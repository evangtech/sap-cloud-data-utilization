<template>
  <div class="de-root">
    <!-- Loading overlay -->
    <div v-if="store.isLoading" class="de-loading">
      <div class="de-loading-spinner"></div>
      <span class="de-loading-text">データを読み込み中...</span>
    </div>

    <!-- Error state -->
    <div v-else-if="store.error" class="de-error-state">
      <div class="de-error-icon">!</div>
      <p class="de-error-msg">{{ store.error }}</p>
      <button class="de-btn de-btn-primary" @click="store.loadData()">再読み込み</button>
    </div>

    <template v-else>
      <!-- ======================== SIDEBAR ======================== -->
      <aside class="de-sidebar">
        <div class="de-sidebar-header">
          <h2 class="de-sidebar-title">Simulation</h2>
          <button class="de-btn de-btn-ghost" @click="store.resetAll()">Reset</button>
        </div>

        <!-- Tariff Accordion -->
        <div class="de-accordion">
          <button
            class="de-accordion-trigger"
            :class="{ 'is-open': openSection === 'tariff' }"
            @click="toggleSection('tariff')"
          >
            <span class="de-accordion-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span>関税 (Tariff)</span>
            <span class="de-badge-count" v-if="store.tariffGroups.length">{{ store.tariffGroups.length }}</span>
          </button>
          <div class="de-accordion-panel" v-show="openSection === 'tariff'">
            <div
              v-for="tg in store.tariffGroups"
              :key="tg.key"
              class="de-slider-group"
            >
              <div class="de-slider-label">
                <span class="de-slider-name">{{ tg.hsCode }} ({{ tg.origin }} → {{ tg.importer }})</span>
                <span class="de-slider-value">{{ getEffectiveTariff(tg) }}%</span>
              </div>
              <input
                type="range"
                class="de-range"
                :min="0"
                :max="Math.max(tg.baseRate * 3, 50)"
                :step="0.5"
                :value="getEffectiveTariff(tg)"
                @input="(e: Event) => store.setTariffOverride(tg.key, parseFloat((e.target as HTMLInputElement).value))"
              />
              <div class="de-slider-bounds">
                <span>0%</span>
                <span class="de-slider-base">Base: {{ tg.baseRate }}%</span>
                <span>{{ Math.max(tg.baseRate * 3, 50) }}%</span>
              </div>
            </div>
            <p v-if="store.tariffGroups.length === 0" class="de-empty-hint">関税データなし</p>
          </div>
        </div>

        <!-- FX Accordion -->
        <div class="de-accordion">
          <button
            class="de-accordion-trigger"
            :class="{ 'is-open': openSection === 'fx' }"
            @click="toggleSection('fx')"
          >
            <span class="de-accordion-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span>為替 (FX)</span>
            <span class="de-badge-count" v-if="store.fxRateList.length">{{ store.fxRateList.length }}</span>
          </button>
          <div class="de-accordion-panel" v-show="openSection === 'fx'">
            <div
              v-for="fx in store.fxRateList"
              :key="fx.currency"
              class="de-slider-group"
            >
              <div class="de-slider-label">
                <span class="de-slider-name">{{ fx.currency }} / JPY</span>
                <span class="de-slider-value">{{ getEffectiveFx(fx).toFixed(6) }}</span>
              </div>
              <input
                type="range"
                class="de-range"
                :min="fx.baseRate * 0.5"
                :max="fx.baseRate * 1.5"
                :step="fx.baseRate * 0.001"
                :value="getEffectiveFx(fx)"
                @input="(e: Event) => store.setFxOverride(fx.currency, parseFloat((e.target as HTMLInputElement).value))"
              />
              <div class="de-slider-bounds">
                <span>{{ (fx.baseRate * 0.5).toFixed(4) }}</span>
                <span class="de-slider-base">Base: {{ fx.baseRate.toFixed(4) }}</span>
                <span>{{ (fx.baseRate * 1.5).toFixed(4) }}</span>
              </div>
            </div>
            <p v-if="store.fxRateList.length === 0" class="de-empty-hint">為替データなし</p>
          </div>
        </div>

        <!-- Supplier Accordion -->
        <div class="de-accordion">
          <button
            class="de-accordion-trigger"
            :class="{ 'is-open': openSection === 'supplier' }"
            @click="toggleSection('supplier')"
          >
            <span class="de-accordion-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span>サプライヤー (Supplier)</span>
            <span class="de-badge-count" v-if="store.supplierList.length">{{ store.supplierList.length }}</span>
          </button>
          <div class="de-accordion-panel" v-show="openSection === 'supplier'">
            <div
              v-for="sup in store.supplierList"
              :key="sup.id"
              class="de-supplier-row"
            >
              <label class="de-switch-label">
                <span class="de-switch">
                  <input
                    type="checkbox"
                    :checked="!store.disabledSuppliers.has(sup.id)"
                    @change="store.toggleSupplier(sup.id)"
                  />
                  <span class="de-switch-track"></span>
                </span>
                <span class="de-supplier-info">
                  <span class="de-supplier-name">{{ sup.name }}</span>
                  <span class="de-supplier-country">{{ sup.country }}</span>
                </span>
              </label>
            </div>
            <p v-if="store.supplierList.length === 0" class="de-empty-hint">サプライヤーデータなし</p>
          </div>
        </div>

        <!-- Volume Multiplier -->
        <div class="de-sidebar-section">
          <div class="de-slider-label">
            <span class="de-slider-name">発注量倍率</span>
            <span class="de-slider-value">{{ store.volumeMultiplier.toFixed(1) }}x</span>
          </div>
          <input
            type="range"
            class="de-range"
            min="0.1"
            max="3.0"
            step="0.1"
            :value="store.volumeMultiplier"
            @input="(e: Event) => store.setVolumeMultiplier(parseFloat((e.target as HTMLInputElement).value))"
          />
        </div>
      </aside>

      <!-- ======================== MAIN ======================== -->
      <main class="de-main">
        <!-- Sticky top bar -->
        <div class="de-topbar">
          <div class="de-breadcrumb">
            <span class="de-breadcrumb-item de-breadcrumb-muted">ダッシュボード</span>
            <span class="de-breadcrumb-sep">/</span>
            <span class="de-breadcrumb-item de-breadcrumb-active">シミュレーション</span>
          </div>
          <div class="de-freshness">
            <span class="de-freshness-dot" :class="store.isDataLoaded ? 'is-live' : 'is-stale'"></span>
            <span class="de-freshness-label">{{ store.isDataLoaded ? 'データ取得済み' : '未取得' }}</span>
          </div>
        </div>

        <!-- Data quality warnings -->
        <div v-if="store.dataQualityWarnings.length" class="de-warnings">
          <div v-for="(w, i) in store.dataQualityWarnings" :key="i" class="de-warning-item">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="de-warning-icon">
              <path d="M8 1L1 14h14L8 1z" stroke="#f59e0b" stroke-width="1.5" fill="none"/>
              <path d="M8 6v3M8 11v1" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <span>{{ w }}</span>
          </div>
        </div>

        <!-- ==================== METRIC CARDS ==================== -->
        <div class="de-metrics-row">
          <div class="de-metric-card">
            <div class="de-metric-header">
              <span class="de-metric-title">コスト変動</span>
              <span
                class="de-metric-badge"
                :class="portfolioBadgeClass"
              >{{ portfolioBadgeLabel }}</span>
            </div>
            <div class="de-metric-value" :class="deltaColorClass(store.portfolioImpact.totalDelta)">
              {{ formatCurrency(store.portfolioImpact.totalDelta) }}
            </div>
            <div class="de-metric-sub">
              ベース {{ formatCurrency(store.portfolioImpact.totalBaseAmount) }} からの変動
            </div>
          </div>

          <div class="de-metric-card">
            <div class="de-metric-header">
              <span class="de-metric-title">影響製品</span>
            </div>
            <div class="de-metric-value">
              {{ store.portfolioImpact.affectedProducts }}
              <span class="de-metric-unit">/ {{ store.simulationResults.length }}</span>
            </div>
            <div class="de-metric-sub">
              <span v-if="store.portfolioImpact.disruptedProducts > 0" class="de-text-danger">
                供給途絶: {{ store.portfolioImpact.disruptedProducts }}件
              </span>
              <span v-else class="de-text-teal">供給途絶なし</span>
            </div>
          </div>

          <div class="de-metric-card">
            <div class="de-metric-header">
              <span class="de-metric-title">変動率</span>
            </div>
            <div class="de-metric-value" :class="deltaColorClass(store.portfolioImpact.totalDeltaPct)">
              {{ store.portfolioImpact.totalDeltaPct >= 0 ? '+' : '' }}{{ store.portfolioImpact.totalDeltaPct.toFixed(2) }}%
            </div>
            <div class="de-metric-sub">
              ポートフォリオ全体
            </div>
          </div>
        </div>

        <!-- ==================== PRODUCT TABLE ==================== -->
        <div class="de-section-card">
          <div class="de-section-header">
            <h3 class="de-section-title">製品別コストシミュレーション</h3>
            <span class="de-section-count">{{ store.simulationResults.length }}件</span>
          </div>
          <div class="de-table-wrap">
            <table class="de-table">
              <thead>
                <tr>
                  <th>製品</th>
                  <th class="de-th-right">ベースコスト</th>
                  <th class="de-th-right">新コスト</th>
                  <th class="de-th-right">変動額</th>
                  <th class="de-th-right">変動率</th>
                  <th class="de-th-right">マージン</th>
                  <th>ステータス</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <template v-for="result in store.simulationResults" :key="result.productId">
                  <tr
                    class="de-table-row"
                    :class="{
                      'is-selected': store.selectedProductId === result.productId,
                      'is-disrupted': result.isDisrupted,
                    }"
                    @click="store.selectProduct(result.productId)"
                  >
                    <td>
                      <div class="de-product-cell">
                        <span class="de-product-name">{{ result.productName }}</span>
                        <span class="de-product-id">{{ result.productId }}</span>
                      </div>
                    </td>
                    <td class="de-td-right">{{ formatCurrency(result.baseCost) }}</td>
                    <td class="de-td-right">{{ formatCurrency(result.newCost) }}</td>
                    <td class="de-td-right" :class="deltaColorClass(result.delta)">
                      {{ result.delta >= 0 ? '+' : '' }}{{ formatCurrency(result.delta) }}
                    </td>
                    <td class="de-td-right" :class="deltaColorClass(result.deltaPct)">
                      {{ result.deltaPct >= 0 ? '+' : '' }}{{ result.deltaPct.toFixed(2) }}%
                    </td>
                    <td class="de-td-right">
                      <span class="de-margin-pair">
                        <span class="de-text-muted">{{ (result.baseMargin * 100).toFixed(1) }}%</span>
                        <span class="de-margin-arrow">→</span>
                        <span :class="deltaColorClass(result.newMargin - result.baseMargin)">{{ (result.newMargin * 100).toFixed(1) }}%</span>
                      </span>
                    </td>
                    <td>
                      <span v-if="result.isDisrupted" class="de-pill de-pill-danger">途絶</span>
                      <span v-else-if="Math.abs(result.deltaPct) < 0.01" class="de-pill de-pill-neutral">変動なし</span>
                      <span v-else-if="result.deltaPct > 0" class="de-pill de-pill-warning">コスト増</span>
                      <span v-else class="de-pill de-pill-success">コスト減</span>
                    </td>
                    <td>
                      <button
                        class="de-expand-btn"
                        :class="{ 'is-open': expandedId === result.productId }"
                        @click.stop="expandedId = expandedId === result.productId ? null : result.productId"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                      </button>
                    </td>
                  </tr>
                  <!-- Expanded component detail -->
                  <tr v-if="expandedId === result.productId" class="de-expand-row">
                    <td colspan="8">
                      <div class="de-expand-content">
                        <div class="de-component-grid">
                          <div
                            v-for="comp in result.components"
                            :key="comp.materialId"
                            class="de-component-card"
                          >
                            <div class="de-comp-header">
                              <span class="de-comp-name">{{ comp.materialName }}</span>
                              <span v-if="comp.isAlternative" class="de-pill de-pill-info">代替</span>
                              <span v-if="comp.supplierName.includes('途絶')" class="de-pill de-pill-danger">途絶</span>
                            </div>
                            <div class="de-comp-details">
                              <div class="de-comp-row">
                                <span class="de-comp-label">サプライヤー</span>
                                <span class="de-comp-val">{{ comp.supplierName }}</span>
                              </div>
                              <div class="de-comp-row">
                                <span class="de-comp-label">単価</span>
                                <span class="de-comp-val">{{ formatCurrency(comp.unitPriceJpy) }}</span>
                              </div>
                              <div class="de-comp-row">
                                <span class="de-comp-label">関税率</span>
                                <span class="de-comp-val">{{ comp.tariffRate.toFixed(1) }}%</span>
                              </div>
                              <div class="de-comp-row">
                                <span class="de-comp-label">BOM数量</span>
                                <span class="de-comp-val">{{ comp.bomQuantity }}</span>
                              </div>
                              <div class="de-comp-row de-comp-row-total">
                                <span class="de-comp-label">合計</span>
                                <span class="de-comp-val" :class="deltaColorClass(comp.totalCost - comp.baselineTotalCost)">
                                  {{ formatCurrency(comp.totalCost) }}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                </template>
                <tr v-if="store.simulationResults.length === 0">
                  <td colspan="8" class="de-empty-row">データがありません</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ==================== WATERFALL CHART ==================== -->
        <div class="de-section-card">
          <div class="de-section-header">
            <h3 class="de-section-title">コスト変動要因 (ウォーターフォール)</h3>
          </div>
          <div class="de-waterfall">
            <div
              v-for="seg in store.costDriverWaterfall"
              :key="seg.label"
              class="de-waterfall-item"
            >
              <div class="de-waterfall-label">{{ seg.label }}</div>
              <div class="de-waterfall-bar-track">
                <div
                  class="de-waterfall-bar"
                  :class="waterfallBarClass(seg)"
                  :style="waterfallBarStyle(seg)"
                ></div>
              </div>
              <div class="de-waterfall-amount" :class="deltaColorClass(seg.value)">
                {{ seg.value >= 0 ? '+' : '' }}{{ formatCurrency(seg.value) }}
              </div>
            </div>
            <p v-if="store.costDriverWaterfall.length === 0" class="de-empty-hint">
              パラメータを変更するとコスト変動要因が表示されます
            </p>
          </div>
        </div>

        <!-- ==================== RISK METRICS ==================== -->
        <div class="de-section-card">
          <div class="de-section-header">
            <h3 class="de-section-title">供給リスク指標</h3>
          </div>
          <div class="de-risk-grid">
            <!-- Supplier HHI -->
            <div class="de-risk-item">
              <div class="de-risk-label-row">
                <span class="de-risk-name">サプライヤー集中度 (HHI)</span>
                <span class="de-risk-values">
                  <span class="de-text-muted">{{ store.supplyRiskMetrics.supplierHHI.before }}</span>
                  <span class="de-risk-arrow">→</span>
                  <span :class="hhiColorClass(store.supplyRiskMetrics.supplierHHI.after)">{{ store.supplyRiskMetrics.supplierHHI.after }}</span>
                </span>
              </div>
              <div class="de-progress-track">
                <div
                  class="de-progress-bar"
                  :class="hhiBarClass(store.supplyRiskMetrics.supplierHHI.after)"
                  :style="{ width: Math.min(store.supplyRiskMetrics.supplierHHI.after / 100, 100) + '%' }"
                ></div>
              </div>
              <div class="de-risk-scale">
                <span>0 (分散)</span>
                <span>10,000 (独占)</span>
              </div>
            </div>

            <!-- Geographic Concentration -->
            <div class="de-risk-item">
              <div class="de-risk-label-row">
                <span class="de-risk-name">地理的集中度 (HHI)</span>
                <span class="de-risk-values">
                  <span class="de-text-muted">{{ store.supplyRiskMetrics.geoConcentration.before }}</span>
                  <span class="de-risk-arrow">→</span>
                  <span :class="hhiColorClass(store.supplyRiskMetrics.geoConcentration.after)">{{ store.supplyRiskMetrics.geoConcentration.after }}</span>
                </span>
              </div>
              <div class="de-progress-track">
                <div
                  class="de-progress-bar"
                  :class="hhiBarClass(store.supplyRiskMetrics.geoConcentration.after)"
                  :style="{ width: Math.min(store.supplyRiskMetrics.geoConcentration.after / 100, 100) + '%' }"
                ></div>
              </div>
              <div class="de-risk-scale">
                <span>0 (分散)</span>
                <span>10,000 (独占)</span>
              </div>
            </div>

            <!-- Single Source -->
            <div class="de-risk-item">
              <div class="de-risk-label-row">
                <span class="de-risk-name">単一ソース素材</span>
                <span class="de-risk-values">
                  <span class="de-text-muted">{{ store.supplyRiskMetrics.singleSource.before }}</span>
                  <span class="de-risk-arrow">→</span>
                  <span :class="singleSourceColorClass(store.supplyRiskMetrics.singleSource.after)">{{ store.supplyRiskMetrics.singleSource.after }}</span>
                </span>
              </div>
              <div class="de-progress-track">
                <div
                  class="de-progress-bar"
                  :class="singleSourceBarClass(store.supplyRiskMetrics.singleSource.after)"
                  :style="{ width: (store.supplyRiskMetrics.singleSource.after / Math.max(store.supplyRiskMetrics.singleSource.before, store.supplyRiskMetrics.singleSource.after, 1)) * 100 + '%' }"
                ></div>
              </div>
            </div>

            <!-- Disrupted Materials -->
            <div class="de-risk-item">
              <div class="de-risk-label-row">
                <span class="de-risk-name">供給途絶素材</span>
                <span class="de-risk-values">
                  <span :class="store.supplyRiskMetrics.disruptedMaterials > 0 ? 'de-text-danger' : 'de-text-teal'">
                    {{ store.supplyRiskMetrics.disruptedMaterials }}件
                  </span>
                </span>
              </div>
              <div class="de-progress-track">
                <div
                  class="de-progress-bar"
                  :class="store.supplyRiskMetrics.disruptedMaterials > 0 ? 'is-danger' : 'is-success'"
                  :style="{ width: store.supplyRiskMetrics.disruptedMaterials > 0 ? '100%' : '0%' }"
                ></div>
              </div>
            </div>
          </div>

          <!-- Cautions -->
          <div v-if="store.supplyRiskMetrics.cautions.length" class="de-cautions">
            <div v-for="(c, i) in store.supplyRiskMetrics.cautions" :key="i" class="de-caution-item">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" class="de-caution-icon">
                <circle cx="8" cy="8" r="7" stroke="#f59e0b" stroke-width="1.5" fill="none"/>
                <path d="M8 5v3M8 10v1" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              <span>{{ c }}</span>
            </div>
          </div>
        </div>
      </main>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useSimulationStore } from '@/stores/simulation';

