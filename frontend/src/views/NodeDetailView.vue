<script setup lang="ts">
/**
 * ノード詳細ビュー
 * 工場・サプライヤー・カスタマの製品/部品・注文一覧を表示
 * BOM（部品構成）表示対応
 */
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSupplyChainStore } from '@/stores/supplyChain';
import { fetchProducts, fetchSalesOrdersByNode, fetchPurchaseOrdersByNode, fetchSubstitutePlants, fetchImpactedProducts, fetchProductsWithBOM } from '@/services/api';
import type { Product } from '@/types';
import type { SalesOrderResult, PurchaseOrderResult, SubstitutePlan, ImpactedProductsResult, ProductWithBOMInfo } from '@/services/api';

const route = useRoute();
const router = useRouter();
const store = useSupplyChainStore();

const nodeType = computed(() => route.params.type as string);
const nodeId = computed(() => route.params.id as string);
const products = ref<(Product & { plantId?: string; plantName?: string })[]>([]);
const productsWithBOM = ref<ProductWithBOMInfo[]>([]);
const salesOrders = ref<SalesOrderResult[]>([]);
const purchaseOrders = ref<PurchaseOrderResult[]>([]);
const substitutePlans = ref<SubstitutePlan[]>([]);
const isLoadingSubstitutes = ref(false);
const isLoading = ref(true);

// 代替工場プラン（上流影響工場ごとにグループ化）
const substituteBySource = ref<Record<string, { plantName: string; componentIds: string[]; componentNames: string[]; plans: SubstitutePlan[] }>>({});

// 製品フィルタ: 影響製品のみ表示するか
const showImpactedProductsOnly = ref(false);

// 影響製品情報
const impactedProductsInfo = ref<ImpactedProductsResult>({
  impactedProductIds: [],
  upstreamImpactedPlants: [],
  impactedComponents: [],
});

// ノード情報を取得
const nodeInfo = computed(() => {
  if (nodeType.value === 'plant') {
    return store.plants.find((p) => p.id === nodeId.value);
  } else if (nodeType.value === 'supplier') {
    return store.suppliers.find((s) => s.id === nodeId.value);
  } else if (nodeType.value === 'customer') {
    return store.customers.find((c) => c.id === nodeId.value);
  }
  return null;
});

// ノード名
const nodeName = computed(() => {
  if (!nodeInfo.value) return nodeId.value;
  return nodeInfo.value.name;
});

// ノードタイプの日本語ラベル
const typeLabel = computed(() => {
  if (nodeType.value === 'plant') return '工場';
  if (nodeType.value === 'supplier') return 'サプライヤー';
  return 'カスタマ';
});

// タイプ別のテーマカラー
const themeColor = computed(() => {
  if (nodeType.value === 'plant') return '#3b82f6';
  if (nodeType.value === 'supplier') return '#0891b2';
  return '#22c55e';
});

// アイコン
const typeIcon = computed(() => {
  if (nodeType.value === 'plant') return '🏭';
  if (nodeType.value === 'supplier') return '📦';
  return '🏢';
});

// 製品の取得元を示す拡張型
interface ProductWithSource extends Product {
  plantId?: string;
  plantName?: string;
  source: 'manufactured' | 'supplied';  // 製造 or 調達
  supplierPlantId?: string;             // 調達元工場ID
  supplierPlantName?: string;           // 調達元工場名
}

