<script setup lang="ts">
/**
 * サプライチェーンマップビュー
 * コマンドバー + マップ + リスクパネルの2カラムレイアウト
 */
import { ref, computed, onMounted } from 'vue';
import { useSupplyChainStore } from '@/stores/supplyChain';
import { useNotificationStore } from '@/stores/notification';
import SupplyChainMap from '@/components/SupplyChainMap.vue';
import MapLegend from '@/components/MapLegend.vue';
import RiskPanel from '@/components/RiskPanel.vue';
import RiskEventTab from '@/components/RiskEventTab.vue';
import ActiveImpactTab from '@/components/ActiveImpactTab.vue';
import CorridorTab from '@/components/CorridorTab.vue';
import RecoveryTab from '@/components/RecoveryTab.vue';
import NodeListTab from '@/components/NodeListTab.vue';

const store = useSupplyChainStore();
const notificationStore = useNotificationStore();
const mapRef = ref<InstanceType<typeof SupplyChainMap> | null>(null);
const riskPanelRef = ref<InstanceType<typeof RiskPanel> | null>(null);
const isFullscreen = ref(false);
const pendingTabFilter = ref<Record<string, unknown>>({});

const stats = computed(() => store.riskDashboardStats);

function formatExposure(amount: number): string {
  if (amount >= 1e8) return `¥${(amount / 1e8).toFixed(1)}億`;
  if (amount >= 1e4) return `¥${(amount / 1e4).toFixed(0)}万`;
  return `¥${amount.toLocaleString()}`;
}

const toggles = [
  { key: 'showPlants' as const, label: '工場', icon: '🏭' },
  { key: 'showSuppliers' as const, label: 'サプライヤー', icon: '🔷' },
  { key: 'showCustomers' as const, label: '顧客', icon: '🟩' },
  { key: 'showWarehouses' as const, label: '倉庫', icon: '🟪' },
  { key: 'showLogisticsHubs' as const, label: '物流拠点', icon: '⚓' },
];

function toggleNodeType(key: string) {
  if (key === 'showPlants') store.togglePlants();
  else if (key === 'showSuppliers') store.toggleSuppliers();
  else if (key === 'showCustomers') store.toggleCustomers();
  else if (key === 'showWarehouses') store.toggleWarehouses();
  else if (key === 'showLogisticsHubs') store.toggleLogisticsHubs();
}

function openTab(tab: string) {
  riskPanelRef.value?.openTab(tab);
}

function openTabWithFilter(tab: string, filter: Record<string, unknown>) {
  riskPanelRef.value?.openTab(tab);
  pendingTabFilter.value = filter;
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
    isFullscreen.value = true;
  } else {
    document.exitFullscreen();
    isFullscreen.value = false;
  }
}

document.addEventListener('fullscreenchange', () => {
  isFullscreen.value = !!document.fullscreenElement;
});

// ノードリストタブ連携
const visiblePlants = computed(() => mapRef.value?.visiblePlants ?? new Set<string>());
const visibleSuppliers = computed(() => mapRef.value?.visibleSuppliers ?? new Set<string>());
const visibleCustomers = computed(() => mapRef.value?.visibleCustomers ?? new Set<string>());

function handleNodeToggle(type: string, id: string) {
  if (type === 'plant') mapRef.value?.togglePlant(id);
  else if (type === 'supplier') mapRef.value?.toggleSupplier(id);
  else if (type === 'customer') mapRef.value?.toggleCustomer(id);
}

function handleBulkSelect(type: string) {
  if (type === 'plant') mapRef.value?.selectAllPlants();
  else if (type === 'supplier') mapRef.value?.selectAllSuppliers();
  else if (type === 'customer') mapRef.value?.selectAllCustomers();
}

function handleBulkDeselect(type: string) {
  if (type === 'plant') mapRef.value?.deselectAllPlants();
  else if (type === 'supplier') mapRef.value?.deselectAllSuppliers();
  else if (type === 'customer') mapRef.value?.deselectAllCustomers();
}

// リスクパネルタブ → マップ連携
function handleFocusEvent(ev: { latitude: number; longitude: number }) {
  mapRef.value?.focusLatLon(ev.latitude, ev.longitude);
}

function handleFocusImpactNode(nodeId: string) {
  mapRef.value?.focusNode(nodeId);
}

onMounted(async () => {
  await store.ensureAllDataLoaded();
  notificationStore.loadCounts();
});
</script>

