import {
  NeptuneGraphClient,
  ExecuteQueryCommand,
} from '@aws-sdk/client-neptune-graph';

/**
 * Neptune Analytics クエリハンドラー
 * AppSync resolverとして動作し、Neptuneからサプライチェーンデータを取得
 */

const NEPTUNE_GRAPH_ID = process.env.NEPTUNE_GRAPH_ID || 'g-1my3glnp96';
const NEPTUNE_REGION = process.env.NEPTUNE_REGION || 'us-west-2';

const client = new NeptuneGraphClient({ region: NEPTUNE_REGION });

interface NeptuneResult {
  results: any[];
  error?: string;
}

/**
 * Neptuneクエリを実行
 */
async function executeQuery(query: string): Promise<NeptuneResult> {
  try {
    const command = new ExecuteQueryCommand({
      graphIdentifier: NEPTUNE_GRAPH_ID,
      queryString: query,
      language: 'OPEN_CYPHER',
    });

    const response = await client.send(command);
    const payload = await response.payload?.transformToString();
    return JSON.parse(payload || '{"results": []}');
  } catch (error) {
    console.error('Neptune query error:', error);
    return { results: [], error: String(error) };
  }
}

/**
 * 全工場を取得
 */
async function getPlants() {
  const query = `
    MATCH (p:Plant)
    OPTIONAL MATCH (p)-[:LOCATED_AT]->(l:Location)
    RETURN 
      p.id as id,
      p.name as name,
      p.location_name as locationName,
      p.lat as latitude,
      p.lon as longitude,
      p.capacity as capacity,
      l.pref as prefecture,
      l.city as city
    ORDER BY p.name
  `;
  const result = await executeQuery(query);
  return result.results || [];
}

/**
 * 全サプライヤーを取得
 */
async function getSuppliers() {
  const query = `
    MATCH (s:Supplier)
    RETURN 
      s.id as id,
      s.name as name,
      s.country as country,
      s.region as region,
      s.lat as latitude,
      s.lon as longitude
    ORDER BY s.name
  `;
  const result = await executeQuery(query);
  return result.results || [];
}

/**
 * 全カスタマを取得
 */
async function getCustomers() {
  const query = `
    MATCH (c:Customer)
    RETURN 
      c.id as id,
      c.name as name,
      c.industry as industry,
      c.lat as latitude,
      c.lon as longitude
    ORDER BY c.name
  `;
  const result = await executeQuery(query);
  return result.results || [];
}

/**
 * サプライチェーン関係を取得（製品情報付き）
 */
async function getSupplyRelations() {
  // SUPPLIES_TO関係を取得
  // 製品情報は別クエリで取得してマージする（OPTIONAL MATCHの問題を回避）
  const relationsQuery = `
    MATCH (from)-[:SUPPLIES_TO]->(to)
    WHERE (from:Plant OR from:Supplier) AND (to:Plant OR to:Customer)
    RETURN 
      from.id as fromId,
      labels(from)[0] as fromType,
      from.name as fromName,
      from.lat as fromLat,
      from.lon as fromLon,
      to.id as toId,
      labels(to)[0] as toType,
      to.name as toName,
      to.lat as toLat,
      to.lon as toLon
  `;
  const relationsResult = await executeQuery(relationsQuery);
  const relations = relationsResult.results || [];
  
  // SUPPLIES_PRODUCT関係を取得
  const productsQuery = `
    MATCH (from)-[sp:SUPPLIES_PRODUCT]->(prod:Product)
    RETURN from.id as fromId, sp.to_node as toId, prod.id as productId, prod.name as productName
  `;
  const productsResult = await executeQuery(productsQuery);
  const productEdges = productsResult.results || [];
  
  // 製品情報をマップに整理（fromId-toId → products[]）
  const productMap = new Map<string, { id: string; name: string }[]>();
  productEdges.forEach((pe: any) => {
    const key = `${pe.fromId}-${pe.toId}`;
    if (!productMap.has(key)) {
      productMap.set(key, []);
    }
    productMap.get(key)!.push({ id: pe.productId, name: pe.productName });
  });
  
  // 関係データに製品情報をマージ
  const result = relations.map((r: any) => ({
    ...r,
    products: productMap.get(`${r.fromId}-${r.toId}`) || [],
  }));
  
  console.log('getSupplyRelations result count:', result.length);
  return result;
}

