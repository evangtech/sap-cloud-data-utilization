<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useSimulationStore } from '@/stores/simulation';

const store = useSimulationStore();
onMounted(() => store.loadData());

/** Format number as JPY */
function fmtJpy(v: number): string {
  if (!isFinite(v)) return '---';
  return '¥' + Math.round(v).toLocaleString('ja-JP');
}

/** Format number with sign */
function fmtDelta(v: number): string {
  if (!isFinite(v)) return '---';
  const sign = v >= 0 ? '+' : '';
  return sign + '¥' + Math.round(v).toLocaleString('ja-JP');
}

/** Format percentage */
function fmtPct(v: number, digits = 1): string {
  if (!isFinite(v)) return '---';
  const sign = v >= 0 ? '+' : '';
  return sign + v.toFixed(digits) + '%';
}

/** Format margin as percentage */
function fmtMargin(v: number): string {
  if (!isFinite(v)) return '---';
  return (v * 100).toFixed(1) + '%';
}

/** Delta color class */
function deltaClass(v: number): string {
  if (v > 0.01) return 'delta-danger';
  if (v < -0.01) return 'delta-success';
  return 'delta-neutral';
}

/** HHI risk level */
function hhiLevel(hhi: number): string {
  if (hhi >= 5000) return '高集中';
  if (hhi >= 2500) return '中集中';
  return '低集中';
}

function hhiClass(hhi: number): string {
  if (hhi >= 5000) return 'risk-high';
  if (hhi >= 2500) return 'risk-medium';
  return 'risk-low';
}

const portfolio = computed(() => store.portfolioImpact);
const results = computed(() => store.simulationResults);
const risk = computed(() => store.supplyRiskMetrics);
const breakdown = computed(() => store.profitBreakdown);

const totalProducts = computed(() => results.value.length);
const disruptedCount = computed(() => results.value.filter(r => r.isDisrupted).length);
</script>

