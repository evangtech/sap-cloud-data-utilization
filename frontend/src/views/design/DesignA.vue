<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useSimulationStore } from '@/stores/simulation';

const store = useSimulationStore();
onMounted(() => store.loadData());

function formatJpy(value: number): string {
  if (isNaN(value)) return '--';
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(value);
}

function formatPct(value: number): string {
  if (isNaN(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatHhi(value: number): string {
  return value.toLocaleString('ja-JP');
}

function hhiLabel(hhi: number): string {
  if (hhi >= 5000) return '高集中';
  if (hhi >= 2500) return '中集中';
  return '低集中';
}

function hhiSeverity(hhi: number): string {
  if (hhi >= 5000) return 'negative';
  if (hhi >= 2500) return 'critical';
  return 'positive';
}

function deltaSeverity(pct: number): string {
  if (pct > 5) return 'negative';
  if (pct > 0) return 'critical';
  if (pct < -1) return 'positive';
  return 'neutral';
}

function marginStatus(margin: number): string {
  if (margin >= 0.15) return 'positive';
  if (margin >= 0.05) return 'critical';
  return 'negative';
}

const averageMargin = computed(() => {
  const results = store.simulationResults;
  if (results.length === 0) return 0;
  return results.reduce((sum, r) => sum + r.newMargin, 0) / results.length;
});

const disruptedCount = computed(() => {
  return store.simulationResults.filter(r => r.isDisrupted).length;
});

function onTariffChange(key: string, value: string) {
  store.setTariffOverride(key, parseFloat(value));
}

function onFxChange(currency: string, value: string) {
  store.setFxOverride(currency, parseFloat(value));
}
</script>

<template>
  <div class="sap-shell">
    <!-- Shell Bar -->
    <header class="shell-bar">
      <div class="shell-bar-start">
        <svg class="sap-logo" viewBox="0 0 92 46" width="52" height="26">
          <rect width="92" height="46" rx="4" fill="#0070f2"/>
          <text x="46" y="30" text-anchor="middle" fill="#fff" font-size="20" font-weight="700" font-family="'SAP 72','Inter','Noto Sans JP',sans-serif">SAP</text>
        </svg>
        <span class="shell-title">What-if シミュレーション</span>
      </div>
      <div class="shell-bar-end">
        <span class="shell-subtitle">Design A: SAP Fiori Horizon</span>
      </div>
    </header>

    <!-- Loading Overlay -->
    <div v-if="store.isLoading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <span class="loading-text">データ読み込み中...</span>
    </div>

    <!-- Error Banner -->
    <div v-if="store.error" class="message-strip message-strip--error">
      <span class="message-strip-icon">!</span>
      <span>{{ store.error }}</span>
    </div>

    <!-- Main Content Grid -->
    <div v-if="!store.isLoading" class="page-content">
      <!-- Left: Parameter Panel -->
      <aside class="param-panel">
        <div class="panel-header">
          <span class="panel-title">パラメータ設定</span>
          <button class="btn btn--ghost btn--sm" @click="store.resetAll()">リセット</button>
        </div>

        <!-- Tariff Sliders -->
        <section class="panel-section">
          <h3 class="section-title">関税率</h3>
          <div v-if="store.tariffGroups.length === 0" class="empty-hint">関税データなし</div>
          <div
            v-for="group in store.tariffGroups"
            :key="group.key"
            class="slider-row"
          >
            <div class="slider-label">
              <span class="slider-label-main">{{ group.origin }} → {{ group.importer }}</span>
              <span class="slider-label-sub">HS {{ group.hsCode }} / {{ group.type }}</span>
            </div>
            <input
              type="range"
              class="sap-slider"
              :min="0"
              :max="Math.max(group.baseRate * 3, 50)"
              :step="0.5"
              :value="store.tariffOverrides.get(group.key) ?? group.baseRate"
              @input="onTariffChange(group.key, ($event.target as HTMLInputElement).value)"
            />
            <span class="slider-value">{{ (store.tariffOverrides.get(group.key) ?? group.baseRate).toFixed(1) }}%</span>
          </div>
        </section>

        <!-- FX Rate Sliders -->
        <section class="panel-section">
          <h3 class="section-title">為替レート</h3>
          <div v-if="store.fxRateList.length === 0" class="empty-hint">為替データなし</div>
          <div
            v-for="fx in store.fxRateList"
            :key="fx.currency"
            class="slider-row"
          >
            <div class="slider-label">
              <span class="slider-label-main">{{ fx.currency }}/JPY</span>
              <span class="slider-label-sub">基準: {{ fx.baseRate.toFixed(4) }}</span>
            </div>
            <input
              type="range"
              class="sap-slider"
              :min="fx.baseRate * 0.5"
              :max="fx.baseRate * 1.5"
              :step="fx.baseRate * 0.005"
              :value="store.fxOverrides.get(fx.currency) ?? fx.baseRate"
              @input="onFxChange(fx.currency, ($event.target as HTMLInputElement).value)"
            />
            <span class="slider-value">{{ (store.fxOverrides.get(fx.currency) ?? fx.baseRate).toFixed(4) }}</span>
          </div>
        </section>

        <!-- Supplier Switch -->
        <section class="panel-section">
          <h3 class="section-title">サプライヤー切替</h3>
          <div v-if="store.supplierList.length === 0" class="empty-hint">サプライヤーデータなし</div>
          <div
            v-for="supplier in store.supplierList"
            :key="supplier.id"
            class="supplier-toggle"
          >
            <label class="toggle-label">
              <input
                type="checkbox"
                class="sap-checkbox"
                :checked="!store.disabledSuppliers.has(supplier.id)"
                @change="store.toggleSupplier(supplier.id)"
              />
              <span class="toggle-text">
                <span class="toggle-name">{{ supplier.name }}</span>
                <span class="toggle-country">{{ supplier.country }}</span>
              </span>
            </label>
          </div>
        </section>
      </aside>

      <!-- Right: Main Area -->
      <main class="main-area">
        <!-- KPI Tiles Row -->
        <div class="kpi-row">
          <div class="kpi-tile">
            <span class="kpi-label">コスト変動率</span>
            <span class="kpi-value" :class="`kpi-value--${deltaSeverity(store.portfolioImpact.totalDeltaPct)}`">
              {{ formatPct(store.portfolioImpact.totalDeltaPct) }}
            </span>
            <span class="kpi-sub">{{ formatJpy(store.portfolioImpact.totalDelta) }}</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-label">平均マージン</span>
            <span class="kpi-value" :class="`kpi-value--${marginStatus(averageMargin)}`">
              {{ formatPct(averageMargin * 100) }}
            </span>
            <span class="kpi-sub">全製品平均</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-label">供給途絶製品</span>
            <span class="kpi-value" :class="disruptedCount > 0 ? 'kpi-value--negative' : 'kpi-value--positive'">
              {{ disruptedCount }}
            </span>
            <span class="kpi-sub">/ {{ store.simulationResults.length }} 製品</span>
          </div>
        </div>

        <!-- Product Impact Table -->
        <section class="table-section">
          <div class="table-header">
            <h2 class="table-title">製品別影響一覧</h2>
            <span class="table-count">{{ store.simulationResults.length }} 件</span>
          </div>
          <div class="table-scroll">
            <table class="sap-table">
              <thead>
                <tr>
                  <th>製品名</th>
                  <th class="col-num">ベースコスト</th>
                  <th class="col-num">新コスト</th>
                  <th class="col-num">変動率</th>
                  <th class="col-num">マージン</th>
                  <th class="col-status">ステータス</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="result in store.simulationResults"
                  :key="result.productId"
                  :class="{ 'row-selected': store.selectedProductId === result.productId }"
                  @click="store.selectProduct(result.productId)"
                >
                  <td class="cell-name">{{ result.productName }}</td>
                  <td class="col-num">{{ formatJpy(result.baseCost) }}</td>
                  <td class="col-num">{{ formatJpy(result.newCost) }}</td>
                  <td class="col-num">
                    <span :class="`delta-badge delta-badge--${deltaSeverity(result.deltaPct)}`">
                      {{ formatPct(result.deltaPct) }}
                    </span>
                  </td>
                  <td class="col-num">{{ formatPct(result.newMargin * 100) }}</td>
                  <td class="col-status">
                    <span v-if="result.isDisrupted" class="status-badge status-badge--negative">途絶</span>
                    <span v-else-if="result.deltaPct > 5" class="status-badge status-badge--critical">要注意</span>
                    <span v-else-if="result.deltaPct > 0" class="status-badge status-badge--warning">軽微</span>
                    <span v-else class="status-badge status-badge--positive">正常</span>
                  </td>
                </tr>
                <tr v-if="store.simulationResults.length === 0">
                  <td colspan="6" class="empty-row">データなし</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Risk Metrics Section -->
        <section class="risk-section">
          <h2 class="table-title">サプライリスク指標</h2>
          <div class="risk-grid">
            <div class="risk-card">
              <span class="risk-label">サプライヤーHHI</span>
              <div class="risk-comparison">
                <div class="risk-val-group">
                  <span class="risk-val-sub">変更前</span>
                  <span class="risk-val">{{ formatHhi(store.supplyRiskMetrics.supplierHHI.before) }}</span>
                  <span :class="`risk-severity risk-severity--${hhiSeverity(store.supplyRiskMetrics.supplierHHI.before)}`">
                    {{ hhiLabel(store.supplyRiskMetrics.supplierHHI.before) }}
                  </span>
                </div>
                <span class="risk-arrow">→</span>
                <div class="risk-val-group">
                  <span class="risk-val-sub">変更後</span>
                  <span class="risk-val">{{ formatHhi(store.supplyRiskMetrics.supplierHHI.after) }}</span>
                  <span :class="`risk-severity risk-severity--${hhiSeverity(store.supplyRiskMetrics.supplierHHI.after)}`">
                    {{ hhiLabel(store.supplyRiskMetrics.supplierHHI.after) }}
                  </span>
                </div>
              </div>
            </div>
            <div class="risk-card">
              <span class="risk-label">地理的集中度 (HHI)</span>
              <div class="risk-comparison">
                <div class="risk-val-group">
                  <span class="risk-val-sub">変更前</span>
                  <span class="risk-val">{{ formatHhi(store.supplyRiskMetrics.geoConcentration.before) }}</span>
                  <span :class="`risk-severity risk-severity--${hhiSeverity(store.supplyRiskMetrics.geoConcentration.before)}`">
                    {{ hhiLabel(store.supplyRiskMetrics.geoConcentration.before) }}
                  </span>
                </div>
                <span class="risk-arrow">→</span>
                <div class="risk-val-group">
                  <span class="risk-val-sub">変更後</span>
                  <span class="risk-val">{{ formatHhi(store.supplyRiskMetrics.geoConcentration.after) }}</span>
                  <span :class="`risk-severity risk-severity--${hhiSeverity(store.supplyRiskMetrics.geoConcentration.after)}`">
                    {{ hhiLabel(store.supplyRiskMetrics.geoConcentration.after) }}
                  </span>
                </div>
              </div>
            </div>
            <div class="risk-card">
              <span class="risk-label">単一ソース素材</span>
              <div class="risk-comparison">
                <div class="risk-val-group">
                  <span class="risk-val-sub">変更前</span>
                  <span class="risk-val">{{ store.supplyRiskMetrics.singleSource.before }}</span>
                </div>
                <span class="risk-arrow">→</span>
                <div class="risk-val-group">
                  <span class="risk-val-sub">変更後</span>
                  <span class="risk-val" :class="{ 'risk-val--warn': store.supplyRiskMetrics.singleSource.after > store.supplyRiskMetrics.singleSource.before }">
                    {{ store.supplyRiskMetrics.singleSource.after }}
                  </span>
                </div>
              </div>
            </div>
            <div class="risk-card" v-if="store.supplyRiskMetrics.cautions.length > 0">
              <span class="risk-label">注意事項</span>
              <ul class="caution-list">
                <li v-for="(caution, idx) in store.supplyRiskMetrics.cautions" :key="idx">{{ caution }}</li>
              </ul>
            </div>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<style scoped>
/* ========================================
   Design A: SAP Fiori Horizon
   Self-contained — no CSS variable dependencies
   ======================================== */

/* Reset & Base */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.sap-shell {
  font-family: 'SAP 72', 'Inter', 'Noto Sans JP', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #32363a;
  background: #f5f6f7;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Shell Bar */
.shell-bar {
  height: 44px;
  background: #fff;
  border-bottom: 3px solid #0070f2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  flex-shrink: 0;
  z-index: 100;
}

.shell-bar-start {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sap-logo {
  flex-shrink: 0;
}

.shell-title {
  font-size: 16px;
  font-weight: 700;
  color: #32363a;
  letter-spacing: 0.02em;
}

.shell-bar-end {
  display: flex;
  align-items: center;
}

.shell-subtitle {
  font-size: 12px;
  color: #6a6d70;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Loading */
.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  gap: 16px;
}

.loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e0e0e0;
  border-top-color: #0070f2;
  border-radius: 50%;
  animation: sap-spin 0.8s linear infinite;
}

@keyframes sap-spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  font-size: 13px;
  color: #6a6d70;
}

/* Message Strip */
.message-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 13px;
}

.message-strip--error {
  background: #ffeaec;
  color: #bb0000;
  border-left: 4px solid #bb0000;
}

.message-strip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #bb0000;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

/* Page Content Grid */
.page-content {
  display: grid;
  grid-template-columns: 280px 1fr;
  flex: 1;
  min-height: 0;
}

/* Left Parameter Panel */
.param-panel {
  background: #f5f6f7;
  border-right: 1px solid #e0e0e0;
  overflow-y: auto;
  padding: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px;
  border-bottom: 1px solid #e0e0e0;
  background: #fff;
  position: sticky;
  top: 0;
  z-index: 10;
}

.panel-title {
  font-size: 14px;
  font-weight: 700;
  color: #32363a;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
  white-space: nowrap;
}

.btn--sm {
  height: 28px;
  padding: 0 10px;
}

.btn--ghost {
  background: transparent;
  border: 1px solid #8a8d90;
  color: #32363a;
}

.btn--ghost:hover {
  background: #e9e9e9;
  border-color: #6a6d70;
}

.btn--emphasized {
  background: #0070f2;
  border: 1px solid #0070f2;
  color: #fff;
}

.btn--emphasized:hover {
  background: #0058c4;
  border-color: #0058c4;
}

/* Panel Sections */
.panel-section {
  padding: 12px 16px;
  border-bottom: 1px solid #e0e0e0;
}

.section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6a6d70;
  margin-bottom: 10px;
}

.empty-hint {
  font-size: 12px;
  color: #8a8d90;
  padding: 4px 0;
}

/* Sliders */
.slider-row {
  margin-bottom: 12px;
}

.slider-label {
  display: flex;
  flex-direction: column;
  margin-bottom: 4px;
}

.slider-label-main {
  font-size: 13px;
  font-weight: 600;
  color: #32363a;
}

.slider-label-sub {
  font-size: 11px;
  color: #8a8d90;
}

.sap-slider {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: #d9d9d9;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.sap-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #0070f2;
  border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  cursor: pointer;
}

.sap-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #0070f2;
  border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  cursor: pointer;
}

