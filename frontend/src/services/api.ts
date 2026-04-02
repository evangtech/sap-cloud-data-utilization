/**
 * API Service for Supply Chain Data
 * Neptune Analytics からデータを取得
 */
import type {
  Plant,
  Supplier,
  Customer,
  SupplyRelation,
  Product,
  EarthquakeEvent,
  PlantImpactStatus,
  DashboardStats,
  Location,
  SimFXRate,
  GraphRiskEvent,
  NodeRiskScore,
  EventImpact,
  DisruptsEdge,
  Warehouse,
  LogisticsHub,
  RouteThrough,
  CorridorRisk,
} from '@/types';

// Amplify Data Client（遅延初期化）
let client: any = null;
let amplifyAvailable = false;

/**
 * Amplifyクライアントを取得
 */
async function getClient() {
  if (client !== null) {
    return amplifyAvailable ? client : null;
  }

  try {
    const { generateClient } = await import('aws-amplify/data');
    client = generateClient();
    amplifyAvailable = true;
    console.log('Amplifyクライアント初期化成功');
    return client;
  } catch (error) {
    console.warn('Amplifyクライアント初期化失敗:', error);
    amplifyAvailable = false;
    client = false;
    return null;
  }
}

// ========================================
// データ取得関数（Neptune Analytics）
// ========================================

/**
 * 全工場を取得
 */
export async function fetchPlants(): Promise<Plant[]> {
  const c = await getClient();
  if (!c) {
    console.warn('Amplify未接続: 工場データを取得できません');
    return [];
  }

  try {
    const { data, errors } = await c.queries.getPlants();
    if (errors) {
      console.error('工場データ取得エラー:', errors);
      return [];
    }
    return (data || []).map((p: any) => ({
      id: p?.id || '',
      name: p?.name || '',
      locationName: p?.locationName || '',
      latitude: p?.latitude || 0,
      longitude: p?.longitude || 0,
      capacity: p?.capacity || 0,
      impactLevel: (p?.impactLevel as 'direct' | 'downstream' | 'none') || 'none',
    }));
  } catch (error) {
    console.error('工場データ取得エラー:', error);
    return [];
  }
}

/**
 * 全サプライヤーを取得
 */
export async function fetchSuppliers(): Promise<Supplier[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getSuppliers();
    if (errors) {
      console.error('サプライヤーデータ取得エラー:', errors);
      return [];
    }
    return (data || []).map((s: any) => ({
      id: s?.id || '',
      name: s?.name || '',
      country: s?.country || '',
      region: s?.region || '',
      latitude: s?.latitude || 0,
      longitude: s?.longitude || 0,
    }));
  } catch (error) {
    console.error('サプライヤーデータ取得エラー:', error);
    return [];
  }
}

/**
 * 全カスタマを取得
 */
export async function fetchCustomers(): Promise<Customer[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getCustomers();
    if (errors) {
      console.error('カスタマデータ取得エラー:', errors);
      return [];
    }
    return (data || []).map((cust: any) => ({
      id: cust?.id || '',
      name: cust?.name || '',
      industry: cust?.industry || '',
      latitude: cust?.latitude || 0,
      longitude: cust?.longitude || 0,
    }));
  } catch (error) {
    console.error('カスタマデータ取得エラー:', error);
    return [];
  }
}

/**
 * サプライチェーン関係を取得
 */
export async function fetchSupplyRelations(): Promise<SupplyRelation[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getSupplyRelations();
    if (errors) {
      console.error('サプライチェーン関係取得エラー:', errors);
      return [];
    }
    return (data || []).map((r: any) => ({
      fromId: r?.fromId || '',
      fromType: (r?.fromType?.toLowerCase() as SupplyRelation['fromType']) || 'plant',
      fromName: r?.fromName || '',
      fromLat: r?.fromLat || 0,
      fromLon: r?.fromLon || 0,
      toId: r?.toId || '',
      toType: (r?.toType?.toLowerCase() as SupplyRelation['toType']) || 'plant',
      toName: r?.toName || '',
      toLat: r?.toLat || 0,
      toLon: r?.toLon || 0,
      products: (r?.products || [])
        .filter((p: any) => p?.id)  // null製品を除外
        .map((p: any) => ({
          id: p?.id || '',
          name: p?.name || '',
        })),
    }));
  } catch (error) {
    console.error('サプライチェーン関係取得エラー:', error);
    return [];
  }
}

