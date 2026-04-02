<script setup lang="ts">
/**
 * 地図凡例 — マーカー色と接続線の意味を示すコンパクトなカラーキー
 * ノード個別選択は NodeListTab に移動済み
 */
import { ref } from 'vue';

const expanded = ref(true);
</script>

<template>
  <div class="legend" :class="{ collapsed: !expanded }">
    <button class="legend-toggle" @click="expanded = !expanded">
      <span>凡例</span>
      <svg :class="{ open: expanded }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
    <div v-if="expanded" class="legend-body">
      <div class="legend-section">
        <div class="legend-row"><span class="dot danger"></span>直接影響</div>
        <div class="legend-row"><span class="dot warning"></span>下流影響</div>
        <div class="legend-row"><span class="dot normal"></span>正常</div>
      </div>
      <div class="legend-sep"></div>
      <div class="legend-section">
        <div class="legend-row"><span class="line line-supplier"></span>サプライヤー</div>
        <div class="legend-row"><span class="line line-customer"></span>カスタマ</div>
        <div class="legend-row"><span class="line line-plant"></span>工場間</div>
        <div class="legend-row"><span class="line line-impact"></span>影響経路</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.legend {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(6px);
  border: 1px solid #d0d5dd;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  min-width: 130px;
}

.legend-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 10px;
  font-size: 10px;
  font-weight: 700;
  color: #4a4a4a;
  letter-spacing: 0.06em;
  cursor: pointer;
}

.legend-toggle svg {
  color: #8a8a8a;
  transition: transform 0.2s ease;
}

.legend-toggle svg.open {
  transform: rotate(180deg);
}

.legend-body {
  padding: 0 10px 8px;
}

.legend-section {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.legend-sep {
  height: 1px;
  background: #e8eaed;
  margin: 6px 0;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: #4a4a4a;
  line-height: 1;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot.danger { background: #ef4444; }
.dot.warning { background: #f59e0b; }
.dot.normal { background: #3b82f6; }

.line {
  width: 20px;
  height: 2px;
  flex-shrink: 0;
  border-radius: 1px;
}

.line-supplier {
  background: repeating-linear-gradient(90deg, #0891b2 0px, #0891b2 4px, transparent 4px, transparent 7px);
}

.line-customer {
  background: repeating-linear-gradient(90deg, #22c55e 0px, #22c55e 4px, transparent 4px, transparent 7px);
}

.line-plant {
  background: repeating-linear-gradient(90deg, #64748b 0px, #64748b 3px, transparent 3px, transparent 6px);
}

.line-impact {
  background: repeating-linear-gradient(90deg, #ef4444 0px, #ef4444 4px, transparent 4px, transparent 7px);
}
</style>
