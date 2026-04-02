/**
 * サプライチェーン地図可視化システム - 型定義
 * Type definitions for Supply Chain Map Visualization
 */

// ========================================
// Node Types (Neptune Graph)
// ========================================

/**
 * 製品/部品
 */
export interface Product {
  id: string;
  name: string;
  type: string;  // 'finished' | 'component' | 'raw_material'
  unit: string;  // 'pcs', 'kg', 'lot'
  plantId?: string;   // 製造工場ID（MANUFACTURED_AT関係）
  plantName?: string; // 製造工場名
}

/**
 * BOM部品情報
 */
export interface BOMComponent {
  componentId: string;
  componentName: string;
  componentType: string;
  quantity: number;
  supplierPlantId?: string;
  supplierPlantName?: string;
}

/**
 * BOM付き製品
 */
export interface ProductWithBOM {
  id: string;
  name: string;
  type: string;
  unit: string;
  components: BOMComponent[];
}

/**
 * 影響部品情報
 */
export interface ImpactedComponent {
  componentId: string;
  componentName: string;
  supplierId: string;
  supplierName: string;
  impactType: 'direct' | 'bom';
  parentProductId?: string;
  parentProductName?: string;
}

/**
 * サプライヤー（仕入先）
 */
export interface Supplier {
  id: string;
  name: string;
  country: string;
  region: string;
  latitude: number;
  longitude: number;
  impactLevel?: 'direct' | 'downstream' | 'none';
}

/**
 * プラント（工場）
 */
export interface Plant {
  id: string;
  name: string;
  locationName: string;
  latitude: number;
  longitude: number;
  capacity: number;
  impactLevel?: 'direct' | 'downstream' | 'none';
}

/**
 * カスタマ（得意先）
 */
export interface Customer {
  id: string;
  name: string;
  industry: string;
  latitude: number;
  longitude: number;
  impactLevel?: 'direct' | 'downstream' | 'none';
}

// ========================================
// リスクイベント関連の型定義
// ========================================

/**
 * 倉庫
 */
export interface Warehouse {
  id: string;
  name: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  capacity: number;
  status: string;
}

/**
 * 物流拠点（港湾・空港・国境検問所）
 */
export interface LogisticsHub {
  id: string;
  name: string;
  type: 'port' | 'airport' | 'border_crossing';
  countryCode: string;
  latitude: number;
  longitude: number;
  capacity: string | null;
  status: 'operational' | 'disrupted' | 'closed';
}

/**
 * 物流ルート（ノード→物流拠点）
 */
export interface RouteThrough {
  fromId: string;
  fromType: 'Plant' | 'Supplier' | 'Warehouse';
  fromName: string;
  toId: string;
  toName: string;
  transitDays: number;
  isPrimary: boolean;
}

/**
 * グラフ上のリスクイベント
 */
export interface GraphRiskEvent {
  id: string;
  sourceEventId: string;
  dedupeKey: string;
  title: string;
  description: string;
  eventType: string;
  source: string;
  severity: number;
  lifecycleStatus: 'detected' | 'active' | 'recovering' | 'resolved';
  reviewStatus: 'pending' | 'confirmed' | 'watching' | 'dismissed';
  reviewedBy: string | null;
  reviewedAt: string | null;
  trustLevel: 'trusted_machine' | 'ai_unverified' | 'analyst';
  latitude: number;
  longitude: number;
  radiusKm: number;
  geoScopeType: 'point' | 'city' | 'region' | 'country' | 'multi_country';
  admin1: string | null;
  admin2: string | null;
  locationName: string;
  affectedCountryCodes?: string[];
  startDate: string;
  endDate: string | null;
  updatedAt: string;
  sourceUrl: string | null;
  sourceSnippetHash: string | null;
  confidence: number;
  latestPropagationRunId: string | null;
  latestPropagationSequence: number;
  propagationStartedAt: string | null;
  propagationCompletedAt: string | null;
  categoryName?: string;
  parentCategory?: string;
}

/**
 * ノード別リスクスコア
 */
export interface NodeRiskScore {
  nodeId: string;
  nodeType: 'Plant' | 'Supplier' | 'Warehouse' | 'LogisticsHub';
  baselineRisk: number;
  liveEventRisk: number;
  revenueExposure: number;
  combinedOperationalRisk: number;
  activeEventCount: number;
  topEvent: { title: string; severity: number } | null;
}

/**
 * ノード視点のインパクト（ノードIDでインデックスするストアキャッシュ用）
 */
