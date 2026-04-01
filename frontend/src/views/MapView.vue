<script setup lang="ts">
/**
 * メイン地図ビュー - 全画面マップ中心レイアウト
 */
import { ref, onMounted, computed } from 'vue';
import { useSupplyChainStore } from '@/stores/supplyChain';
import { useNotificationStore } from '@/stores/notification';
import SupplyChainMap from '@/components/SupplyChainMap.vue';
import FactoryList from '@/components/FactoryList.vue';
import DashboardStats from '@/components/DashboardStats.vue';
import MapLegend from '@/components/MapLegend.vue';
import NlSearchBar from '@/components/NlSearchBar.vue';
import type { Plant } from '@/types';
import type { NlQueryResult } from '@/services/api';

const store = useSupplyChainStore();
const notificationStore = useNotificationStore();
const mapRef = ref<InstanceType<typeof SupplyChainMap> | null>(null);
const showSidebar = ref(true);
const isFullscreen = ref(false);
const nlHighlightIds = ref<Set<string>>(new Set());

// 通知バッジテキスト（0件は非表示、99超は"99+"）
const badgeText = computed<string | null>(() => {
  const count = notificationStore.attentionCount;
  if (count === 0) return null;
  if (count > 99) return '99+';
  return String(count);
});

// 最新の地震イベントを取得
const latestEarthquake = computed(() => {
  if (store.earthquakes.length === 0) return null;
  // タイムスタンプ降順で最新を取得
  return [...store.earthquakes].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )[0];
});

// 地震発生時刻をフォーマット
function formatEqTime(ts: string): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// フルスクリーン切り替え
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
    isFullscreen.value = true;
  } else {
    document.exitFullscreen();
    isFullscreen.value = false;
  }
}

// フルスクリーン状態の監視
document.addEventListener('fullscreenchange', () => {
  isFullscreen.value = !!document.fullscreenElement;
});

const visiblePlants = computed(() => mapRef.value?.visiblePlants ?? new Set<string>());
const visibleSuppliers = computed(() => mapRef.value?.visibleSuppliers ?? new Set<string>());
const visibleCustomers = computed(() => mapRef.value?.visibleCustomers ?? new Set<string>());

function handlePlantSelect(plant: Plant) {
  mapRef.value?.focusNode(plant.id);
}

function handleFocusNode(nodeId: string) {
  mapRef.value?.focusNode(nodeId);
}

function handleTogglePlant(id: string) { mapRef.value?.togglePlant(id); }
function handleToggleSupplier(id: string) { mapRef.value?.toggleSupplier(id); }
function handleToggleCustomer(id: string) { mapRef.value?.toggleCustomer(id); }
function handleSelectAllPlants() { mapRef.value?.selectAllPlants(); }
function handleDeselectAllPlants() { mapRef.value?.deselectAllPlants(); }
function handleSelectAllSuppliers() { mapRef.value?.selectAllSuppliers(); }
function handleDeselectAllSuppliers() { mapRef.value?.deselectAllSuppliers(); }
function handleSelectAllCustomers() { mapRef.value?.selectAllCustomers(); }
function handleDeselectAllCustomers() { mapRef.value?.deselectAllCustomers(); }

/**
 * 自然言語クエリ結果を処理
 */
function handleNlResult(result: NlQueryResult) {
  nlHighlightIds.value = new Set();

  if (result.type === 'filter' && result.filter) {
    // フィルタ命令: 表示/非表示を切り替え
    const f = result.filter;
    if (f.showPlants !== undefined) store.showPlants = f.showPlants;
    if (f.showSuppliers !== undefined) store.showSuppliers = f.showSuppliers;
    if (f.showCustomers !== undefined) store.showCustomers = f.showCustomers;

    if (f.impactOnly) {
      // 影響ノードのみ表示: 影響なしノードを非表示に
      const impactedPlantIds = new Set(store.plants.filter(p => p.impactLevel === 'direct' || p.impactLevel === 'downstream').map(p => p.id));
      const impactedSupplierIds = new Set(store.suppliers.filter(s => s.impactLevel === 'downstream').map(s => s.id));
      const impactedCustomerIds = new Set(store.customers.filter(c => c.impactLevel === 'downstream').map(c => c.id));
      mapRef.value?.setVisiblePlants(impactedPlantIds);
      mapRef.value?.setVisibleSuppliers(impactedSupplierIds);
      mapRef.value?.setVisibleCustomers(impactedCustomerIds);
    }

    if (f.highlightIds && f.highlightIds.length > 0) {
      // 特定ノードをハイライト（他は薄く表示）
      nlHighlightIds.value = new Set(f.highlightIds);
      // ハイライトIDに含まれるノードだけ表示
      const plantIds = new Set(store.plants.filter(p => f.highlightIds!.includes(p.id)).map(p => p.id));
      const supplierIds = new Set(store.suppliers.filter(s => f.highlightIds!.includes(s.id)).map(s => s.id));
      const customerIds = new Set(store.customers.filter(c => f.highlightIds!.includes(c.id)).map(c => c.id));
      if (plantIds.size > 0) mapRef.value?.setVisiblePlants(plantIds);
      if (supplierIds.size > 0) mapRef.value?.setVisibleSuppliers(supplierIds);
      if (customerIds.size > 0) mapRef.value?.setVisibleCustomers(customerIds);

      // 最初のハイライトノードにフォーカス
      const firstId = f.highlightIds[0];
      if (firstId) mapRef.value?.focusNode(firstId);
    }
  } else if (result.type === 'cypher' && result.results.length > 0) {
    // Cypherクエリ結果: 結果ノードをハイライト
    const resultIds = result.results.map(r => r.id).filter(Boolean) as string[];
    nlHighlightIds.value = new Set(resultIds);

    // 結果に含まれるノードタイプ別に振り分け
    const plantIds = new Set(store.plants.filter(p => resultIds.includes(p.id)).map(p => p.id));
    const supplierIds = new Set(store.suppliers.filter(s => resultIds.includes(s.id)).map(s => s.id));
    const customerIds = new Set(store.customers.filter(c => resultIds.includes(c.id)).map(c => c.id));

    // 結果に含まれるノードタイプのみ表示、含まれないタイプは非表示にする
    mapRef.value?.setVisiblePlants(plantIds.size > 0 ? plantIds : new Set());
    mapRef.value?.setVisibleSuppliers(supplierIds.size > 0 ? supplierIds : new Set());
    mapRef.value?.setVisibleCustomers(customerIds.size > 0 ? customerIds : new Set());

    // 最初の結果にフォーカス
    const first = result.results[0];
    if (first?.id) mapRef.value?.focusNode(first.id);
  }
}