/**
 * 特定のロケーションで影響を受ける工場を取得
 */
async function getAffectedPlantsByLocation(pref: string, city?: string) {
  let whereClause = `l.pref = '${pref}'`;
  if (city) {
    whereClause += ` OR l.city CONTAINS '${city}'`;
  }

  const query = `
    MATCH (p:Plant)-[:LOCATED_AT]->(l:Location)
    WHERE ${whereClause}
    RETURN 
      p.id as id,
      p.name as name,
      p.lat as latitude,
      p.lon as longitude
  `;
  const result = await executeQuery(query);
  return result.results || [];
}

/**
 * 下流への影響を分析
 */
async function getDownstreamImpact(plantIds: string[]) {
  const idsString = plantIds.map((id) => `'${id}'`).join(', ');

  const query = `
    MATCH (affected:Plant)
    WHERE affected.id IN [${idsString}]
    MATCH path = (affected)-[:SUPPLIES_TO*1..3]->(downstream)
    WHERE downstream:Plant OR downstream:Customer
    RETURN DISTINCT
      affected.id as affectedPlantId,
      affected.name as affectedPlantName,
      downstream.id as downstreamId,
      labels(downstream)[0] as downstreamType,
      downstream.name as downstreamName,
      downstream.lat as latitude,
      downstream.lon as longitude,
      length(path) as depth
    ORDER BY depth
  `;
  const result = await executeQuery(query);
  return result.results || [];
}

/**
 * 影響を受けた注文金額を計算
 */
async function getImpactedOrderAmount(plantIds: string[]) {
  const idsString = plantIds.map((id) => `'${id}'`).join(', ');

  const query = `
    MATCH (p:Plant)
    WHERE p.id IN [${idsString}]
    MATCH (p)-[:SUPPLIES_TO*1..3]->(c:Customer)<-[:PLACED_BY]-(so:SalesOrder)
    RETURN 
      sum(so.amount) as totalAmount,
      count(DISTINCT so) as orderCount,
      count(DISTINCT c) as customerCount
  `;
  const result = await executeQuery(query);
  return result.results?.[0] || { totalAmount: 0, orderCount: 0, customerCount: 0 };
}

/**
 * ノードに関連する販売伝票を取得
 */
async function getSalesOrdersByNode(nodeType: string, nodeId: string) {
  let query = '';
  
  if (nodeType === 'plant') {
    // 工場 → 直接・間接的に供給するカスタマの販売伝票
    query = `
      MATCH (p:Plant {id: '${nodeId}'})-[:SUPPLIES_TO*1..3]->(c:Customer)<-[:PLACED_BY]-(so:SalesOrder)
      RETURN DISTINCT
        so.id as id,
        so.line_item as lineItem,
        so.order_date as orderDate,
        so.requested_date as requestedDate,
        so.amount as amount,
        c.id as customerId,
        c.name as customerName
      ORDER BY so.order_date DESC
    `;
  } else if (nodeType === 'customer') {
    // カスタマの販売伝票
    query = `
      MATCH (c:Customer {id: '${nodeId}'})<-[:PLACED_BY]-(so:SalesOrder)
      RETURN
        so.id as id,
        so.line_item as lineItem,
        so.order_date as orderDate,
        so.requested_date as requestedDate,
        so.amount as amount,
        c.id as customerId,
        c.name as customerName
      ORDER BY so.order_date DESC
    `;
  } else if (nodeType === 'supplier') {
    // サプライヤー → 供給先工場 → カスタマの販売伝票
    query = `
      MATCH (s:Supplier {id: '${nodeId}'})-[:SUPPLIES_TO]->(p:Plant)-[:SUPPLIES_TO*1..2]->(c:Customer)<-[:PLACED_BY]-(so:SalesOrder)
      RETURN DISTINCT
        so.id as id,
        so.line_item as lineItem,
        so.order_date as orderDate,
        so.requested_date as requestedDate,
        so.amount as amount,
        c.id as customerId,
        c.name as customerName
      ORDER BY so.order_date DESC
    `;
  }

  if (!query) return [];
  const result = await executeQuery(query);
  return result.results || [];
}