const store = useSimulationStore();
const expandedId = ref<string | null>(null);
const openSection = ref<string | null>('tariff');

onMounted(() => store.loadData());

function toggleSection(section: string) {
  openSection.value = openSection.value === section ? null : section;
}

function getEffectiveTariff(tg: { key: string; baseRate: number }) {
  const override = store.tariffOverrides.get(tg.key);
  return override !== undefined ? override : tg.baseRate;
}

function getEffectiveFx(fx: { currency: string; baseRate: number }) {
  const override = store.fxOverrides.get(fx.currency);
  return override !== undefined ? override : fx.baseRate;
}

function formatCurrency(value: number): string {
  if (isNaN(value)) return '--';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return (value / 1_000_000_000).toFixed(2) + 'B';
  if (abs >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return (value / 1_000).toFixed(1) + 'K';
  return value.toFixed(0) + ' JPY';
}

function deltaColorClass(value: number) {
  if (Math.abs(value) < 0.001) return '';
  return value > 0 ? 'de-text-danger' : 'de-text-teal';
}

const portfolioBadgeClass = computed(() => {
  const d = store.portfolioImpact.totalDelta;
  if (Math.abs(d) < 0.01) return 'de-pill de-pill-neutral';
  return d > 0 ? 'de-pill de-pill-danger' : 'de-pill de-pill-success';
});

const portfolioBadgeLabel = computed(() => {
  const d = store.portfolioImpact.totalDeltaPct;
  if (Math.abs(d) < 0.01) return '変動なし';
  return d > 0 ? 'コスト増' : 'コスト減';
});

function waterfallBarClass(seg: { type: string; value: number }) {
  if (seg.type === 'net') return seg.value >= 0 ? 'is-danger' : 'is-success';
  return seg.value >= 0 ? 'is-warning' : 'is-teal';
}

function waterfallBarStyle(seg: { value: number }) {
  const maxVal = Math.max(
    ...store.costDriverWaterfall.map(s => Math.abs(s.value)),
    1
  );
  const pct = Math.min((Math.abs(seg.value) / maxVal) * 100, 100);
  return { width: pct + '%' };
}

function hhiColorClass(val: number) {
  if (val >= 5000) return 'de-text-danger';
  if (val >= 2500) return 'de-text-warning';
  return 'de-text-teal';
}

function hhiBarClass(val: number) {
  if (val >= 5000) return 'is-danger';
  if (val >= 2500) return 'is-warning';
  return 'is-success';
}

function singleSourceColorClass(val: number) {
  if (val > 3) return 'de-text-danger';
  if (val > 0) return 'de-text-warning';
  return 'de-text-teal';
}

function singleSourceBarClass(val: number) {
  if (val > 3) return 'is-danger';
  if (val > 0) return 'is-warning';
  return 'is-success';
}
</script>

<style scoped>
/* ========================================
   Design E: Cloud Modern (Notion/Linear-inspired)
   ======================================== */

/* Fonts */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;600;700&display=swap');

/* ---- ROOT LAYOUT ---- */
.de-root {
  display: flex;
  min-height: 100vh;
  background: #ffffff;
  font-family: 'Inter', 'Noto Sans JP', -apple-system, BlinkMacSystemFont, sans-serif;
  font-feature-settings: "cv02", "cv03", "cv04", "cv11";
  color: #111827;
  -webkit-font-smoothing: antialiased;
}

/* ---- LOADING / ERROR ---- */
.de-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 100vh;
  gap: 16px;
}

