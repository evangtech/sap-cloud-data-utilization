<script setup lang="ts">
/**
 * Tab 4: 復旧状況
 * アクティブイベント別の復旧プログレス + ノード別詳細（展開時fetchImpactsByEvent）
 */
import { onMounted, ref } from 'vue';
import { useSupplyChainStore } from '@/stores/supplyChain';
import { fetchImpactsByEvent } from '@/services/api';
import type { EventImpact } from '@/types';

const store = useSupplyChainStore();
const expandedEventId = ref<string | null>(null);
const expandedNodeImpacts = ref<EventImpact[]>([]);
const expandLoading = ref(false);

onMounted(() => {
  if (store.recoveryData.length === 0) store.loadRecoveryDashboard();
});

async function toggleExpand(eventId: string) {
  if (expandedEventId.value === eventId) { expandedEventId.value = null; return; }
  expandedEventId.value = eventId;
  expandLoading.value = true;
  try { expandedNodeImpacts.value = await fetchImpactsByEvent(eventId); }
  finally { expandLoading.value = false; }
}

function progressPct(ev: Record<string, unknown>): number {
  const total = ((ev.activeImpacts as number) || 0) + ((ev.recoveringImpacts as number) || 0) + ((ev.resolvedImpacts as number) || 0);
  if (total === 0) return 0;
  return (((ev.resolvedImpacts as number) || 0) / total) * 100;
}

function formatJpy(amount: number): string {
  if (amount >= 1e8) return `¥${(amount / 1e8).toFixed(1)}億`;
  if (amount >= 1e4) return `¥${(amount / 1e4).toFixed(0)}万`;
  return `¥${amount.toLocaleString()}`;
}
</script>

<template>
  <div class="recovery-tab">
    <div v-if="store.recoveryLoading" class="state-msg">復旧データを取得中...</div>
    <div v-else-if="store.recoveryData.length === 0" class="state-msg">アクティブな復旧イベントはありません</div>
    <div v-else class="recovery-list">
      <div v-for="ev in store.recoveryData" :key="(ev as any).id" class="recovery-card">
        <div class="card-head" @click="toggleExpand((ev as any).id)">
          <div class="card-info">
            <span class="event-title">{{ (ev as any).title }}</span>
            <span class="event-meta">残り約 {{ (ev as any).avgRemainingRecoveryDays?.toFixed(0) ?? '?' }}日</span>
          </div>
          <span class="exposure mono">{{ formatJpy((ev as any).outstandingExposureJpy ?? 0) }}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${progressPct(ev as Record<string, unknown>)}%` }"></div>
        </div>
        <div class="progress-labels">
          <span>Active: {{ (ev as any).activeImpacts ?? 0 }}</span>
          <span>Recovering: {{ (ev as any).recoveringImpacts ?? 0 }}</span>
          <span>Resolved: {{ (ev as any).resolvedImpacts ?? 0 }}</span>
        </div>

        <div v-if="expandedEventId === (ev as any).id" class="node-detail">
          <div v-if="expandLoading" class="loading">読み込み中...</div>
          <div v-else-if="expandedNodeImpacts.length > 0" class="node-list">
            <div v-for="imp in expandedNodeImpacts" :key="imp.nodeId" class="node-row">
              <span class="node-name">{{ imp.nodeName }}</span>
              <span class="status-tag" :class="imp.status">{{ imp.status }}</span>
            </div>
          </div>
          <div v-else class="no-data">ノード別データなし</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.recovery-tab { overflow-y: auto; height: 100%; }
.state-msg { padding: var(--space-8); text-align: center; color: var(--color-gray-700); font-size: var(--text-sm); }
.recovery-list { padding: var(--space-2) 0; }
.recovery-card { border-bottom: 1px solid var(--color-gray-200); padding: var(--space-2) var(--space-3); }
.card-head { display: flex; align-items: center; cursor: pointer; }
.card-info { flex: 1; }
.event-title { font-size: var(--text-sm); font-weight: 600; }
.event-meta { font-size: var(--text-xs); color: var(--color-gray-700); margin-left: var(--space-2); }
.exposure { font-size: var(--text-xs); }
.mono { font-family: var(--font-mono); }
.progress-bar { height: 6px; background: var(--color-gray-200); border-radius: 3px; margin-top: var(--space-2); overflow: hidden; }
.progress-fill { height: 100%; background: var(--color-success-600); border-radius: 3px; transition: width var(--transition-base); }
.progress-labels { display: flex; gap: var(--space-3); font-size: 10px; color: var(--color-gray-700); margin-top: var(--space-1); }
.node-detail { margin-top: var(--space-2); }
.loading, .no-data { font-size: var(--text-xs); color: var(--color-gray-700); padding: var(--space-2); }
.node-list { display: flex; flex-direction: column; }
.node-row { display: flex; justify-content: space-between; padding: var(--space-1) 0; font-size: var(--text-xs); border-bottom: 1px solid #f0f0f0; }
.status-tag { padding: 1px var(--space-1); border-radius: 2px; font-size: 10px; }
.status-tag.active { background: #fef2f2; color: #dc2626; }
.status-tag.recovering { background: #fffbeb; color: #d97706; }
.status-tag.resolved { background: #ecfdf5; color: #059669; }
</style>