/**
 * ノードに関連する購買伝票を取得
 */
async function getPurchaseOrdersByNode(nodeType: string, nodeId: string) {
  let query = '';

  if (nodeType === 'supplier') {
    // サプライヤーへの購買伝票
    query = `
      MATCH (s:Supplier {id: '${nodeId}'})<-[:ISSUED_TO]-(po:PurchaseOrder)
      RETURN
        po.id as id,
        po.line_item as lineItem,
        po.order_date as orderDate,
        po.status as status,
        po.amount as amount,
        s.id as supplierId,
        s.name as supplierName
      ORDER BY po.order_date DESC
    `;
  } else if (nodeType === 'plant') {
    // 工場に供給するサプライヤーの購買伝票
    query = `
      MATCH (s:Supplier)-[:SUPPLIES_TO]->(p:Plant {id: '${nodeId}'})
      MATCH (s)<-[:ISSUED_TO]-(po:PurchaseOrder)
      RETURN
        po.id as id,
        po.line_item as lineItem,
        po.order_date as orderDate,
        po.status as status,
        po.amount as amount,
        s.id as supplierId,
        s.name as supplierName
      ORDER BY po.order_date DESC
    `;
  } else if (nodeType === 'customer') {
    // カスタマに供給する工場のサプライヤーの購買伝票
    query = `
      MATCH (s:Supplier)-[:SUPPLIES_TO]->(p:Plant)-[:SUPPLIES_TO*1..2]->(c:Customer {id: '${nodeId}'})
      MATCH (s)<-[:ISSUED_TO]-(po:PurchaseOrder)
      RETURN DISTINCT
        po.id as id,
        po.line_item as lineItem,
        po.order_date as orderDate,
        po.status as status,
        po.amount as amount,
        s.id as supplierId,
        s.name as supplierName
      ORDER BY po.order_date DESC
    `;
  }

  if (!query) return [];
  const result = await executeQuery(query);
  return result.results || [];
}

/**
 * 全製品を取得
 */
async function getProducts() {
  // OPTIONAL MATCHとWHEREの組み合わせで問題が発生する可能性があるため、
  // サブクエリパターンを使用
  const query = `
    MATCH (p:Product)
    OPTIONAL MATCH (p)-[:MANUFACTURED_AT]->(pl:Plant)
    RETURN 
      p.id as id,
      p.name as name,
      p.type as type,
      p.unit as unit,
      pl.id as plantId,
      pl.name as plantName
    ORDER BY p.name
  `;
  const result = await executeQuery(query);
  return result.results || [];
}

/**
 * 工場で製造される製品とそのBOM（部品構成）を取得
 * 製造製品のBOMには、実際の供給元工場（SUPPLIES_PRODUCT）を表示
 * @param plantId 対象工場ID
 */