// 関連製品をフィルタ（製造/調達の区別付き）
// この工場で製造される製品 + この工場に供給される製品
const relatedProducts = computed(() => {
  let filtered: ProductWithSource[] = [];
  const addedIds = new Set<string>();
  
  if (nodeType.value === 'plant') {
    // 1. この工場で製造される製品
    // まずproductsWithBOMから取得（より正確）
    productsWithBOM.value.forEach((p) => {
      if (!addedIds.has(p.id)) {
        filtered.push({
          id: p.id,
          name: p.name,
          type: p.type,
          unit: p.unit,
          plantId: nodeId.value,
          plantName: nodeName.value,
          source: 'manufactured' as const,
        });
        addedIds.add(p.id);
      }
    });
    
    // products.valueからも追加（plantIdがこの工場のもの）
    products.value
      .filter((p) => p.plantId === nodeId.value && !addedIds.has(p.id))
      .forEach((p) => {
        filtered.push({
          ...p,
          source: 'manufactured' as const,
        });
        addedIds.add(p.id);
      });
    
    // 2. 上流から供給される製品（supplyRelationsでtoId = this plantのもの）
    store.supplyRelations
      .filter((r) => r.toId === nodeId.value && r.products && r.products.length > 0)
      .forEach((r) => {
        r.products?.forEach((sp) => {
          if (sp.id && !addedIds.has(sp.id)) {
            const productDetail = products.value.find((p) => p.id === sp.id);
            if (productDetail) {
              filtered.push({
                ...productDetail,
                source: 'supplied' as const,
                supplierPlantId: r.fromId,
                supplierPlantName: r.fromName,
              });
              addedIds.add(sp.id);
            }
          }
        });
      });
  } else if (nodeType.value === 'supplier') {
    // サプライヤーが供給する工場の製品を取得
    const suppliedPlantIds = new Set(
      store.supplyRelations
        .filter((r) => r.fromId === nodeId.value && r.toType === 'plant')
        .map((r) => r.toId)
    );
    products.value.forEach((p) => {
      if (p.plantId && suppliedPlantIds.has(p.plantId) && !addedIds.has(p.id)) {
        filtered.push({ ...p, source: 'manufactured' as const });
        addedIds.add(p.id);
      }
    });
  } else {
    // カスタマに供給する工場の製品を取得
    const supplyingPlantIds = new Set(
      store.supplyRelations
        .filter((r) => r.toId === nodeId.value && r.fromType === 'plant')
        .map((r) => r.fromId)
    );
    products.value.forEach((p) => {
      if (p.plantId && supplyingPlantIds.has(p.plantId) && !addedIds.has(p.id)) {
        filtered.push({ ...p, source: 'manufactured' as const });
        addedIds.add(p.id);
      }
    });
  }

  // 影響製品フィルタが有効な場合
  if (showImpactedProductsOnly.value && impactedProductsInfo.value.impactedProductIds.length > 0) {
    const impactedIds = new Set(impactedProductsInfo.value.impactedProductIds);
    filtered = filtered.filter((p) => impactedIds.has(p.id));
  }

  // デバッグログ
  console.log('relatedProducts:', {
    nodeId: nodeId.value,
    productsWithBOM: productsWithBOM.value,
    productsCount: products.value.length,
    filteredCount: filtered.length,
    filtered,
  });

  return filtered;
});

// 影響製品かどうかを判定
function isImpactedProduct(productId: string): boolean {
  return impactedProductsInfo.value.impactedProductIds.includes(productId);
}

// 部品が影響を受けているかを判定
// 重要: (componentId, supplierPlantId) のペアで判定する
// 同じ部品でも、影響を受けていない工場から供給されるものは正常
function isImpactedComponent(componentId: string, supplierPlantId?: string): boolean {
  // supplierPlantIdが指定されている場合、そのペアで判定
  if (supplierPlantId) {
    // impactedComponentsに (componentId, supplierPlantId) のペアが含まれているか
    const matchingComponent = impactedProductsInfo.value.impactedComponents.find(
      (c) => c.componentId === componentId && c.supplierPlantId === supplierPlantId
    );
    if (matchingComponent) return true;
    
    // 供給元工場が直接影響を受けているか
    const impactedPlantIds = store.plants
      .filter((p) => p.impactLevel === 'direct')
      .map((p) => p.id);
    return impactedPlantIds.includes(supplierPlantId);
  }
  
  // supplierPlantIdが未指定の場合、componentIdのみで判定（後方互換）
  return impactedProductsInfo.value.impactedComponents.some(
    (c) => c.componentId === componentId
  );
}

// 部品の影響情報を取得
function getComponentImpactInfo(componentId: string) {
  return impactedProductsInfo.value.impactedComponents.find(
    (c) => c.componentId === componentId
  );
}

// 供給元工場が影響を受けているかを判定
function isSupplierImpacted(supplierPlantId?: string): boolean {
  if (!supplierPlantId) return false;
  const impactedPlantIds = store.plants
    .filter((p) => p.impactLevel === 'direct')
    .map((p) => p.id);
  return impactedPlantIds.includes(supplierPlantId);
}

// 影響状態
const impactLevel = computed(() => {
  if (!nodeInfo.value) return 'none';
  return (nodeInfo.value as any).impactLevel || 'none';
});

// 関連ノード（サプライチェーン上の接続先）
const relatedNodes = computed(() => {
  const nodes: { id: string; name: string; type: string; direction: string }[] = [];
  store.supplyRelations.forEach((r) => {
    if (r.fromId === nodeId.value) {
      nodes.push({ id: r.toId, name: r.toName, type: r.toType, direction: '供給先' });
    }
    if (r.toId === nodeId.value) {
      nodes.push({ id: r.fromId, name: r.fromName, type: r.fromType, direction: '供給元' });
    }
  });
  return nodes;
});

// 製品タイプの日本語ラベル
function productTypeLabel(type: string): string {
  if (type === 'finished') return '完成品';
  if (type === 'component') return '部品';
  if (type === 'raw_material') return '原材料';
  return type;
}

// 購買伝票ステータスの日本語ラベル
function poStatusLabel(status: string): string {
  if (status === 'confirmed') return '確認済';
  if (status === 'open') return '未確認';
  if (status === 'delivered') return '納品済';
  if (status === 'cancelled') return 'キャンセル';
  return status;
}

