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
} from '@/types';
import {
  fetchPlants,
  fetchSuppliers,
  fetchCustomers,
  fetchLocations,
  fetchSupplyRelations,
  fetchEarthquakes,
  fetchPlantImpacts,
  fetchDashboardStats,
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
        earthquakesData,
        impactsData,
      ] = await Promise.all([
        fetchPlants(),
        fetchSuppliers(),
        fetchCustomers(),
        fetchLocations(),
        fetchSupplyRelations(),
        fetchEarthquakes(),
        fetchPlantImpacts(),
      ]);

      plants.value = plantsData;
      suppliers.value = suppliersData;
      customers.value = customersData;
      locations.value = locationsData;
      supplyRelations.value = relationsData;
      earthquakes.value = earthquakesData;
      plantImpacts.value = impactsData;
      
      console.log('データ読み込み完了:', {
        plants: plants.value.length,
        suppliers: suppliers.value.length,
        customers: customers.value.length,
        relations: supplyRelations.value.length,
        earthquakes: earthquakes.value.length,
        impacts: plantImpacts.value.length,
      });
      
      // 影響データに基づいて工場のimpactLevelを更新
      if (impactsData.length > 0) {
        const impactMap = new Map<string, 'direct' | 'downstream'>();
        impactsData.forEach((impact) => {
          const existing = impactMap.get(impact.plantId);
          // directが優先
          if (!existing || impact.impactLevel === 'direct') {
            impactMap.set(impact.plantId, impact.impactLevel);
          }
        });
        
        plants.value = plants.value.map((p) => ({
          ...p,
          impactLevel: impactMap.get(p.id) || p.impactLevel || 'none',
        }));
        
        // 影響を受けた工場に関連するサプライヤー・カスタマも更新
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
        
        suppliers.value = suppliers.value.map((s) => ({
          ...s,
          impactLevel: affectedSupplierIds.has(s.id) ? 'downstream' as const : (s.impactLevel || 'none' as const),
        }));
        
        customers.value = customers.value.map((c) => ({
          ...c,
          impactLevel: affectedCustomerIds.has(c.id) ? 'downstream' as const : (c.impactLevel || 'none' as const),
        }));
      }
      
      console.log('データ読み込み完了:', {
        plants: plants.value.length,
        suppliers: suppliers.value.length,
        customers: customers.value.length,
        relations: supplyRelations.value.length,
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
    // State
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

    // Computed
    dashboardStats,
    filteredPlants,
    paginatedPlants,
    totalPages,
    mapMarkers,
    mapLines,

    // Actions
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

    // Legacy (後方互換性)
    factories,
    filteredFactories,
    paginatedFactories,
    selectedFactory: selectedPlant,
    selectFactory: selectPlant,
  };
});
