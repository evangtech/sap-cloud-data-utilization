import { type ClientSchema, a, defineData, defineFunction } from '@aws-amplify/backend';

/**
 * Neptune Analyticsクエリ関数を定義
 * amplify/functions/neptune-query/handler.ts を参照
 */
export const neptuneQueryFunction = defineFunction({
  name: 'neptune-query',
  entry: '../functions/neptune-query/handler.ts',
  environment: {
    NEPTUNE_GRAPH_ID: 'g-844qqbri1a',
    NEPTUNE_REGION: 'us-west-2',
  },
  timeoutSeconds: 30,
});

/**
 * 自然言語クエリ関数を定義
 * amplify/functions/nl-query/handler.ts を参照
 */
export const nlQueryFunction = defineFunction({
  name: 'nl-query',
  entry: '../functions/nl-query/handler.ts',
  environment: {
    NEPTUNE_GRAPH_ID: 'g-844qqbri1a',
    NEPTUNE_REGION: 'us-west-2',
    BEDROCK_REGION: 'us-west-2',
    BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
  },
  timeoutSeconds: 30,
});

/**
 * EventTableクエリ・更新関数を定義
 * amplify/functions/event-query/handler.ts を参照
 */
export const eventQueryFunction = defineFunction({
  name: 'event-query',
  entry: '../functions/event-query/handler.ts',
  environment: {
    EVENT_TABLE_NAME: 'event-table-dev',
  },
  timeoutSeconds: 30,
});

/**
 * Neptuneリスク分析クエリ関数を定義
 * amplify/functions/neptune-risk-query/handler.ts を参照
 */
export const neptuneRiskQueryFunction = defineFunction({
  name: 'neptune-risk-query',
  entry: '../functions/neptune-risk-query/handler.ts',
  environment: {
    NEPTUNE_GRAPH_ID: 'g-844qqbri1a',
    NEPTUNE_REGION: 'us-west-2',
  },
  timeoutSeconds: 30,
});

/**
 * サプライチェーン地図可視化システム - データスキーマ定義
 *
 * データソース:
 * - Neptune Analytics: グラフデータ（工場、サプライヤー、カスタマ、関係）
 * - EventTable: リスクイベントデータ（DynamoDB外部テーブル）
 */