export interface NodeImpact {
  eventId: string;
  eventTitle: string;
  severity: number;
  impactType: 'direct' | 'downstream';
  status: 'active' | 'recovering' | 'resolved';
  estimatedRecoveryDays: number | null;
  costImpactPct: number | null;
  cachedImpactAmount: number;
  impactConfidence: number;
  assessmentMethod: 'automated' | 'manual_override' | 'ai_assisted';
  firstDetectedAt: string | null;
  lastUpdatedAt: string | null;
  resolvedAt: string | null;
  propagationRunId: string | null;
  overrideReviewStatus: 'active' | 'stale' | 'dismissed' | null;
}

/**
 * イベント視点のインパクト（イベントIDでインデックスするストアキャッシュ用）
 */
export interface EventImpact {
  eventId: string;
  eventTitle: string;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  severity: number;
  impactType: 'direct' | 'downstream';
  status: 'active' | 'recovering' | 'resolved';
  cachedImpactAmount: number;
  impactConfidence: number;
  costImpactPct: number | null;
  assessmentMethod: string;
}

/**
 * DISRUPTSエッジ（リスクイベント→HSCode）
 */
export interface DisruptsEdge {
  eventId: string;
  eventTitle: string;
  hsCode: string;
  originCountry: string;
  destinationCountry: string;
  regulatorBody: string | null;
  effectiveDate: string;
  expiryDate: string | null;
  tariffIncreasePct: number;
  exportRestricted: boolean;
}

/**
 * リスクイベントフィルタ状態
 */
export interface RiskEventFilterState {
  eventTypes: string[];
  minSeverity: number;
  maxSeverity: number;
  lifecycleStatuses: string[];
  reviewStatuses: string[];
  dateRange: { start: string | null; end: string | null };
}

/**
 * サプライルートリスク
 */
export interface CorridorRisk {
  origin: { id: string; name: string; type: string };
  destination: { id: string; name: string; type: string };
  chokePointScore: number;
  avgRouteRisk: number;
  hops: number;
  riskyNodes: { name: string; risk: number; exposure: number }[];
}

/**
 * リスクシナリオスナップショット（シミュレーション入力）
 */
export interface RiskScenarioSnapshot {
  disabledSuppliers: Set<string>;
  tariffOverrides: Map<string, number>;
  fxOverrides: Map<string, number>;
  volumeMultipliers: Map<string, number>;
  metadata: {
    sourceEventIds: string[];
    snapshotDate: string;
    description: string;
  };
}

// ========================================
// その他のノード型（既存）
// ========================================

/**
 * ロケーション（地理情報）
 */
export interface Location {
  id: string;
  pref: string;
  city: string;
  latitude: number;
  longitude: number;
}

/**
 * 購買伝票
 */
export interface PurchaseOrder {
  id: string;
  lineItem: string;
  orderDate: string;
  status: 'open' | 'confirmed' | 'delivered' | 'cancelled';
  supplierId: string;
  products: { productId: string; quantity: number; amount: number }[];
}

/**
 * 販売伝票
 */
export interface SalesOrder {
  id: string;
  lineItem: string;
  orderDate: string;
  requestedDate: string;
  customerId: string;
  products: { productId: string; quantity: number; amount: number }[];
}

// ========================================
// Edge Types (Neptune Graph Relations)
// ========================================

/**
 * 部品構成（BOM）
 */
export interface ConsistsOf {
  parentProductId: string;
  childProductId: string;
  quantity: number;
}

/**
 * 供給元関係
 */
export interface SuppliedBy {
  productId: string;
  supplierId: string;
  pricePerUnit: number;
}

/**
 * 製造場所関係
 */
export interface ManufacturedAt {
  productId: string;
  plantId: string;
}

/**
 * サプライチェーン関係の製品情報
 */
export interface SupplyRelationProduct {
  id: string;
  name: string;
}

/**
 * サプライチェーン関係（供給フロー）
 */
export interface SupplyRelation {
  fromId: string;
  fromType: 'plant' | 'supplier' | 'warehouse';
  fromName: string;
  fromLat: number;
  fromLon: number;
  toId: string;
  toType: 'plant' | 'customer' | 'warehouse';
  toName: string;
  toLat: number;
  toLon: number;
  products?: SupplyRelationProduct[];  // 供給される製品リスト
}

/**
 * ロケーション関係
 */
export interface LocatedAt {
  entityId: string;
  entityType: 'plant' | 'supplier';
  locationId: string;
}

// ========================================
// DynamoDB Types (Temporal Data)
// ========================================

/**
 * 地震イベント
 */