.de-loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e5e7eb;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: de-spin 0.7s linear infinite;
}

@keyframes de-spin {
  to { transform: rotate(360deg); }
}

.de-loading-text {
  font-size: 14px;
  color: #6b7280;
}

.de-error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 100vh;
  gap: 12px;
}

.de-error-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #fef2f2;
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 700;
}

.de-error-msg {
  font-size: 14px;
  color: #6b7280;
}

/* ---- SIDEBAR ---- */
.de-sidebar {
  width: 300px;
  min-width: 300px;
  background: #ffffff;
  border-right: 1px solid #e5e7eb;
  height: 100vh;
  position: sticky;
  top: 0;
  overflow-y: auto;
  padding: 20px 0;
  display: flex;
  flex-direction: column;
}

.de-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px 16px;
  border-bottom: 1px solid #f3f4f6;
  margin-bottom: 4px;
}

.de-sidebar-title {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  letter-spacing: -0.01em;
  margin: 0;
}

/* ---- BUTTONS ---- */
.de-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  padding: 6px 12px;
  transition: all 200ms ease;
}

.de-btn-primary {
  background: #6366f1;
  color: #ffffff;
}

.de-btn-primary:hover {
  background: #4f46e5;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
}

.de-btn-ghost {
  background: transparent;
  color: #6b7280;
  padding: 4px 10px;
}

