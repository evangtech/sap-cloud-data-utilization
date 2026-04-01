import {
  NeptuneGraphClient,
  ExecuteQueryCommand,
} from '@aws-sdk/client-neptune-graph';

/**
 * Neptune Analytics クエリハンドラー
 * AppSync resolverとして動作し、Neptuneからサプライチェーンデータを取得
 */

const NEPTUNE_GRAPH_ID = process.env.NEPTUNE_GRAPH_ID || 'g-844qqbri1a';
const NEPTUNE_REGION = process.env.NEPTUNE_REGION || 'us-west-2';

const client = new NeptuneGraphClient({ region: NEPTUNE_REGION });

interface NeptuneResult {
  results: any[];
  error?: string;
}

/**
 * Neptuneクエリを実行
 * エラー時は throw — 呼び出し元で partial data を隠さない
 */
async function executeQuery(query: string): Promise<NeptuneResult> {
  const command = new ExecuteQueryCommand({
    graphIdentifier: NEPTUNE_GRAPH_ID,
    queryString: query,
    language: 'OPEN_CYPHER',
  });

  const response = await client.send(command);
  const payload = await response.payload?.transformToString();
  if (!payload) {
    throw new Error('Neptune returned empty payload');
  }
  const parsed = JSON.parse(payload);
  if (!parsed.results) {
    throw new Error(`Neptune returned no results field: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  return parsed;
}

/**
 * 既存のクエリで try/catch が必要な場合のみ使用 (非シミュレーション系)
 * シミュレーション以外の既存クエリは後方互換性のため残す
 */
async function executeQuerySafe(query: string): Promise<NeptuneResult> {
  try {
    return await executeQuery(query);
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
    OPTIONAL MATCH (p)-[:LOCATED_IN]->(c:Country)
    RETURN
      p.id as id,
      p.name as name,
      p.country_code as locationName,
      p.lat as latitude,
      p.lon as longitude,
      p.capacity as capacity,
      c.name as prefecture,
      c.region as city
    ORDER BY p.name
  `;
  const result = await executeQuerySafe(query);
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
      s.country_code as country,
      s.region as region,
      s.lat as latitude,
      s.lon as longitude
    ORDER BY s.name
  `;
  const result = await executeQuerySafe(query);
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
      c.country_code as countryCode,
      c.lat as latitude,
      c.lon as longitude
    ORDER BY c.name
  `;
  const result = await executeQuerySafe(query);
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
    WHERE (from:Plant OR from:Supplier OR from:Warehouse) AND (to:Plant OR to:Customer OR to:Warehouse)
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
  const relationsResult = await executeQuerySafe(relationsQuery);
  const relations = relationsResult.results || [];

  // 製品情報を取得（fromId + toId ペアごとに紐付く製品を特定）
  // Supplier→Plant の場合: Supplier-[:SUPPLIES]->Material<-[:HAS_COMPONENT]-Product-[:PRODUCED_AT]->Plant
  // Plant→Warehouse/Customer の場合: Product-[:PRODUCED_AT]->Plant で紐付く製品
  const supplierProductsQuery = `
    MATCH (s:Supplier)-[:SUPPLIES_TO]->(dest)
    MATCH (s)-[:SUPPLIES]->(m:Material)<-[:HAS_COMPONENT]-(prod:Product)-[:PRODUCED_AT]->(dest)
    RETURN s.id as fromId, dest.id as toId, prod.id as productId, prod.description as productName
  `;
  const plantProductsQuery = `
    MATCH (p:Plant)-[:SUPPLIES_TO]->(dest)
    MATCH (prod:Product)-[:PRODUCED_AT]->(p)
    RETURN p.id as fromId, dest.id as toId, prod.id as productId, prod.description as productName
  `;
  const [suppProdResult, plantProdResult] = await Promise.all([
    executeQuerySafe(supplierProductsQuery),
    executeQuerySafe(plantProductsQuery),
  ]);
  const productEdges = [
    ...(suppProdResult.results || []),
    ...(plantProdResult.results || []),
  ];

  // 製品情報をマップに整理（fromId-toId ペア → products[]）
  const productMap = new Map<string, { id: string; name: string }[]>();
  productEdges.forEach((pe: any) => {
    const key = `${pe.fromId}::${pe.toId}`;
    if (!productMap.has(key)) {
      productMap.set(key, []);
    }
    const existing = productMap.get(key)!;
    if (!existing.some((p) => p.id === pe.productId)) {
      existing.push({ id: pe.productId, name: pe.productName });
    }
  });

  // 関係データに製品情報をマージ（fromId-toId ペアで正確にマッチ）
  const result = relations.map((r: any) => ({
    ...r,
    products: productMap.get(`${r.fromId}::${r.toId}`) || [],
  }));

  console.log('getSupplyRelations result count:', result.length);
  return result;
}

/**
 * 特定のロケーションで影響を受ける工場を取得
 */
async function getAffectedPlantsByLocation(pref: string, city?: string) {
  let whereClause = `c.name = '${pref}' OR c.code = '${pref}'`;
  if (city) {
    whereClause += ` OR c.region CONTAINS '${city}'`;
  }

  const query = `
    MATCH (p:Plant)-[:LOCATED_IN]->(c:Country)
    WHERE ${whereClause}
    RETURN
      p.id as id,
      p.name as name,
      p.lat as latitude,
      p.lon as longitude
  `;
  const result = await executeQuerySafe(query);
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
  const result = await executeQuerySafe(query);
  return result.results || [];
}

/**
 * 影響を受けた注文金額を計算
 */
async function getImpactedOrderAmount(plantIds: string[]) {
  const idsString = plantIds.map((id) => `'${id}'`).join(', ');

  // v2: ORDERED_BY has annual_order_qty and unit_price_jpy (not amount)
  const query = `
    MATCH (p:Plant)
    WHERE p.id IN [${idsString}]
    MATCH (p)-[:SUPPLIES_TO*1..3]->(c:Customer)<-[o:ORDERED_BY]-(prod:Product)
    RETURN
      sum(o.annual_order_qty * o.unit_price_jpy) as totalAmount,
      count(DISTINCT prod) as orderCount,
      count(DISTINCT c) as customerCount
  `;
  const result = await executeQuerySafe(query);
  return result.results?.[0] || { totalAmount: 0, orderCount: 0, customerCount: 0 };
}

/**
 * ノードに関連する販売伝票を取得
 */
async function getSalesOrdersByNode(nodeType: string, nodeId: string) {
  let query = '';

  if (nodeType === 'plant') {
    // 工場 → 直接・間接的に供給するカスタマの注文（ORDERED_BY経由）
    // v2: ORDERED_BY has annual_order_qty, unit_price_jpy (not order_id/amount)
    query = `
      MATCH (p:Plant {id: '${nodeId}'})-[:SUPPLIES_TO*1..3]->(c:Customer)
      MATCH (prod:Product)-[o:ORDERED_BY]->(c)
      RETURN DISTINCT
        prod.id as id,
        prod.description as lineItem,
        '' as orderDate,
        '' as requestedDate,
        toFloat(o.annual_order_qty) * toFloat(o.unit_price_jpy) as amount,
        c.id as customerId,
        c.name as customerName
      ORDER BY amount DESC
    `;
  } else if (nodeType === 'customer') {
    // カスタマの注文（ORDERED_BY経由）
    query = `
      MATCH (prod:Product)-[o:ORDERED_BY]->(c:Customer {id: '${nodeId}'})
      RETURN
        prod.id as id,
        prod.description as lineItem,
        '' as orderDate,
        '' as requestedDate,
        toFloat(o.annual_order_qty) * toFloat(o.unit_price_jpy) as amount,
        c.id as customerId,
        c.name as customerName
      ORDER BY amount DESC
    `;
  } else if (nodeType === 'supplier') {
    // サプライヤー → 供給先工場 → カスタマの注文（ORDERED_BY経由）
    query = `
      MATCH (s:Supplier {id: '${nodeId}'})-[:SUPPLIES_TO]->(p:Plant)-[:SUPPLIES_TO*1..2]->(c:Customer)
      MATCH (prod:Product)-[o:ORDERED_BY]->(c)
      RETURN DISTINCT
        prod.id as id,
        prod.description as lineItem,
        '' as orderDate,
        '' as requestedDate,
        toFloat(o.annual_order_qty) * toFloat(o.unit_price_jpy) as amount,
        c.id as customerId,
        c.name as customerName
      ORDER BY amount DESC
    `;
  }

  if (!query) return [];
  const result = await executeQuerySafe(query);
  return result.results || [];
}

/**
 * ノードに関連する購買伝票を取得
 */
async function getPurchaseOrdersByNode(nodeType: string, nodeId: string) {
  let query = '';

  if (nodeType === 'supplier') {
    // サプライヤーが供給する資材情報（SUPPLIES経由）
    // v2: SUPPLIES has is_primary only. Use material properties for display.
    query = `
      MATCH (s:Supplier {id: '${nodeId}'})-[r:SUPPLIES]->(m:Material)
      RETURN
        m.id as id,
        m.description as lineItem,
        CASE WHEN r.is_primary THEN 'primary' ELSE 'alternative' END as orderDate,
        CASE WHEN r.is_primary THEN 'active' ELSE 'standby' END as status,
        m.unit_price as amount,
        s.id as supplierId,
        s.name as supplierName
      ORDER BY r.is_primary DESC, m.id
    `;
  } else if (nodeType === 'plant') {
    // 工場に供給するサプライヤーの資材情報
    query = `
      MATCH (s:Supplier)-[:SUPPLIES_TO]->(p:Plant {id: '${nodeId}'})
      MATCH (s)-[r:SUPPLIES]->(m:Material)
      RETURN
        m.id as id,
        m.description as lineItem,
        CASE WHEN r.is_primary THEN 'primary' ELSE 'alternative' END as orderDate,
        CASE WHEN r.is_primary THEN 'active' ELSE 'standby' END as status,
        m.unit_price as amount,
        s.id as supplierId,
        s.name as supplierName
      ORDER BY r.is_primary DESC, m.id
    `;
  } else if (nodeType === 'customer') {
    // カスタマに供給する工場のサプライヤーの資材情報
    query = `
      MATCH (s:Supplier)-[:SUPPLIES_TO]->(p:Plant)-[:SUPPLIES_TO*1..2]->(c:Customer {id: '${nodeId}'})
      MATCH (s)-[r:SUPPLIES]->(m:Material)
      RETURN DISTINCT
        m.id as id,
        m.description as lineItem,
        CASE WHEN r.is_primary THEN 'primary' ELSE 'alternative' END as orderDate,
        CASE WHEN r.is_primary THEN 'active' ELSE 'standby' END as status,
        m.unit_price as amount,
        s.id as supplierId,
        s.name as supplierName
      ORDER BY r.is_primary DESC, m.id
    `;
  }

  if (!query) return [];
  const result = await executeQuerySafe(query);
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
    OPTIONAL MATCH (p)-[:PRODUCED_AT]->(pl:Plant)
    RETURN
      p.id as id,
      p.description as name,
      p.product_group as type,
      p.margin_rate as unit,
      pl.id as plantId,
      pl.name as plantName
    ORDER BY p.description
  `;
  const result = await executeQuerySafe(query);
  return result.results || [];
}

/**
 * 工場で製造される製品とそのBOM（部品構成）を取得
 * 製造製品のBOMには、実際の供給元（SUPPLIES経由のSupplier）を表示
 * @param plantId 対象工場ID
 */
async function getProductsWithBOM(plantId: string) {
  // この工場で製造される製品を取得
  const productsQuery = `
    MATCH (prod:Product)-[:PRODUCED_AT]->(pl:Plant {id: '${plantId}'})
    RETURN
      prod.id as id,
      prod.description as name,
      prod.product_group as type,
      prod.margin_rate as unit
  `;
  const productsResult = await executeQuerySafe(productsQuery);
  const products = productsResult.results || [];

  if (products.length === 0) {
    return [];
  }

  // 各製品のBOM（部品構成）を取得
  // HAS_COMPONENT (Product→Material) + SUPPLIES (Supplier→Material) で供給元を取得
  const productIds = products.map((p: any) => `'${p.id}'`).join(', ');
  const bomQuery = `
    MATCH (parent:Product)-[c:HAS_COMPONENT]->(m:Material)
    WHERE parent.id IN [${productIds}]
    OPTIONAL MATCH (supplier:Supplier)-[:SUPPLIES]->(m)
    RETURN
      parent.id as parentId,
      m.id as componentId,
      m.description as componentName,
      m.material_group as componentType,
      c.quantity as quantity,
      supplier.id as supplierPlantId,
      supplier.name as supplierPlantName
  `;
  const bomResult = await executeQuerySafe(bomQuery);
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
      MATCH (prod:Product)-[:PRODUCED_AT]->(pl:Plant {id: '${plantId}'})
      RETURN prod.id as productId, prod.description as productName
    `;
    const manufacturedResult = await executeQuerySafe(manufacturedQuery);
    manufacturedProducts = manufacturedResult.results || [];
  }

  // 上流から供給される資材経由で影響を受ける製品を取得
  // SUPPLIES (Supplier→Material) + HAS_COMPONENT (Product→Material)
  // 影響工場に関連するサプライヤーからの供給を特定
  const directQuery = `
    MATCH (upstream:Plant)<-[:SUPPLIES_TO]-(s:Supplier)-[:SUPPLIES]->(m:Material)<-[:HAS_COMPONENT]-(prod:Product)
    WHERE upstream.id IN [${idsString}]
    MATCH (prod)-[:PRODUCED_AT]->(pl:Plant {id: '${plantId}'})
    RETURN DISTINCT
      upstream.id as upstreamId,
      upstream.name as upstreamName,
      prod.id as productId,
      prod.description as productName,
      'direct' as impactType
  `;
  const directResult = await executeQuerySafe(directQuery);
  const directRows = directResult.results || [];

  // BOM経由の影響を確認
  // この工場で製造する製品の部品（Material）が、影響工場関連サプライヤーから供給されているかをチェック
  const bomQuery = `
    MATCH (prod:Product)-[:PRODUCED_AT]->(pl:Plant {id: '${plantId}'})
    MATCH (prod)-[:HAS_COMPONENT]->(m:Material)
    MATCH (s:Supplier)-[:SUPPLIES]->(m)
    MATCH (s)-[:SUPPLIES_TO]->(upstream:Plant)
    WHERE upstream.id IN [${idsString}]
    RETURN DISTINCT
      upstream.id as upstreamId,
      upstream.name as upstreamName,
      m.id as productId,
      m.description as productName,
      prod.id as parentProductId,
      prod.description as parentProductName,
      'bom' as impactType
  `;
  const bomResult = await executeQuerySafe(bomQuery);
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
  const impactedProductIds = Array.from(new Set(allRows.map((r: any) => r.productId)));
  
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
    OPTIONAL MATCH (prod:Product)-[:PRODUCED_AT]->(impacted)
    RETURN
      impacted.id as plantId,
      impacted.name as plantName,
      impacted.capacity as capacity,
      impacted.lat as lat,
      impacted.lon as lon,
      collect({id: prod.id, name: prod.description, type: prod.product_group}) as products
  `;
  const impactedResult = await executeQuerySafe(impactedQuery);
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
    MATCH (prod:Product)-[:PRODUCED_AT]->(candidate:Plant)
    WHERE prod.id IN [${productIds}] AND candidate.id <> '${plantId}'
    OPTIONAL MATCH (candidate)-[:LOCATED_IN]->(c:Country)
    RETURN
      candidate.id as id,
      candidate.name as name,
      candidate.capacity as capacity,
      candidate.lat as lat,
      candidate.lon as lon,
      candidate.country_code as locationName,
      collect(DISTINCT {id: prod.id, name: prod.description}) as products
    ORDER BY candidate.capacity DESC
  `;
  const candidateResult = await executeQuerySafe(candidateQuery);
  const candidates = candidateResult.results || [];

  if (candidates.length === 0) return [];

  // 下流カスタマを取得（距離計算用）
  const downstreamQuery = `
    MATCH (impacted:Plant {id: '${plantId}'})-[:SUPPLIES_TO*1..2]->(c:Customer)
    RETURN DISTINCT c.id as id, c.name as name, c.lat as lat, c.lon as lon
  `;
  const downstreamResult = await executeQuerySafe(downstreamQuery);
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
      const allCovered = Array.from(reqProducts).every(pid => coveredProducts.has(pid));
      if (allCovered && totalCap >= reqCapacity) break;
    }

    const allCovered = Array.from(reqProducts).every(pid => coveredProducts.has(pid));
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
 * What-if シミュレーション用データ一括取得
 * BOM構成 + 素材価格 + サプライヤー + 関税 + 受注 + 代替 + 為替
 */
async function getSimulationData() {
  // Sub-query 1: BOM + Material + Supplier
  // originCountry = material の製造国 (関税判定に使用)
  // supplierCountry = supplier の所在国 (地理集中度・リスク計算に使用)
  // Join through PRODUCED_AT → Plant ← SUPPLIES_TO to ensure a supplier
  // is only associated with a product if it supplies a plant where that product is made.
  // DISTINCT removes duplicates when a supplier supplies multiple plants for the same product.
  const bomQuery = `
    MATCH (p:Product)-[bom:HAS_COMPONENT]->(m:Material)
    OPTIONAL MATCH (p)-[:PRODUCED_AT]->(plt:Plant)<-[:SUPPLIES_TO]-(s:Supplier)-[sup:SUPPLIES]->(m)
    OPTIONAL MATCH (m)-[:CLASSIFIED_AS]->(hs:HSCode)
    RETURN DISTINCT
      p.id AS productId, p.description AS productName,
      p.cost_estimate_jpy AS baseCostJpy,
      p.sales_price_jpy AS salesPriceJpy,
      p.margin_rate AS marginRate,
      m.id AS materialId, m.description AS materialName,
      m.unit_price AS materialUnitPrice, m.currency AS materialCurrency,
      m.origin_country AS originCountry,
      hs.code AS hsCode,
      bom.quantity AS bomQuantity,
      s.id AS supplierId, s.name AS supplierName,
      s.country_code AS supplierCountry,
      sup.is_primary AS isPrimary
    ORDER BY p.id, m.id
  `;

  // Sub-query 2: Tariffs
  const tariffQuery = `
    MATCH (h:HSCode)-[tar:TARIFF_APPLIES]->(c:Country)
    RETURN
      h.code AS hsCode,
      c.code AS originCountry,
      tar.importing_country AS importingCountry,
      tar.tariff_rate_pct AS tariffRatePct,
      tar.tariff_type AS tariffType
  `;

  // Sub-query 3: Orders
  const orderQuery = `
    MATCH (p:Product)-[ord:ORDERED_BY]->(cust:Customer)
    RETURN
      p.id AS productId, p.description AS productName,
      cust.id AS customerId, cust.name AS customerName,
      ord.annual_order_qty AS annualOrderQty,
      ord.unit_price_jpy AS unitPriceJpy
  `;

  // Sub-query 4: Alternatives
  const altQuery = `
    MATCH (s:Supplier)-[alt:ALTERNATIVE_TO]->(altSup:Supplier)
    RETURN
      s.id AS supplierId, s.name AS supplierName,
      altSup.id AS altSupplierId, altSup.name AS altSupplierName,
      alt.quality_score_diff AS qualityDiff,
      alt.price_diff_pct AS priceDiffPct,
      alt.lead_time_diff_days AS leadTimeDiff,
      alt.risk_score_diff AS riskScoreDiff
  `;

  // Sub-query 5: FX Rates (from Country nodes)
  const fxQuery = `
    MATCH (c:Country)
    WHERE c.exchange_rate_jpy IS NOT NULL
    RETURN
      c.code AS countryCode,
      c.exchange_rate_jpy AS exchangeRateJpy
  `;

  // Execute all in parallel
  const [bomResult, tariffResult, orderResult, altResult, fxResult] =
    await Promise.all([
      executeQuery(bomQuery),
      executeQuery(tariffQuery),
      executeQuery(orderQuery),
      executeQuery(altQuery),
      executeQuery(fxQuery),
    ]);

  // Build country code → exchange_rate_jpy map
  const countryFx = new Map<string, number>();
  for (const row of fxResult.results || []) {
    countryFx.set(row.countryCode, row.exchangeRateJpy);
  }

  // Static currency → home country mapping
  // exchange_rate_jpy on Country nodes = foreign units per 1 JPY
  const CURRENCY_COUNTRY: Record<string, string> = {
    JPY: 'JP', USD: 'US', EUR: 'DE', CNY: 'CN', KRW: 'KR',
    TWD: 'TW', THB: 'TH', VND: 'VN', INR: 'IN', MXN: 'MX',
    AUD: 'AU', SGD: 'SG', MYR: 'MY', PHP: 'PH', BRL: 'BR',
    RUB: 'RU', IDR: 'ID',
  };

  // Collect unique currencies from BOM data, then map to correct country
  const seenCurrencies = new Set<string>();
  for (const row of bomResult.results || []) {
    if (row.materialCurrency) seenCurrencies.add(row.materialCurrency);
  }
  seenCurrencies.add('JPY');

  const fxRates: any[] = [];
  for (const currency of seenCurrencies) {
    const countryCode = CURRENCY_COUNTRY[currency];
    if (!countryCode) continue;
    const rate = countryFx.get(countryCode);
    if (rate !== undefined) {
      fxRates.push({
        currencyCode: currency,
        countryCode,
        exchangeRateJpy: rate,
      });
    }
  }

  return {
    bomItems: (bomResult.results || []).map((r: any) => ({
      productId: r.productId,
      productName: r.productName,
      baseCostJpy: r.baseCostJpy,
      salesPriceJpy: r.salesPriceJpy,
      marginRate: r.marginRate,
      materialId: r.materialId,
      materialName: r.materialName,
      materialUnitPrice: r.materialUnitPrice,
      materialCurrency: r.materialCurrency,
      hsCode: r.hsCode,
      originCountry: r.originCountry,
      bomQuantity: r.bomQuantity,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      supplierCountry: r.supplierCountry,
      isPrimary: r.isPrimary,
    })),
    tariffs: (tariffResult.results || []).map((r: any) => ({
      hsCode: r.hsCode,
      originCountry: r.originCountry,
      importingCountry: r.importingCountry,
      tariffRatePct: r.tariffRatePct,
      tariffType: r.tariffType,
    })),
    orders: (orderResult.results || []).map((r: any) => ({
      productId: r.productId,
      productName: r.productName,
      customerId: r.customerId,
      customerName: r.customerName,
      annualOrderQty: r.annualOrderQty,
      unitPriceJpy: r.unitPriceJpy,
    })),
    alternatives: (altResult.results || []).map((r: any) => ({
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      altSupplierId: r.altSupplierId,
      altSupplierName: r.altSupplierName,
      qualityDiff: r.qualityDiff,
      priceDiffPct: r.priceDiffPct,
      leadTimeDiff: r.leadTimeDiff,
      riskScoreDiff: r.riskScoreDiff,
    })),
    fxRates,
  };
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

      case 'getSimulationData':
        return await getSimulationData();

      default:
        throw new Error(`Unknown field: ${fieldName}`);
    }
  } catch (error) {
    console.error('Handler error:', error);
    throw error;
  }
};