<template>
  <div class="design-d">
    <!-- ===== Header Bar ===== -->
    <header class="header-bar">
      <div class="header-inner">
        <h1 class="header-title">What-if コストシミュレーション</h1>
        <span class="header-subtitle">Supply Chain Cost Simulator</span>
      </div>
      <div class="header-gold-line"></div>
    </header>

    <!-- ===== Loading / Error ===== -->
    <div v-if="store.isLoading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>データを読み込み中...</p>
    </div>

    <div v-else-if="store.error" class="error-state">
      <p class="error-title">エラーが発生しました</p>
      <p class="error-message">{{ store.error }}</p>
    </div>

    <!-- ===== Main Content ===== -->
    <div v-else class="main-layout">

      <!-- ===== Left Column: 条件設定 ===== -->
      <aside class="left-column">
        <div class="left-header">
          <span class="left-header-text">条件設定</span>
        </div>

        <!-- 関税設定 -->
        <section class="param-section">
          <h3 class="param-title">関税率調整</h3>
          <div v-if="store.tariffGroups.length === 0" class="param-empty">
            該当する関税グループがありません
          </div>
          <div v-for="tg in store.tariffGroups" :key="tg.key" class="param-row">
            <div class="param-label">
              <span class="param-label-main">{{ tg.hsCode }}</span>
              <span class="param-label-sub">{{ tg.origin }} → {{ tg.importer }}</span>
            </div>
            <div class="param-control">
              <input
                type="range"
                :min="0"
                :max="Math.max(tg.baseRate * 3, 50)"
                :step="0.5"
                :value="store.tariffOverrides.get(tg.key) ?? tg.baseRate"
                class="slider"
                @input="store.setTariffOverride(tg.key, Number(($event.target as HTMLInputElement).value))"
              />
              <span class="param-value">
                {{ ((store.tariffOverrides.get(tg.key) ?? tg.baseRate)).toFixed(1) }}%
              </span>
            </div>
            <div class="param-baseline">基準: {{ tg.baseRate.toFixed(1) }}%</div>
          </div>
        </section>

        <div class="section-divider"></div>

        <!-- 為替設定 -->
        <section class="param-section">
          <h3 class="param-title">為替レート調整</h3>
          <div v-if="store.fxRateList.length === 0" class="param-empty">
            為替データがありません
          </div>
          <div v-for="fx in store.fxRateList" :key="fx.currency" class="param-row">
            <div class="param-label">
              <span class="param-label-main">{{ fx.currency }}/JPY</span>
              <span class="param-label-sub">1{{ fx.currency }} = ¥{{ fx.displayRate }}</span>
            </div>
            <div class="param-control">
              <input
                type="range"
                :min="fx.baseRate * 0.5"
                :max="fx.baseRate * 1.5"
                :step="fx.baseRate * 0.01"
                :value="store.fxOverrides.get(fx.currency) ?? fx.baseRate"
                class="slider"
                @input="store.setFxOverride(fx.currency, Number(($event.target as HTMLInputElement).value))"
              />
              <span class="param-value">
                ¥{{ Math.round(1 / (store.fxOverrides.get(fx.currency) ?? fx.baseRate)) }}
              </span>
            </div>
            <div class="param-baseline">基準: ¥{{ fx.displayRate }}</div>
          </div>
        </section>

        <div class="section-divider"></div>

        <!-- サプライヤー制御 -->
        <section class="param-section">
          <h3 class="param-title">サプライヤー制御</h3>
          <div v-if="store.supplierList.length === 0" class="param-empty">
            サプライヤーデータがありません
          </div>
          <div v-for="s in store.supplierList" :key="s.id" class="supplier-row">
            <label class="supplier-label">
              <input
                type="checkbox"
                :checked="!store.disabledSuppliers.has(s.id)"
                class="supplier-checkbox"
                @change="store.toggleSupplier(s.id)"
              />
              <span class="supplier-name">{{ s.name }}</span>
              <span class="supplier-country">{{ s.country }}</span>
            </label>
          </div>
        </section>

        <div class="section-divider"></div>

        <!-- 発注量調整 -->
        <section class="param-section">
          <h3 class="param-title">発注量倍率</h3>
          <div class="param-row">
            <div class="param-control">
              <input
                type="range"
                :min="0.5"
                :max="2.0"
                :step="0.1"
                :value="store.volumeMultiplier"
                class="slider"
                @input="store.setVolumeMultiplier(Number(($event.target as HTMLInputElement).value))"
              />
              <span class="param-value volume-value">{{ store.volumeMultiplier.toFixed(1) }}x</span>
            </div>
          </div>
        </section>

        <div class="section-divider"></div>

        <!-- リセット -->
        <section class="param-section">
          <button class="btn-reset" @click="store.resetAll()">条件をリセット</button>
        </section>
      </aside>

      <!-- ===== Right Column: 分析結果 ===== -->
      <main class="right-column">

        <!-- 分析結果ヘッダー -->
        <h2 class="section-heading">分析結果</h2>

        <!-- KPIボックス -->
        <div class="kpi-row">
          <div class="kpi-box">
            <div class="kpi-label">ポートフォリオ影響額</div>
            <div :class="['kpi-value', deltaClass(portfolio.totalDelta)]">
              {{ fmtDelta(portfolio.totalDelta) }}
            </div>
            <div class="kpi-sub">{{ fmtPct(portfolio.totalDeltaPct) }}</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">影響製品数</div>
            <div class="kpi-value">
              {{ portfolio.affectedProducts }}<span class="kpi-unit"> / {{ totalProducts }}</span>
            </div>
            <div class="kpi-sub">
              途絶: <span :class="disruptedCount > 0 ? 'text-danger' : ''">{{ disruptedCount }}件</span>
            </div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">コスト変動要因</div>
            <div class="kpi-drivers">
              <div class="driver-item">
                <span class="driver-label">関税</span>
                <span :class="['driver-value', deltaClass(breakdown.tariffImpact)]">
                  {{ fmtDelta(breakdown.tariffImpact) }}
                </span>
              </div>
              <div class="driver-item">
                <span class="driver-label">為替</span>
                <span :class="['driver-value', deltaClass(breakdown.fxImpact)]">
                  {{ fmtDelta(breakdown.fxImpact) }}
                </span>
              </div>
              <div class="driver-item">
                <span class="driver-label">切替</span>
                <span :class="['driver-value', deltaClass(breakdown.supplierImpact)]">
                  {{ fmtDelta(breakdown.supplierImpact) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- 製品別影響一覧 -->
        <h2 class="section-heading">製品別影響一覧</h2>
        <div class="table-wrapper">
          <table class="formal-table">
            <thead>
              <tr>
                <th class="col-id">製品ID</th>
                <th class="col-name">製品名</th>
                <th class="col-num">基準コスト</th>
                <th class="col-num">シナリオコスト</th>
                <th class="col-num">差額</th>
                <th class="col-num">変動率</th>
                <th class="col-num">基準利益率</th>
                <th class="col-num">新利益率</th>
                <th class="col-status">状態</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="results.length === 0">
                <td colspan="9" class="empty-row">データがありません</td>
              </tr>
              <tr
                v-for="r in results"
                :key="r.productId"
                :class="{ 'row-disrupted': r.isDisrupted, 'row-selected': store.selectedProductId === r.productId }"
                @click="store.selectProduct(r.productId)"
              >
                <td class="col-id">{{ r.productId }}</td>
                <td class="col-name">{{ r.productName }}</td>
                <td class="col-num">{{ fmtJpy(r.baseCost) }}</td>
                <td class="col-num">{{ fmtJpy(r.newCost) }}</td>
                <td :class="['col-num', deltaClass(r.delta)]">{{ fmtDelta(r.delta) }}</td>
                <td :class="['col-num', deltaClass(r.deltaPct)]">{{ fmtPct(r.deltaPct) }}</td>
                <td class="col-num">{{ fmtMargin(r.baseMargin) }}</td>
                <td class="col-num">{{ fmtMargin(r.newMargin) }}</td>
                <td class="col-status">
                  <span v-if="r.isDisrupted" class="badge-disrupted">途絶</span>
                  <span v-else-if="Math.abs(r.deltaPct) > 0.01" class="badge-affected">変動</span>
                  <span v-else class="badge-normal">正常</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 選択製品の内訳 -->
        <div v-if="store.selectedProductBreakdown.length > 0" class="detail-section">
          <h2 class="section-heading">部品別コスト内訳</h2>
          <div class="table-wrapper">
            <table class="formal-table compact">
              <thead>
                <tr>
                  <th>部品名</th>
                  <th>サプライヤー</th>
                  <th class="col-num">単価(JPY)</th>
                  <th class="col-num">関税率</th>
                  <th class="col-num">数量</th>
                  <th class="col-num">基準合計</th>
                  <th class="col-num">シナリオ合計</th>
                  <th class="col-num">差額</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in store.selectedProductBreakdown" :key="c.materialId" :class="{ 'row-alt': c.isAlternative }">
                  <td>{{ c.materialName }}</td>
                  <td>
                    {{ c.supplierName }}
                    <span v-if="c.isAlternative" class="badge-alt">代替</span>
                  </td>
                  <td class="col-num">{{ fmtJpy(c.unitPriceJpy) }}</td>
                  <td class="col-num">{{ c.tariffRate.toFixed(1) }}%</td>
                  <td class="col-num">{{ c.bomQuantity }}</td>
                  <td class="col-num">{{ fmtJpy(c.baselineTotalCost) }}</td>
                  <td class="col-num">{{ fmtJpy(c.totalCost) }}</td>
                  <td :class="['col-num', deltaClass(c.totalCost - c.baselineTotalCost)]">
                    {{ fmtDelta(c.totalCost - c.baselineTotalCost) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- リスク指標 -->
        <h2 class="section-heading">リスク指標</h2>
        <div class="risk-grid">
          <div class="risk-card">
            <div class="risk-card-title">サプライヤー集中度 (HHI)</div>
            <div class="risk-pair">
              <div class="risk-item">
                <span class="risk-label">変更前</span>
                <span :class="['risk-value', hhiClass(risk.supplierHHI.before)]">
                  {{ risk.supplierHHI.before.toLocaleString() }}
                </span>
                <span class="risk-level">{{ hhiLevel(risk.supplierHHI.before) }}</span>
              </div>
              <div class="risk-arrow">→</div>
              <div class="risk-item">
                <span class="risk-label">変更後</span>
                <span :class="['risk-value', hhiClass(risk.supplierHHI.after)]">
                  {{ risk.supplierHHI.after.toLocaleString() }}
                </span>
                <span class="risk-level">{{ hhiLevel(risk.supplierHHI.after) }}</span>
              </div>
            </div>
          </div>

          <div class="risk-card">
            <div class="risk-card-title">地理的集中度 (HHI)</div>
            <div class="risk-pair">
              <div class="risk-item">
                <span class="risk-label">変更前</span>
                <span :class="['risk-value', hhiClass(risk.geoConcentration.before)]">
                  {{ risk.geoConcentration.before.toLocaleString() }}
                </span>
                <span class="risk-level">{{ hhiLevel(risk.geoConcentration.before) }}</span>
              </div>
              <div class="risk-arrow">→</div>
              <div class="risk-item">
                <span class="risk-label">変更後</span>
                <span :class="['risk-value', hhiClass(risk.geoConcentration.after)]">
                  {{ risk.geoConcentration.after.toLocaleString() }}
                </span>
                <span class="risk-level">{{ hhiLevel(risk.geoConcentration.after) }}</span>
              </div>
            </div>
          </div>

          <div class="risk-card">
            <div class="risk-card-title">単一ソース部品</div>
            <div class="risk-pair">
              <div class="risk-item">
                <span class="risk-label">変更前</span>
                <span class="risk-value risk-count">{{ risk.singleSource.before }}</span>
                <span class="risk-level">件</span>
              </div>
              <div class="risk-arrow">→</div>
              <div class="risk-item">
                <span class="risk-label">変更後</span>
                <span :class="['risk-value', 'risk-count', risk.singleSource.after > risk.singleSource.before ? 'risk-high' : '']">
                  {{ risk.singleSource.after }}
                </span>
                <span class="risk-level">件</span>
              </div>
            </div>
          </div>

          <div class="risk-card">
            <div class="risk-card-title">途絶部品数</div>
            <div class="risk-single">
              <span :class="['risk-value', 'risk-count', risk.disruptedMaterials > 0 ? 'risk-high' : 'risk-low']">
                {{ risk.disruptedMaterials }}
              </span>
              <span class="risk-level">件</span>
            </div>
          </div>
        </div>

        <!-- 注意事項 -->
        <div v-if="risk.cautions.length > 0" class="cautions-section">
          <h3 class="caution-title">注意事項</h3>
          <ul class="caution-list">
            <li v-for="(c, i) in risk.cautions" :key="i">{{ c }}</li>
          </ul>
        </div>

        <!-- データ品質警告 -->
        <div v-if="store.dataQualityWarnings.length > 0" class="warnings-section">
          <h3 class="warning-title">データ品質警告</h3>
          <ul class="warning-list">
            <li v-for="(w, i) in store.dataQualityWarnings" :key="i">{{ w }}</li>
          </ul>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=BIZ+UDGothic:wght@400;700&family=Noto+Sans+JP:wght@400;500;700&display=swap');

/* ===== Root & Reset ===== */
.design-d {
  font-family: 'BIZ UDGothic', 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif;
  color: #1a1a1a;
  background: #ffffff;
  min-height: 100vh;
  font-size: 13px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

/* ===== Header Bar ===== */
.header-bar {
  background: #1b2838;
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 24px;
  position: relative;
}

.header-inner {
  display: flex;
  align-items: baseline;
  gap: 16px;
}

.header-title {
  color: #ffffff;
  font-size: 16px;
  font-weight: 700;
  margin: 0;
  letter-spacing: 0.05em;
}

.header-subtitle {
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.02em;
}

.header-gold-line {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #b8860b 0%, #d4a843 50%, #b8860b 100%);
}

/* ===== Loading / Error ===== */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 400px;
  color: #4a4a4a;
  gap: 16px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #eef1f5;
  border-top-color: #1b2838;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 400px;
  gap: 8px;
}

.error-title {
  color: #c62828;
  font-weight: 700;
  font-size: 15px;
}

.error-message {
  color: #4a4a4a;
  font-size: 13px;
}

/* ===== Main Layout ===== */
.main-layout {
  display: grid;
  grid-template-columns: 300px 1fr;
  min-height: calc(100vh - 50px);
}

/* ===== Left Column ===== */
.left-column {
  border-right: 1px solid #d0d5dd;
  background: #fafbfc;
  overflow-y: auto;
  max-height: calc(100vh - 50px);
}

.left-header {
  background: #1b2838;
  padding: 10px 20px;
}

.left-header-text {
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

/* Parameter Sections */
.param-section {
  padding: 16px 20px;
}

.param-title {
  font-size: 12px;
  font-weight: 700;
  color: #1b2838;
  margin: 0 0 12px 0;
  padding-left: 10px;
  border-left: 3px solid #1b2838;
  line-height: 1.4;
}

.param-empty {
  color: #8a8a8a;
  font-size: 12px;
  padding: 4px 0;
}

.param-row {
  margin-bottom: 14px;
}

.param-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.param-label-main {
  font-size: 12px;
  font-weight: 700;
  color: #1a1a1a;
}

.param-label-sub {
  font-size: 11px;
  color: #8a8a8a;
}

.param-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: #d0d5dd;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #1b2838;
  cursor: pointer;
  border: 2px solid #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #1b2838;
  cursor: pointer;
  border: 2px solid #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.param-value {
  font-size: 12px;
  font-weight: 700;
  color: #1b2838;
  min-width: 52px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.volume-value {
  min-width: 36px;
}

.param-baseline {
  font-size: 10px;
  color: #8a8a8a;
  margin-top: 2px;
}

.section-divider {
  height: 1px;
  background: #d0d5dd;
  margin: 0 20px;
}

/* Supplier Controls */
.supplier-row {
  margin-bottom: 6px;
}

.supplier-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 0;
  font-size: 12px;
}

.supplier-checkbox {
  width: 14px;
  height: 14px;
  accent-color: #1b2838;
  cursor: pointer;
  flex-shrink: 0;
}

.supplier-name {
  color: #1a1a1a;
  font-weight: 500;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.supplier-country {
  color: #8a8a8a;
  font-size: 11px;
  flex-shrink: 0;
}

/* Reset Button */
.btn-reset {
  width: 100%;
  padding: 8px 16px;
  background: #ffffff;
  color: #1b2838;
  border: 1px solid #1b2838;
  border-radius: 3px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  letter-spacing: 0.04em;
  transition: background 0.15s, color 0.15s;
}

.btn-reset:hover {
  background: #1b2838;
  color: #ffffff;
}

/* ===== Right Column ===== */
.right-column {
  padding: 24px 32px;
  overflow-y: auto;
  max-height: calc(100vh - 50px);
}

/* Section Heading */
.section-heading {
  font-size: 15px;
  font-weight: 700;
  color: #1b2838;
  margin: 0 0 16px 0;
  padding-left: 12px;
  border-left: 4px solid #1b2838;
  line-height: 1.4;
}

/* ===== KPI Row ===== */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 32px;
}

.kpi-box {
  background: #ffffff;
  border-top: 3px solid #1b2838;
  border-radius: 0 0 4px 4px;
  padding: 16px 20px;
  border-left: 1px solid #e8eaed;
  border-right: 1px solid #e8eaed;
  border-bottom: 1px solid #e8eaed;
}

.kpi-label {
  font-size: 11px;
  font-weight: 700;
  color: #4a4a4a;
  margin-bottom: 8px;
  letter-spacing: 0.04em;
}

.kpi-value {
  font-size: 22px;
  font-weight: 700;
  color: #1a1a1a;
  font-variant-numeric: tabular-nums;
}

.kpi-unit {
  font-size: 13px;
  font-weight: 400;
  color: #4a4a4a;
}

.kpi-sub {
  font-size: 11px;
  color: #8a8a8a;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}

.kpi-drivers {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.driver-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.driver-label {
  font-size: 11px;
  color: #4a4a4a;
  font-weight: 500;
}

.driver-value {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* Delta Colors */
.delta-danger {
  color: #c62828;
}

.delta-success {
  color: #2e7d32;
}

.delta-neutral {
  color: #4a4a4a;
}

.text-danger {
  color: #c62828;
  font-weight: 700;
}

/* ===== Tables ===== */
.table-wrapper {
  overflow-x: auto;
  margin-bottom: 32px;
}

.formal-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.formal-table th,
.formal-table td {
  padding: 8px 12px;
  border: 1px solid #d0d5dd;
  text-align: left;
  vertical-align: middle;
}

.formal-table thead th {
  background: #eef1f5;
  font-weight: 700;
  color: #1b2838;
  font-size: 11px;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.formal-table tbody tr {
  cursor: pointer;
  transition: background 0.1s;
}

.formal-table tbody tr:hover {
  background: #f5f7fa;
}

.formal-table.compact th,
.formal-table.compact td {
  padding: 6px 10px;
  font-size: 11px;
}

.col-id {
  white-space: nowrap;
  font-weight: 500;
  font-size: 11px;
  color: #4a4a4a;
}

.col-name {
  font-weight: 500;
  min-width: 120px;
}

.col-num {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.col-status {
  text-align: center;
  white-space: nowrap;
}

.empty-row {
  text-align: center;
  color: #8a8a8a;
  padding: 24px;
}

.row-disrupted {
  background: #fff5f5;
}

.row-disrupted:hover {
  background: #ffecec !important;
}

.row-selected {
  background: #eef1f5;
}

.row-selected:hover {
  background: #e3e8f0 !important;
}

.row-alt {
  background: #fdf8f0;
}

/* Badges */
.badge-disrupted {
  display: inline-block;
  padding: 2px 8px;
  background: #c62828;
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  border-radius: 3px;
  letter-spacing: 0.04em;
}

.badge-affected {
  display: inline-block;
  padding: 2px 8px;
  background: #f57f17;
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  border-radius: 3px;
  letter-spacing: 0.04em;
}

.badge-normal {
  display: inline-block;
  padding: 2px 8px;
  background: #e8eaed;
  color: #4a4a4a;
  font-size: 10px;
  font-weight: 700;
  border-radius: 3px;
  letter-spacing: 0.04em;
}

.badge-alt {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  background: #b8860b;
  color: #ffffff;
  font-size: 9px;
  font-weight: 700;
  border-radius: 2px;
  vertical-align: middle;
}

/* Detail section */
.detail-section {
  margin-bottom: 8px;
}

/* ===== Risk Grid ===== */
.risk-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.risk-card {
  background: #ffffff;
  border-top: 3px solid #1b2838;
  border-left: 1px solid #e8eaed;
  border-right: 1px solid #e8eaed;
  border-bottom: 1px solid #e8eaed;
  border-radius: 0 0 4px 4px;
  padding: 16px 20px;
}

.risk-card-title {
  font-size: 11px;
  font-weight: 700;
  color: #4a4a4a;
  margin-bottom: 12px;
  letter-spacing: 0.04em;
}

.risk-pair {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.risk-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex: 1;
}

.risk-arrow {
  color: #8a8a8a;
  font-size: 16px;
  flex-shrink: 0;
}

.risk-label {
  font-size: 10px;
  color: #8a8a8a;
  font-weight: 500;
}

.risk-value {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.risk-count {
  font-size: 24px;
}

.risk-level {
  font-size: 10px;
  color: #4a4a4a;
  font-weight: 500;
}

.risk-single {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  padding: 8px 0;
}

.risk-high {
  color: #c62828;
}

.risk-medium {
  color: #f57f17;
}

.risk-low {
  color: #2e7d32;
}

/* ===== Cautions / Warnings ===== */
.cautions-section {
  margin-bottom: 20px;
  padding: 14px 18px;
  background: #fffde7;
  border: 1px solid #f57f17;
  border-radius: 4px;
}

.caution-title {
  font-size: 12px;
  font-weight: 700;
  color: #f57f17;
  margin: 0 0 8px 0;
}

.caution-list {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: #4a4a4a;
  line-height: 1.8;
}

.warnings-section {
  margin-bottom: 20px;
  padding: 14px 18px;
  background: #fff5f5;
  border: 1px solid #c62828;
  border-radius: 4px;
}

.warning-title {
  font-size: 12px;
  font-weight: 700;
  color: #c62828;
  margin: 0 0 8px 0;
}

.warning-list {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: #4a4a4a;
  line-height: 1.8;
}

/* ===== Responsive ===== */
@media (max-width: 960px) {
  .main-layout {
    grid-template-columns: 1fr;
  }

  .left-column {
    max-height: none;
    border-right: none;
    border-bottom: 1px solid #d0d5dd;
  }

  .right-column {
    max-height: none;
  }

  .kpi-row {
    grid-template-columns: 1fr;
  }

  .risk-grid {
    grid-template-columns: 1fr;
  }
}
</style>