// 金額フォーマット
function formatAmount(amount: number): string {
  return `¥${amount.toLocaleString()}`;
}

// 販売伝票合計金額
const salesTotal = computed(() => salesOrders.value.reduce((sum, so) => sum + so.amount, 0));

// 購買伝票合計金額
const purchaseTotal = computed(() => purchaseOrders.value.reduce((sum, po) => sum + po.amount, 0));

function goBack() {
  router.push('/');
}

function navigateToNode(type: string, id: string) {
  router.push(`/node/${type}/${id}`);
}

async function loadData() {
  isLoading.value = true;
  // ストアデータがなければ読み込み
  if (store.plants.length === 0) {
    await store.loadAllData();
  }
  
  // 工場の場合はBOM付き製品を取得、それ以外は通常の製品リスト
  if (nodeType.value === 'plant') {
    const [allProducts, bomProducts, sales, purchases] = await Promise.all([
      fetchProducts(),
      fetchProductsWithBOM(nodeId.value),
      fetchSalesOrdersByNode(nodeType.value, nodeId.value),
      fetchPurchaseOrdersByNode(nodeType.value, nodeId.value),
    ]);
    products.value = allProducts as any[];
    productsWithBOM.value = bomProducts;
    salesOrders.value = sales;
    purchaseOrders.value = purchases;
  } else {
    const [allProducts, sales, purchases] = await Promise.all([
      fetchProducts(),
      fetchSalesOrdersByNode(nodeType.value, nodeId.value),
      fetchPurchaseOrdersByNode(nodeType.value, nodeId.value),
    ]);
    products.value = allProducts as any[];
    productsWithBOM.value = [];
    salesOrders.value = sales;
    purchaseOrders.value = purchases;
  }
  isLoading.value = false;

  // 影響工場IDリストを取得
  const impactedPlantIds = store.plants
    .filter((p) => p.impactLevel === 'direct')
    .map((p) => p.id);

  // 工場の場合、影響製品情報を取得
  if (nodeType.value === 'plant' && impactedPlantIds.length > 0) {
    try {
      impactedProductsInfo.value = await fetchImpactedProducts(nodeId.value, impactedPlantIds);
    } catch (e) {
      console.error('影響製品取得エラー:', e);
      impactedProductsInfo.value = { impactedProductIds: [], upstreamImpactedPlants: [], impactedComponents: [] };
    }

    // 影響工場の場合、デフォルトで影響製品フィルタをON
    if (impactLevel.value !== 'none') {
      showImpactedProductsOnly.value = true;
    } else {
      showImpactedProductsOnly.value = false;
    }
  } else {
    impactedProductsInfo.value = { impactedProductIds: [], upstreamImpactedPlants: [], impactedComponents: [] };
    showImpactedProductsOnly.value = false;
  }

  // 下流影響工場の場合、上流影響工場ごとに代替工場プランを取得
  if (nodeType.value === 'plant' && impactLevel.value === 'downstream') {
    isLoadingSubstitutes.value = true;
    try {
      const bySource: Record<string, { plantName: string; componentIds: string[]; componentNames: string[]; plans: SubstitutePlan[] }> = {};
      
      // 上流影響工場ごとに代替工場を検索
      for (const upPlant of impactedProductsInfo.value.upstreamImpactedPlants) {
        // この上流工場から供給される影響部品のIDを取得
        const targetComponents = impactedProductsInfo.value.impactedComponents
          .filter((c) => c.supplierPlantId === upPlant.id)
          .map((c) => ({ id: c.componentId, name: c.componentName }));
        
        if (targetComponents.length === 0) continue;
        
        const targetProductIds = targetComponents.map((c) => c.id);
        const plans = await fetchSubstitutePlants(upPlant.id, targetProductIds);
        
        bySource[upPlant.id] = {
          plantName: upPlant.name,
          componentIds: targetProductIds,
          componentNames: targetComponents.map((c) => c.name),
          plans,
        };
      }
      
      substituteBySource.value = bySource;
    } catch (e) {
      console.error('代替工場プラン取得エラー:', e);
      substituteBySource.value = {};
    }
    isLoadingSubstitutes.value = false;
  } else {
    substituteBySource.value = {};
  }
}

onMounted(() => loadData());

// ルートパラメータ変更時にリロード（ノード間遷移）
watch(() => route.params, () => loadData(), { deep: true });
</script>

