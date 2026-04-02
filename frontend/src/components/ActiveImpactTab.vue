<script setup lang="ts">
/**
 * Tab 2: アクティブインパクト
 * 影響ノードリスト（cachedImpactAmount降順）、リスクスコア内訳、履歴リンク
 */
import { computed, ref } from 'vue';
import { useSupplyChainStore } from '@/stores/supplyChain';
import { fetchRiskEventHistory } from '@/services/api';
import type { NodeImpact } from '@/types';

const store = useSupplyChainStore();

const emit = defineEmits<{
  (e: 'focus-node', nodeId: string): void;
}>();

interface ImpactedNode {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  impacts: NodeImpact[];
  totalExposure: number;
  maxSeverity: number;
  hasDirect: boolean;
}

const impactedNodes = computed<ImpactedNode[]>(() => {
  const nodes: ImpactedNode[] = [];
  for (const [nodeId, impacts] of store.activeImpactsByNode) {
    nodes.push({
      nodeId,
      nodeName: resolveName(nodeId),
      nodeType: resolveType(nodeId),
      impacts,
      totalExposure: impacts.reduce((s, i) => s + i.cachedImpactAmount, 0),
      maxSeverity: Math.max(...impacts.map(i => i.severity)),
      hasDirect: impacts.some(i => i.impactType === 'direct'),
    });
  }
  return nodes.sort((a, b) => b.totalExposure - a.totalExposure);
});

function resolveName(id: string): string {
  return store.plants.find(p => p.id === id)?.name
    ?? store.suppliers.find(s => s.id === id)?.name
    ?? store.customers.find(c => c.id === id)?.name
    ?? store.warehouses.find(w => w.id === id)?.name
    ?? store.logisticsHubs.find(h => h.id === id)?.name
    ?? id;
}

function resolveType(id: string): string {
  if (store.plants.find(p => p.id === id)) return 'Plant';
  if (store.suppliers.find(s => s.id === id)) return 'Supplier';
  if (store.customers.find(c => c.id === id)) return 'Customer';
  if (store.warehouses.find(w => w.id === id)) return 'Warehouse';
  if (store.logisticsHubs.find(h => h.id === id)) return 'LogisticsHub';
  return 'Unknown';
}

const typeIcons: Record<string, string> = {
  Plant: '🏭', Supplier: '🔷', Customer: '🟩', Warehouse: '🟪', LogisticsHub: '⚓',
};

function formatJpy(amount: number): string {
  if (amount >= 1e8) return `¥${(amount / 1e8).toFixed(1)}億`;
  if (amount >= 1e4) return `¥${(amount / 1e4).toFixed(0)}万`;
  return `¥${amount.toLocaleString()}`;
}

const selectedNodeId = ref<string | null>(null);
const historyData = ref<unknown[]>([]);
const historyLoading = ref(false);

async function showHistory(nodeId: string) {
  historyLoading.value = true;
  try { historyData.value = await fetchRiskEventHistory(nodeId); }
  finally { historyLoading.value = false; }
}
</script>

<template>
  <div class="impact-tab">
    <div v-if="impactedNodes.length === 0" class="empty-state">アクティブな影響ノードはありません</div>
    <div
      v-for="node in impactedNodes" :key="node.nodeId"
      class="impact-row" :class="{ selected: selectedNodeId === node.nodeId }"
      @click="() => {
        const wasSelected = selectedNodeId === node.nodeId;
        selectedNodeId = wasSelected ? null : node.nodeId;
        if (!wasSelected) emit('focus-node', node.nodeId);
      }"
    >
      <div class="row-head">
        <span class="node-icon">{{ typeIcons[node.nodeType] || '📍' }}</span>
        <div class="node-info">
          <span class="node-name">{{ node.nodeName }}</span>
          <span class="tags">
            <span v-if="node.hasDirect" class="tag direct">直接</span>
            <span v-else class="tag downstream">下流</span>
            <span class="tag sev">Sev {{ node.maxSeverity }}</span>
          </span>
        </div>
        <span class="exposure mono">{{ formatJpy(node.totalExposure) }}</span>
      </div>

      <div v-if="selectedNodeId === node.nodeId" class="row-detail">
        <div class="detail-section">
          <div class="detail-label">リスクスコア</div>
          <div class="score-row" v-if="store.riskScores.get(node.nodeId)">
            <span>基準: {{ store.riskScores.get(node.nodeId)!.baselineRisk.toFixed(1) }}</span>
            <span>ライブ: {{ store.riskScores.get(node.nodeId)!.liveEventRisk.toFixed(2) }}</span>
            <span>統合: {{ store.riskScores.get(node.nodeId)!.combinedOperationalRisk.toFixed(2) }}</span>
          </div>
          <div v-else class="no-score">スコアなし（Plant以外はv3で対応）</div>
        </div>
        <button class="history-btn" @click.stop="showHistory(node.nodeId)">📜 履歴を表示</button>
        <div v-if="historyLoading" class="loading">読み込み中...</div>
        <div v-else-if="historyData.length > 0" class="history-list">
          <div v-for="(h, i) in historyData" :key="i" class="history-item">
            {{ (h as any).title }} (Sev {{ (h as any).severity }}) — {{ (h as any).startDate?.slice(0, 10) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.impact-tab { overflow-y: auto; height: 100%; }
.empty-state { padding: var(--space-8); text-align: center; color: var(--color-gray-700); }
.impact-row { border-bottom: 1px solid var(--color-gray-200); cursor: pointer; transition: background var(--transition-fast); }
.impact-row:hover { background: var(--color-primary-50); }
.impact-row.selected { background: rgba(59,130,246,0.05); }
.row-head { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); }
.node-icon { font-size: 16px; }
.node-info { flex: 1; min-width: 0; }
.node-name { font-size: var(--text-sm); font-weight: 600; }
.tags { display: flex; gap: var(--space-1); margin-top: 2px; }
.tag { font-size: 10px; padding: 1px var(--space-1); border-radius: 2px; }
.tag.direct { background: #fef2f2; color: #dc2626; }
.tag.downstream { background: #fffbeb; color: #d97706; }
.tag.sev { background: var(--color-gray-200); color: var(--color-gray-700); }
.exposure { font-size: var(--text-xs); white-space: nowrap; }
.mono { font-family: var(--font-mono); }
.row-detail { padding: 0 var(--space-3) var(--space-3); }
.detail-section { margin-top: var(--space-2); }
.detail-label { font-size: var(--text-xs); font-weight: 600; color: var(--color-gray-700); }
.score-row { display: flex; gap: var(--space-3); font-size: var(--text-xs); font-family: var(--font-mono); margin-top: var(--space-1); }
.no-score { font-size: var(--text-xs); color: var(--color-gray-700); font-style: italic; }
.history-btn { margin-top: var(--space-2); padding: var(--space-1) var(--space-2); border: 1px solid var(--color-gray-200); border-radius: var(--radius-sm); background: #fff; font-size: var(--text-xs); cursor: pointer; }
.history-btn:hover { background: var(--color-primary-50); }
.loading { padding: var(--space-2); text-align: center; font-size: var(--text-xs); color: var(--color-gray-700); }
.history-list { margin-top: var(--space-2); }
.history-item { font-size: var(--text-xs); padding: var(--space-1) 0; border-bottom: 1px solid #f0f0f0; }
</style>
