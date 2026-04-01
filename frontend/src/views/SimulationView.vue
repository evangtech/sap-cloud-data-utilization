<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useSimulationStore } from '@/stores/simulation';
import { Bar } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const route = useRoute();
const store = useSimulationStore();

// ── State ──
const expandedProductId = ref<string | null>(null);

// ── Data Loading ──
onMounted(async () => {
  await store.loadData();

  if (route.query.disable) {
    const ids = (route.query.disable as string).split(',');
    ids.forEach(id => {
      if (!store.disabledSuppliers.has(id)) {
        store.toggleSupplier(id);
      }
    });
  }
});

// ── Waterfall Bar Chart ──
const waterfallChartData = computed(() => {
  const segments = store.costDriverWaterfall;
  return {
    labels: segments.map(s => s.label),
    datasets: [{
      data: segments.map(s => s.value),
      backgroundColor: segments.map(s => {
        if (s.type === 'net') return '#1b2838';
        return s.value > 0 ? '#c62828' : '#2e7d32';
      }),
      borderRadius: 3,
      borderSkipped: false,
      barPercentage: 0.6,
    }],
  };
});

const waterfallChartOptions = {
  indexAxis: 'y' as const,
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: any) => {
          const v = ctx.raw as number;
          return `${v > 0 ? '+' : ''}${formatJpy(v)}`;
        },
      },
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(0,0,0,0.06)' },
      ticks: {
        callback: (value: any) => formatJpyCompact(value),
        font: { size: 11, family: "'BIZ UDGothic', monospace" },
      },
    },
    y: {
      grid: { display: false },
      ticks: { font: { size: 12 } },
    },
  },
};

// ── Helpers ──
function formatJpy(value: number): string {
  if (Math.abs(value) >= 100_000_000) return `¥${(value / 100_000_000).toFixed(2)}億`;
  if (Math.abs(value) >= 10_000) return `¥${Math.round(value / 10_000).toLocaleString()}万`;
  return `¥${Math.round(value).toLocaleString()}`;
}

function formatJpyCompact(value: number): string {
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(0)}億`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 10_000)}万`;
  return `${Math.round(value)}`;
}

function formatPct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function fxDisplayValue(currency: string): number {
  const rate = store.fxOverrides.get(currency);
  if (rate !== undefined && rate > 0) return Math.round(1 / rate);
  const base = store.fxRates.find(f => f.currencyCode === currency);
  return base && base.exchangeRateJpy > 0 ? Math.round(1 / base.exchangeRateJpy) : 0;
}

function handleFxSlider(currency: string, displayJpy: number) {
  if (displayJpy > 0) {
    store.setFxOverride(currency, 1 / displayJpy);
  }
}

function handleTariffSlider(key: string, rate: number) {
  store.setTariffOverride(key, rate);
}

function hhiLabel(hhi: number): string {
  if (hhi < 1500) return '分散';
  if (hhi < 2500) return '中程度';
  return '集中';
}

function hhiLevel(hhi: number): string {
  if (hhi < 1500) return 'low';
  if (hhi < 2500) return 'medium';
  return 'high';
}

function toggleProductExpand(productId: string) {
  expandedProductId.value = expandedProductId.value === productId ? null : productId;
  store.selectProduct(productId);
}

// Focus supplier info
const focusedSupplierInfo = computed(() => {
  if (!store.focusedSupplierId) return null;
  const sup = store.supplierList.find(s => s.id === store.focusedSupplierId);
  if (!sup) return null;
  return { id: sup.id, name: sup.name, country: sup.country };
});

const isSwitched = computed(() => {
  if (!store.focusedSupplierId) return false;
  return store.disabledSuppliers.has(store.focusedSupplierId);
});

function onSwitchToggle(doSwitch: boolean) {
  if (doSwitch) {
    store.executeFocusedSwitch();
  } else {
    store.revertFocusedSwitch();
  }
}
</script>

