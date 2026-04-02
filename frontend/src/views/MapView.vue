<script setup lang="ts">
/**
 * サプライチェーンマップビュー
 * 共通シェル配下で地図ワークスペースを表示
 */
import { ref, onMounted, computed } from 'vue';
import { useSupplyChainStore } from '@/stores/supplyChain';
import { useNotificationStore } from '@/stores/notification';
import SupplyChainMap from '@/components/SupplyChainMap.vue';
import MapLegend from '@/components/MapLegend.vue';
import KpiStrip from '@/components/KpiStrip.vue';
import MapControls from '@/components/MapControls.vue';
import RiskPanel from '@/components/RiskPanel.vue';
import RiskEventTab from '@/components/RiskEventTab.vue';
import ActiveImpactTab from '@/components/ActiveImpactTab.vue';
import CorridorTab from '@/components/CorridorTab.vue';
import RecoveryTab from '@/components/RecoveryTab.vue';
import type { Plant } from '@/types';
import type { NlQueryResult } from '@/services/api';

const store = useSupplyChainStore();
const notificationStore = useNotificationStore();
const mapRef = ref<InstanceType<typeof SupplyChainMap> | null>(null);
const riskPanelRef = ref<InstanceType<typeof RiskPanel> | null>(null);
const showSidebar = ref(true);
const isFullscreen = ref(false);
const nlHighlightIds = ref<Set<string>>(new Set());
const pendingTabFilter = ref<Record<string, unknown>>({});

const badgeText = computed<string>(() => {
  const count = notificationStore.attentionCount;
  if (count > 99) return '99+';
  return String(count);
});

const latestEarthquake = computed(() => {
  if (store.earthquakes.length === 0) return null;
  return [...store.earthquakes].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )[0];
});

const impactedPlants = computed(() =>
  store.dashboardStats.directlyAffectedPlants + store.dashboardStats.downstreamAffectedPlants
);

function formatEqTime(ts: string): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

function handleNlResult(result: NlQueryResult) {
  nlHighlightIds.value = new Set();

  if (result.type === 'filter' && result.filter) {
    const f = result.filter;
    if (f.showPlants !== undefined) store.showPlants = f.showPlants;
    if (f.showSuppliers !== undefined) store.showSuppliers = f.showSuppliers;
    if (f.showCustomers !== undefined) store.showCustomers = f.showCustomers;

    if (f.impactOnly) {
      const impactedPlantIds = new Set(store.plants.filter(p => p.impactLevel === 'direct' || p.impactLevel === 'downstream').map(p => p.id));
      const impactedSupplierIds = new Set(store.suppliers.filter(s => s.impactLevel === 'downstream').map(s => s.id));
      const impactedCustomerIds = new Set(store.customers.filter(c => c.impactLevel === 'downstream').map(c => c.id));
      mapRef.value?.setVisiblePlants(impactedPlantIds);
      mapRef.value?.setVisibleSuppliers(impactedSupplierIds);
      mapRef.value?.setVisibleCustomers(impactedCustomerIds);
    }

    if (f.highlightIds && f.highlightIds.length > 0) {
      nlHighlightIds.value = new Set(f.highlightIds);
      const plantIds = new Set(store.plants.filter(p => f.highlightIds!.includes(p.id)).map(p => p.id));
      const supplierIds = new Set(store.suppliers.filter(s => f.highlightIds!.includes(s.id)).map(s => s.id));
      const customerIds = new Set(store.customers.filter(c => f.highlightIds!.includes(c.id)).map(c => c.id));
      if (plantIds.size > 0) mapRef.value?.setVisiblePlants(plantIds);
      if (supplierIds.size > 0) mapRef.value?.setVisibleSuppliers(supplierIds);
      if (customerIds.size > 0) mapRef.value?.setVisibleCustomers(customerIds);

      const firstId = f.highlightIds[0];
      if (firstId) mapRef.value?.focusNode(firstId);
    }
  } else if (result.type === 'cypher' && result.results.length > 0) {
    const resultIds = result.results.map(r => r.id).filter(Boolean) as string[];
    nlHighlightIds.value = new Set(resultIds);

    const plantIds = new Set(store.plants.filter(p => resultIds.includes(p.id)).map(p => p.id));
    const supplierIds = new Set(store.suppliers.filter(s => resultIds.includes(s.id)).map(s => s.id));
    const customerIds = new Set(store.customers.filter(c => resultIds.includes(c.id)).map(c => c.id));

    const matchedAnyKnownType = plantIds.size > 0 || supplierIds.size > 0 || customerIds.size > 0;

    if (matchedAnyKnownType) {
      // 既知のノードタイプにマッチした場合のみ、表示セットを絞り込む
      // マッチしなかったタイプは全表示を維持（空セットで消さない）
      if (plantIds.size > 0) mapRef.value?.setVisiblePlants(plantIds);
      if (supplierIds.size > 0) mapRef.value?.setVisibleSuppliers(supplierIds);
    } else {
      // RiskEvent, LogisticsHub等の結果 — 既存ノード表示はそのまま維持し、
      // 結果の lat/lon があればそこにフォーカスするだけ
      // マップを空にしない
    }

    const first = result.results[0];
    if (first?.lat && first?.lon) {
      mapRef.value?.focusLatLon(Number(first.lat), Number(first.lon));
    } else if (first?.id) {
      mapRef.value?.focusNode(first.id);
    }
  }
}