.de-btn-ghost:hover {
  background: #f3f4f6;
  color: #111827;
}

/* ---- ACCORDION ---- */
.de-accordion {
  border-bottom: 1px solid #f3f4f6;
}

.de-accordion-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px 20px;
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  text-align: left;
  transition: all 200ms ease;
}

.de-accordion-trigger:hover {
  background: #f9fafb;
}

.de-accordion-icon {
  display: flex;
  align-items: center;
  color: #9ca3af;
  transition: transform 200ms ease;
}

.de-accordion-trigger.is-open .de-accordion-icon {
  transform: rotate(90deg);
}

.de-badge-count {
  margin-left: auto;
  background: #f3f4f6;
  color: #6b7280;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
}

.de-accordion-panel {
  padding: 4px 20px 16px;
}

/* ---- SLIDERS ---- */
.de-slider-group {
  margin-bottom: 16px;
}

.de-slider-group:last-child {
  margin-bottom: 0;
}

.de-slider-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.de-slider-name {
  font-size: 12px;
  color: #374151;
  font-weight: 500;
}

.de-slider-value {
  font-size: 12px;
  color: #6366f1;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.de-range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  background: #e5e7eb;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.de-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #6366f1;
  border: 2px solid #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  transition: box-shadow 200ms ease;
}