/**
 * 全製品を取得
 */
export async function fetchProducts(): Promise<Product[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getProducts();
    if (errors) {
      console.error('製品データ取得エラー:', errors);
      return [];
    }
    return (data || []).map((p: any) => ({
      id: p?.id || '',
      name: p?.name || '',
      type: p?.type || '',
      unit: p?.unit || '',
      plantId: p?.plantId || undefined,
      plantName: p?.plantName || undefined,
    }));
  } catch (error) {
    console.error('製品データ取得エラー:', error);
    return [];
  }
}

/**
 * 販売伝票型（API結果）
 */
export interface SalesOrderResult {
  id: string;
  lineItem: string;
  orderDate: string;
  requestedDate: string;
  amount: number;
  customerId: string;
  customerName: string;
}

/**
 * 購買伝票型（API結果）
 */
export interface PurchaseOrderResult {
  id: string;
  lineItem: string;
  orderDate: string;
  status: string;
  amount: number;
  supplierId: string;
  supplierName: string;
}

/**
 * ノードに関連する販売伝票を取得
 */
export async function fetchSalesOrdersByNode(nodeType: string, nodeId: string): Promise<SalesOrderResult[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getSalesOrdersByNode({ nodeType, nodeId });
    if (errors) {
      console.error('販売伝票取得エラー:', errors);
      return [];
    }
    return (data || []).map((so: any) => ({
      id: so?.id || '',
      lineItem: so?.lineItem || '',
      orderDate: so?.orderDate || '',
      requestedDate: so?.requestedDate || '',
      amount: so?.amount || 0,
      customerId: so?.customerId || '',
      customerName: so?.customerName || '',
    }));
  } catch (error) {
    console.error('販売伝票取得エラー:', error);
    return [];
  }
}

/**
 * ノードに関連する購買伝票を取得
 */
export async function fetchPurchaseOrdersByNode(nodeType: string, nodeId: string): Promise<PurchaseOrderResult[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getPurchaseOrdersByNode({ nodeType, nodeId });
    if (errors) {
      console.error('購買伝票取得エラー:', errors);
      return [];
    }
    return (data || []).map((po: any) => ({
      id: po?.id || '',
      lineItem: po?.lineItem || '',
      orderDate: po?.orderDate || '',
      status: po?.status || '',
      amount: po?.amount || 0,
      supplierId: po?.supplierId || '',
      supplierName: po?.supplierName || '',
    }));
  } catch (error) {
    console.error('購買伝票取得エラー:', error);
    return [];
  }
}

/**
 * 地震イベントを取得（DynamoDB）
 */
export async function fetchEarthquakes(): Promise<EarthquakeEvent[]> {
  const c = await getClient();
  if (!c) {
    console.warn('Amplify未接続: 地震データを取得できません');
    return [];
  }

  try {
    const { data, errors } = await c.models.EarthquakeEvent.list();
    if (errors) {
      console.error('地震データ取得エラー:', errors);
      return [];
    }
    const now = Math.floor(Date.now() / 1000);
    return (data || [])
      .filter((e: any) => !e.ttl || e.ttl > now)  // TTL期限切れを除外
      .map((e: any) => ({
        earthquakeId: e.earthquakeId || '',
        timestamp: e.timestamp || '',
        magnitude: e.magnitude || 0,
        location: e.location || '',
        depth: e.depth || 0,
        latitude: e.latitude || 0,
        longitude: e.longitude || 0,
        maxScale: e.maxScale || 0,
        affectedPlantsCount: e.affectedPlantsCount || 0,
        affectedCustomersCount: e.affectedCustomersCount || 0,
        impactedOrderAmount: e.impactedOrderAmount || 0,
      }));
  } catch (error) {
    console.error('地震データ取得エラー:', error);
    return [];
  }
}

/**
 * 工場影響状態を取得（DynamoDB）
 */