<template>
  <div class="detail-layout">
    <!-- ヘッダー -->
    <header class="detail-header">
      <button class="back-btn" @click="goBack">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        地図に戻る
      </button>
      <div class="header-info">
        <span class="type-icon">{{ typeIcon }}</span>
        <div>
          <div class="type-label" :style="{ color: themeColor }">{{ typeLabel }}</div>
          <h1>{{ nodeName }}</h1>
        </div>
        <span v-if="impactLevel !== 'none'" class="impact-badge" :class="impactLevel">
          {{ impactLevel === 'direct' ? '直接影響' : '下流影響' }}
        </span>
      </div>
    </header>

    <!-- ローディング -->
    <div v-if="isLoading" class="loading">
      <div class="spinner"></div>
      <p>データを読み込み中...</p>
    </div>

    <!-- コンテンツ -->
    <main v-else class="detail-content">
      <!-- ノード基本情報 -->
      <section class="info-section">
        <h2>基本情報</h2>
        <div class="info-grid">
          <template v-if="nodeType === 'plant' && nodeInfo">
            <div class="info-item">
              <span class="info-label">所在地</span>
              <span class="info-value">{{ (nodeInfo as any).locationName }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">生産能力</span>
              <span class="info-value">{{ (nodeInfo as any).capacity?.toLocaleString() }} 個/月</span>
            </div>
          </template>
          <template v-if="nodeType === 'supplier' && nodeInfo">
            <div class="info-item">
              <span class="info-label">国</span>
              <span class="info-value">{{ (nodeInfo as any).country }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">地域</span>
              <span class="info-value">{{ (nodeInfo as any).region }}</span>
            </div>
          </template>
          <template v-if="nodeType === 'customer' && nodeInfo">
            <div class="info-item">
              <span class="info-label">業種</span>
              <span class="info-value">{{ (nodeInfo as any).industry }}</span>
            </div>
          </template>
          <div class="info-item">
            <span class="info-label">状態</span>
            <span class="info-value">
              <span class="status-dot" :class="impactLevel"></span>
              {{ impactLevel === 'direct' ? '直接影響' : impactLevel === 'downstream' ? '下流影響' : '正常' }}
            </span>
          </div>
        </div>
      </section>

      <!-- 代替工場候補（下流影響工場：上流影響工場ごとにグループ表示） -->
      <section v-if="nodeType === 'plant' && impactLevel === 'downstream' && Object.keys(substituteBySource).length > 0 || isLoadingSubstitutes" class="table-section substitute-section">
        <h2>
          <span class="section-icon">🔄</span>
          代替工場候補
        </h2>

        <!-- ローディング -->
        <div v-if="isLoadingSubstitutes" class="substitute-loading">
          <div class="spinner small"></div>
          <span>代替工場を検索中...</span>
        </div>

        <!-- 上流影響工場ごとのブロック -->
        <template v-else>
          <div v-for="(source, sourceId) in substituteBySource" :key="sourceId" class="source-block">
            <div class="source-header">
              <span class="source-label">⚠️ 影響元工場:</span>
              <button class="link-btn source-link" @click="navigateToNode('plant', sourceId as string)">{{ source.plantName }}</button>
            </div>
            <div class="source-components">
              <span class="components-tag-label">影響部品:</span>
              <span v-for="(name, idx) in source.componentNames" :key="idx" class="component-tag">{{ name }}</span>
            </div>

            <!-- プランなし -->
            <div v-if="source.plans.length === 0" class="empty-table compact">
              <span>🔍</span>
              <p>代替可能な工場プランが見つかりませんでした</p>
            </div>

            <!-- プランカード -->
            <div v-else class="plans-grid">
              <div v-for="plan in source.plans" :key="plan.planIndex" class="plan-card">
                <div class="plan-header">
                  <span class="plan-rank">#{{ plan.planIndex }}</span>
                  <div class="plan-metrics">
                    <div class="metric">
                      <span class="metric-label">合計キャパシティ</span>
                      <span class="metric-value" :class="{ sufficient: plan.totalCapacity >= plan.requiredCapacity }">
                        {{ plan.totalCapacity.toLocaleString() }}
                        <span class="metric-unit">/ {{ plan.requiredCapacity.toLocaleString() }} 個/月</span>
                      </span>
                    </div>
                    <div class="metric">
                      <span class="metric-label">平均ルート距離</span>
                      <span class="metric-value">{{ plan.avgDistance.toLocaleString() }} <span class="metric-unit">km</span></span>
                    </div>
                    <div class="metric">
                      <span class="metric-label">合計ルート距離</span>
                      <span class="metric-value">{{ plan.totalDistance.toLocaleString() }} <span class="metric-unit">km</span></span>
                    </div>
                  </div>
                </div>
                <div class="plan-plants">
                  <table class="fixed-table">
                    <colgroup>
                      <col style="width:18%">
                      <col style="width:22%">
                      <col style="width:15%">
                      <col style="width:20%">
                      <col style="width:13%">
                      <col style="width:12%">
                    </colgroup>
                    <thead>
                      <tr>
                        <th>工場ID</th>
                        <th>工場名</th>
                        <th>キャパシティ</th>
                        <th>所在地</th>
                        <th>距離</th>
                        <th class="text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="sp in plan.plants" :key="sp.id">
                        <td class="mono">{{ sp.id }}</td>
                        <td>{{ sp.name }}</td>
                        <td>{{ sp.capacity.toLocaleString() }} 個/月</td>
                        <td>{{ sp.locationName || '-' }}</td>
                        <td>{{ sp.distanceToCustomers.toLocaleString() }} km</td>
                        <td class="text-right">
                          <button class="link-btn" @click="navigateToNode('plant', sp.id)">詳細</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </template>
      </section>

      <!-- 製品/部品テーブル -->
      <section class="table-section">
        <h2>
          {{ nodeType === 'plant' ? '製品一覧' : nodeType === 'supplier' ? '供給先製品' : '受注製品' }}
          <span class="count-badge">{{ relatedProducts.length }}</span>
          <!-- 影響製品フィルタトグル（工場で影響製品がある場合のみ表示） -->
          <label v-if="nodeType === 'plant' && impactedProductsInfo.impactedProductIds.length > 0" class="filter-toggle">
            <input type="checkbox" v-model="showImpactedProductsOnly" />
            <span class="toggle-label">影響製品のみ表示</span>
            <span class="impacted-count">({{ impactedProductsInfo.impactedProductIds.length }}件)</span>
          </label>
        </h2>
        <!-- 上流影響工場の情報 -->
        <div v-if="impactedProductsInfo.upstreamImpactedPlants.length > 0" class="upstream-info">
          <span class="upstream-label">⚠️ 上流影響工場:</span>
          <span v-for="(plant, idx) in impactedProductsInfo.upstreamImpactedPlants" :key="plant.id" class="upstream-plant">
            <button class="link-btn" @click="navigateToNode('plant', plant.id)">{{ plant.name }}</button>
            <span v-if="idx < impactedProductsInfo.upstreamImpactedPlants.length - 1">, </span>
          </span>
        </div>
        
        <!-- 工場の場合: BOM付き製品カード表示 -->
        <div v-if="nodeType === 'plant' && productsWithBOM.length > 0" class="product-cards">
          <div v-for="product in productsWithBOM" :key="product.id" class="product-card">
            <div class="product-card-header">
              <div class="product-main-info">
                <span class="product-id mono">{{ product.id }}</span>
                <span class="product-name">{{ product.name }}</span>
                <span class="type-tag" :class="product.type">{{ productTypeLabel(product.type) }}</span>
                <span class="source-tag manufactured">製造</span>
              </div>
            </div>
            
            <!-- 部品構成（BOM） -->
            <div v-if="product.components.length > 0" class="product-components">
              <div class="components-header">
                <span class="components-label">📦 部品構成 ({{ product.components.length }})</span>
              </div>
              <table class="components-table">
                <thead>
                  <tr>
                    <th style="width:15%">部品ID</th>
                    <th style="width:25%">部品名</th>
                    <th style="width:12%">種別</th>
                    <th style="width:10%">数量</th>
                    <th style="width:25%">供給元工場</th>
                    <th style="width:13%">状態</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="comp in product.components" :key="comp.componentId"
                      :class="{ 'impacted-row': isImpactedComponent(comp.componentId, comp.supplierPlantId) }">
                    <td class="mono">{{ comp.componentId }}</td>
                    <td>
                      {{ comp.componentName }}
                      <span v-if="isImpactedComponent(comp.componentId, comp.supplierPlantId)" class="product-impact-badge">影響</span>
                    </td>
                    <td>
                      <span class="type-tag" :class="comp.componentType">{{ productTypeLabel(comp.componentType) }}</span>
                    </td>
                    <td class="text-center">× {{ comp.quantity }}</td>
                    <td>
                      <button v-if="comp.supplierPlantId" class="link-btn"
                              :class="{ 'impacted-link': isSupplierImpacted(comp.supplierPlantId) }"
                              @click="navigateToNode('plant', comp.supplierPlantId)">
                        {{ comp.supplierPlantName || comp.supplierPlantId }}
                        <span v-if="isSupplierImpacted(comp.supplierPlantId)" class="impact-icon">⚠️</span>
                      </button>
                      <span v-else class="no-supplier">未定義</span>
                    </td>
                    <td>
                      <span v-if="isImpactedComponent(comp.componentId, comp.supplierPlantId)" class="status-impacted">供給リスク</span>
                      <span v-else class="status-normal">正常</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="no-components-inline">
              <span>部品構成なし（単体製品）</span>
            </div>
          </div>
        </div>
        
        <!-- 工場以外、またはBOMがない場合: 従来のテーブル表示 -->
        <div v-else class="table-wrapper">
          <table v-if="relatedProducts.length > 0" class="fixed-table">
            <colgroup>
              <col style="width:10%">
              <col style="width:22%">
              <col style="width:10%">
              <col style="width:10%">
              <col style="width:10%">
              <col style="width:25%">
              <col style="width:13%">
            </colgroup>
            <thead>
              <tr>
                <th>製品ID</th>
                <th>製品名</th>
                <th>種別</th>
                <th>単位</th>
                <th>区分</th>
                <th>{{ nodeType === 'plant' ? '製造元/調達元' : '製造工場' }}</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="product in relatedProducts" :key="product.id" :class="{ 'impacted-row': isImpactedProduct(product.id) }">
                <td class="mono">{{ product.id }}</td>
                <td>
                  {{ product.name }}
                  <span v-if="isImpactedProduct(product.id)" class="product-impact-badge">影響</span>
                </td>
                <td>
                  <span class="type-tag" :class="product.type">{{ productTypeLabel(product.type) }}</span>
                </td>
                <td>{{ product.unit }}</td>
                <td>
                  <span v-if="nodeType === 'plant'" class="source-tag" :class="product.source">
                    {{ product.source === 'manufactured' ? '製造' : '調達' }}
                  </span>
                  <span v-else>-</span>
                </td>
                <td>
                  <template v-if="nodeType === 'plant'">
                    <template v-if="product.source === 'manufactured'">
                      {{ product.plantName || nodeName }}
                    </template>
                    <template v-else>
                      <button v-if="product.supplierPlantId" class="link-btn" @click="navigateToNode('plant', product.supplierPlantId)">
                        {{ product.supplierPlantName || product.supplierPlantId }}
                      </button>
                      <span v-else>-</span>
                    </template>
                  </template>
                  <template v-else>
                    {{ product.plantName || '-' }}
                  </template>
                </td>
                <td>
                  <span v-if="isImpactedProduct(product.id)" class="status-impacted">供給リスク</span>
                  <span v-else class="status-normal">正常</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty-table">
            <span>📋</span>
            <p>関連する製品データがありません</p>
          </div>
        </div>
      </section>

      <!-- 関連ノード -->
      <section class="table-section">
        <h2>
          サプライチェーン接続
          <span class="count-badge">{{ relatedNodes.length }}</span>
        </h2>
        <div class="table-wrapper">
          <table v-if="relatedNodes.length > 0" class="fixed-table">
            <colgroup>
              <col style="width:12%">
              <col style="width:25%">
              <col style="width:15%">
              <col style="width:15%">
              <col style="width:20%">
              <col style="width:13%">
            </colgroup>
            <thead>
              <tr>
                <th>方向</th>
                <th>ノード名</th>
                <th>種別</th>
                <th></th>
                <th></th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="node in relatedNodes" :key="node.id + node.direction">
                <td>
                  <span class="direction-badge" :class="node.direction === '供給元' ? 'upstream' : 'downstream'">
                    {{ node.direction }}
                  </span>
                </td>
                <td>{{ node.name }}</td>
                <td>{{ node.type === 'plant' ? '工場' : node.type === 'supplier' ? 'サプライヤー' : 'カスタマ' }}</td>
                <td></td>
                <td></td>
                <td class="text-right">
                  <button class="link-btn" @click="navigateToNode(node.type, node.id)">詳細</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 販売伝票 -->
      <section class="table-section">
        <h2>
          <span class="section-icon">📄</span>
          販売伝票
          <span class="count-badge">{{ salesOrders.length }}</span>
          <span v-if="salesTotal > 0" class="total-badge">合計 {{ formatAmount(salesTotal) }}</span>
        </h2>
        <div class="table-wrapper">
          <table v-if="salesOrders.length > 0" class="fixed-table">
            <colgroup>
              <col style="width:12%">
              <col style="width:25%">
              <col style="width:15%">
              <col style="width:15%">
              <col style="width:20%">
              <col style="width:13%">
            </colgroup>
            <thead>
              <tr>
                <th>伝票ID</th>
                <th>カスタマ</th>
                <th>受注日</th>
                <th>納期</th>
                <th>明細</th>
                <th class="text-right">金額</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="so in salesOrders" :key="so.id">
                <td class="mono">{{ so.id }}</td>
                <td>
                  <button class="link-btn" @click="navigateToNode('customer', so.customerId)">
                    {{ so.customerName }}
                  </button>
                </td>
                <td>{{ so.orderDate }}</td>
                <td>{{ so.requestedDate }}</td>
                <td>{{ so.lineItem }}</td>
                <td class="text-right amount">{{ formatAmount(so.amount) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="5" class="total-label">合計</td>
                <td class="text-right amount total-value">{{ formatAmount(salesTotal) }}</td>
              </tr>
            </tfoot>
          </table>
          <div v-else class="empty-table">
            <span>📄</span>
            <p>関連する販売伝票がありません</p>
          </div>
        </div>
      </section>

      <!-- 購買伝票 -->
      <section class="table-section">
        <h2>
          <span class="section-icon">🧾</span>
          購買伝票
          <span class="count-badge">{{ purchaseOrders.length }}</span>
          <span v-if="purchaseTotal > 0" class="total-badge">合計 {{ formatAmount(purchaseTotal) }}</span>
        </h2>
        <div class="table-wrapper">
          <table v-if="purchaseOrders.length > 0" class="fixed-table">
            <colgroup>
              <col style="width:12%">
              <col style="width:25%">
              <col style="width:15%">
              <col style="width:15%">
              <col style="width:20%">
              <col style="width:13%">
            </colgroup>
            <thead>
              <tr>
                <th>伝票ID</th>
                <th>サプライヤー</th>
                <th>発注日</th>
                <th>ステータス</th>
                <th>明細</th>
                <th class="text-right">金額</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="po in purchaseOrders" :key="po.id">
                <td class="mono">{{ po.id }}</td>
                <td>
                  <button class="link-btn" @click="navigateToNode('supplier', po.supplierId)">
                    {{ po.supplierName }}
                  </button>
                </td>
                <td>{{ po.orderDate }}</td>
                <td>
                  <span class="po-status" :class="po.status">{{ poStatusLabel(po.status) }}</span>
                </td>
                <td>{{ po.lineItem }}</td>
                <td class="text-right amount">{{ formatAmount(po.amount) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="5" class="total-label">合計</td>
                <td class="text-right amount total-value">{{ formatAmount(purchaseTotal) }}</td>
              </tr>
            </tfoot>
          </table>
          <div v-else class="empty-table">
            <span>🧾</span>
            <p>関連する購買伝票がありません</p>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.detail-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: #f8fafc;
}

/* ヘッダー */
.detail-header {
  background: white;
  border-bottom: 1px solid #e2e8f0;
  padding: 16px 24px;
  display: flex;
  align-items: center;
  gap: 24px;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}

.back-btn:hover {
  background: #e2e8f0;
  color: #334155;
}

.header-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.type-icon {
  font-size: 28px;
}

.type-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.header-info h1 {
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
}

.impact-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  margin-left: 8px;
}

.impact-badge.direct {
  background: #fee2e2;
  color: #b91c1c;
}

.impact-badge.downstream {
  background: #fef3c7;
  color: #b45309;
}

/* ローディング */
.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px;
  gap: 16px;
  color: #64748b;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e2e8f0;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* コンテンツ */
.detail-content {
  flex: 1;
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* 基本情報セクション */
.info-section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px 24px;
}

.info-section h2, .table-section h2 {
  font-size: 15px;
  font-weight: 600;
  color: #334155;
  margin: 0 0 16px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-label {
  font-size: 12px;
  font-weight: 500;
  color: #94a3b8;
}

.info-value {
  font-size: 14px;
  font-weight: 500;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
}

.status-dot.direct {
  background: #ef4444;
}

.status-dot.downstream {
  background: #f59e0b;
}

/* テーブルセクション */
.table-section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px 24px;
}

.count-badge {
  font-size: 11px;
  font-weight: 600;
  background: #f1f5f9;
  color: #64748b;
  padding: 2px 8px;
  border-radius: 6px;
}

.table-wrapper {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

/* 全テーブルで統一された列幅を使用 */
.fixed-table {
  table-layout: fixed;
}

th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 10px 12px;
  border-bottom: 2px solid #e2e8f0;
  background: #f8fafc;
}

td {
  font-size: 13px;
  color: #334155;
  padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

tr:hover td {
  background: #f8fafc;
}

.mono {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  color: #64748b;
}

/* 製品種別タグ */
.type-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
}

.type-tag.finished {
  background: #dbeafe;
  color: #1d4ed8;
}

.type-tag.component {
  background: #fef3c7;
  color: #b45309;
}

.type-tag.raw_material {
  background: #f1f5f9;
  color: #475569;
}

/* 製品区分タグ（製造/調達） */
.source-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
}

.source-tag.manufactured {
  background: #dbeafe;
  color: #1d4ed8;
}

.source-tag.supplied {
  background: #fef3c7;
  color: #b45309;
}

/* 方向バッジ */
.direction-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
}

.direction-badge.upstream {
  background: #ecfeff;
  color: #0e7490;
}

.direction-badge.downstream {
  background: #ecfdf5;
  color: #047857;
}

.link-btn {
  font-size: 12px;
  font-weight: 500;
  color: #3b82f6;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}

.link-btn:hover {
  background: #eff6ff;
}

.empty-table {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px;
  color: #94a3b8;
  font-size: 13px;
}

.empty-table span {
  font-size: 32px;
  opacity: 0.5;
}

/* 金額・合計 */
.text-right {
  text-align: right;
}

.amount {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-weight: 600;
  color: #1e293b;
}

.total-label {
  text-align: right;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  padding-right: 12px;
}

.total-value {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  border-top: 2px solid #e2e8f0;
}

tfoot td {
  background: #f8fafc;
}

.total-badge {
  font-size: 11px;
  font-weight: 600;
  background: #dbeafe;
  color: #1d4ed8;
  padding: 2px 8px;
  border-radius: 6px;
  margin-left: auto;
}

.section-icon {
  font-size: 14px;
}

/* 購買伝票ステータス */
.po-status {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
}

.po-status.confirmed {
  background: #dcfce7;
  color: #15803d;
}

.po-status.open {
  background: #fef3c7;
  color: #b45309;
}

.po-status.delivered {
  background: #dbeafe;
  color: #1d4ed8;
}

.po-status.cancelled {
  background: #fee2e2;
  color: #b91c1c;
}

/* 代替工場候補セクション */
.substitute-section {
  border-left: 3px solid #f59e0b;
}

.substitute-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px;
  color: #64748b;
  font-size: 13px;
}

.spinner.small {
  width: 20px;
  height: 20px;
  border-width: 2px;
}

/* 上流影響工場ブロック */
.source-block {
  margin-bottom: 20px;
  padding: 16px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
}

.source-block:last-child {
  margin-bottom: 0;
}

.source-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
}

.source-label {
  color: #b45309;
}

.source-link {
  font-size: 14px !important;
  font-weight: 600 !important;
  color: #b45309 !important;
}

.source-link:hover {
  background: #fef3c7 !important;
}

.source-components {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.components-tag-label {
  font-size: 12px;
  font-weight: 500;
  color: #92400e;
}

.component-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
  border-radius: 4px;
}

.empty-table.compact {
  padding: 20px;
}

.plans-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.plan-card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

.plan-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.plan-rank {
  font-size: 18px;
  font-weight: 700;
  color: #f59e0b;
  min-width: 32px;
}

.plan-metrics {
  display: flex;
  gap: 24px;
  flex: 1;
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.metric-label {
  font-size: 11px;
  font-weight: 500;
  color: #94a3b8;
}

.metric-value {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
}

.metric-value.sufficient {
  color: #16a34a;
}

.metric-unit {
  font-size: 11px;
  font-weight: 400;
  color: #94a3b8;
}

.plan-plants {
  padding: 0;
}

.plan-plants table {
  margin: 0;
}

/* 製品フィルタトグル */
.filter-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 12px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
}

.filter-toggle input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #f59e0b;
  cursor: pointer;
}