.de-range::-webkit-slider-thumb:hover {
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.15);
}

.de-range::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #6366f1;
  border: 2px solid #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  cursor: pointer;
}

.de-slider-bounds {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #9ca3af;
  margin-top: 4px;
}

.de-slider-base {
  color: #6b7280;
  font-weight: 500;
}

.de-sidebar-section {
  padding: 16px 20px;
  border-top: 1px solid #f3f4f6;
}

/* ---- SUPPLIER SWITCH ---- */
.de-supplier-row {
  padding: 6px 0;
}

.de-switch-label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.de-switch {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  flex-shrink: 0;
}

.de-switch input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.de-switch-track {
  position: absolute;
  inset: 0;
  background: #d1d5db;
  border-radius: 999px;
  transition: background 200ms ease;
}

.de-switch-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: #ffffff;
  border-radius: 50%;
  transition: transform 200ms ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.de-switch input:checked + .de-switch-track {
  background: #6366f1;
}

.de-switch input:checked + .de-switch-track::after {
  transform: translateX(14px);
}

.de-supplier-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.de-supplier-name {
  font-size: 13px;
  font-weight: 500;
  color: #111827;
}

.de-supplier-country {
  font-size: 11px;
  color: #9ca3af;
}

/* ---- MAIN AREA ---- */
.de-main {
  flex: 1;
  min-width: 0;
  background: #f9fafb;
  padding: 0 32px 40px;
}