export async function fetchPlantImpacts(): Promise<PlantImpactStatus[]> {
  const c = await getClient();
  if (!c) {
    console.warn('Amplify未接続: 影響データを取得できません');
    return [];
  }

  try {
    const { data, errors } = await c.models.PlantImpactStatus.list();
    if (errors) {
      console.error('影響データ取得エラー:', errors);
      return [];
    }
    const now = Math.floor(Date.now() / 1000);
    return (data || [])
      .filter((i: any) => i.ttl > now)  // TTL期限切れを除外
      .map((i: any) => ({
        plantId: i.plantId || '',
        earthquakeId: i.earthquakeId || '',
        impactLevel: (i.impactLevel as 'direct' | 'downstream') || 'direct',
        impactedAt: i.impactedAt || '',
        ttl: i.ttl || 0,
        earthquakeMagnitude: i.earthquakeMagnitude || 0,
        earthquakeLocation: i.earthquakeLocation || '',
        downstreamCustomersCount: i.downstreamCustomersCount || 0,
        impactedOrderAmount: i.impactedOrderAmount || 0,
      }));
  } catch (error) {
    console.error('影響データ取得エラー:', error);
    return [];
  }
}

/**
 * ロケーションを取得
 */
export async function fetchLocations(): Promise<Location[]> {
  const plants = await fetchPlants();
  const locationMap = new Map<string, Location>();
  
  plants.forEach((p) => {
    const key = p.locationName;
    if (key && !locationMap.has(key)) {
      const prefMatch = p.locationName.match(/^(.+?[都道府県])/);
      const pref = prefMatch?.[1] ?? '';
      const city = pref ? p.locationName.replace(pref, '') : '';
      locationMap.set(key, {
        id: key,
        pref,
        city,
        latitude: p.latitude,
        longitude: p.longitude,
      });
    }
  });
  return Array.from(locationMap.values());
}

/**
 * ダッシュボード統計を計算
 */
export async function fetchDashboardStats(): Promise<DashboardStats> {
  const [plants, suppliers, customers] = await Promise.all([
    fetchPlants(),
    fetchSuppliers(),
    fetchCustomers(),
  ]);

  const directlyAffected = plants.filter((p) => p.impactLevel === 'direct').length;
  const downstreamAffected = plants.filter((p) => p.impactLevel === 'downstream').length;

  return {
    totalPlants: plants.length,
    totalSuppliers: suppliers.length,
    totalCustomers: customers.length,
    directlyAffectedPlants: directlyAffected,
    downstreamAffectedPlants: downstreamAffected,
    affectedCustomers: 0,
    impactedOrderAmount: 0,
    impactedOrderCount: 0,
  };
}

// ========================================
// What-if シミュレーション
// ========================================

/**
 * シミュレーション用データを一括取得（Neptune Analytics）
 */
