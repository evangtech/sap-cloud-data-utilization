<script setup lang="ts">
/**
 * /risk-dashboard — Plantリスクスコアランキング
 * v2スコープ: Plantのみ。ノード名はstore.plantsからクライアントサイド結合。
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useSupplyChainStore } from '@/stores/supplyChain';

const store = useSupplyChainStore();
const router = useRouter();

const rankedPlants = computed(() => {
  return [...store.riskScores.values()]
    .filter(s => s.nodeType === 'Plant')
    .sort((a, b) => b.combinedOperationalRisk - a.combinedOperationalRisk)
    .map((s, idx) => ({
      rank: idx + 1,
      ...s,
      name: store.plants.find(p => p.id === s.nodeId)?.name ?? s.nodeId,
    }));
});

function selectPlant(nodeId: string) {
  router.push({ name: 'map', query: { focus: nodeId } });
}

function formatJpy(amount: number): string {
  if (amount >= 1e8) return `¥${(amount / 1e8).toFixed(1)}億`;
  if (amount >= 1e4) return `¥${(amount / 1e4).toFixed(0)}万`;
  return `¥${amount.toLocaleString()}`;
}
</script>

<template>
  <div class="dashboard-page">
    <div class="page-header">
      <h1 class="page-title">Plant リスクスコアランキング</h1>
      <button class="btn-refresh" @click="store.refreshRiskScores()">🔄 更新</button>
    </div>
    <p class="scope-note">v2スコープ: Plantのみ。Supplier/Warehouse/LogisticsHubはv3で追加。</p>

    <div v-if="rankedPlants.length === 0" class="empty-state">
      リスクスコアデータがありません。データ読み込みを確認してください。
    </div>
    <table v-else class="ranking-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Plant</th>
          <th>基準リスク</th>
          <th>ライブリスク</th>
          <th>売上エクスポージャー</th>
          <th>統合リスク</th>
          <th>イベント数</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in rankedPlants" :key="p.nodeId" @click="selectPlant(p.nodeId)" class="clickable">
          <td>{{ p.rank }}</td>
          <td class="name-cell">{{ p.name }}</td>
          <td class="mono">{{ p.baselineRisk.toFixed(1) }}</td>
          <td class="mono">{{ p.liveEventRisk.toFixed(3) }}</td>
          <td class="mono">{{ formatJpy(p.revenueExposure) }}</td>
          <td class="mono highlight">{{ p.combinedOperationalRisk.toFixed(3) }}</td>
          <td>{{ p.activeEventCount }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.dashboard-page { padding: var(--space-6); max-width: 1200px; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); }
.page-title { font-size: var(--text-xl); font-weight: 700; }
.btn-refresh { padding: var(--space-2) var(--space-3); border: 1px solid var(--color-gray-200); border-radius: var(--radius-sm); background: #fff; cursor: pointer; font-size: var(--text-sm); }
.btn-refresh:hover { background: var(--color-primary-50); }
.scope-note { font-size: var(--text-xs); color: var(--color-gray-700); margin-bottom: var(--space-4); }
.empty-state { padding: var(--space-8); text-align: center; color: var(--color-gray-700); }
.ranking-table { width: 100%; border-collapse: collapse; }
.ranking-table th { padding: var(--space-2) var(--space-3); text-align: left; font-size: var(--text-xs); font-weight: 600; color: var(--color-gray-700); border-bottom: 2px solid var(--color-gray-200); }
.ranking-table td { padding: var(--space-2) var(--space-3); border-bottom: 1px solid #f0f0f0; font-size: var(--text-sm); }
.clickable { cursor: pointer; transition: background var(--transition-fast); }
.clickable:hover { background: var(--color-primary-50); }
.mono { font-family: var(--font-mono); }
.name-cell { font-weight: 600; }
.highlight { color: var(--color-danger-600); font-weight: 700; }
</style>