.toggle-label {
  color: #475569;
}

.impacted-count {
  color: #f59e0b;
  font-weight: 600;
}

/* 上流影響工場情報 */
.upstream-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 6px;
  font-size: 13px;
}

.upstream-label {
  font-weight: 600;
  color: #b45309;
}

.upstream-plant {
  color: #92400e;
}

/* 影響製品行 */
.impacted-row {
  background: #fef3c7 !important;
}

.impacted-row:hover td {
  background: #fde68a !important;
}

/* 製品影響バッジ */
.product-impact-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  margin-left: 6px;
  background: #fef3c7;
  color: #b45309;
  border: 1px solid #fcd34d;
  border-radius: 4px;
}

/* 製品状態 */
.status-impacted {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  background: #fee2e2;
  color: #b91c1c;
  border-radius: 4px;
}

.status-normal {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  background: #dcfce7;
  color: #15803d;
  border-radius: 4px;
}

/* BOMセクション */
.bom-section {
  border-left: 3px solid #3b82f6;
}

.section-description {
  font-size: 13px;
  color: #64748b;
  margin: -8px 0 16px 0;
}

.bom-cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.bom-card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

.bom-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.bom-product-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bom-product-id {
  font-size: 12px;
  color: #64748b;
}

.bom-product-name {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
}

