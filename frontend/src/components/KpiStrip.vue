<script setup lang="ts">
/**
 * KPIストリップ — マップ上部の52pxバー
 * riskDashboardStats から5つの主要メトリクスを表示
 * クリックで右パネルの該当タブを開く
 */
import { computed } from 'vue';
import { useSupplyChainStore } from '@/stores/supplyChain';

const store = useSupplyChainStore();
const stats = computed(() => store.riskDashboardStats);

const emit = defineEmits<{
  (e: 'open-tab', tab: string): void;
  (e: 'open-tab-filter', tab: string, filter: Record<string, unknown>): void;
}>();

function formatExposure(amount: number): string {
  if (amount >= 1e8) return `¥${(amount / 1e8).toFixed(1)}億`;
  if (amount >= 1e4) return `¥${(amount / 1e4).toFixed(0)}万`;
  return `¥${amount.toLocaleString()}`;
}

const highestRiskPlantName = computed(() => {
  const hr = stats.value.highestRisk;
  if (!hr) return '—';
  const plant = store.plants.find(p => p.id === hr.nodeId);
  return plant?.name ?? hr.nodeId;
});
</script>

<template>
  <div class="kpi-strip">
    <button class="kpi-item" @click="emit('open-tab', 'events')">
      <span class="kpi-label">アクティブイベント</span>
      <span class="kpi-value" :class="{ 'kpi-alert': stats.activeEventCount > 0 }">
        {{ stats.activeEventCount }}
      </span>
    </button>
    <button class="kpi-item" @click="emit('open-tab', 'impacts')">
      <span class="kpi-label">直接影響</span>
      <span class="kpi-value">{{ stats.directCount }}</span>
    </button>
    <button class="kpi-item" @click="emit('open-tab', 'impacts')">
      <span class="kpi-label">下流影響</span>
      <span class="kpi-value">{{ stats.downstreamCount }}</span>
    </button>
    <button class="kpi-item" @click="emit('open-tab', 'impacts')">
      <span class="kpi-label">エクスポージャー</span>
      <span class="kpi-value kpi-mono">{{ formatExposure(stats.totalExposure) }}</span>
    </button>
    <button class="kpi-item" @click="emit('open-tab-filter', 'events', { reviewStatus: 'pending' })">
      <span class="kpi-label">確認待ち</span>
      <span class="kpi-value" :class="{ 'kpi-warning': stats.pendingReviewCount > 0 }">
        {{ stats.pendingReviewCount }}
      </span>
    </button>
    <div class="kpi-item kpi-highlight" v-if="stats.highestRisk">
      <span class="kpi-label">最高リスク</span>
      <span class="kpi-value kpi-mono kpi-truncate">{{ highestRiskPlantName }}</span>
    </div>
  </div>
</template>

<style scoped>
.kpi-strip {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  height: 52px;
  padding: 0 var(--space-3);
  background: var(--color-primary-700);
  border-bottom: 1px solid rgba(212, 168, 67, 0.22);
  flex-shrink: 0;
}
.kpi-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
  min-width: 0;
}
.kpi-item:hover { background: rgba(255,255,255,0.08); }
.kpi-label {
  font-size: var(--text-xs);
  color: rgba(255,255,255,0.6);
  white-space: nowrap;
}
.kpi-value {
  font-size: var(--text-lg);
  font-weight: 700;
  color: #fff;
}
.kpi-mono { font-family: var(--font-mono); }
.kpi-truncate { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kpi-alert {
  color: #ef4444;
  background: rgba(239,68,68,0.15);
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
}
.kpi-warning {
  color: #f59e0b;
  background: rgba(245,158,11,0.15);
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
}
.kpi-highlight {
  margin-left: auto;
  cursor: default;
}
</style>