/**
 * 検索クリア: 全ノードを再表示
 */
function handleNlClear() {
  nlHighlightIds.value = new Set();
  store.showPlants = true;
  store.showSuppliers = true;
  store.showCustomers = true;
  mapRef.value?.selectAllPlants();
  mapRef.value?.selectAllSuppliers();
  mapRef.value?.selectAllCustomers();
}

onMounted(async () => {
  await store.loadAllData();
  // 通知件数を取得（ナビゲーションバッジ用）
  notificationStore.loadCounts();
});
</script>

<template>
  <div class="app-layout">
    <!-- ヘッダー -->
    <header class="app-header">
      <div class="header-top">
        <div class="header-brand">
          <div class="brand-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div class="brand-copy">
            <span class="brand-eyebrow">SUPPLY CHAIN MAP</span>
            <span class="brand-title">サプライチェーン可視化</span>
          </div>
        </div>

        <!-- 地震アラートバナー -->
        <div v-if="latestEarthquake" class="eq-alert">
          <span class="eq-alert-icon">⚠️</span>
          <span class="eq-alert-text">
            <span class="eq-mag">M{{ latestEarthquake.magnitude.toFixed(1) }}</span>
            {{ latestEarthquake.location }}
            <span class="eq-time">{{ formatEqTime(latestEarthquake.timestamp) }}</span>
          </span>
        </div>

        <div class="header-actions">
          <!-- 通知リンク（バッジ付き） -->
          <router-link to="/notifications" class="nav-notification-link" title="通知一覧">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span>通知</span>
            <span v-if="badgeText" class="notification-badge">{{ badgeText }}</span>
          </router-link>

          <div class="header-stats">
            <DashboardStats />
          </div>
          <div class="status-indicator">
            <span class="status-dot"></span>
            <span>稼働中</span>
          </div>
          <button class="icon-btn" @click="toggleFullscreen" :title="isFullscreen ? '全画面解除' : '全画面表示'">
            <svg v-if="!isFullscreen" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
              <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
              <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
              <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
            </svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M8 3v3a2 2 0 0 1-2 2H3"/>
              <path d="M21 8h-3a2 2 0 0 1-2-2V3"/>
              <path d="M3 16h3a2 2 0 0 1 2 2v3"/>
              <path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
            </svg>
          </button>
          <button class="icon-btn" @click="showSidebar = !showSidebar" title="サイドバー切替">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M9 3v18"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- 統計サマリー（独立した行） -->
      
    </header>

    <!-- メインコンテンツ -->
    <main class="app-main">
      <!-- サイドバー（左側） -->
      <aside class="sidebar" :class="{ hidden: !showSidebar }">
        <FactoryList @select-plant="handlePlantSelect" @focus-node="handleFocusNode" />
      </aside>

      <!-- 地図エリア -->
      <div class="map-area">
        <!-- 自然言語検索バー（上部中央） -->
        <div class="search-container">
          <NlSearchBar @result="handleNlResult" @clear="handleNlClear" />
        </div>

        <SupplyChainMap ref="mapRef" />

        <!-- 凡例オーバーレイ（右下） -->
        <div class="legend-container">
          <MapLegend 
            :visible-plants="visiblePlants"
            :visible-suppliers="visibleSuppliers"
            :visible-customers="visibleCustomers"
            @toggle-plant="handleTogglePlant"
            @toggle-supplier="handleToggleSupplier"
            @toggle-customer="handleToggleCustomer"
            @select-all-plants="handleSelectAllPlants"
            @deselect-all-plants="handleDeselectAllPlants"
            @select-all-suppliers="handleSelectAllSuppliers"
            @deselect-all-suppliers="handleDeselectAllSuppliers"
            @select-all-customers="handleSelectAllCustomers"
            @deselect-all-customers="handleDeselectAllCustomers"
          />
        </div>
      </div>
    </main>

    <!-- ローディング -->
    <Transition name="fade">
      <div v-if="store.isLoading" class="loading-overlay">
        <div class="loading-spinner"></div>
        <p>データを読み込み中...</p>
      </div>
    </Transition>

    <!-- エラー -->
    <Transition name="slide">
      <div v-if="store.error" class="error-toast">
        <span>{{ store.error }}</span>
        <button @click="store.loadAllData()">再試行</button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* ヘッダー */