async function getProductsWithBOM(plantId: string) {
  // この工場で製造される製品を取得
  const productsQuery = `
    MATCH (prod:Product)-[:MANUFACTURED_AT]->(pl:Plant {id: '${plantId}'})
    RETURN 
      prod.id as id,
      prod.name as name,
      prod.type as type,
      prod.unit as unit
  `;
  const productsResult = await executeQuery(productsQuery);
  const products = productsResult.results || [];

  if (products.length === 0) {
    return [];
  }

  // 各製品のBOM（部品構成）を取得
  // 供給元は SUPPLIES_PRODUCT 関係から取得（実際の供給関係）
  const productIds = products.map((p: any) => `'${p.id}'`).join(', ');
  const bomQuery = `
    MATCH (parent:Product)-[c:CONSISTS_OF]->(child:Product)
    WHERE parent.id IN [${productIds}]
    OPTIONAL MATCH (supplier:Plant)-[sp:SUPPLIES_PRODUCT]->(child)
    WHERE sp.to_node = '${plantId}'
    RETURN 
      parent.id as parentId,
      child.id as componentId,
      child.name as componentName,
      child.type as componentType,
      c.quantity as quantity,
      supplier.id as supplierPlantId,
      supplier.name as supplierPlantName
  `;
  const bomResult = await executeQuery(bomQuery);
  const bomRows = bomResult.results || [];

  // 製品ごとにBOMをグループ化
  const bomMap = new Map<string, any[]>();
  bomRows.forEach((row: any) => {
    if (!bomMap.has(row.parentId)) {
      bomMap.set(row.parentId, []);
    }
    bomMap.get(row.parentId)!.push({
      componentId: row.componentId,
      componentName: row.componentName,
      componentType: row.componentType,
      quantity: row.quantity,
      supplierPlantId: row.supplierPlantId,
      supplierPlantName: row.supplierPlantName,
    });
  });

  // 製品にBOMを付与して返す
  return products.map((p: any) => ({
    ...p,
    components: bomMap.get(p.id) || [],
  }));
}

/**
 * 工場の影響製品を取得
 * 
 * 2つのケースを処理:
 * 1. 対象工場自体が直接影響を受けている場合 → その工場で製造される製品が影響
 * 2. 上流の影響工場から供給される製品 → 特定の供給元からの部品が影響
 * 
 * 重要: 影響部品は (componentId, supplierPlantId) のペアで識別する
 * 同じ部品でも、影響を受けていない工場から供給されるものは正常
 * 
 * @param plantId 対象工場ID
 * @param impactedPlantIds 影響を受けている工場IDリスト（直接影響のみ）
 */