.bom-component-count {
  font-size: 12px;
  font-weight: 500;
  color: #64748b;
  background: #f1f5f9;
  padding: 4px 10px;
  border-radius: 6px;
}

.bom-components {
  padding: 0;
}

.bom-table {
  margin: 0;
}

.bom-table th {
  background: #fafafa;
}

.text-center {
  text-align: center;
}

.no-components {
  padding: 24px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
}

.no-supplier {
  color: #94a3b8;
  font-style: italic;
}

.impacted-link {
  color: #b91c1c !important;
  font-weight: 600;
}

.impacted-link:hover {
  background: #fee2e2 !important;
}

.impact-icon {
  margin-left: 4px;
}

/* 製品カード（BOM表示用） */
.product-cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.product-card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  background: white;
}

.product-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.product-main-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.product-id {
  font-size: 12px;
  color: #64748b;
}

.product-name {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
}

/* 部品構成セクション */
.product-components {
  padding: 0;
}

.components-header {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  background: #fafafa;
  border-bottom: 1px solid #f1f5f9;
}

.components-label {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
}

.components-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.components-table th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 8px 12px;
  border-bottom: 1px solid #e2e8f0;
  background: #fafafa;
}

.components-table td {
  font-size: 13px;
  color: #334155;
  padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.components-table tr:hover td {
  background: #f8fafc;
}

.no-components-inline {
  padding: 16px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
  background: #fafafa;
}
</style>