function handleNlClear() {
  nlHighlightIds.value = new Set();
  store.showPlants = true;
  store.showSuppliers = true;
  store.showCustomers = true;
  mapRef.value?.selectAllPlants();
  mapRef.value?.selectAllSuppliers();
  mapRef.value?.selectAllCustomers();
}

function handleFocusEvent(ev: { latitude: number; longitude: number }) {
  mapRef.value?.focusLatLon(ev.latitude, ev.longitude);
}

function handleFocusImpactNode(nodeId: string) {
  mapRef.value?.focusNode(nodeId);
}

onMounted(async () => {
  await store.loadAllData();
  notificationStore.loadCounts();
});
</script>

<template>
  <div class="map-page">
    <KpiStrip
      @open-tab="(tab: string) => riskPanelRef?.openTab(tab)"
      @open-tab-filter="(tab: string, filter: Record<string, unknown>) => {
        riskPanelRef?.openTab(tab);
        pendingTabFilter.value = filter;
      }"
    />
    <main class="workspace-grid">
      <aside class="workspace-sidebar" :class="{ hidden: !showSidebar }">
        <MapControls @nl-result="(r: any) => handleNlResult(r)" @nl-clear="handleNlClear" />
        <section class="rail-card rail-card-summary">
          <div class="rail-heading">運用概要</div>
          <div class="rail-subtitle">供給ネットワークの現在値</div>

          <div class="rail-metrics">
            <div class="rail-metric">
              <span class="rail-metric-label">工場</span>
              <span class="rail-metric-value">{{ store.dashboardStats.totalPlants }}</span>
            </div>
            <div class="rail-metric">
              <span class="rail-metric-label">サプライヤー</span>
              <span class="rail-metric-value">{{ store.dashboardStats.totalSuppliers }}</span>
            </div>
            <div class="rail-metric">
              <span class="rail-metric-label">カスタマ</span>
              <span class="rail-metric-value">{{ store.dashboardStats.totalCustomers }}</span>
            </div>
            <div class="rail-metric" :class="{ alert: notificationStore.attentionCount > 0 }">
              <span class="rail-metric-label">要確認通知</span>
              <span class="rail-metric-value">{{ badgeText }}</span>
            </div>
          </div>

          <div class="rail-status-row">
            <div class="status-indicator">
              <span class="status-dot"></span>
              <span>稼働中</span>
            </div>
            <div class="rail-status-note">影響工場 {{ impactedPlants }} 件</div>
          </div>

          <div v-if="latestEarthquake" class="eq-alert rail-alert">
            <span class="eq-alert-icon">⚠</span>
            <span class="eq-alert-text">
              <span class="eq-mag">M{{ latestEarthquake.magnitude.toFixed(1) }}</span>
              {{ latestEarthquake.location }}
              <span class="eq-time">{{ formatEqTime(latestEarthquake.timestamp) }}</span>
            </span>
          </div>
        </section>

      </aside>

      <section class="workspace-main">
        <div class="map-shell">
          <div class="map-toolbar">
            <div class="map-toolbar-copy">
              <div class="map-toolbar-eyebrow">MAP WORKSPACE</div>
              <h2 class="map-toolbar-title">供給ネットワーク地図</h2>
              <p class="map-toolbar-text">
                接続関係、影響経路、自然言語検索の結果を同じ視点で確認します。
              </p>
            </div>

            <div class="map-toolbar-actions">
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

          <div class="map-frame">
            <div class="map-chip-row">
              <div class="map-chip">
                <span class="map-chip-label">工場</span>
                <span class="map-chip-value">{{ store.dashboardStats.totalPlants }}</span>
              </div>
              <div class="map-chip">
                <span class="map-chip-label">影響工場</span>
                <span class="map-chip-value">{{ impactedPlants }}</span>
              </div>
              <div class="map-chip" :class="{ alert: notificationStore.attentionCount > 0 }">
                <span class="map-chip-label">通知</span>
                <span class="map-chip-value">{{ badgeText }}</span>
              </div>
            </div>

            <SupplyChainMap ref="mapRef" />

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
        </div>
      </section>

      <RiskPanel ref="riskPanelRef">
        <template #events>
          <RiskEventTab @focus-event="handleFocusEvent" />
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
      </RiskPanel>
    </main>

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
  min-height: calc(100vh - 48px);
  height: 100%;
  background: #f4f6f8;
  padding: 16px 20px 20px;
  font-family: 'BIZ UDGothic', 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif;
}

