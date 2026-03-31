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
  fromType: 'plant' | 'supplier';
  fromName: string;
  fromLat: number;
  fromLon: number;
  toId: string;
  toType: 'plant' | 'customer';
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
  type: 'plant' | 'supplier' | 'customer' | 'location';
  name: string;
  latitude: number;
  longitude: number;
  impactLevel: 'direct' | 'downstream' | 'none';
  details?: Record<string, any>;
}

/**
 * 地図上の線（サプライチェーン関係）
 */
export interface MapLine {
  fromId: string;
  fromType: 'plant' | 'supplier';
  fromLat: number;
  fromLon: number;
  fromName: string;
  toId: string;
  toType: 'plant' | 'customer' | 'supplier';
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