async function getImpactedProducts(plantId: string, impactedPlantIds: string[]) {
  if (impactedPlantIds.length === 0) {
    return { 
      impactedProductIds: [], 
      upstreamImpactedPlants: [], 
      impactedComponents: [],
      isDirectlyImpacted: false,
      manufacturedProducts: [],
    };
  }

  const idsString = impactedPlantIds.map((id) => `'${id}'`).join(', ');
  
  // この工場自体が直接影響を受けているかチェック
  const isDirectlyImpacted = impactedPlantIds.includes(plantId);
  
  // 直接影響工場の場合: この工場で製造される製品を取得
  let manufacturedProducts: any[] = [];
  if (isDirectlyImpacted) {
    const manufacturedQuery = `
      MATCH (prod:Product)-[:MANUFACTURED_AT]->(pl:Plant {id: '${plantId}'})
      RETURN prod.id as productId, prod.name as productName
    `;
    const manufacturedResult = await executeQuery(manufacturedQuery);
    manufacturedProducts = manufacturedResult.results || [];
  }

  // 上流から供給される製品（SUPPLIES_PRODUCT関係）を取得
  // supplierPlantIdを含めて、どの工場からの供給かを特定
  const directQuery = `
    MATCH (upstream:Plant)-[sp:SUPPLIES_PRODUCT]->(prod:Product)
    WHERE upstream.id IN [${idsString}] AND sp.to_node = '${plantId}'
    RETURN DISTINCT
      upstream.id as upstreamId,
      upstream.name as upstreamName,
      prod.id as productId,
      prod.name as productName,
      'direct' as impactType
  `;
  const directResult = await executeQuery(directQuery);
  const directRows = directResult.results || [];

  // BOM経由の影響を確認
  // この工場で製造する製品の部品が、影響工場から供給されているかをチェック
  const bomQuery = `
    MATCH (prod:Product)-[:MANUFACTURED_AT]->(pl:Plant {id: '${plantId}'})
    MATCH (prod)-[:CONSISTS_OF]->(component:Product)
    MATCH (upstream:Plant)-[sp:SUPPLIES_PRODUCT]->(component)
    WHERE upstream.id IN [${idsString}] AND sp.to_node = '${plantId}'
    RETURN DISTINCT
      upstream.id as upstreamId,
      upstream.name as upstreamName,
      component.id as productId,
      component.name as productName,
      prod.id as parentProductId,
      prod.name as parentProductName,
      'bom' as impactType
  `;
  const bomResult = await executeQuery(bomQuery);
  const bomRows = bomResult.results || [];

  // 結果を統合
  // キーを (productId, upstreamId) のペアにして、供給元ごとに区別
  const componentMap = new Map<string, any>();
  
  directRows.forEach((r: any) => {
    const key = `${r.productId}-${r.upstreamId}`;
    componentMap.set(key, r);
  });
  
  bomRows.forEach((r: any) => {
    const key = `${r.productId}-${r.upstreamId}`;
    componentMap.set(key, r);
  });

  const allRows = Array.from(componentMap.values());

  // 影響製品IDを抽出（重複排除）
  const impactedProductIds = [...new Set(allRows.map((r: any) => r.productId))];
  
  // 直接影響工場の製造製品も追加
  manufacturedProducts.forEach((p: any) => {
    if (!impactedProductIds.includes(p.productId)) {
      impactedProductIds.push(p.productId);
    }
  });

  // 上流影響工場を抽出（重複排除）
  const upstreamMap = new Map<string, { id: string; name: string }>();
  allRows.forEach((r: any) => {
    if (!upstreamMap.has(r.upstreamId)) {
      upstreamMap.set(r.upstreamId, { id: r.upstreamId, name: r.upstreamName });
    }
  });
  const upstreamImpactedPlants = Array.from(upstreamMap.values());

  // 影響部品の詳細（supplierPlantIdを含めて供給元を特定）
  const impactedComponents = allRows.map((r: any) => ({
    componentId: r.productId,
    componentName: r.productName,
    supplierId: r.upstreamId,
    supplierName: r.upstreamName,
    supplierPlantId: r.upstreamId,  // フロントエンドで使用
    impactType: r.impactType,
    parentProductId: r.parentProductId || null,
    parentProductName: r.parentProductName || null,
  }));
  
  // 直接影響工場の製造製品も影響部品として追加
  manufacturedProducts.forEach((p: any) => {
    impactedComponents.push({
      componentId: p.productId,
      componentName: p.productName,
      supplierId: plantId,
      supplierName: null,  // 自工場製造
      supplierPlantId: plantId,
      impactType: 'manufactured',  // この工場で製造
      parentProductId: null,
      parentProductName: null,
    });
  });

  return { 
    impactedProductIds, 
    upstreamImpactedPlants, 
    impactedComponents,
    isDirectlyImpacted,
    manufacturedProducts: manufacturedProducts.map((p: any) => ({
      productId: p.productId,
      productName: p.productName,
    })),
  };
}

/**
 * 影響工場の代替工場候補を検索し、上位3プランを返す
 * アルゴリズム:
 * 1. 影響工場が製造する製品を特定
 * 2. 同じ製品を製造できる非影響工場を候補として取得
 * 3. 候補工場の組み合わせで影響工場のキャパシティをカバーできるプランを生成
 * 4. 下流カスタマへのルート距離で評価し、上位3プランを返す
 */