.app-header {
  display: flex;
  flex-direction: column;
  background: var(--color-shell-navy);
  border-bottom: 1px solid rgba(212, 168, 67, 0.22);
  flex-shrink: 0;
  z-index: 100;
  position: relative;
}

.app-header::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  height: 2px;
  background: linear-gradient(90deg, var(--color-shell-gold) 0%, var(--color-shell-gold-soft) 50%, var(--color-shell-gold) 100%);
}

.header-top {
  display: flex;
  align-items: center;
  height: var(--shell-topbar-height);
  padding: 0 20px;
}

.header-stats {
  display: flex;
  flex-direction:row-reverse;
  align-items: center;
  padding: 0 var(--space-4) 8px;
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.brand-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-shell-gold-soft);
  border: 1px solid rgba(212, 168, 67, 0.24);
  border-radius: 4px;
}

.brand-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-eyebrow {
  font-size: 10px;
  line-height: 1.2;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.48);
}

.brand-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: #ffffff;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
}

/* 地震アラートバナー */
.eq-alert {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  margin-right: auto;
  padding: 4px 12px;
  background: #fffde7;
  border: 1px solid rgba(184, 134, 11, 0.42);
  border-radius: 4px;
  font-size: 12px;
  color: #7b5b09;
  white-space: nowrap;
}

.eq-alert-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.eq-alert-text {
  display: flex;
  align-items: center;
  gap: 6px;
}

.eq-mag {
  font-weight: 700;
  color: #dc2626;
  font-size: 13px;
}

.eq-time {
  color: #a16207;
  font-size: 11px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid rgba(212, 168, 67, 0.24);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 11px;
  font-weight: 700;
  color: #ffffff;
}

.status-dot {
  width: 8px;
  height: 8px;
  background: var(--color-success-500);
  border-radius: 50%;
  animation: pulse 2s infinite;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  color: rgba(255, 255, 255, 0.8);
  border-radius: 4px;
  border: 1px solid rgba(212, 168, 67, 0.18);
  transition: all var(--transition-fast);
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #ffffff;
}

/* メインコンテンツ */
.app-main {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* 地図エリア */
.map-area {
  flex: 1;
  position: relative;
  min-width: 0;
}

.search-container {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1100;
}

.legend-container {
  position: absolute;
  bottom: 16px;
  right: 16px;
  z-index: 1100;
}

/* サイドバー（左側） */
.sidebar {
  width: 360px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  background: var(--color-shell-panel);
  transition: all var(--transition-base);
  overflow: hidden;
}

.sidebar.hidden {
  width: 0;
  border-right: none;
}

/* ローディング */
.loading-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  background: rgba(255, 255, 255, 0.9);
  z-index: 2000;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--color-gray-200);
  border-top-color: var(--color-primary-600);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-overlay p {
  color: var(--color-text-secondary);
}

/* エラートースト */
.error-toast {
  position: fixed;
  bottom: var(--space-6);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-danger-500);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 2000;
}

.error-toast span {
  color: var(--color-danger-600);
  font-size: var(--text-sm);
}

.error-toast button {
  padding: var(--space-2) var(--space-3);
  background: var(--color-danger-500);
  color: white;
  font-size: var(--text-sm);
  font-weight: 500;
  border-radius: var(--radius-md);
}

/* トランジション */
.fade-enter-active, .fade-leave-active {
  transition: opacity var(--transition-base);
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

/* 通知リンク */
.nav-notification-link {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #ffffff;
  text-decoration: none;
  border-radius: 3px;
  border: 1px solid rgba(212, 168, 67, 0.24);
  transition: all var(--transition-fast);
  position: relative;
  background: rgba(255, 255, 255, 0.04);
}

.nav-notification-link:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #ffffff;
}

/* 通知バッジ（赤色ピル型） */
.notification-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: #dc2626;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  border-radius: 9px;
}

@media (max-width: 1024px) {
  .header-top {
    padding: 0 14px;
  }

  .brand-eyebrow,
  .eq-alert,
  .status-indicator,
  .header-stats {
    display: none;
  }

  .brand-title {
    font-size: 13px;
  }

  .sidebar {
    width: 320px;
  }
}

.slide-enter-active, .slide-leave-active {
  transition: all var(--transition-base);
}
.slide-enter-from, .slide-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}
</style>