<template>
  <div class="sim-page">
    <!-- Loading -->
    <div v-if="store.isLoading" class="state-overlay">
      <div class="state-box">
        <div class="spinner"></div>
        <p class="state-text">データ読み込み中...</p>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="store.error" class="state-overlay">
      <div class="state-box">
        <div class="error-icon">!</div>
        <p class="state-text error-text">{{ store.error }}</p>
        <button class="btn btn-primary" @click="store.loadData()">再読み込み</button>
      </div>
    </div>

    <!-- Main Content -->
    <template v-else>
      <!-- ─── Left: Parameter Panel ─── -->
      <aside class="params-panel">
        <div class="params-scroll">
          <div class="params-head">
            <h2 class="params-title">パラメータ</h2>
            <button class="btn btn-ghost btn-xs" @click="store.resetAll()">リセット</button>
          </div>

          <!-- Tariff Sliders -->
          <section class="param-group">
            <h3 class="group-label">関税率</h3>
            <div v-for="group in store.tariffGroups" :key="group.key" class="slider-row">
              <div class="slider-head">
                <span class="tariff-badge" :class="group.type.toLowerCase()">{{ group.type }}</span>
                <span class="slider-route">{{ group.hsCode }} {{ group.origin }} → {{ group.importer }}</span>
                <span class="slider-val mono">{{ (store.tariffOverrides.get(group.key) ?? group.baseRate).toFixed(1) }}%</span>
              </div>
              <input
                type="range" :min="0" :max="Math.max(50, group.baseRate * 2)" :step="0.5"
                :value="store.tariffOverrides.get(group.key) ?? group.baseRate"
                @input="handleTariffSlider(group.key, Number(($event.target as HTMLInputElement).value))"
                class="range-slider"
              />
            </div>
            <p v-if="store.tariffGroups.length === 0" class="empty-hint">関税データなし</p>
          </section>

          <!-- FX Rate Sliders -->
          <section class="param-group">
            <h3 class="group-label">為替レート</h3>
            <div v-for="fx in store.fxRateList" :key="fx.currency" class="slider-row fx-slider-row">
              <div class="slider-head">
                <span class="fx-pair">
                  <span class="fx-currency">{{ fx.currency }}</span>
                  <span class="fx-sep">/</span>
                  <span class="fx-jpy">JPY</span>
                </span>
                <span class="slider-val mono">¥{{ fxDisplayValue(fx.currency) }}</span>
              </div>
              <div class="fx-range-wrap">
                <span class="fx-range-label mono">¥{{ Math.round(fx.displayRate * 0.7) }}</span>
                <input
                  type="range"
                  :min="Math.round(fx.displayRate * 0.7)"
                  :max="Math.round(fx.displayRate * 1.5)"
                  :step="1"
                  :value="fxDisplayValue(fx.currency)"
                  @input="handleFxSlider(fx.currency, Number(($event.target as HTMLInputElement).value))"
                  class="range-slider"
                />
                <span class="fx-range-label mono">¥{{ Math.round(fx.displayRate * 1.5) }}</span>
              </div>
            </div>
          </section>

          <!-- Supplier Switch -->
          <section class="param-group">
            <h3 class="group-label">サプライヤー切替</h3>
            <select
              class="select-field"
              :value="store.focusedSupplierId || ''"
              @change="store.setFocusedSupplier(($event.target as HTMLSelectElement).value || null)"
            >
              <option value="">サプライヤーを選択...</option>
              <option v-for="sup in store.supplierList" :key="sup.id" :value="sup.id">
                {{ sup.id }} {{ sup.name }}
              </option>
            </select>

            <template v-if="focusedSupplierInfo">
              <div class="switch-card">
                <div class="switch-row">
                  <span class="switch-label">現行</span>
                  <span class="switch-name">{{ focusedSupplierInfo.name }}</span>
                  <span class="switch-country">{{ focusedSupplierInfo.country }}</span>
                </div>

                <div v-if="store.focusedAlternatives.length > 0" class="switch-row">
                  <span class="switch-label">切替先</span>
                  <select
                    class="select-field select-sm"
                    :value="store.focusedAlternativeId || store.focusedAlternatives[0]?.id"
                    @change="store.focusedAlternativeId = ($event.target as HTMLSelectElement).value"
                  >
                    <option v-for="alt in store.focusedAlternatives" :key="alt.id" :value="alt.id">
                      {{ alt.name }} ({{ alt.priceDiff > 0 ? '+' : '' }}{{ alt.priceDiff }}%{{ alt.source === 'bom' ? ' BOM' : '' }})
                    </option>
                  </select>
                </div>
                <p v-else class="empty-hint">代替候補なし</p>

                <div class="switch-actions">
                  <label class="radio-pill" :class="{ active: !isSwitched }">
                    <input type="radio" name="sw" :checked="!isSwitched" @change="onSwitchToggle(false)" />
                    現行維持
                  </label>
                  <label class="radio-pill" :class="{ active: isSwitched }">
                    <input type="radio" name="sw" :checked="isSwitched" @change="onSwitchToggle(true)" />
                    切替実行
                  </label>
                </div>

                <!-- Trade-off summary -->
                <div v-if="isSwitched && store.switchTradeoffSummary" class="tradeoff">
                  <div class="tradeoff-title">切替影響</div>
                  <div class="tradeoff-grid">
                    <span class="tf-label">単価差</span>
                    <span class="tf-value mono" :class="store.switchTradeoffSummary.priceDiffPct > 0 ? 'neg' : 'pos'">
                      {{ store.switchTradeoffSummary.priceDiffPct > 0 ? '+' : '' }}{{ store.switchTradeoffSummary.priceDiffPct }}%
                    </span>
                    <span class="tf-label">リードタイム</span>
                    <span class="tf-value mono" :class="store.switchTradeoffSummary.leadTimeDiff > 0 ? 'neg' : store.switchTradeoffSummary.leadTimeDiff < 0 ? 'pos' : ''">
                      {{ store.switchTradeoffSummary.leadTimeDiff > 0 ? '+' : '' }}{{ store.switchTradeoffSummary.leadTimeDiff }}日
                    </span>
                    <span class="tf-label">品質</span>
                    <span class="tf-value mono" :class="store.switchTradeoffSummary.qualityDiff < 0 ? 'neg' : store.switchTradeoffSummary.qualityDiff > 0 ? 'pos' : ''">
                      {{ store.switchTradeoffSummary.qualityDiff > 0 ? '+' : '' }}{{ store.switchTradeoffSummary.qualityDiff }}
                    </span>
                    <span class="tf-label">影響素材</span>
                    <span class="tf-value mono">{{ store.switchTradeoffSummary.affectedMaterialCount }}件</span>
                    <span class="tf-label">単一ソース解消</span>
                    <span class="tf-value mono" :class="store.switchTradeoffSummary.singleSourceReduction > 0 ? 'pos' : ''">
                      {{ store.switchTradeoffSummary.singleSourceReduction }}件
                    </span>
                  </div>
                </div>
              </div>
            </template>
          </section>

          <!-- Volume -->
          <section class="param-group">
            <h3 class="group-label">受注量</h3>
            <div class="slider-row">
              <div class="slider-head">
                <span class="slider-route">倍率</span>
                <span class="slider-val mono">{{ store.volumeMultiplier.toFixed(1) }}x</span>
              </div>
              <input
                type="range" min="0.5" max="2.0" step="0.1"
                :value="store.volumeMultiplier"
                @input="store.setVolumeMultiplier(Number(($event.target as HTMLInputElement).value))"
                class="range-slider"
              />
            </div>
          </section>
        </div>
      </aside>

      <!-- ─── Right: Results ─── -->
      <main class="results-area">

        <!-- 0. Data Quality Warnings -->
        <div v-if="store.dataQualityWarnings.length > 0" class="dq-warning">
          <strong>データ品質警告:</strong>
          <span v-for="(w, i) in store.dataQualityWarnings" :key="i">{{ w }}</span>
        </div>

        <!-- 1. Disruption Alert -->
        <div v-if="store.portfolioImpact.disruptedProducts > 0" class="disruption-alert">
          <svg class="alert-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>
            {{ store.portfolioImpact.disruptedProducts }}件の製品で供給途絶が発生しています
            <template v-if="store.portfolioImpact.lostRevenue > 0">
              — 逸失売上: {{ formatJpy(store.portfolioImpact.lostRevenue) }}
            </template>
          </span>
        </div>

        <!-- 2. Product Impact Table (primary content) -->
        <div class="card">
          <h3 class="card-heading">製品別影響</h3>
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th class="col-expand"></th>
                  <th>製品</th>
                  <th class="r">基準コスト</th>
                  <th class="r">シナリオコスト</th>
                  <th class="r">差分</th>
                  <th class="r">変動率</th>
                  <th class="r">マージン</th>
                  <th>状態</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="r in store.simulationResults" :key="r.productId">
                  <tr
                    :class="{ 'row-selected': expandedProductId === r.productId, 'row-disrupted': r.isDisrupted }"
                    @click="toggleProductExpand(r.productId)"
                  >
                    <td class="col-expand">
                      <svg :class="{ rotated: expandedProductId === r.productId }" class="expand-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
                    </td>
                    <td class="col-name">{{ r.productName }}</td>
                    <td class="r mono">{{ formatJpy(r.baseCost) }}</td>
                    <td class="r mono">{{ formatJpy(r.newCost) }}</td>
                    <td class="r mono" :class="r.delta > 0 ? 'neg' : r.delta < 0 ? 'pos' : ''">
                      {{ formatJpy(r.delta) }}
                    </td>
                    <td class="r mono" :class="r.deltaPct > 0 ? 'neg' : r.deltaPct < 0 ? 'pos' : ''">
                      {{ formatPct(r.deltaPct) }}
                    </td>
                    <td class="r mono">
                      <span :class="{ neg: r.newMargin < r.baseMargin }">{{ (r.newMargin * 100).toFixed(1) }}%</span>
                    </td>
                    <td>
                      <span v-if="r.isDisrupted" class="badge badge-danger">途絶</span>
                      <span v-else-if="r.deltaPct > 5" class="badge badge-warn">注意</span>
                      <span v-else class="badge badge-ok">正常</span>
                    </td>
                  </tr>
                  <!-- Expanded component detail -->
                  <tr v-if="expandedProductId === r.productId" class="expand-row">
                    <td colspan="8">
                      <div class="component-detail">
                        <table class="component-table">
                          <thead>
                            <tr>
                              <th>素材</th>
                              <th>サプライヤー</th>
                              <th class="r">単価 (JPY)</th>
                              <th class="r">関税率</th>
                              <th class="r">基準コスト</th>
                              <th class="r">シナリオコスト</th>
                              <th class="r">差分</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="c in r.components" :key="c.materialId">
                              <td>{{ c.materialName }}</td>
                              <td>
                                {{ c.supplierName }}
                                <span v-if="c.isAlternative" class="badge badge-alt">代替</span>
                              </td>
                              <td class="r mono">{{ formatJpy(c.unitPriceJpy) }}</td>
                              <td class="r mono">{{ c.tariffRate.toFixed(1) }}%</td>
                              <td class="r mono">{{ formatJpy(c.baselineTotalCost) }}</td>
                              <td class="r mono">{{ formatJpy(c.totalCost) }}</td>
                              <td class="r mono" :class="(c.totalCost - c.baselineTotalCost) > 0 ? 'neg' : (c.totalCost - c.baselineTotalCost) < 0 ? 'pos' : ''">
                                {{ formatJpy(c.totalCost - c.baselineTotalCost) }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 3. Summary Cards -->
        <div class="card-row">
          <div class="metric-card" :class="{ 'metric-neg': store.portfolioImpact.totalDeltaPct > 0, 'metric-pos': store.portfolioImpact.totalDeltaPct < 0 }">
            <div class="metric-label">コスト変動</div>
            <div class="metric-value mono">{{ formatPct(store.portfolioImpact.totalDeltaPct) }}</div>
            <div class="metric-sub mono">{{ formatJpy(store.portfolioImpact.totalDelta) }}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">マージン (平均)</div>
            <div class="metric-value mono">
              {{ store.simulationResults.length > 0 ? (store.simulationResults.reduce((s, r) => s + r.baseMargin, 0) / store.simulationResults.length * 100).toFixed(1) : '—' }}%
              <span class="metric-arrow">→</span>
              {{ store.simulationResults.length > 0 ? (store.simulationResults.reduce((s, r) => s + r.newMargin, 0) / store.simulationResults.length * 100).toFixed(1) : '—' }}%
            </div>
            <div class="metric-sub">{{ store.portfolioImpact.affectedProducts }}/{{ store.products.length }} 製品に影響</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">単一ソース素材</div>
            <div class="metric-value mono">
              {{ store.supplyRiskMetrics.singleSource.before }}
              <span class="metric-arrow">→</span>
              <span :class="store.supplyRiskMetrics.singleSource.after > store.supplyRiskMetrics.singleSource.before ? 'neg' : store.supplyRiskMetrics.singleSource.after < store.supplyRiskMetrics.singleSource.before ? 'pos' : ''">
                {{ store.supplyRiskMetrics.singleSource.after }}
              </span>
            </div>
            <div class="metric-sub">代替なし素材数</div>
          </div>
        </div>

        <!-- 4. Cost Driver Waterfall -->
        <div class="card" v-if="store.costDriverWaterfall.length > 1">
          <h3 class="card-heading">コスト変動要因</h3>
          <div class="chart-wrap">
            <Bar :data="waterfallChartData" :options="waterfallChartOptions" />
          </div>
        </div>

        <!-- 5. Supply Risk Metrics -->
        <div class="card">
          <h3 class="card-heading">供給リスク指標</h3>
          <div class="risk-metrics">
            <div class="risk-row">
              <span class="risk-label">供給元集中度</span>
              <div class="risk-before-after">
                <span class="risk-val">
                  <span class="risk-dot" :class="hhiLevel(store.supplyRiskMetrics.supplierHHI.before)"></span>
                  {{ hhiLabel(store.supplyRiskMetrics.supplierHHI.before) }}
                  <span class="risk-num mono">{{ store.supplyRiskMetrics.supplierHHI.before }}</span>
                </span>
                <span class="risk-arrow-icon">→</span>
                <span class="risk-val">
                  <span class="risk-dot" :class="hhiLevel(store.supplyRiskMetrics.supplierHHI.after)"></span>
                  {{ hhiLabel(store.supplyRiskMetrics.supplierHHI.after) }}
                  <span class="risk-num mono">{{ store.supplyRiskMetrics.supplierHHI.after }}</span>
                </span>
              </div>
            </div>
            <div class="risk-row">
              <span class="risk-label">地域集中度</span>
              <div class="risk-before-after">
                <span class="risk-val">
                  <span class="risk-dot" :class="hhiLevel(store.supplyRiskMetrics.geoConcentration.before)"></span>
                  {{ hhiLabel(store.supplyRiskMetrics.geoConcentration.before) }}
                  <span class="risk-num mono">{{ store.supplyRiskMetrics.geoConcentration.before }}</span>
                </span>
                <span class="risk-arrow-icon">→</span>
                <span class="risk-val">
                  <span class="risk-dot" :class="hhiLevel(store.supplyRiskMetrics.geoConcentration.after)"></span>
                  {{ hhiLabel(store.supplyRiskMetrics.geoConcentration.after) }}
                  <span class="risk-num mono">{{ store.supplyRiskMetrics.geoConcentration.after }}</span>
                </span>
              </div>
            </div>
            <div class="risk-row">
              <span class="risk-label">単一ソース素材</span>
              <div class="risk-before-after">
                <span class="risk-val mono">{{ store.supplyRiskMetrics.singleSource.before }}件</span>
                <span class="risk-arrow-icon">→</span>
                <span class="risk-val mono" :class="store.supplyRiskMetrics.singleSource.after > store.supplyRiskMetrics.singleSource.before ? 'neg' : 'pos'">
                  {{ store.supplyRiskMetrics.singleSource.after }}件
                </span>
              </div>
            </div>
            <div v-if="store.supplyRiskMetrics.disruptedMaterials > 0" class="risk-row">
              <span class="risk-label">途絶素材</span>
              <div class="risk-before-after">
                <span class="risk-val mono neg">{{ store.supplyRiskMetrics.disruptedMaterials }}件</span>
              </div>
            </div>
          </div>
          <div v-if="store.supplyRiskMetrics.cautions.length > 0" class="caution-list">
            <div class="caution-heading">注意事項</div>
            <ul>
              <li v-for="(c, i) in store.supplyRiskMetrics.cautions" :key="i">{{ c }}</li>
            </ul>
          </div>
        </div>
      </main>
    </template>
  </div>
</template>

<style scoped>
/* ========================================
   Design D — Japanese Corporate Style
   Navy #1b2838 / Gold #b8860b / BIZ UDGothic
   ======================================== */

/* ===== Page ===== */
.sim-page {
  display: grid;
  grid-template-columns: 300px 1fr;
  height: calc(100vh - var(--shell-topbar-height));
  overflow: hidden;
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-primary);
  background: var(--color-surface);
  -webkit-font-smoothing: antialiased;
}