export interface EarthquakeEvent {
  earthquakeId: string;
  timestamp: string;
  magnitude: number;
  location: string;
  depth: number;
  latitude: number;
  longitude: number;
  maxScale: number;
  affectedPlantsCount?: number;
  affectedCustomersCount?: number;
  impactedOrderAmount?: number;
}

/**
 * 工場影響状態（TTL付き）
 */
export interface PlantImpactStatus {
  plantId: string;
  earthquakeId: string;
  impactLevel: 'direct' | 'downstream';
  impactedAt: string;
  ttl: number;  // Unix timestamp
  earthquakeMagnitude?: number;
  earthquakeLocation?: string;
  downstreamCustomersCount?: number;
  impactedOrderAmount?: number;
}

// ========================================
// Frontend Display Types
// ========================================

/**
 * 地図上のマーカー（統合型）
 */
export interface MapMarker {
  id: string;
  type: 'plant' | 'supplier' | 'customer' | 'warehouse' | 'logisticsHub' | 'location';
  name: string;
  latitude: number;
  longitude: number;
  impactLevel: 'direct' | 'downstream' | 'none';
  details?: Record<string, any>;
  riskScore?: NodeRiskScore | null;
}

/**
 * 地図上の線（サプライチェーン関係）
 */
export interface MapLine {
  fromId: string;
  fromType: 'plant' | 'supplier' | 'warehouse';
  fromLat: number;
  fromLon: number;
  fromName: string;
  toId: string;
  toType: 'plant' | 'customer' | 'supplier' | 'warehouse';
  toLat: number;
  toLon: number;
  toName: string;
  isImpacted?: boolean;
  products?: SupplyRelationProduct[];  // 供給される製品リスト
}

/**
 * ダッシュボード統計
 */
export interface DashboardStats {
  totalPlants: number;
  totalSuppliers: number;
  totalCustomers: number;
  directlyAffectedPlants: number;
  downstreamAffectedPlants: number;
  affectedCustomers: number;
  impactedOrderAmount: number;
  impactedOrderCount: number;
}

/**
 * 影響分析結果
 */
export interface ImpactAnalysis {
  earthquakeId: string;
  earthquakeInfo: EarthquakeEvent;
  directlyAffectedPlants: Plant[];
  downstreamAffectedPlants: Plant[];
  affectedSuppliers: Supplier[];
  affectedCustomers: Customer[];
  impactedSalesOrders: SalesOrder[];
  totalImpactedAmount: number;
}

// ========================================
// What-if Simulation Types
// ========================================

/**
 * BOMアイテム（シミュレーション用）
 */
export interface SimBOMItem {
  productId: string;
  productName: string;
  baseCostJpy: number;
  salesPriceJpy: number;
  marginRate: number;
  materialId: string;
  materialName: string;
  materialUnitPrice: number;
  materialCurrency: string;
  hsCode: string;
  originCountry: string;       // 素材の製造国 (関税判定用)
  bomQuantity: number;
  supplierId: string;
  supplierName: string;
  supplierCountry: string;     // サプライヤーの所在国 (地理集中度・リスク計算用)
  isPrimary: boolean;
}

/**
 * 関税データ（シミュレーション用）
 */
export interface SimTariff {
  hsCode: string;
  originCountry: string;
  importingCountry: string;
  tariffRatePct: number;
  tariffType: string;
}

/**
 * 受注データ（シミュレーション用）
 */
export interface SimOrder {
  productId: string;
  productName: string;
  customerId: string;
  customerName: string;
  annualOrderQty: number;
  unitPriceJpy: number;
}

/**
 * 代替サプライヤーデータ（シミュレーション用）
 */
export interface SimAlternative {
  supplierId: string;
  supplierName: string;
  altSupplierId: string;
  altSupplierName: string;
  qualityDiff: number;
  priceDiffPct: number;
  leadTimeDiff: number;
  riskScoreDiff: number;
}

/**
 * 為替レート
 */
export interface SimFXRate {
  currencyCode: string;
  countryCode: string;
  exchangeRateJpy: number;
}

/**
 * シミュレーション一括取得データ
 */
export interface SimulationData {
  bomItems: SimBOMItem[];
  tariffs: SimTariff[];
  orders: SimOrder[];
  alternatives: SimAlternative[];
  fxRates: SimFXRate[];
}

/**
 * 製品別シミュレーション結果
 */
export interface ProductSimResult {
  productId: string;
  productName: string;
  baseCost: number;
  newCost: number;
  delta: number;
  deltaPct: number;
  baseMargin: number;
  newMargin: number;
  isDisrupted: boolean;
  components: ComponentSimResult[];
}