/* ---- TOP BAR ---- */
.de-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  position: sticky;
  top: 0;
  background: #f9fafb;
  z-index: 10;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 24px;
}

.de-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.de-breadcrumb-muted {
  color: #9ca3af;
}

.de-breadcrumb-sep {
  color: #d1d5db;
}

.de-breadcrumb-active {
  color: #111827;
  font-weight: 600;
}

.de-freshness {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #6b7280;
}

.de-freshness-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.de-freshness-dot.is-live {
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
}

.de-freshness-dot.is-stale {
  background: #d1d5db;
}

/* ---- WARNINGS ---- */
.de-warnings {
  margin-bottom: 20px;
}

.de-warning-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 12px;
  font-size: 13px;
  color: #92400e;
  margin-bottom: 8px;
}

.de-warning-icon {
  flex-shrink: 0;
}

/* ---- METRIC CARDS ---- */
.de-metrics-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.de-metric-card {
  background: #ffffff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
  transition: all 200ms ease;
}

.de-metric-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04);
}

.de-metric-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.de-metric-title {
  font-size: 13px;
  color: #6b7280;
  font-weight: 500;
}

.de-metric-badge {
  font-size: 11px;
}

.de-metric-value {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.de-metric-unit {
  font-size: 16px;
  font-weight: 500;
  color: #9ca3af;
}

.de-metric-sub {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 6px;
}

/* ---- SECTION CARDS ---- */
.de-section-card {
  background: #ffffff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
  margin-bottom: 24px;
}

.de-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.de-section-title {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  letter-spacing: -0.01em;
  margin: 0;
}

.de-section-count {
  font-size: 12px;
  color: #9ca3af;
  background: #f3f4f6;
  padding: 2px 8px;
  border-radius: 999px;
}

/* ---- TABLE ---- */
.de-table-wrap {
  overflow-x: auto;
}

.de-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0 4px;
  font-size: 13px;
}