/* ===== State Overlays ===== */
.state-overlay {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
.state-box { text-align: center; padding: 32px; }
.spinner {
  width: 32px; height: 32px;
  border: 3px solid #eef1f5;
  border-top-color: #1b2838;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 14px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.state-text { font-size: 13px; color: #4a4a4a; }
.error-text { color: #c62828; }
.error-icon {
  width: 36px; height: 36px; border-radius: 50%;
  background: #fff5f5; color: #c62828;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 18px; margin: 0 auto 12px;
}

/* ===== Parameters Panel ===== */
.params-panel {
  border-right: 1px solid var(--color-border);
  background: var(--color-shell-panel);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.params-scroll {
  overflow-y: auto;
  padding: 0 0 24px;
  flex: 1;
}
.params-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: var(--color-shell-navy);
  border-bottom: 1px solid rgba(212, 168, 67, 0.16);
}
.params-title {
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.08em;
}

/* Param Groups */
.param-group {
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
}
.param-group:last-child { border-bottom: none; }
.group-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-shell-navy);
  margin-bottom: 12px;
  padding-left: 10px;
  border-left: 3px solid var(--color-shell-navy);
  line-height: 1.4;
}

/* Slider Rows */
.slider-row { margin-bottom: 14px; }
.slider-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 12px;
  color: #1a1a1a;
}
.slider-route {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px;
}
.slider-val {
  font-weight: 700;
  color: var(--color-shell-navy);
  flex-shrink: 0;
  min-width: 52px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* FX Slider */
.fx-slider-row {
  background: #f0f2f5;
  border-radius: 4px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.fx-pair {
  display: inline-flex;
  align-items: baseline;
  gap: 1px;
}
.fx-currency { font-weight: 700; font-size: 12px; color: #1a1a1a; }
.fx-sep { color: #8a8a8a; font-size: 11px; }
.fx-jpy { color: #8a8a8a; font-size: 11px; }
.fx-range-wrap { display: flex; align-items: center; gap: 8px; }
.fx-range-label { font-size: 10px; color: #8a8a8a; flex-shrink: 0; width: 32px; text-align: center; }

/* Range Slider */
.range-slider {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--color-border);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.range-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: var(--color-shell-navy);
  cursor: pointer;
  border: 2px solid #ffffff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  transition: transform 0.15s;
}
.range-slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
.range-slider::-webkit-slider-thumb:active {
  transform: scale(1.05);
  box-shadow: 0 0 0 4px rgba(27, 40, 56, 0.12);
}
.range-slider::-moz-range-thumb {
  width: 14px; height: 14px;
  border-radius: 50%;
  background: var(--color-shell-navy);
  cursor: pointer;
  border: 2px solid #ffffff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

/* Tariff Badge */
.tariff-badge {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 700;
  text-transform: uppercase;
  flex-shrink: 0;
  line-height: 1.5;
}
.tariff-badge.section301 { background: #fffde7; color: #92400e; }
.tariff-badge.cbam { background: #e3f2fd; color: #1e40af; }
.tariff-badge.retaliatory { background: #fff5f5; color: #991b1b; }
.tariff-badge.mfn { background: #f0f2f5; color: #4a4a4a; }
.tariff-badge.epa, .tariff-badge.usmca { background: #e8f5e9; color: #166534; }

/* Select Fields */
.select-field {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #d0d5dd;
  border-radius: 3px;
  font-size: 12px;
  font-family: inherit;
  background: #ffffff;
  color: #1a1a1a;
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s;
}
.select-field:focus { border-color: #1b2838; }
.select-sm { padding: 5px 8px; }

/* Supplier Switch Card */
.switch-card {
  background: #f0f2f5;
  border: 1px solid #d0d5dd;
  border-radius: 4px;
  padding: 12px;
  margin-top: 10px;
}
.switch-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 12px;
}
.switch-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #8a8a8a;
  width: 34px;
  flex-shrink: 0;
}
.switch-name { font-weight: 500; color: #1a1a1a; }
.switch-country { color: #8a8a8a; font-size: 11px; }
.switch-actions { display: flex; gap: 4px; margin-top: 4px; }
.radio-pill {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: 1px solid #d0d5dd;
  border-radius: 3px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  color: #4a4a4a;
  background: #ffffff;
  font-weight: 400;
}
.radio-pill input { display: none; }
.radio-pill.active {
  background: #1b2838;
  border-color: #1b2838;
  color: #ffffff;
  font-weight: 700;
}

/* Trade-off Summary */
.tradeoff {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #d0d5dd;
}
.tradeoff-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #4a4a4a;
  margin-bottom: 6px;
}
.tradeoff-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 10px;
  font-size: 12px;
}
.tf-label { color: #4a4a4a; }
.tf-value { font-weight: 700; text-align: right; }

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  font-family: inherit;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-primary {
  padding: 8px 16px;
  background: var(--color-shell-navy);
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid var(--color-shell-navy);
}
.btn-primary:hover { background: #2d3f52; }
.btn-ghost {
  padding: 5px 10px;
  background: #ffffff;
  color: var(--color-shell-navy);
  border: 1px solid rgba(212, 168, 67, 0.35);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.btn-ghost:hover { background: var(--color-shell-navy); color: #ffffff; }
.btn-xs { padding: 3px 8px; font-size: 10px; }

.empty-hint { font-size: 12px; color: #8a8a8a; font-style: italic; }
.mono { font-family: 'BIZ UDGothic', monospace; font-variant-numeric: tabular-nums; }

/* ===== Results Area ===== */
.results-area {
  overflow-y: auto;
  padding: 24px 32px 40px;
  background: var(--color-background);
}

/* Data Quality Warning */
.dq-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #fffde7;
  border: 1px solid #f57f17;
  border-radius: 4px;
  color: #f57f17;
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 12px;
}

/* Disruption Alert */
.disruption-alert {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: #fff5f5;
  border: 1px solid #c62828;
  border-radius: 4px;
  color: #c62828;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 16px;
}
.alert-icon { flex-shrink: 0; }

/* Cards (Navy Top Border Style) */
.card {
  background: #ffffff;
  border-top: 3px solid #1b2838;
  border-left: 1px solid #e8eaed;
  border-right: 1px solid #e8eaed;
  border-bottom: 1px solid #e8eaed;
  border-radius: 0 0 4px 4px;
  padding: 18px 20px;
  margin-bottom: 20px;
}
.card-heading {
  font-size: 15px;
  font-weight: 700;
  color: #1b2838;
  margin-bottom: 14px;
  padding-left: 12px;
  border-left: 4px solid #1b2838;
  line-height: 1.4;
}

/* Metric Cards (KPI Row) */
.card-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}
.metric-card {
  background: #ffffff;
  border-top: 3px solid #1b2838;
  border-left: 1px solid #e8eaed;
  border-right: 1px solid #e8eaed;
  border-bottom: 1px solid #e8eaed;
  border-radius: 0 0 4px 4px;
  padding: 16px 20px;
}
.metric-card.metric-neg { border-top-color: #c62828; }
.metric-card.metric-pos { border-top-color: #2e7d32; }
.metric-label {
  font-size: 11px;
  font-weight: 700;
  color: #4a4a4a;
  margin-bottom: 8px;
  letter-spacing: 0.04em;
}
.metric-value {
  font-size: 22px;
  font-weight: 700;
  color: #1a1a1a;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.metric-neg .metric-value { color: #c62828; }
.metric-pos .metric-value { color: #2e7d32; }
.metric-arrow {
  font-weight: 400;
  color: #8a8a8a;
  font-size: 0.65em;
  margin: 0 3px;
}
.metric-sub {
  font-size: 11px;
  color: #8a8a8a;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}

/* ===== Formal Data Table ===== */
.table-scroll { overflow-x: auto; margin: 0 -20px; padding: 0 20px; }
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.data-table th,
.data-table td {
  padding: 8px 12px;
  border: 1px solid #d0d5dd;
  text-align: left;
  vertical-align: middle;
}
.data-table thead th {
  background: #eef1f5;
  font-weight: 700;
  color: #1b2838;
  font-size: 11px;
  letter-spacing: 0.02em;
  white-space: nowrap;
  position: sticky;
  top: 0;
}
.data-table tbody tr {
  cursor: pointer;
  transition: background 0.1s;
}
.data-table tbody tr:hover { background: #f5f7fa; }
.data-table tbody tr.row-selected { background: #eef1f5; }
.data-table tbody tr.row-selected:hover { background: #e3e8f0; }
.data-table tbody tr.row-disrupted { background: #fff5f5; }
.data-table tbody tr.row-disrupted:hover { background: #ffecec; }
.r { text-align: right; }
.col-expand {
  width: 28px;
  text-align: center;
  padding-left: 4px;
  padding-right: 0;
}
.expand-chevron {
  transition: transform 0.15s;
  color: #8a8a8a;
}
.expand-chevron.rotated { transform: rotate(90deg); }
.col-name {
  font-weight: 500;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Expanded Row */
.expand-row td { padding: 0; background: #fafbfc; border: none; }
.component-detail { padding: 8px 20px 12px 40px; }
.component-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.component-table th,
.component-table td {
  padding: 6px 10px;
  border: 1px solid #d0d5dd;
  text-align: left;
}
.component-table thead th {
  background: #eef1f5;
  font-weight: 700;
  color: #1b2838;
  font-size: 10px;
  letter-spacing: 0.02em;
}

/* Badges (Square / Corporate) */
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0.04em;
}
.badge-danger { background: #c62828; color: #ffffff; }
.badge-warn { background: #f57f17; color: #ffffff; }
.badge-ok { background: #e8eaed; color: #4a4a4a; }
.badge-alt { background: #b8860b; color: #ffffff; font-size: 9px; margin-left: 4px; vertical-align: middle; }

/* Value Colors */
.neg { color: #c62828; }
.pos { color: #2e7d32; }

/* ===== Waterfall Chart ===== */
.chart-wrap { height: 180px; }

/* ===== Risk Metrics ===== */
.risk-metrics {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.risk-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #fafbfc;
  border: 1px solid #e8eaed;
  border-radius: 4px;
}
.risk-label {
  font-size: 12px;
  font-weight: 500;
  color: #4a4a4a;
}
.risk-before-after {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.risk-val {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 500;
  color: #1a1a1a;
}
.risk-num { font-size: 10px; color: #8a8a8a; }
.risk-arrow-icon { color: #8a8a8a; font-size: 11px; }
.risk-dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.risk-dot.low { background: #2e7d32; }
.risk-dot.medium { background: #f57f17; }
.risk-dot.high { background: #c62828; }

.caution-list {
  margin-top: 12px;
  padding: 14px 18px;
  background: #fffde7;
  border: 1px solid #f57f17;
  border-radius: 4px;
}
.caution-heading {
  font-size: 12px;
  font-weight: 700;
  color: #f57f17;
  margin-bottom: 8px;
}
.caution-list ul {
  list-style: none;
  margin: 0;
  padding-left: 0;
}
.caution-list li {
  font-size: 12px;
  color: #4a4a4a;
  padding: 3px 0 3px 18px;
  position: relative;
  line-height: 1.8;
}
.caution-list li::before {
  content: '';
  position: absolute;
  left: 0; top: 12px;
  width: 5px; height: 5px;
  border-radius: 50%;
  background: #f57f17;
}

/* ===== Responsive ===== */
@media (max-width: 960px) {
  .sim-page {
    grid-template-columns: 1fr;
    height: auto;
    overflow: visible;
  }
  .params-panel {
    border-right: none;
    border-bottom: 1px solid #d0d5dd;
    max-height: 50vh;
  }
  .results-area { padding: 16px; }
  .card-row { grid-template-columns: 1fr; }
  .risk-metrics { grid-template-columns: 1fr; }
}
</style>