/**
 * 部品別コスト内訳
 */
export interface ComponentSimResult {
  materialId: string;
  materialName: string;
  supplierId: string;
  supplierName: string;
  isAlternative: boolean;
  unitPriceJpy: number;
  tariffRate: number;
  costWithTariff: number;
  bomQuantity: number;
  totalCost: number;
  baselineTotalCost: number;
}

/**
 * ポートフォリオ影響サマリー
 */
export interface PortfolioImpact {
  totalDelta: number;
  totalDeltaPct: number;
  affectedProducts: number;
  disruptedProducts: number;
  totalBaseAmount: number;
  totalNewAmount: number;
}

/**
 * 代替推奨
 */
export interface AlternativeRecommendation {
  disabledSupplierId: string;
  disabledSupplierName: string;
  altSupplierId: string;
  altSupplierName: string;
  priceDiffPct: number;
  qualityDiff: number;
  leadTimeDiff: number;
  materialIds: string[];
}

/**
 * 供給リスク指標 (HHI + 集中度)
 */
export interface SupplyRiskMetrics {
  singleSource: { before: number; after: number };
  supplierHHI: { before: number; after: number };
  geoConcentration: { before: number; after: number };
  disruptedMaterials: number;
  cautions: string[];
}

/**
 * 切替トレードオフサマリー
 */
export interface SwitchTradeoffSummary {
  originalSupplier: string;
  alternativeSupplier: string;
  priceDiffPct: number;
  leadTimeDiff: number;
  qualityDiff: number;
  affectedMaterialCount: number;
  singleSourceReduction: number;  // 単一ソース→複数ソースになる素材数
}

/**
 * コスト変動要因セグメント
 */
export interface CostDriverSegment {
  label: string;
  value: number;
  type: 'tariff' | 'fx' | 'supplier' | 'net';
}

// ========================================
// API Response Types
// ========================================

export interface Pagination {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
}

export interface PlantsResponse {
  plants: Plant[];
  pagination?: Pagination;
}

export interface SuppliersResponse {
  suppliers: Supplier[];
  pagination?: Pagination;
}

export interface CustomersResponse {
  customers: Customer[];
  pagination?: Pagination;
}

export interface EarthquakesResponse {
  earthquakes: EarthquakeEvent[];
  pagination?: Pagination;
}

// ========================================
// Legacy Types (for backward compatibility)
// ========================================

/**
 * @deprecated Use Plant instead
 */
export interface Factory {
  factoryId: string;
  factoryName: string;
  prefecture: string;
  city: string;
  latitude: number;
  longitude: number;
  capacity: number;
  isActive: boolean;
  materials: string[];
  impactLevel?: 'direct' | 'downstream' | 'none';
}

/**
 * @deprecated Use PlantImpactStatus instead
 */
export interface FactoryImpactStatus {
  factoryId: string;
  earthquakeId: string;
  impactLevel: 'direct' | 'downstream' | 'none';
  impactedAt: string;
  expiresAt: string;
  earthquakeMagnitude: number;
  earthquakeLocation: string;
  downstreamAffectedCount: number;
  alternativeSuppliers: string[];
  s3AnalysisKey?: string;
  s3GraphKey?: string;
}

// ========================================
// 通知・リスクイベント型 (Event Notification)
// ========================================

/**
 * 関連ノード（リスクイベントに紐づくサプライチェーンノード）
 */
export interface RelatedNode {
  id: string;
  name: string;
  node_type: string;
  impact_summary?: string;
  relevance_score?: number;
}

/**
 * 事実ソース（リスク判定の根拠となるデータソース）
 */
export interface FactSource {
  source: string;
  data_type?: string;
  matched_text?: string;
  matched_at?: string;
  score_added?: number;
}

/**
 * リスクイベント（EventTable から取得される通知データ）
 */
export interface RiskEvent {
  event_id: string;
  status: 'CONFIRMED' | 'PENDING' | 'WATCHING' | 'DISMISSED';
  category_id: string;
  category_name?: string;
  summary?: string;
  risk_level?: number;
  final_confidence?: number;
  related_nodes?: RelatedNode[];
  fact_sources?: FactSource[];
  source_type?: string;
  created_at?: string;
  updated_at?: string;
  reviewed_by?: string | null;
}

/**
 * イベント件数（各ステータスごとの集計）
 */
export interface EventCounts {
  confirmed: number;
  pending: number;
  watching: number;
  dismissed: number;
}