export async function fetchSimulationData(): Promise<{
  bomItems: any[];
  tariffs: any[];
  orders: any[];
  alternatives: any[];
  fxRates: any[];
}> {
  const c = await getClient();
  if (!c) {
    throw new Error('バックエンドに接続できません。ネットワーク接続を確認してください。');
  }

  try {
    const { data, errors } = await c.queries.getSimulationData();
    if (errors && errors.length > 0) {
      console.error('シミュレーションデータ取得エラー:', errors);
      throw new Error(`データ取得エラー: ${errors[0]?.message || '不明なエラー'}`);
    }
    if (!data) {
      throw new Error('シミュレーションデータが空です。データが登録されているか確認してください。');
    }
    return {
      bomItems: (data?.bomItems || []).map((r: any) => ({
        productId: r?.productId || '',
        productName: r?.productName || '',
        baseCostJpy: r?.baseCostJpy || 0,
        salesPriceJpy: r?.salesPriceJpy || 0,
        marginRate: r?.marginRate || 0,
        materialId: r?.materialId || '',
        materialName: r?.materialName || '',
        materialUnitPrice: r?.materialUnitPrice || 0,
        materialCurrency: r?.materialCurrency || 'JPY',
        hsCode: r?.hsCode || '',
        originCountry: r?.originCountry || '',
        bomQuantity: r?.bomQuantity || 0,
        supplierId: r?.supplierId || '',
        supplierName: r?.supplierName || '',
        supplierCountry: r?.supplierCountry || '',
        isPrimary: r?.isPrimary ?? false,
      })),
      tariffs: (data?.tariffs || []).map((r: any) => ({
        hsCode: r?.hsCode || '',
        originCountry: r?.originCountry || '',
        importingCountry: r?.importingCountry || '',
        tariffRatePct: r?.tariffRatePct || 0,
        tariffType: r?.tariffType || '',
      })),
      orders: (data?.orders || []).map((r: any) => ({
        productId: r?.productId || '',
        productName: r?.productName || '',
        customerId: r?.customerId || '',
        customerName: r?.customerName || '',
        annualOrderQty: r?.annualOrderQty || 0,
        unitPriceJpy: r?.unitPriceJpy || 0,
      })),
      alternatives: (data?.alternatives || []).map((r: any) => ({
        supplierId: r?.supplierId || '',
        supplierName: r?.supplierName || '',
        altSupplierId: r?.altSupplierId || '',
        altSupplierName: r?.altSupplierName || '',
        qualityDiff: r?.qualityDiff || 0,
        priceDiffPct: r?.priceDiffPct || 0,
        leadTimeDiff: r?.leadTimeDiff || 0,
        riskScoreDiff: r?.riskScoreDiff || 0,
      })),
      fxRates: (data?.fxRates || []).map((r: any) => ({
        currencyCode: r?.currencyCode || '',
        countryCode: r?.countryCode || '',
        exchangeRateJpy: r?.exchangeRateJpy || 1,
      })),
    };
  } catch (error) {
    // Re-throw our own errors (from above checks)
    if (error instanceof Error && (
      error.message.startsWith('データ') || error.message.startsWith('バック') || error.message.startsWith('シミュレーション')
    )) {
      throw error;
    }
    console.error('シミュレーションデータ取得エラー:', error);
    throw new Error('シミュレーションデータの取得に失敗しました。しばらく経ってから再度お試しください。');
  }
}

// ========================================
// ライブ為替レート
// ========================================

/** 通貨コード → 国コード マッピング */
const CURRENCY_COUNTRY: Record<string, string> = {
  USD: 'US', EUR: 'DE', CNY: 'CN', KRW: 'KR', TWD: 'TW',
  SGD: 'SG', THB: 'TH', GBP: 'GB', AUD: 'AU', CAD: 'CA',
  INR: 'IN', MYR: 'MY', PHP: 'PH', IDR: 'ID', VND: 'VN',
};

/**
 * ライブ為替レートを取得 (Frankfurter API — ECB データ、無料、APIキー不要)
 *
 * 返り値の exchangeRateJpy は「1 JPY = X 外貨」の形式。
 * 例: USD の場合 ≈ 0.00633 (1 JPY ≈ 0.00633 USD)
 *
 * @param currencies BOM で使用されている通貨コード (JPY 除く)
 * @returns 取得できた通貨のレート配列。API 失敗時は空配列。
 */