<template>
  <div class="map-page">
    <!-- コマンドバー: KPI + ノードトグル + アクション -->
    <div class="command-bar">
      <div class="cmd-kpis">
        <button class="cmd-kpi" @click="openTab('events')">
          <span class="cmd-kpi-label">イベント</span>
          <span class="cmd-kpi-value" :class="{ alert: stats.activeEventCount > 0 }">
            {{ stats.activeEventCount }}
          </span>
        </button>
        <button class="cmd-kpi" @click="openTab('impacts')">
          <span class="cmd-kpi-label">直接影響</span>
          <span class="cmd-kpi-value">{{ stats.directCount }}</span>
        </button>
        <button class="cmd-kpi" @click="openTab('impacts')">
          <span class="cmd-kpi-label">下流影響</span>
          <span class="cmd-kpi-value">{{ stats.downstreamCount }}</span>
        </button>
        <button class="cmd-kpi" @click="openTab('impacts')">
          <span class="cmd-kpi-label">エクスポージャー</span>
          <span class="cmd-kpi-value mono">{{ formatExposure(stats.totalExposure) }}</span>
        </button>
        <button class="cmd-kpi" @click="openTabWithFilter('events', { reviewStatus: 'pending' })">
          <span class="cmd-kpi-label">確認待ち</span>
          <span class="cmd-kpi-value" :class="{ warning: stats.pendingReviewCount > 0 }">
            {{ stats.pendingReviewCount }}
          </span>
        </button>
      </div>

      <div class="cmd-sep"></div>

      <div class="cmd-toggles">
        <button
          v-for="t in toggles"
          :key="t.key"
          class="cmd-toggle"
          :class="{ active: store[t.key] }"
          @click="toggleNodeType(t.key)"
          :title="t.label"
        >
          <span class="cmd-toggle-icon">{{ t.icon }}</span>
        </button>
      </div>

      <div class="cmd-actions">
        <button class="cmd-action" @click="toggleFullscreen" :title="isFullscreen ? '全画面解除' : '全画面表示'">
          <svg v-if="!isFullscreen" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
            <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
            <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
            <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
          </svg>
          <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3v3a2 2 0 0 1-2 2H3"/>
            <path d="M21 8h-3a2 2 0 0 1-2-2V3"/>
            <path d="M3 16h3a2 2 0 0 1 2 2v3"/>
            <path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- ワークスペース: マップ + リスクパネル -->
    <div class="workspace">
      <div class="map-area">
        <SupplyChainMap ref="mapRef" />
        <div class="legend-container">
          <MapLegend />
        </div>
      </div>

      <RiskPanel ref="riskPanelRef">
        <template #events>
          <RiskEventTab
            :initial-review-filter="(pendingTabFilter.reviewStatus as string) ?? ''"
            @focus-event="handleFocusEvent"
          />
        </template>
        <template #impacts>
          <ActiveImpactTab @focus-node="handleFocusImpactNode" />
        </template>
        <template #corridors>
          <CorridorTab />
        </template>
        <template #recovery>
          <RecoveryTab />
        </template>
        <template #nodes>
          <NodeListTab
            :visible-plants="visiblePlants"
            :visible-suppliers="visibleSuppliers"
            :visible-customers="visibleCustomers"
            @toggle-node="handleNodeToggle"
            @select-all="handleBulkSelect"
            @deselect-all="handleBulkDeselect"
            @focus-node="handleFocusImpactNode"
          />
        </template>
      </RiskPanel>
    </div>

    <Transition name="fade">
      <div v-if="store.isLoading" class="loading-overlay">
        <div class="loading-spinner"></div>
        <p>データを読み込み中...</p>
      </div>
    </Transition>

    <Transition name="slide">
      <div v-if="store.error" class="error-toast">
        <span>{{ store.error }}</span>
        <button @click="store.loadAllData()">再試行</button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.map-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  background: #f4f6f8;
}

/* ── コマンドバー ─────────────────────────────── */
.command-bar {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 12px;
  background: #ffffff;
  border-bottom: 1px solid #d0d5dd;
  flex-shrink: 0;
}

.cmd-kpis {
  display: flex;
  align-items: center;
  gap: 2px;
}

.cmd-kpi {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 3px;
  transition: background 0.15s ease;
  white-space: nowrap;
}

.cmd-kpi:hover {
  background: #eef1f5;
}

.cmd-kpi-label {
  font-size: 10px;
  font-weight: 700;
  color: #8a8a8a;
  letter-spacing: 0.04em;
}

.cmd-kpi-value {
  font-size: 14px;
  font-weight: 700;
  color: #1b2838;
  font-variant-numeric: tabular-nums;
}

.cmd-kpi-value.alert {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
  padding: 0 6px;
  border-radius: 3px;
}

.cmd-kpi-value.warning {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
  padding: 0 6px;
  border-radius: 3px;
}

.mono {
  font-family: var(--font-mono);
}

.cmd-sep {
  width: 1px;
  height: 20px;
  background: #d0d5dd;
  margin: 0 10px;
  flex-shrink: 0;
}

.cmd-toggles {
  display: flex;
  align-items: center;
  gap: 2px;
}

.cmd-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s ease;
  opacity: 0.35;
}

.cmd-toggle.active {
  opacity: 1;
  background: #eef1f5;
  border-color: #d0d5dd;
}

.cmd-toggle:hover {
  opacity: 1;
  background: #f0f2f5;
}

.cmd-toggle-icon {
  font-size: 14px;
}

.cmd-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.cmd-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: #4a4a4a;
  border-radius: 3px;
  border: 1px solid #d0d5dd;
  background: #ffffff;
  cursor: pointer;
  transition: background 0.15s ease;
}

.cmd-action:hover {
  background: #eef1f5;
  color: #1b2838;
}

/* ── ワークスペース ───────────────────────────── */
.workspace {
  display: flex;
  flex: 1;
  min-height: 0;
}

.map-area {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.legend-container {
  position: absolute;
  bottom: 12px;
  right: 12px;
  z-index: 1100;
}

/* ── オーバーレイ ─────────────────────────────── */
.loading-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: rgba(255, 255, 255, 0.9);
  z-index: 2000;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #d0d5dd;
  border-top-color: #1b2838;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-overlay p {
  color: #4a4a4a;
}

.error-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: #ffffff;
  border: 1px solid #c62828;
  border-radius: 4px;
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04);
  z-index: 2000;
}

.error-toast span {
  color: #c62828;
  font-size: 12px;
}

.error-toast button {
  padding: 6px 10px;
  background: #c62828;
  color: white;
  font-size: 12px;
  font-weight: 700;
  border-radius: 3px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ── レスポンシブ ─────────────────────────────── */
@media (max-width: 1024px) {
  .cmd-kpi-label {
    display: none;
  }

  .cmd-kpi {
    padding: 4px 6px;
  }
}
</style>
