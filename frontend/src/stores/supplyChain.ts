import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  Plant,
  Supplier,
  Customer,
  Location,
  SupplyRelation,
  EarthquakeEvent,
  PlantImpactStatus,
  DashboardStats,
  MapMarker,
  MapLine,
  GraphRiskEvent,
  NodeRiskScore,
  NodeImpact,
  EventImpact,
  DisruptsEdge,
  Warehouse,
  LogisticsHub,
  RouteThrough,
  RiskScenarioSnapshot,
  SimTariff,
} from '@/types';
import { buildScenarioFromActiveRisks } from '@/services/riskSimulationAdapter';
import {
  fetchPlants,
  fetchSuppliers,
  fetchCustomers,
  fetchLocations,
  fetchSupplyRelations,
  fetchEarthquakes,
  fetchPlantImpacts,
  fetchDashboardStats,
  fetchRiskEvents,
  fetchActiveImpacts,
  fetchActiveDisrupts,
  fetchNodeRiskScores,
  fetchWarehouses,
  fetchLogisticsHubs,
  fetchRoutesThrough,
} from '@/services/api';

/**
 * サプライチェーンストア
 * Supply Chain Store - manages all supply chain data
 */
export const useSupplyChainStore = defineStore('supplyChain', () => {
  // ========================================
  // State
  // ========================================
  
  // Node data
  const plants = ref<Plant[]>([]);
  const suppliers = ref<Supplier[]>([]);
  const customers = ref<Customer[]>([]);
  const locations = ref<Location[]>([]);
  
  // Edge data
  const supplyRelations = ref<SupplyRelation[]>([]);
  
  // Event data
  const earthquakes = ref<EarthquakeEvent[]>([]);
  const plantImpacts = ref<PlantImpactStatus[]>([]);
  
  // UI state
  const selectedPlant = ref<Plant | null>(null);
  const selectedEarthquake = ref<EarthquakeEvent | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  
  // Filter state
  const filterTab = ref<'all' | 'affected'>('all');
  const currentPage = ref(1);
  const itemsPerPage = ref(10);
  const showPlants = ref(true);
  const showSuppliers = ref(true);
  const showCustomers = ref(true);

  // リスクイベント関連状態（新規）
  const warehouses = ref<Warehouse[]>([]);
  const logisticsHubs = ref<LogisticsHub[]>([]);
  const routesThrough = ref<RouteThrough[]>([]);
  const riskEvents = ref<GraphRiskEvent[]>([]);
  const activeImpactsByNode = ref<Map<string, NodeImpact[]>>(new Map());
  const activeImpactsByEvent = ref<Map<string, EventImpact[]>>(new Map());
  const activeDisrupts = ref<DisruptsEdge[]>([]);
  const riskScores = ref<Map<string, NodeRiskScore>>(new Map());
  const selectedRiskEvent = ref<GraphRiskEvent | null>(null);
  const showWarehouses = ref(true);
  const showLogisticsHubs = ref(true);

  // ========================================
  // Computed - Dashboard Stats
  // ========================================
  
  const dashboardStats = computed<DashboardStats>(() => {
    const directlyAffected = plants.value.filter((p) => p.impactLevel === 'direct').length;
    const downstreamAffected = plants.value.filter((p) => p.impactLevel === 'downstream').length;
    const affectedCustomerCount = customers.value.filter((c) => c.impactLevel !== 'none').length;
    
    // 影響を受けた注文金額を計算
    const impactedAmount = plantImpacts.value.reduce(
      (sum, impact) => sum + (impact.impactedOrderAmount || 0),
      0
    );

    return {
      totalPlants: plants.value.length,
      totalSuppliers: suppliers.value.length,
      totalCustomers: customers.value.length,
      directlyAffectedPlants: directlyAffected,
      downstreamAffectedPlants: downstreamAffected,
      affectedCustomers: affectedCustomerCount,
      impactedOrderAmount: impactedAmount,
      impactedOrderCount: plantImpacts.value.length,
    };
  });

  // ========================================
  // Computed - Filtered Lists
  // ========================================
  
  const filteredPlants = computed(() => {
    if (filterTab.value === 'all') {
      return plants.value;
    }
    return plants.value.filter(
      (p) => p.impactLevel === 'direct' || p.impactLevel === 'downstream'
    );
  });

  const paginatedPlants = computed(() => {
    const start = (currentPage.value - 1) * itemsPerPage.value;
    const end = start + itemsPerPage.value;
    return filteredPlants.value.slice(start, end);
  });

  const totalPages = computed(() => {
    return Math.ceil(filteredPlants.value.length / itemsPerPage.value) || 1;
  });

  // ========================================
  // Computed - Map Data
  // ========================================
  
  /**
   * 地図上のマーカーデータ
   */
  const mapMarkers = computed<MapMarker[]>(() => {
    const markers: MapMarker[] = [];
    
    // Plants
    plants.value.forEach((plant) => {
      markers.push({
        id: plant.id,
        type: 'plant',
        name: plant.name,
        latitude: plant.latitude,
        longitude: plant.longitude,
        impactLevel: plant.impactLevel || 'none',
        details: {
          locationName: plant.locationName,
          capacity: plant.capacity,
        },
      });
    });
    
    // Suppliers (if enabled)
    if (showSuppliers.value) {
      suppliers.value.forEach((supplier) => {
        markers.push({
          id: supplier.id,
          type: 'supplier',
          name: supplier.name,
          latitude: supplier.latitude,
          longitude: supplier.longitude,
          impactLevel: supplier.impactLevel || 'none',
          details: {
            country: supplier.country,
            region: supplier.region,
          },
        });
      });
    }
    
    // Customers (if enabled)
    if (showCustomers.value) {
      customers.value.forEach((customer) => {
        markers.push({
          id: customer.id,
          type: 'customer',
          name: customer.name,
          latitude: customer.latitude,
          longitude: customer.longitude,
          impactLevel: customer.impactLevel || 'none',
          details: {
            industry: customer.industry,
          },
        });
      });
    }
    
    return markers;
  });

  /**
   * 地図上の線データ（サプライチェーン関係）
   */
  const mapLines = computed<MapLine[]>(() => {
    // 直接影響を受けた工場のIDセット
    const directPlantIds = new Set(
      plants.value
        .filter((p) => p.impactLevel === 'direct')
        .map((p) => p.id)
    );
    // 下流影響を受けた工場のIDセット
    const downstreamPlantIds = new Set(
      plants.value
        .filter((p) => p.impactLevel === 'downstream')
        .map((p) => p.id)
    );
    
    return supplyRelations.value.map((rel) => {
      // 影響線の判定ロジック:
      // 1. 直接影響工場 → 下流影響工場（PLT004→PLT001等）
      // 2. 直接影響工場 → カスタマ
      // 3. サプライヤー → 直接影響工場（SUP001→PLT004等）
      // 4. 下流影響工場 → カスタマ（PLT001→CUS001等）
      // ※ 下流影響工場とその無関係なサプライヤー間は影響線にしない
      const fromIsDirect = directPlantIds.has(rel.fromId);
      const fromIsDownstream = downstreamPlantIds.has(rel.fromId);
      const toIsDirect = directPlantIds.has(rel.toId);
      const toIsDownstream = downstreamPlantIds.has(rel.toId);
      
      let isImpacted = false;
      
      if (fromIsDirect) {
        // 直接影響工場からの全ての線は影響線
        isImpacted = true;
      } else if (toIsDirect) {
        // 直接影響工場への供給線は影響線（サプライヤー→直接影響工場）
        isImpacted = true;
      } else if (fromIsDownstream && rel.toType === 'customer') {
        // 下流影響工場→カスタマは影響線
        isImpacted = true;
      }
      // 下流影響工場への供給線（サプライヤー→下流工場）は影響線にしない
      
      return {
        fromId: rel.fromId,
        fromType: rel.fromType,
        fromLat: rel.fromLat,
        fromLon: rel.fromLon,
        fromName: rel.fromName,
        toId: rel.toId,
        toType: rel.toType,
        toLat: rel.toLat,
        toLon: rel.toLon,
        toName: rel.toName,
        isImpacted,
        products: rel.products,  // 供給される製品リスト
      };
    });
  });

  // ========================================
  // Actions - Data Loading
  // ========================================
  
  /**
   * 全データを読み込み
   */
  async function loadAllData() {
    isLoading.value = true;
    error.value = null;

    try {
      const [
        plantsData,
        suppliersData,
        customersData,
        locationsData,
        relationsData,
        // レガシー互換性（Phase 3で削除）
        earthquakesData,
        impactsData,
        // リスクイベント関連（新規）
        warehousesData,
        logisticsHubsData,
        routesThroughData,
        riskEventsData,
        activeImpactsData,
        activeDisruptsData,
        riskScoresData,
      ] = await Promise.all([
        fetchPlants(),
        fetchSuppliers(),
        fetchCustomers(),
        fetchLocations(),
        fetchSupplyRelations(),
        // レガシー互換性（Phase 3で削除）
        fetchEarthquakes(),
        fetchPlantImpacts(),
        // リスクイベント関連（新規）
        fetchWarehouses(),
        fetchLogisticsHubs(),
        fetchRoutesThrough(),
        fetchRiskEvents({ lifecycleStatus: ['detected', 'active', 'recovering'] }),
        fetchActiveImpacts(),
        fetchActiveDisrupts(),
        fetchNodeRiskScores(),
      ]);

      // --- 全ての派生状態をローカル変数で先に構築 ---

      // インパクトをノード別・イベント別にインデックス化
      // activeImpactsDataはハンドラーから全フィールドを返すが、
      // EventImpact型は軽量版のため、NodeImpact構築時はanyでアクセスする
      const byNode = new Map<string, NodeImpact[]>();
      const byEvent = new Map<string, EventImpact[]>();
      for (const impact of activeImpactsData) {
        const raw = impact as Record<string, any>;
        const nodeKey = impact.nodeId;
        if (!byNode.has(nodeKey)) byNode.set(nodeKey, []);
        byNode.get(nodeKey)!.push({
          eventId: impact.eventId,
          eventTitle: impact.eventTitle ?? '',
          severity: impact.severity,
          impactType: impact.impactType as 'direct' | 'downstream',
          status: impact.status as 'active' | 'recovering' | 'resolved',
          estimatedRecoveryDays: raw.estimatedRecoveryDays ?? null,
          costImpactPct: raw.costImpactPct ?? null,
          cachedImpactAmount: impact.cachedImpactAmount ?? 0,
          impactConfidence: impact.impactConfidence ?? 0,
          assessmentMethod: (raw.assessmentMethod ?? 'automated') as NodeImpact['assessmentMethod'],
          firstDetectedAt: raw.firstDetectedAt ?? null,
          lastUpdatedAt: raw.lastUpdatedAt ?? null,
          resolvedAt: raw.resolvedAt ?? null,
          propagationRunId: raw.propagationRunId ?? null,
          overrideReviewStatus: (raw.overrideReviewStatus as NodeImpact['overrideReviewStatus']) ?? null,
        });

        const evKey = impact.eventId;
        if (!byEvent.has(evKey)) byEvent.set(evKey, []);
        byEvent.get(evKey)!.push(impact);
      }

      // リスクスコアをノードIDでインデックス化
      const scoresMap = new Map<string, NodeRiskScore>();
      for (const score of riskScoresData) {
        scoresMap.set(score.nodeId, score);
      }

      // レガシー互換性: impactLevelをプラント/サプライヤー/カスタマに適用
      if (impactsData.length > 0) {
        const impactMap = new Map<string, 'direct' | 'downstream'>();
        impactsData.forEach((impact) => {
          const existing = impactMap.get(impact.plantId);
          if (!existing || impact.impactLevel === 'direct') {
            impactMap.set(impact.plantId, impact.impactLevel);
          }
        });

        plantsData.forEach((p) => {
          p.impactLevel = impactMap.get(p.id) || p.impactLevel || 'none';
        });

        const affectedPlantIds = new Set(impactMap.keys());
        const affectedSupplierIds = new Set<string>();
        const affectedCustomerIds = new Set<string>();

        relationsData.forEach((rel) => {
          if (affectedPlantIds.has(rel.toId) && rel.fromType === 'supplier') {
            affectedSupplierIds.add(rel.fromId);
          }
          if (affectedPlantIds.has(rel.fromId) && rel.toType === 'customer') {
            affectedCustomerIds.add(rel.toId);
          }
        });

        suppliersData.forEach((s) => {
          if (affectedSupplierIds.has(s.id)) s.impactLevel = 'downstream';
        });
        customersData.forEach((c) => {
          if (affectedCustomerIds.has(c.id)) c.impactLevel = 'downstream';
        });
      }

      // 新方式: activeImpactsから全ノードタイプのimpactLevelを導出
      for (const plant of plantsData) {
        const nodeImpacts = byNode.get(plant.id);
        if (nodeImpacts?.some((i) => i.impactType === 'direct')) {
          plant.impactLevel = 'direct';
        } else if (nodeImpacts?.some((i) => i.impactType === 'downstream')) {
          plant.impactLevel = 'downstream';
        }
      }
      for (const supplier of suppliersData) {
        const nodeImpacts = byNode.get(supplier.id);
        if (nodeImpacts?.some((i) => i.impactType === 'direct')) {
          supplier.impactLevel = 'direct';
        } else if (nodeImpacts?.some((i) => i.impactType === 'downstream')) {
          supplier.impactLevel = 'downstream';
        }
      }
      for (const customer of customersData) {
        const nodeImpacts = byNode.get(customer.id);
        if (nodeImpacts?.some((i) => i.impactType === 'direct')) {
          customer.impactLevel = 'direct';
        } else if (nodeImpacts?.some((i) => i.impactType === 'downstream')) {
          customer.impactLevel = 'downstream';
        }
      }

      // --- 同一ティックでバッチ更新 ---
      // Vueのリアクティビティシステムは同一同期ブロック内のref更新を
      // 次のマイクロタスクまでバッチ処理する（same-tick batched update）
      plants.value = plantsData;
      suppliers.value = suppliersData;
      customers.value = customersData;
      locations.value = locationsData;
      supplyRelations.value = relationsData;
      earthquakes.value = earthquakesData;
      plantImpacts.value = impactsData;
      warehouses.value = warehousesData;
      logisticsHubs.value = logisticsHubsData;
      routesThrough.value = routesThroughData;
      riskEvents.value = riskEventsData;
      activeImpactsByNode.value = byNode;
      activeImpactsByEvent.value = byEvent;
      activeDisrupts.value = activeDisruptsData;
      riskScores.value = scoresMap;

      console.log('データ読み込み完了:', {
        plants: plantsData.length,
        suppliers: suppliersData.length,
        customers: customersData.length,
        relations: relationsData.length,
        riskEvents: riskEventsData.length,
        activeImpacts: activeImpactsData.length,
        riskScores: riskScoresData.length,
        warehouses: warehousesData.length,
        logisticsHubs: logisticsHubsData.length,
      });
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'データの読み込みに失敗しました';
      console.error('データ読み込みエラー:', e);
    } finally {
      isLoading.value = false;
    }
  }

  // ========================================
  // Actions - Selection
  // ========================================
  
  function selectPlant(plant: Plant | null) {
    selectedPlant.value = plant;
  }

  function selectEarthquake(earthquake: EarthquakeEvent | null) {
    selectedEarthquake.value = earthquake;
  }

  // ========================================
  // Actions - Filtering
  // ========================================
  
  function setFilterTab(tab: 'all' | 'affected') {
    filterTab.value = tab;
    currentPage.value = 1;
  }

  function setPage(page: number) {
    currentPage.value = page;
  }

  function nextPage() {
    if (currentPage.value < totalPages.value) {
      currentPage.value++;
    }
  }

  function prevPage() {
    if (currentPage.value > 1) {
      currentPage.value--;
    }
  }

  function toggleSuppliers() {
    showSuppliers.value = !showSuppliers.value;
  }

  function toggleCustomers() {
    showCustomers.value = !showCustomers.value;
  }

  function togglePlants() {
    showPlants.value = !showPlants.value;
  }

  function toggleWarehouses() {
    showWarehouses.value = !showWarehouses.value;
  }

  function toggleLogisticsHubs() {
    showLogisticsHubs.value = !showLogisticsHubs.value;
  }

  function selectRiskEvent(event: GraphRiskEvent | null) {
    selectedRiskEvent.value = event;
  }

  /**
   * 現在のリスク状況からシミュレーションシナリオを生成
   * simulation ストアの applyScenario() に渡す用途
   */
  function buildCurrentRiskScenario(currentTariffs: SimTariff[]): RiskScenarioSnapshot {
    // ノードタイプマップを構築（アダプターがサプライヤーを判定するために必要）
    const nodeTypes = new Map<string, string>();
    suppliers.value.forEach((s) => nodeTypes.set(s.id, 'Supplier'));
    plants.value.forEach((p) => nodeTypes.set(p.id, 'Plant'));
    customers.value.forEach((c) => nodeTypes.set(c.id, 'Customer'));
    warehouses.value.forEach((w) => nodeTypes.set(w.id, 'Warehouse'));
    logisticsHubs.value.forEach((h) => nodeTypes.set(h.id, 'LogisticsHub'));

    return buildScenarioFromActiveRisks(
      activeImpactsByNode.value,
      nodeTypes,
      activeDisrupts.value,
      currentTariffs,
    );
  }

  // ========================================
  // Computed - Risk Dashboard Stats
  // ========================================

  const riskDashboardStats = computed(() => {
    let directCount = 0;
    let downstreamCount = 0;
    let totalExposure = 0;

    for (const [, impacts] of activeImpactsByNode.value) {
      const hasDirect = impacts.some((i) => i.impactType === 'direct');
      const hasDownstream = impacts.some((i) => i.impactType === 'downstream');
      if (hasDirect) directCount++;
      else if (hasDownstream) downstreamCount++;
      totalExposure += impacts.reduce((sum, i) => sum + i.cachedImpactAmount, 0);
    }

    const activeEventCount = riskEvents.value.filter(
      (e) => e.lifecycleStatus !== 'resolved' && e.reviewStatus === 'confirmed',
    ).length;

    const pendingReviewCount = riskEvents.value.filter(
      (e) => e.reviewStatus === 'pending',
    ).length;

    let highestRisk: NodeRiskScore | null = null;
    for (const score of riskScores.value.values()) {
      if (!highestRisk || score.combinedOperationalRisk > highestRisk.combinedOperationalRisk) {
        highestRisk = score;
      }
    }

    return { directCount, downstreamCount, totalExposure, activeEventCount, pendingReviewCount, highestRisk };
  });

  // ========================================
  // Legacy Computed (後方互換性)
  // ========================================
  
  /**
   * @deprecated Use plants instead
   */
  const factories = computed(() => {
    return plants.value.map((p) => ({
      factoryId: p.id,
      factoryName: p.name,
      prefecture: p.locationName,
      city: '',
      latitude: p.latitude,
      longitude: p.longitude,
      capacity: p.capacity,
      isActive: p.impactLevel !== 'direct',
      materials: [],
      impactLevel: p.impactLevel,
    }));
  });

  /**
   * @deprecated Use filteredPlants instead
   */
  const filteredFactories = computed(() => filteredPlants.value);

  /**
   * @deprecated Use paginatedPlants instead
   */
  const paginatedFactories = computed(() => paginatedPlants.value);

  return {
    // State（既存）
    plants,
    suppliers,
    customers,
    locations,
    supplyRelations,
    earthquakes,
    plantImpacts,
    selectedPlant,
    selectedEarthquake,
    isLoading,
    error,
    filterTab,
    currentPage,
    itemsPerPage,
    showPlants,
    showSuppliers,
    showCustomers,

    // State（リスクイベント新規）
    warehouses,
    logisticsHubs,
    routesThrough,
    riskEvents,
    activeImpactsByNode,
    activeImpactsByEvent,
    activeDisrupts,
    riskScores,
    selectedRiskEvent,
    showWarehouses,
    showLogisticsHubs,

    // Computed（既存）
    dashboardStats,
    filteredPlants,
    paginatedPlants,
    totalPages,
    mapMarkers,
    mapLines,

    // Computed（リスク新規）
    riskDashboardStats,

    // Actions（既存）
    loadAllData,
    selectPlant,
    selectEarthquake,
    setFilterTab,
    setPage,
    nextPage,
    prevPage,
    toggleSuppliers,
    toggleCustomers,
    togglePlants,

    // Actions（リスク新規）
    toggleWarehouses,
    toggleLogisticsHubs,
    selectRiskEvent,
    buildCurrentRiskScenario,

    // Legacy (後方互換性)
    factories,
    filteredFactories,
    paginatedFactories,
    selectedFactory: selectedPlant,
    selectFactory: selectPlant,
  };
});