export async function fetchLiveFxRates(currencies: string[]): Promise<SimFXRate[]> {
  const needed = currencies.filter(c => c && c !== 'JPY');
  if (needed.length === 0) return [];

  try {
    // Frankfurter API: base=JPY → 各通貨を "1 JPY = X 外貨" で返す
    const symbols = needed.join(',');
    const res = await fetch(
      `https://api.frankfurter.dev/v1/latest?base=JPY&symbols=${symbols}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const rates: SimFXRate[] = [];
    for (const cur of needed) {
      const rate = data.rates?.[cur];
      if (rate && rate > 0) {
        rates.push({
          currencyCode: cur,
          countryCode: CURRENCY_COUNTRY[cur] || '',
          exchangeRateJpy: rate,
        });
      }
    }
    console.log(`[FX] ライブ為替レート取得: ${rates.length}/${needed.length} 通貨 (${data.date})`);
    return rates;
  } catch (error) {
    console.warn('[FX] ライブ為替レート取得失敗 — Neptune データにフォールバック:', error);
    return [];
  }
}

// ========================================
// 影響分析クエリ（将来実装）
// ========================================

/**
 * 特定のロケーションで影響を受ける工場を取得
 */
export async function fetchAffectedPlantsByLocation(
  pref: string,
  city?: string
): Promise<Plant[]> {
  console.log('影響工場取得: Neptune統合待ち', pref, city);
  return [];
}

/**
 * 下流への影響を分析
 */
export async function fetchDownstreamImpact(plantIds: string[]) {
  console.log('下流影響分析: Neptune統合待ち', plantIds);
  return [];
}

/**
 * 影響を受けた注文金額を計算
 */
export async function fetchImpactedOrderAmount(plantIds: string[]) {
  console.log('影響金額計算: Neptune統合待ち', plantIds);
  return { totalAmount: 0, orderCount: 0, customerCount: 0 };
}

/**
 * 特定の地震で影響を受けた工場を取得
 */
export async function fetchPlantImpactsByEarthquake(
  earthquakeId: string
): Promise<PlantImpactStatus[]> {
  console.log('地震別影響工場取得: Neptune統合待ち', earthquakeId);
  return [];
}

// ========================================
// 代替工場プラン（Neptune Analytics）
// ========================================

/**
 * 代替工場の製品情報
 */
export interface SubstituteProductInfo {
  id: string;
  name: string;
}

/**
 * 代替工場候補
 */
export interface SubstitutePlantInfo {
  id: string;
  name: string;
  capacity: number;
  lat: number;
  lon: number;
  locationName: string;
  products: SubstituteProductInfo[];
  distanceToCustomers: number;
}

/**
 * 代替プラン（工場の組み合わせ）
 */
export interface SubstitutePlan {
  planIndex: number;
  plants: SubstitutePlantInfo[];
  totalCapacity: number;
  requiredCapacity: number;
  totalDistance: number;
  avgDistance: number;
}

/**
 * 影響工場の代替工場プランを取得
 * @param plantId 対象工場ID
 * @param targetProductIds 対象製品IDリスト（下流工場が必要とする製品に絞り込む）
 */
export async function fetchSubstitutePlants(plantId: string, targetProductIds?: string[]): Promise<SubstitutePlan[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const args: any = { plantId };
    if (targetProductIds && targetProductIds.length > 0) {
      args.targetProductIds = targetProductIds;
    }
    const { data, errors } = await c.queries.getSubstitutePlants(args);
    if (errors) {
      console.error('代替工場取得エラー:', errors);
      return [];
    }
    return (data || []).map((plan: any) => ({
      planIndex: plan?.planIndex || 0,
      plants: (plan?.plants || []).map((p: any) => ({
        id: p?.id || '',
        name: p?.name || '',
        capacity: p?.capacity || 0,
        lat: p?.lat || 0,
        lon: p?.lon || 0,
        locationName: p?.locationName || '',
        products: (p?.products || []).map((pr: any) => ({
          id: pr?.id || '',
          name: pr?.name || '',
        })),
        distanceToCustomers: p?.distanceToCustomers || 0,
      })),
      totalCapacity: plan?.totalCapacity || 0,
      requiredCapacity: plan?.requiredCapacity || 0,
      totalDistance: plan?.totalDistance || 0,
      avgDistance: plan?.avgDistance || 0,
    }));
  } catch (error) {
    console.error('代替工場取得エラー:', error);
    return [];
  }
}

/**
 * 影響部品情報型
 */
export interface ImpactedComponentInfo {
  componentId: string;
  componentName: string;
  supplierId: string;
  supplierName: string;
  supplierPlantId: string;  // 供給元工場ID（フロントエンドで影響判定に使用）
  impactType: 'direct' | 'bom' | 'manufactured';  // manufactured = 直接影響工場で製造
  parentProductId?: string;
  parentProductName?: string;
}

/**
 * 影響製品結果型
 */
export interface ImpactedProductsResult {
  impactedProductIds: string[];
  upstreamImpactedPlants: { id: string; name: string }[];
  impactedComponents: ImpactedComponentInfo[];
  isDirectlyImpacted?: boolean;  // この工場自体が直接影響を受けているか
  manufacturedProducts?: { productId: string; productName: string }[];  // 直接影響工場の製造製品
}

/**
 * 工場の影響製品を取得（上流影響工場から供給される製品）
 */
export async function fetchImpactedProducts(
  plantId: string,
  impactedPlantIds: string[]
): Promise<ImpactedProductsResult> {
  const c = await getClient();
  if (!c) {
    return { impactedProductIds: [], upstreamImpactedPlants: [], impactedComponents: [] };
  }

  try {
    const { data, errors } = await c.queries.getImpactedProducts({
      plantId,
      impactedPlantIds,
    });
    if (errors) {
      console.error('影響製品取得エラー:', errors);
      return { impactedProductIds: [], upstreamImpactedPlants: [], impactedComponents: [] };
    }
    return {
      impactedProductIds: data?.impactedProductIds || [],
      upstreamImpactedPlants: (data?.upstreamImpactedPlants || []).map((p: any) => ({
        id: p?.id || '',
        name: p?.name || '',
      })),
      impactedComponents: (data?.impactedComponents || []).map((c: any) => ({
        componentId: c?.componentId || '',
        componentName: c?.componentName || '',
        supplierId: c?.supplierId || '',
        supplierName: c?.supplierName || '',
        supplierPlantId: c?.supplierPlantId || c?.supplierId || '',  // supplierPlantIdを追加
        impactType: c?.impactType || 'direct',
        parentProductId: c?.parentProductId || undefined,
        parentProductName: c?.parentProductName || undefined,
      })),
      isDirectlyImpacted: data?.isDirectlyImpacted || false,
      manufacturedProducts: (data?.manufacturedProducts || []).map((p: any) => ({
        productId: p?.productId || '',
        productName: p?.productName || '',
      })),
    };
  } catch (error) {
    console.error('影響製品取得エラー:', error);
    return { impactedProductIds: [], upstreamImpactedPlants: [], impactedComponents: [] };
  }
}

/**
 * BOM部品情報型
 */
export interface BOMComponentInfo {
  componentId: string;
  componentName: string;
  componentType: string;
  quantity: number;
  supplierPlantId?: string;
  supplierPlantName?: string;
}

/**
 * BOM付き製品型
 */
export interface ProductWithBOMInfo {
  id: string;
  name: string;
  type: string;
  unit: string;
  components: BOMComponentInfo[];
}

/**
 * 工場で製造される製品とそのBOM（部品構成）を取得
 */
export async function fetchProductsWithBOM(plantId: string): Promise<ProductWithBOMInfo[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getProductsWithBOM({ plantId });
    if (errors) {
      console.error('BOM付き製品取得エラー:', errors);
      return [];
    }
    return (data || []).map((p: any) => ({
      id: p?.id || '',
      name: p?.name || '',
      type: p?.type || '',
      unit: p?.unit || '',
      components: (p?.components || []).map((c: any) => ({
        componentId: c?.componentId || '',
        componentName: c?.componentName || '',
        componentType: c?.componentType || '',
        quantity: c?.quantity || 0,
        supplierPlantId: c?.supplierPlantId || undefined,
        supplierPlantName: c?.supplierPlantName || undefined,
      })),
    }));
  } catch (error) {
    console.error('BOM付き製品取得エラー:', error);
    return [];
  }
}

// ========================================
// 自然言語クエリ（Bedrock + Neptune）
// ========================================

/**
 * 自然言語クエリ結果型
 */
export interface NlQueryResultItem {
  id?: string;
  name?: string;
  lat?: number;
  lon?: number;
  [key: string]: any;
}

export interface NlQueryFilter {
  showPlants?: boolean;
  showSuppliers?: boolean;
  showCustomers?: boolean;
  highlightIds?: string[];
  impactOnly?: boolean;
}

export interface NlQueryResult {
  type: 'filter' | 'cypher' | 'no_result' | 'error';
  description: string;
  query?: string;
  filter?: NlQueryFilter;
  results: NlQueryResultItem[];
}

/**
 * 自然言語でサプライチェーンを検索
 */
export async function executeNlQuery(query: string): Promise<NlQueryResult> {
  const c = await getClient();
  if (!c) {
    return {
      type: 'error',
      description: 'Amplify未接続: クエリを実行できません',
      results: [],
    };
  }

  try {
    const { data, errors } = await c.queries.nlQuery({ query });
    if (errors) {
      console.error('NLクエリエラー:', errors);
      return {
        type: 'error',
        description: errors.map((e: any) => e.message).join(', '),
        results: [],
      };
    }

    return {
      type: data?.type || 'error',
      description: data?.description || '',
      query: data?.query || undefined,
      filter: data?.filter ? {
        showPlants: data.filter.showPlants ?? true,
        showSuppliers: data.filter.showSuppliers ?? true,
        showCustomers: data.filter.showCustomers ?? true,
        highlightIds: data.filter.highlightIds || [],
        impactOnly: data.filter.impactOnly ?? false,
      } : undefined,
      results: (data?.results || []).map((r: any) => ({
        id: r?.id || '',
        name: r?.name || '',
        lat: r?.lat || 0,
        lon: r?.lon || 0,
      })),
    };
  } catch (error) {
    console.error('NLクエリエラー:', error);
    return {
      type: 'error',
      description: error instanceof Error ? error.message : 'クエリ処理中にエラーが発生しました',
      results: [],
    };
  }
}

// ========================================
// リスクイベント関連 API（Neptune Graph）
// ========================================

/**
 * リスクイベント一覧を取得
 */
export async function fetchRiskEvents(filter?: {
  lifecycleStatus?: string[];
  eventType?: string;
}): Promise<GraphRiskEvent[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const args: Record<string, unknown> = {};
    if (filter?.lifecycleStatus) args.lifecycleStatuses = filter.lifecycleStatus;
    if (filter?.eventType) args.eventTypes = [filter.eventType];

    const { data, errors } = await c.queries.getRiskEvents(args);
    if (errors) console.error('リスクイベント取得エラー:', errors);
    return (data ?? []) as GraphRiskEvent[];
  } catch (error) {
    console.error('リスクイベント取得エラー:', error);
    return [];
  }
}

/**
 * アクティブなインパクト一覧を取得（ノード別 or イベント別）
 */
export async function fetchActiveImpacts(
  nodeId?: string,
  eventId?: string,
): Promise<EventImpact[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const args: Record<string, unknown> = {};
    if (nodeId) args.nodeId = nodeId;
    if (eventId) args.eventId = eventId;

    const { data, errors } = await c.queries.getActiveImpacts(args);
    if (errors) console.error('アクティブインパクト取得エラー:', errors);
    return (data ?? []) as EventImpact[];
  } catch (error) {
    console.error('アクティブインパクト取得エラー:', error);
    return [];
  }
}

/**
 * 特定イベントの全インパクト（過去イベント含む、シナリオ再現用）
 */
export async function fetchImpactsByEvent(eventId: string): Promise<EventImpact[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getImpactsByEvent({ eventId });
    if (errors) console.error('イベント別インパクト取得エラー:', errors);
    return (data ?? []) as EventImpact[];
  } catch (error) {
    console.error('イベント別インパクト取得エラー:', error);
    return [];
  }
}

/**
 * アクティブなDISRUPTSエッジ一覧を取得
 */
export async function fetchActiveDisrupts(): Promise<DisruptsEdge[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getActiveDisrupts();
    if (errors) console.error('アクティブDISRUPTS取得エラー:', errors);
    return (data ?? []) as DisruptsEdge[];
  } catch (error) {
    console.error('アクティブDISRUPTS取得エラー:', error);
    return [];
  }
}

/**
 * 特定イベントのDISRUPTSエッジ（シナリオ再現用）
 */
export async function fetchDisruptsByEvent(eventId: string): Promise<DisruptsEdge[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getDisruptsByEvent({ eventId });
    if (errors) console.error('イベント別DISRUPTS取得エラー:', errors);
    return (data ?? []) as DisruptsEdge[];
  } catch (error) {
    console.error('イベント別DISRUPTS取得エラー:', error);
    return [];
  }
}

/**
 * 全ノードのリスクスコアを取得
 */
export async function fetchNodeRiskScores(): Promise<NodeRiskScore[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getNodeRiskScores();
    if (errors) console.error('リスクスコア取得エラー:', errors);
    return (data ?? []).map((r: any) => ({
      nodeId: r?.nodeId || '',
      nodeType: r?.nodeType || 'Plant',
      baselineRisk: r?.baselineRisk || 0,
      liveEventRisk: r?.liveEventRisk || 0,
      revenueExposure: r?.revenueExposure || 0,
      combinedOperationalRisk: r?.combinedOperationalRisk || 0,
      activeEventCount: r?.activeEventCount || 0,
      topEvent: r?.topEvent || null,
    }));
  } catch (error) {
    console.error('リスクスコア取得エラー:', error);
    return [];
  }
}

/**
 * サプライルートリスク分析を取得
 */
export async function fetchCorridorRisks(): Promise<CorridorRisk[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getCorridorRisks();
    if (errors) console.error('ルートリスク取得エラー:', errors);
    return (data ?? []).map((raw: any) => {
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return {
      origin: {
        id: r?.originId || '',
        name: r?.originName || '',
        type: r?.originType || '',
      },
      destination: {
        id: r?.destId || '',
        name: r?.destName || '',
        type: r?.destType || '',
      },
      chokePointScore: r?.chokePointScore || 0,
      avgRouteRisk: r?.avgRouteRisk || 0,
      hops: r?.hops || 0,
      riskyNodes: r?.riskyNodes || [],
      };
    });
  } catch (error) {
    console.error('ルートリスク取得エラー:', error);
    return [];
  }
}

/**
 * 倉庫一覧を取得
 */
export async function fetchWarehouses(): Promise<Warehouse[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getWarehouses();
    if (errors) console.error('倉庫データ取得エラー:', errors);
    return (data ?? []).map((w: any) => ({
      id: w?.id || '',
      name: w?.name || '',
      countryCode: w?.countryCode || '',
      latitude: w?.latitude || 0,
      longitude: w?.longitude || 0,
      capacity: w?.capacity || 0,
      status: w?.status || 'active',
    }));
  } catch (error) {
    console.error('倉庫データ取得エラー:', error);
    return [];
  }
}

/**
 * 物流拠点一覧を取得
 */
export async function fetchLogisticsHubs(): Promise<LogisticsHub[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getLogisticsHubs();
    if (errors) console.error('物流拠点取得エラー:', errors);
    return (data ?? []).map((lh: any) => ({
      id: lh?.id || '',
      name: lh?.name || '',
      type: lh?.type || 'port',
      countryCode: lh?.countryCode || '',
      latitude: lh?.latitude || 0,
      longitude: lh?.longitude || 0,
      capacity: lh?.capacity || null,
      status: lh?.status || 'operational',
    }));
  } catch (error) {
    console.error('物流拠点取得エラー:', error);
    return [];
  }
}

/**
 * ROUTES_THROUGHリレーション一覧を取得
 */
export async function fetchRoutesThrough(): Promise<RouteThrough[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getRoutesThrough();
    if (errors) console.error('ルート情報取得エラー:', errors);
    return (data ?? []).map((r: any) => ({
      fromId: r?.fromId || '',
      fromType: r?.fromType || 'Plant',
      fromName: r?.fromName || '',
      toId: r?.toId || '',
      toName: r?.toName || '',
      transitDays: r?.transitDays || 0,
      isPrimary: r?.isPrimary ?? true,
    }));
  } catch (error) {
    console.error('ルート情報取得エラー:', error);
    return [];
  }
}

/**
 * ノード別リスク履歴（オンデマンド）
 */
export async function fetchRiskEventHistory(nodeId: string): Promise<unknown[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getRiskEventHistory({ nodeId });
    if (errors) console.error('リスク履歴取得エラー:', errors);
    return data ?? [];
  } catch (error) {
    console.error('リスク履歴取得エラー:', error);
    return [];
  }
}

/**
 * イベント因果チェーン（オンデマンド）
 */
export async function fetchRiskEventChain(eventId: string): Promise<unknown[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getRiskEventChain({ eventId });
    if (errors) console.error('因果チェーン取得エラー:', errors);
    return data ?? [];
  } catch (error) {
    console.error('因果チェーン取得エラー:', error);
    return [];
  }
}

/**
 * 復旧ダッシュボードデータを取得（オンデマンド）
 */
export async function fetchRecoveryDashboard(): Promise<unknown[]> {
  const c = await getClient();
  if (!c) return [];

  try {
    const { data, errors } = await c.queries.getRecoveryDashboard();
    if (errors) console.error('復旧ダッシュボード取得エラー:', errors);
    return data ?? [];
  } catch (error) {
    console.error('復旧ダッシュボード取得エラー:', error);
    return [];
  }
}