.de-table thead th {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-align: left;
  border-bottom: 1px solid #f3f4f6;
}

.de-th-right {
  text-align: right !important;
}

.de-table-row {
  cursor: pointer;
  transition: all 200ms ease;
}

.de-table-row td {
  padding: 12px;
  background: #f9fafb;
  border-top: 1px solid transparent;
  border-bottom: 1px solid transparent;
  vertical-align: middle;
}

.de-table-row td:first-child {
  border-radius: 12px 0 0 12px;
}

.de-table-row td:last-child {
  border-radius: 0 12px 12px 0;
}

.de-table-row:hover td {
  background: #f3f0ff;
}

.de-table-row.is-selected td {
  background: #eef2ff;
  border-top-color: #c7d2fe;
  border-bottom-color: #c7d2fe;
}

.de-table-row.is-selected td:first-child {
  border-left: 3px solid #6366f1;
}

.de-table-row.is-disrupted td {
  background: #fef2f2;
}

.de-td-right {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.de-product-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.de-product-name {
  font-weight: 500;
  color: #111827;
}

.de-product-id {
  font-size: 11px;
  color: #9ca3af;
}

.de-margin-pair {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}

.de-margin-arrow {
  color: #d1d5db;
  font-size: 11px;
}

/* ---- PILLS ---- */
.de-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.de-pill-success {
  background: #ecfdf5;
  color: #059669;
}

.de-pill-danger {
  background: #fef2f2;
  color: #dc2626;
}

.de-pill-warning {
  background: #fffbeb;
  color: #d97706;
}

.de-pill-neutral {
  background: #f3f4f6;
  color: #6b7280;
}

.de-pill-info {
  background: #eef2ff;
  color: #6366f1;
}

/* ---- EXPAND BUTTON ---- */
.de-expand-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: #9ca3af;
  transition: all 200ms ease;
}