async function getSubstitutePlants(plantId: string, targetProductIds?: string[]) {
  // 影響工場の情報と製造製品を取得
  const impactedQuery = `
    MATCH (impacted:Plant {id: '${plantId}'})
    OPTIONAL MATCH (prod:Product)-[:MANUFACTURED_AT]->(impacted)
    RETURN 
      impacted.id as plantId,
      impacted.name as plantName,
      impacted.capacity as capacity,
      impacted.lat as lat,
      impacted.lon as lon,
      collect({id: prod.id, name: prod.name, type: prod.type}) as products
  `;
  const impactedResult = await executeQuery(impactedQuery);
  const impactedInfo = impactedResult.results?.[0];
  if (!impactedInfo) return [];

  const requiredCapacity = impactedInfo.capacity || 0;
  let impactedProducts = (impactedInfo.products || []).filter((p: any) => p.id);

  // targetProductIdsが指定されている場合、対象製品に絞り込む
  if (targetProductIds && targetProductIds.length > 0) {
    const targetSet = new Set(targetProductIds);
    impactedProducts = impactedProducts.filter((p: any) => targetSet.has(p.id));
  }

  if (impactedProducts.length === 0) return [];

  // 同じ製品を製造できる非影響工場を取得
  const productIds = impactedProducts.map((p: any) => `'${p.id}'`).join(', ');
  const candidateQuery = `
    MATCH (prod:Product)-[:MANUFACTURED_AT]->(candidate:Plant)
    WHERE prod.id IN [${productIds}] AND candidate.id <> '${plantId}'
    RETURN 
      candidate.id as id,
      candidate.name as name,
      candidate.capacity as capacity,
      candidate.lat as lat,
      candidate.lon as lon,
      candidate.location_name as locationName,
      collect(DISTINCT {id: prod.id, name: prod.name}) as products
    ORDER BY candidate.capacity DESC
  `;
  const candidateResult = await executeQuery(candidateQuery);
  const candidates = candidateResult.results || [];

  if (candidates.length === 0) return [];

  // 下流カスタマを取得（距離計算用）
  const downstreamQuery = `
    MATCH (impacted:Plant {id: '${plantId}'})-[:SUPPLIES_TO*1..2]->(c:Customer)
    RETURN DISTINCT c.id as id, c.name as name, c.lat as lat, c.lon as lon
  `;
  const downstreamResult = await executeQuery(downstreamQuery);
  const downstreamCustomers = downstreamResult.results || [];

  // ハバーサイン距離計算（km）
  function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // 候補工場から下流カスタマへの平均距離を計算
  function avgDistanceToCustomers(candidateLat: number, candidateLon: number): number {
    if (downstreamCustomers.length === 0) return 0;
    const total = downstreamCustomers.reduce((sum: number, c: any) => {
      return sum + haversine(candidateLat, candidateLon, c.lat || 0, c.lon || 0);
    }, 0);
    return total / downstreamCustomers.length;
  }

  // 全製品IDセット（カバレッジ確認用）
  const requiredProductIds = new Set<string>(impactedProducts.map((p: any) => p.id));

  // プラン生成: 貪欲法で組み合わせを生成
  // 各候補を距離順にソートし、キャパシティを満たすまで追加
  const plans: any[] = [];

  // 戦略1: 距離が近い順に追加
  const byDistance = [...candidates].sort((a, b) =>
    avgDistanceToCustomers(a.lat, a.lon) - avgDistanceToCustomers(b.lat, b.lon)
  );
  plans.push(buildPlan(byDistance, requiredCapacity, requiredProductIds));

  // 戦略2: キャパシティが大きい順に追加
  const byCapacity = [...candidates].sort((a, b) => (b.capacity || 0) - (a.capacity || 0));
  plans.push(buildPlan(byCapacity, requiredCapacity, requiredProductIds));

  // 戦略3: 距離×キャパシティのバランス（距離/キャパシティ比が小さい順）
  const byBalance = [...candidates].sort((a, b) => {
    const ratioA = avgDistanceToCustomers(a.lat, a.lon) / Math.max(a.capacity || 1, 1);
    const ratioB = avgDistanceToCustomers(b.lat, b.lon) / Math.max(b.capacity || 1, 1);
    return ratioA - ratioB;
  });
  plans.push(buildPlan(byBalance, requiredCapacity, requiredProductIds));

  function buildPlan(sortedCandidates: any[], reqCapacity: number, reqProducts: Set<string>) {
    const selected: any[] = [];
    let totalCap = 0;
    const coveredProducts = new Set<string>();

    for (const c of sortedCandidates) {
      // まだ製品カバレッジが不足、またはキャパシティが不足なら追加
      const candidateProducts = (c.products || []).map((p: any) => p.id);
      const addsNewProduct = candidateProducts.some((pid: string) => !coveredProducts.has(pid));
      const needsCapacity = totalCap < reqCapacity;

      if (addsNewProduct || needsCapacity) {
        const dist = avgDistanceToCustomers(c.lat, c.lon);
        selected.push({
          id: c.id,
          name: c.name,
          capacity: c.capacity || 0,
          lat: c.lat,
          lon: c.lon,
          locationName: c.locationName || '',
          products: c.products || [],
          distanceToCustomers: Math.round(dist),
        });
        totalCap += c.capacity || 0;
        candidateProducts.forEach((pid: string) => coveredProducts.add(pid));
      }

      // 全製品カバー＋キャパシティ充足で終了
      const allCovered = [...reqProducts].every(pid => coveredProducts.has(pid));
      if (allCovered && totalCap >= reqCapacity) break;
    }

    const allCovered = [...reqProducts].every(pid => coveredProducts.has(pid));
    const totalDistance = selected.reduce((sum, s) => sum + s.distanceToCustomers, 0);

    return {
      plants: selected,
      totalCapacity: totalCap,
      requiredCapacity: reqCapacity,
      capacityCovered: totalCap >= reqCapacity,
      productsCovered: allCovered,
      totalDistance: Math.round(totalDistance),
      avgDistance: selected.length > 0 ? Math.round(totalDistance / selected.length) : 0,
    };
  }

  // 重複プランを除去し、距離でソート
  const uniquePlans: any[] = [];
  const seen = new Set<string>();
  for (const plan of plans) {
    if (!plan.capacityCovered || !plan.productsCovered) continue;
    const key = plan.plants.map((p: any) => p.id).sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    uniquePlans.push(plan);
  }

  // 距離でソートし上位3件
  uniquePlans.sort((a, b) => a.totalDistance - b.totalDistance);

  return uniquePlans.slice(0, 3).map((plan, idx) => ({
    planIndex: idx + 1,
    plants: plan.plants,
    totalCapacity: plan.totalCapacity,
    requiredCapacity: plan.requiredCapacity,
    totalDistance: plan.totalDistance,
    avgDistance: plan.avgDistance,
  }));
}