const schema = a.schema({
  // ========================================
  // カスタム型定義（Neptune用）
  // ========================================
  
  /**
   * 工場型
   */
  Plant: a.customType({
    id: a.string().required(),
    name: a.string().required(),
    locationName: a.string(),
    latitude: a.float(),
    longitude: a.float(),
    capacity: a.integer(),
    prefecture: a.string(),
    city: a.string(),
    impactLevel: a.string(),
  }),

  /**
   * サプライヤー型
   */
  Supplier: a.customType({
    id: a.string().required(),
    name: a.string().required(),
    country: a.string(),
    region: a.string(),
    latitude: a.float(),
    longitude: a.float(),
  }),

  /**
   * カスタマ型
   */
  Customer: a.customType({
    id: a.string().required(),
    name: a.string().required(),
    industry: a.string(),
    latitude: a.float(),
    longitude: a.float(),
  }),

  /**
   * サプライチェーン関係の製品情報
   */
  SupplyRelationProduct: a.customType({
    id: a.string(),
    name: a.string(),
  }),

  /**
   * サプライチェーン関係型
   */
  SupplyRelation: a.customType({
    fromId: a.string().required(),
    fromType: a.string(),
    fromName: a.string(),
    fromLat: a.float(),
    fromLon: a.float(),
    toId: a.string().required(),
    toType: a.string(),
    toName: a.string(),
    toLat: a.float(),
    toLon: a.float(),
    products: a.ref('SupplyRelationProduct').array(),
  }),

  /**
   * 製品型
   */
  Product: a.customType({
    id: a.string().required(),
    name: a.string().required(),
    type: a.string(),
    unit: a.string(),
    plantId: a.string(),
    plantName: a.string(),
  }),

  /**
   * 販売伝票型
   */
  SalesOrderResult: a.customType({
    id: a.string().required(),
    lineItem: a.string(),
    orderDate: a.string(),
    requestedDate: a.string(),
    amount: a.float(),
    customerId: a.string(),
    customerName: a.string(),
  }),

  /**
   * 購買伝票型
   */
  PurchaseOrderResult: a.customType({
    id: a.string().required(),
    lineItem: a.string(),
    orderDate: a.string(),
    status: a.string(),
    amount: a.float(),
    supplierId: a.string(),
    supplierName: a.string(),
  }),

  /**
   * 代替工場の製品情報
   */
  SubstituteProductInfo: a.customType({
    id: a.string(),
    name: a.string(),
  }),

  /**
   * 代替工場候補
   */
  SubstitutePlantInfo: a.customType({
    id: a.string().required(),
    name: a.string().required(),
    capacity: a.integer(),
    lat: a.float(),
    lon: a.float(),
    locationName: a.string(),
    products: a.ref('SubstituteProductInfo').array(),
    distanceToCustomers: a.integer(),
  }),

  /**
   * 代替プラン（工場の組み合わせ）
   */
  SubstitutePlan: a.customType({
    planIndex: a.integer().required(),
    plants: a.ref('SubstitutePlantInfo').array(),
    totalCapacity: a.integer(),
    requiredCapacity: a.integer(),
    totalDistance: a.integer(),
    avgDistance: a.integer(),
  }),

  /**
   * 上流影響工場情報
   */
  UpstreamImpactedPlant: a.customType({
    id: a.string().required(),
    name: a.string().required(),
  }),

  /**
   * 製品→供給元工場マッピング
   */
  ProductSupplierMapping: a.customType({
    productId: a.string().required(),
    productName: a.string(),
    supplierId: a.string().required(),
    supplierName: a.string(),
  }),

  /**
   * 影響部品情報（BOM経由の影響を含む）
   */
  ImpactedComponent: a.customType({
    componentId: a.string().required(),
    componentName: a.string(),
    supplierId: a.string().required(),
    supplierName: a.string(),
    supplierPlantId: a.string(),  // 供給元工場ID（フロントエンドで影響判定に使用）
    impactType: a.string(),  // 'direct' | 'bom' | 'manufactured'
    parentProductId: a.string(),
    parentProductName: a.string(),
  }),

  /**
   * 直接影響工場の製造製品
   */
  ManufacturedProduct: a.customType({
    productId: a.string().required(),
    productName: a.string(),
  }),

  /**
   * 影響製品結果型
   */
  ImpactedProductsResult: a.customType({
    impactedProductIds: a.string().array(),
    upstreamImpactedPlants: a.ref('UpstreamImpactedPlant').array(),
    impactedComponents: a.ref('ImpactedComponent').array(),
    isDirectlyImpacted: a.boolean(),  // この工場自体が直接影響を受けているか
    manufacturedProducts: a.ref('ManufacturedProduct').array(),  // 直接影響工場の製造製品
  }),

  /**
   * BOM部品情報
   */
  BOMComponent: a.customType({
    componentId: a.string().required(),
    componentName: a.string(),
    componentType: a.string(),
    quantity: a.integer(),
    supplierPlantId: a.string(),
    supplierPlantName: a.string(),
  }),

  /**
   * BOM付き製品型
   */
  ProductWithBOM: a.customType({
    id: a.string().required(),
    name: a.string().required(),
    type: a.string(),
    unit: a.string(),
    components: a.ref('BOMComponent').array(),
  }),

  /**
   * 自然言語クエリ結果型
   */
  NlQueryResultItem: a.customType({
    id: a.string(),
    name: a.string(),
    lat: a.float(),
    lon: a.float(),
  }),

  /**
   * フィルタ命令型
   */
  NlQueryFilter: a.customType({
    showPlants: a.boolean(),
    showSuppliers: a.boolean(),
    showCustomers: a.boolean(),
    highlightIds: a.string().array(),
    impactOnly: a.boolean(),
  }),

  /**
   * 自然言語クエリ結果型
   */
  NlQueryResult: a.customType({
    type: a.string().required(),
    description: a.string(),
    query: a.string(),
    filter: a.ref('NlQueryFilter'),
    results: a.ref('NlQueryResultItem').array(),
  }),

  // ========================================
  // カスタム型定義（EventTable用）
  // ========================================

  /**
   * 関連ノード型（リスクイベントに関連するサプライチェーンノード）
   */
  RelatedNode: a.customType({
    id: a.string().required(),
    name: a.string().required(),
    node_type: a.string().required(),
    impact_summary: a.string(),
    relevance_score: a.integer(),
  }),

  /**
   * 事実ソース型（リスクイベントの根拠情報）
   */
  FactSource: a.customType({
    source: a.string().required(),
    data_type: a.string(),
    matched_text: a.string(),
    matched_at: a.string(),
    score_added: a.integer(),
  }),

  /**
   * リスクイベント型（EventTableの1レコードに対応）
   */
  RiskEvent: a.customType({
    event_id: a.string().required(),
    status: a.string().required(),
    category_id: a.string().required(),
    category_name: a.string(),
    summary: a.string(),
    risk_level: a.integer(),
    final_confidence: a.integer(),
    related_nodes: a.ref('RelatedNode').array(),
    fact_sources: a.ref('FactSource').array(),
    source_type: a.string(),
    created_at: a.string(),
    updated_at: a.string(),
    reviewed_by: a.string(),
  }),

  /**
   * リスクイベントページ型（ページネーション付きリスト）
   */
  RiskEventPage: a.customType({
    events: a.ref('RiskEvent').array(),
    nextToken: a.string(),
  }),

  /**
   * イベント件数型（各ステータスの件数）
   */
  EventCounts: a.customType({
    confirmed: a.integer().required(),
    pending: a.integer().required(),
    watching: a.integer().required(),
    dismissed: a.integer().required(),
  }),

  // ========================================
  // カスタム型定義（What-if シミュレーション用）
  // ========================================

  /**
   * シミュレーション用BOMアイテム
   */
  SimBOMItem: a.customType({
    productId: a.string().required(),
    productName: a.string(),
    baseCostJpy: a.float(),
    salesPriceJpy: a.float(),
    marginRate: a.float(),
    materialId: a.string().required(),
    materialName: a.string(),
    materialUnitPrice: a.float(),
    materialCurrency: a.string(),
    hsCode: a.string(),
    originCountry: a.string(),
    bomQuantity: a.integer(),
    supplierId: a.string(),
    supplierName: a.string(),
    supplierCountry: a.string(),
    isPrimary: a.boolean(),
  }),

  /**
   * シミュレーション用関税データ
   */
  SimTariff: a.customType({
    hsCode: a.string().required(),
    originCountry: a.string().required(),
    importingCountry: a.string().required(),
    tariffRatePct: a.float(),
    tariffType: a.string(),
  }),

  /**
   * シミュレーション用受注データ
   */
  SimOrder: a.customType({
    productId: a.string().required(),
    productName: a.string(),
    customerId: a.string().required(),
    customerName: a.string(),
    annualOrderQty: a.integer(),
    unitPriceJpy: a.float(),
  }),

  /**
   * シミュレーション用代替サプライヤーデータ
   */
  SimAlternative: a.customType({
    supplierId: a.string().required(),
    supplierName: a.string(),
    altSupplierId: a.string().required(),
    altSupplierName: a.string(),
    qualityDiff: a.integer(),
    priceDiffPct: a.float(),
    leadTimeDiff: a.integer(),
    riskScoreDiff: a.integer(),
  }),

  /**
   * シミュレーション用為替レート
   */
  SimFXRate: a.customType({
    currencyCode: a.string().required(),
    countryCode: a.string().required(),
    exchangeRateJpy: a.float(),
  }),

  /**
   * シミュレーションデータ（一括取得結果）
   */
  SimulationData: a.customType({
    bomItems: a.ref('SimBOMItem').array(),
    tariffs: a.ref('SimTariff').array(),
    orders: a.ref('SimOrder').array(),
    alternatives: a.ref('SimAlternative').array(),
    fxRates: a.ref('SimFXRate').array(),
  }),

  // ========================================
  // DynamoDBモデル（時系列データ）
  // ========================================

  /**
   * 地震イベント（DynamoDB）
   */
  EarthquakeEvent: a.model({
    earthquakeId: a.string().required(),
    timestamp: a.string().required(),
    magnitude: a.float().required(),
    location: a.string().required(),
    depth: a.float(),
    latitude: a.float().required(),
    longitude: a.float().required(),
    maxScale: a.integer(),
    affectedPlantsCount: a.integer(),
    affectedCustomersCount: a.integer(),
    impactedOrderAmount: a.float(),
    ttl: a.integer(),  // Unix timestamp（TTL用）
  }).identifier(['earthquakeId'])
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * 工場影響状態（DynamoDB、TTL付き）
   */
  PlantImpactStatus: a.model({
    plantId: a.string().required(),
    earthquakeId: a.string().required(),
    impactLevel: a.string().required(),  // 'direct' | 'downstream'
    impactedAt: a.string().required(),
    ttl: a.integer().required(),  // Unix timestamp（TTL用）
    earthquakeMagnitude: a.float(),
    earthquakeLocation: a.string(),
    downstreamCustomersCount: a.integer(),
    impactedOrderAmount: a.float(),
  }).identifier(['plantId', 'earthquakeId'])
    .authorization((allow) => [allow.publicApiKey()]),

  // ========================================
  // カスタムクエリ（Neptune Analytics）
  // ========================================

  /**
   * 全工場を取得
   */
  getPlants: a
    .query()
    .returns(a.ref('Plant').array())
    .handler(a.handler.function(neptuneQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * 全サプライヤーを取得
   */
  getSuppliers: a
    .query()
    .returns(a.ref('Supplier').array())
    .handler(a.handler.function(neptuneQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * 全カスタマを取得
   */
  getCustomers: a
    .query()
    .returns(a.ref('Customer').array())
    .handler(a.handler.function(neptuneQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * サプライチェーン関係を取得
   */
  getSupplyRelations: a
    .query()
    .returns(a.ref('SupplyRelation').array())
    .handler(a.handler.function(neptuneQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * 全製品を取得
   */
  getProducts: a
    .query()
    .returns(a.ref('Product').array())
    .handler(a.handler.function(neptuneQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * ノードに関連する販売伝票を取得
   */
  getSalesOrdersByNode: a
    .query()
    .arguments({
      nodeType: a.string().required(),
      nodeId: a.string().required(),
    })
    .returns(a.ref('SalesOrderResult').array())
    .handler(a.handler.function(neptuneQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * ノードに関連する購買伝票を取得
   */
  getPurchaseOrdersByNode: a
    .query()
    .arguments({
      nodeType: a.string().required(),
      nodeId: a.string().required(),
    })
    .returns(a.ref('PurchaseOrderResult').array())
    .handler(a.handler.function(neptuneQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * 自然言語クエリ（Bedrock + Neptune）
   */
  nlQuery: a
    .query()
    .arguments({
      query: a.string().required(),
    })
    .returns(a.ref('NlQueryResult'))
    .handler(a.handler.function(nlQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * 影響工場の代替工場プランを取得
   */
  getSubstitutePlants: a
    .query()
    .arguments({
      plantId: a.string().required(),
      targetProductIds: a.string().array(),
    })
    .returns(a.ref('SubstitutePlan').array())
    .handler(a.handler.function(neptuneQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * 工場の影響製品を取得（上流影響工場から供給される製品）
   */
  getImpactedProducts: a
    .query()
    .arguments({
      plantId: a.string().required(),
      impactedPlantIds: a.string().array().required(),
    })
    .returns(a.ref('ImpactedProductsResult'))
    .handler(a.handler.function(neptuneQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * 工場で製造される製品とそのBOM（部品構成）を取得
   */
  getProductsWithBOM: a
    .query()
    .arguments({
      plantId: a.string().required(),
    })
    .returns(a.ref('ProductWithBOM').array())
    .handler(a.handler.function(neptuneQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * What-if シミュレーション用データ一括取得
   */
  getSimulationData: a
    .query()
    .returns(a.ref('SimulationData'))
    .handler(a.handler.function(neptuneQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  // ========================================
  // カスタムクエリ・ミューテーション（EventTable）
  // ========================================

  /**
   * ステータス別にリスクイベントを取得（GSI1使用）
   */
  getEventsByStatus: a
    .query()
    .arguments({
      status: a.string().required(),
      limit: a.integer(),
      nextToken: a.string(),
    })
    .returns(a.ref('RiskEventPage'))
    .handler(a.handler.function(eventQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * カテゴリ別にリスクイベントを取得（GSI2使用）
   */
  getEventsByCategory: a
    .query()
    .arguments({
      categoryId: a.string().required(),
      limit: a.integer(),
      nextToken: a.string(),
    })
    .returns(a.ref('RiskEventPage'))
    .handler(a.handler.function(eventQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * イベントIDで単一リスクイベントを取得
   */
  getEventById: a
    .query()
    .arguments({
      eventId: a.string().required(),
    })
    .returns(a.ref('RiskEvent'))
    .handler(a.handler.function(eventQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * 各ステータスのイベント件数を取得
   */
  getEventCounts: a
    .query()
    .returns(a.ref('EventCounts'))
    .handler(a.handler.function(eventQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * リスクイベントのステータスを更新
   */
  updateEventStatus: a
    .mutation()
    .arguments({
      eventId: a.string().required(),
      status: a.string().required(),
      reviewedBy: a.string().required(),
    })
    .returns(a.ref('RiskEvent'))
    .handler(a.handler.function(eventQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  // ========================================
  // リスク分析カスタム型
  // ========================================

  GraphRiskEvent: a.customType({
    id: a.string().required(),
    sourceEventId: a.string(),
    dedupeKey: a.string(),
    title: a.string().required(),
    description: a.string(),
    eventType: a.string().required(),
    source: a.string(),
    severity: a.integer().required(),
    lifecycleStatus: a.string().required(),
    reviewStatus: a.string().required(),
    reviewedBy: a.string(),
    reviewedAt: a.string(),
    trustLevel: a.string(),
    latitude: a.float(),
    longitude: a.float(),
    radiusKm: a.float(),
    geoScopeType: a.string(),
    admin1: a.string(),
    admin2: a.string(),
    locationName: a.string(),
    startDate: a.string(),
    endDate: a.string(),
    updatedAt: a.string(),
    sourceUrl: a.string(),
    sourceSnippetHash: a.string(),
    confidence: a.float(),
    latestPropagationRunId: a.string(),
    latestPropagationSequence: a.integer(),
    propagationStartedAt: a.string(),
    propagationCompletedAt: a.string(),
    categoryName: a.string(),
    parentCategory: a.string(),
  }),

  ImpactResult: a.customType({
    eventId: a.string().required(),
    eventTitle: a.string(),
    nodeId: a.string().required(),
    nodeType: a.string(),
    nodeName: a.string(),
    severity: a.integer(),
    impactType: a.string(),
    status: a.string(),
    estimatedRecoveryDays: a.integer(),
    costImpactPct: a.float(),
    cachedImpactAmount: a.float(),
    impactConfidence: a.float(),
    assessmentMethod: a.string(),
    firstDetectedAt: a.string(),
    lastUpdatedAt: a.string(),
    resolvedAt: a.string(),
    propagationRunId: a.string(),
    overrideReviewStatus: a.string(),
  }),

  DisruptsResult: a.customType({
    eventId: a.string().required(),
    eventTitle: a.string(),
    hsCode: a.string().required(),
    originCountry: a.string(),
    destinationCountry: a.string(),
    regulatorBody: a.string(),
    effectiveDate: a.string(),
    expiryDate: a.string(),
    tariffIncreasePct: a.float(),
    exportRestricted: a.boolean(),
  }),

  NodeRiskScoreResult: a.customType({
    nodeId: a.string().required(),
    nodeType: a.string().required(),
    baselineRisk: a.float(),
    liveEventRisk: a.float(),
    revenueExposure: a.float(),
    combinedOperationalRisk: a.float(),
    activeEventCount: a.integer(),
  }),

  WarehouseResult: a.customType({
    id: a.string().required(),
    name: a.string(),
    countryCode: a.string(),
    latitude: a.float(),
    longitude: a.float(),
    capacity: a.float(),
    status: a.string(),
    countryName: a.string(),
  }),

  LogisticsHubResult: a.customType({
    id: a.string().required(),
    name: a.string(),
    type: a.string(),
    countryCode: a.string(),
    latitude: a.float(),
    longitude: a.float(),
    capacity: a.string(),
    status: a.string(),
    countryName: a.string(),
  }),

  RouteThroughResult: a.customType({
    fromId: a.string().required(),
    fromType: a.string(),
    fromName: a.string(),
    toId: a.string().required(),
    toName: a.string(),
    transitDays: a.integer(),
    isPrimary: a.boolean(),
  }),

  // ========================================
  // リスク分析クエリ
  // ========================================

  getRiskEvents: a
    .query()
    .arguments({
      lifecycleStatuses: a.string().array(),
      reviewStatuses: a.string().array(),
      eventTypes: a.string().array(),
      minSeverity: a.integer(),
    })
    .returns(a.ref('GraphRiskEvent').array())
    .handler(a.handler.function(neptuneRiskQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  getActiveImpacts: a
    .query()
    .arguments({ nodeId: a.string(), eventId: a.string() })
    .returns(a.ref('ImpactResult').array())
    .handler(a.handler.function(neptuneRiskQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  getImpactsByEvent: a
    .query()
    .arguments({ eventId: a.string().required() })
    .returns(a.ref('ImpactResult').array())
    .handler(a.handler.function(neptuneRiskQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  getActiveDisrupts: a
    .query()
    .returns(a.ref('DisruptsResult').array())
    .handler(a.handler.function(neptuneRiskQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  getDisruptsByEvent: a
    .query()
    .arguments({ eventId: a.string().required() })
    .returns(a.ref('DisruptsResult').array())
    .handler(a.handler.function(neptuneRiskQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  getNodeRiskScores: a
    .query()
    .returns(a.ref('NodeRiskScoreResult').array())
    .handler(a.handler.function(neptuneRiskQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  getCorridorRisks: a
    .query()
    .returns(a.json().array())
    .handler(a.handler.function(neptuneRiskQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  getRecoveryDashboard: a
    .query()
    .returns(a.json().array())
    .handler(a.handler.function(neptuneRiskQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  getRiskEventHistory: a
    .query()
    .arguments({ nodeId: a.string().required() })
    .returns(a.json().array())
    .handler(a.handler.function(neptuneRiskQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  getRiskEventChain: a
    .query()
    .arguments({ eventId: a.string().required() })
    .returns(a.json().array())
    .handler(a.handler.function(neptuneRiskQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  getWarehouses: a
    .query()
    .returns(a.ref('WarehouseResult').array())
    .handler(a.handler.function(neptuneRiskQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  getLogisticsHubs: a
    .query()
    .returns(a.ref('LogisticsHubResult').array())
    .handler(a.handler.function(neptuneRiskQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),

  getRoutesThrough: a
    .query()
    .returns(a.ref('RouteThroughResult').array())
    .handler(a.handler.function(neptuneRiskQueryFunction))
    .authorization((allow) => [allow.publicApiKey()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'apiKey',
    apiKeyAuthorizationMode: {
      expiresInDays: 365,
    },
  },
});