.de-expand-btn:hover {
  background: #f3f4f6;
  color: #6366f1;
}

.de-expand-btn.is-open {
  transform: rotate(180deg);
  color: #6366f1;
}

/* ---- EXPANDED ROW ---- */
.de-expand-row td {
  padding: 0 12px 12px;
  background: transparent;
}

.de-expand-content {
  padding: 12px 0 4px;
}

.de-component-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.de-component-card {
  background: #f9fafb;
  border-radius: 12px;
  padding: 14px;
  border: 1px solid #e5e7eb;
  transition: all 200ms ease;
}

.de-component-card:hover {
  border-color: #c7d2fe;
}

.de-comp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.de-comp-name {
  font-size: 13px;
  font-weight: 600;
  color: #111827;
}

.de-comp-details {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.de-comp-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.de-comp-row-total {
  border-top: 1px solid #e5e7eb;
  padding-top: 6px;
  margin-top: 2px;
}

.de-comp-label {
  font-size: 11px;
  color: #9ca3af;
}

.de-comp-val {
  font-size: 12px;
  font-weight: 500;
  color: #374151;
  font-variant-numeric: tabular-nums;
}

/* ---- WATERFALL ---- */
.de-waterfall {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.de-waterfall-item {
  display: grid;
  grid-template-columns: 140px 1fr 120px;
  align-items: center;
  gap: 12px;
}

.de-waterfall-label {
  font-size: 13px;
  font-weight: 500;
  color: #374151;
}

.de-waterfall-bar-track {
  height: 24px;
  background: #f3f4f6;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
}

.de-waterfall-bar {
  height: 100%;
  border-radius: 8px;
  min-width: 4px;
  transition: width 400ms ease;
}

.de-waterfall-bar.is-danger {
  background: linear-gradient(90deg, #fca5a5, #ef4444);
}

.de-waterfall-bar.is-warning {
  background: linear-gradient(90deg, #fde68a, #f59e0b);
}

.de-waterfall-bar.is-success {
  background: linear-gradient(90deg, #6ee7b7, #10b981);
}

.de-waterfall-bar.is-teal {
  background: linear-gradient(90deg, #5eead4, #14b8a6);
}

.de-waterfall-amount {
  font-size: 13px;
  font-weight: 600;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* ---- RISK METRICS ---- */
.de-risk-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.de-risk-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.de-risk-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.de-risk-name {
  font-size: 13px;
  font-weight: 500;
  color: #374151;
}

.de-risk-values {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.de-risk-arrow {
  color: #d1d5db;
  font-size: 11px;
}

.de-progress-track {
  height: 8px;
  background: #f3f4f6;
  border-radius: 999px;
  overflow: hidden;
}

.de-progress-bar {
  height: 100%;
  border-radius: 999px;
  transition: width 400ms ease;
}

.de-progress-bar.is-success {
  background: #10b981;
}

.de-progress-bar.is-warning {
  background: #f59e0b;
}

.de-progress-bar.is-danger {
  background: #ef4444;
}

.de-risk-scale {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #9ca3af;
}

/* ---- CAUTIONS ---- */
.de-cautions {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f3f4f6;
}

.de-caution-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #92400e;
  padding: 6px 0;
}

.de-caution-icon {
  flex-shrink: 0;
}

/* ---- UTILITY CLASSES ---- */
.de-text-danger {
  color: #ef4444;
}

.de-text-teal {
  color: #14b8a6;
}

.de-text-warning {
  color: #f59e0b;
}

.de-text-muted {
  color: #9ca3af;
}

.de-empty-hint {
  font-size: 13px;
  color: #9ca3af;
  text-align: center;
  padding: 16px 0;
}

.de-empty-row {
  text-align: center;
  padding: 24px 12px !important;
  color: #9ca3af;
  font-size: 13px;
}

/* ---- RESPONSIVE ---- */
@media (max-width: 1024px) {
  .de-root {
    flex-direction: column;
  }

  .de-sidebar {
    width: 100%;
    min-width: unset;
    height: auto;
    position: relative;
    border-right: none;
    border-bottom: 1px solid #e5e7eb;
  }

  .de-metrics-row {
    grid-template-columns: 1fr;
  }

  .de-risk-grid {
    grid-template-columns: 1fr;
  }

  .de-waterfall-item {
    grid-template-columns: 100px 1fr 90px;
  }
}
</style>