.eq-alert {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #fffde7;
  border: 1px solid #f57f17;
  border-radius: 3px;
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
  color: #c62828;
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
  border: 1px solid #d0d5dd;
  border-radius: 3px;
  background: #ffffff;
  font-size: 11px;
  font-weight: 700;
  color: #1b2838;
}

.status-dot {
  width: 8px;
  height: 8px;
  background: #2e7d32;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  color: #1b2838;
  border-radius: 3px;
  border: 1px solid #d0d5dd;
  background: #ffffff;
  transition: background 0.15s ease, color 0.15s ease;
}

.icon-btn:hover {
  background: #eef1f5;
  color: #1b2838;
}

.workspace-grid {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 16px;
}

.workspace-sidebar {
  width: 348px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition: width 0.2s ease;
}

.workspace-sidebar.hidden {
  width: 0;
  gap: 0;
  overflow: hidden;
}

.workspace-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.rail-card,
.map-shell {
  background: #ffffff;
  border-top: 3px solid #1b2838;
  border-left: 1px solid #e8eaed;
  border-right: 1px solid #e8eaed;
  border-bottom: 1px solid #e8eaed;
  border-radius: 0 0 4px 4px;
}

.rail-card-summary {
  padding: 18px 20px;
}

.rail-card-list {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.rail-heading {
  font-size: 15px;
  font-weight: 700;
  color: #1b2838;
  margin-bottom: 4px;
  padding-left: 12px;
  border-left: 4px solid #1b2838;
  line-height: 1.4;
}

.rail-subtitle {
  font-size: 12px;
  color: #8a8a8a;
  margin-bottom: 14px;
}

.rail-metrics {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.rail-metric {
  padding: 12px;
  background: #fafbfc;
  border: 1px solid #d0d5dd;
  border-radius: 4px;
}

.rail-metric.alert {
  background: #fff5f5;
  border-color: #fecaca;
}

.rail-metric-label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  color: #4a4a4a;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}

.rail-metric-value {
  display: block;
  font-size: 22px;
  font-weight: 700;
  color: #1a1a1a;
  font-variant-numeric: tabular-nums;
}

.rail-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 14px;
}

.rail-status-note {
  font-size: 11px;
  color: #8a8a8a;
  font-weight: 700;
}

.rail-alert {
  margin-top: 14px;
}

.map-shell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.map-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid #e8eaed;
}

.map-toolbar-copy {
  min-width: 0;
}

.map-toolbar-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #8a8a8a;
  margin-bottom: 6px;
}

.map-toolbar-title {
  font-size: 16px;
  font-weight: 700;
  color: #1b2838;
  line-height: 1.3;
}

.map-toolbar-text {
  margin-top: 4px;
  font-size: 12px;
  color: #4a4a4a;
}

.map-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.map-search-bar {
  padding: 14px 20px 0;
}

.map-frame {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #eef1f5;
  margin: 14px 20px 20px;
  border: 1px solid #d0d5dd;
  border-radius: 4px;
}

.map-chip-row {
  position: absolute;
  top: 16px;
  left: 16px;
  display: flex;
  gap: 8px;
  z-index: 1100;
}

.map-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #d0d5dd;
  border-radius: 3px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.map-chip.alert {
  border-color: #fecaca;
  background: rgba(255, 245, 245, 0.96);
}

.map-chip-label {
  font-size: 10px;
  font-weight: 700;
  color: #8a8a8a;
  letter-spacing: 0.06em;
}

.map-chip-value {
  font-size: 12px;
  font-weight: 700;
  color: #1b2838;
}

.legend-container {
  position: absolute;
  bottom: 16px;
  right: 16px;
  z-index: 1100;
}

.legend-container {
  position: absolute;
  bottom: 16px;
  right: 16px;
  z-index: 1100;
}

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

@media (max-width: 1024px) {
  .map-page {
    padding: 12px;
  }

  .workspace-grid {
    flex-direction: column;
  }

  .workspace-sidebar {
    width: 100%;
    max-height: none;
  }

  .workspace-sidebar.hidden {
    width: 100%;
    max-height: 0;
  }

  .workspace-main {
    min-height: 60vh;
  }

  .rail-metrics {
    grid-template-columns: repeat(2, 1fr);
  }

  .map-toolbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .map-toolbar-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .map-search-bar {
    padding: 12px 12px 0;
  }

  .map-frame {
    margin: 12px;
  }

  .map-chip-row {
    left: 12px;
    top: 12px;
    flex-wrap: wrap;
    max-width: calc(100% - 92px);
  }

  .legend-container {
    right: 12px;
    bottom: 12px;
  }
}
</style>