.slider-value {
  display: block;
  text-align: right;
  font-size: 12px;
  font-weight: 600;
  color: #0070f2;
  margin-top: 2px;
}

/* Supplier Toggle */
.supplier-toggle {
  margin-bottom: 6px;
}

.toggle-label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
  padding: 6px 4px;
  border-radius: 4px;
  transition: background 0.1s;
}

.toggle-label:hover {
  background: #eaecee;
}

.sap-checkbox {
  width: 16px;
  height: 16px;
  margin-top: 1px;
  accent-color: #0070f2;
  cursor: pointer;
  flex-shrink: 0;
}

.toggle-text {
  display: flex;
  flex-direction: column;
}

.toggle-name {
  font-size: 13px;
  font-weight: 500;
  color: #32363a;
  line-height: 1.3;
}

.toggle-country {
  font-size: 11px;
  color: #8a8d90;
}

/* Main Area */
.main-area {
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* KPI Tiles */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.kpi-tile {
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kpi-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6a6d70;
}

.kpi-value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
}

.kpi-value--positive { color: #107e3e; }
.kpi-value--critical { color: #e9730c; }
.kpi-value--negative { color: #bb0000; }
.kpi-value--neutral  { color: #32363a; }

.kpi-sub {
  font-size: 12px;
  color: #8a8d90;
}

/* Table Section */
.table-section {
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
}

.table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e0e0e0;
}

.table-title {
  font-size: 15px;
  font-weight: 700;
  color: #32363a;
}

.table-count {
  font-size: 12px;
  color: #6a6d70;
  background: #eaecee;
  padding: 2px 8px;
  border-radius: 10px;
}

.table-scroll {
  overflow-x: auto;
}

.sap-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.sap-table thead {
  background: #f5f6f7;
}

.sap-table th {
  padding: 8px 12px;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6a6d70;
  border-bottom: 1px solid #e0e0e0;
  white-space: nowrap;
}

.sap-table td {
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
  white-space: nowrap;
}

.sap-table tbody tr:nth-child(even) {
  background: #fafbfc;
}

.sap-table tbody tr:hover {
  background: #e8f0fe;
  cursor: pointer;
}

.sap-table tbody tr.row-selected {
  background: #dae8fc;
}

.col-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.col-status {
  text-align: center;
}

.cell-name {
  font-weight: 500;
  color: #0070f2;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-row {
  text-align: center;
  color: #8a8d90;
  padding: 24px 12px;
}

/* Delta Badges */
.delta-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.delta-badge--positive {
  background: #e6f4ea;
  color: #107e3e;
}

.delta-badge--critical {
  background: #fef3e1;
  color: #e9730c;
}

.delta-badge--negative {
  background: #ffeaec;
  color: #bb0000;
}

.delta-badge--neutral {
  background: #eaecee;
  color: #32363a;
}

/* Status Badges */
.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.status-badge--positive {
  background: #e6f4ea;
  color: #107e3e;
}

.status-badge--warning {
  background: #fef3e1;
  color: #e9730c;
}

.status-badge--critical {
  background: #fde8d0;
  color: #c35500;
}

.status-badge--negative {
  background: #ffeaec;
  color: #bb0000;
}

/* Risk Section */
.risk-section {
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
}

.risk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.risk-card {
  background: #f5f6f7;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 14px 16px;
}

.risk-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6a6d70;
  display: block;
  margin-bottom: 10px;
}

.risk-comparison {
  display: flex;
  align-items: center;
  gap: 12px;
}

.risk-val-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}

.risk-val-sub {
  font-size: 10px;
  color: #8a8d90;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.risk-val {
  font-size: 22px;
  font-weight: 700;
  color: #32363a;
  line-height: 1.3;
}

.risk-val--warn {
  color: #bb0000;
}

.risk-arrow {
  font-size: 18px;
  color: #8a8d90;
  flex-shrink: 0;
}

.risk-severity {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.risk-severity--positive {
  background: #e6f4ea;
  color: #107e3e;
}

.risk-severity--critical {
  background: #fef3e1;
  color: #e9730c;
}

.risk-severity--negative {
  background: #ffeaec;
  color: #bb0000;
}

/* Caution List */
.caution-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.caution-list li {
  font-size: 12px;
  color: #6a6d70;
  padding: 3px 0;
  border-bottom: 1px solid #e0e0e0;
  line-height: 1.4;
}

.caution-list li:last-child {
  border-bottom: none;
}

.caution-list li::before {
  content: '\26A0';
  margin-right: 6px;
  color: #e9730c;
}
</style>