/**
 * Lambda ハンドラー
 */
export const handler = async (event: any) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const { fieldName, arguments: args } = event;

  try {
    switch (fieldName) {
      case 'getPlants':
        return await getPlants();

      case 'getSuppliers':
        return await getSuppliers();

      case 'getCustomers':
        return await getCustomers();

      case 'getSupplyRelations':
        return await getSupplyRelations();

      case 'getProducts':
        return await getProducts();

      case 'getProductsWithBOM':
        return await getProductsWithBOM(args.plantId);

      case 'getAffectedPlantsByLocation':
        return await getAffectedPlantsByLocation(args.pref, args.city);

      case 'getDownstreamImpact':
        return await getDownstreamImpact(args.plantIds);

      case 'getImpactedOrderAmount':
        return await getImpactedOrderAmount(args.plantIds);

      case 'getSalesOrdersByNode':
        return await getSalesOrdersByNode(args.nodeType, args.nodeId);

      case 'getPurchaseOrdersByNode':
        return await getPurchaseOrdersByNode(args.nodeType, args.nodeId);

      case 'getSubstitutePlants':
        return await getSubstitutePlants(args.plantId, args.targetProductIds);

      case 'getImpactedProducts':
        return await getImpactedProducts(args.plantId, args.impactedPlantIds || []);

      default:
        throw new Error(`Unknown field: ${fieldName}`);
    }
  } catch (error) {
    console.error('Handler error:', error);
    throw error;
  }
};
