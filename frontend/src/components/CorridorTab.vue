<script setup lang="ts">
/**
 * Tab 3: ルート分析
 * CorridorRiskテーブル + マップ連動ハイライト（BFSパス復元はストア側）
 */
import { onMounted, ref } from 'vue';
import { useSupplyChainStore } from '@/stores/supplyChain';

const store = useSupplyChainStore();
const selectedIndex = ref<number | null>(null);

onMounted(() => {
  if (store.corridorRisks.length === 0) store.loadCorridorRisks();
});

function selectCorridor(index: number) {
  if (selectedIndex.value === index) {
    selectedIndex.value = null;
    store.clearCorridorHighlight();
    return;
  }
  selectedIndex.value = index;
  const c = store.corridorRisks[index];
  store.highlightCorridor(c.origin.id, c.destination.id);
}

function fmt(val: number) { return val.toFixed(2); }
</script>

<template>
  <div class="corridor-tab">
    <div v-if="store.corridorLoading" class="state-msg">ルートリスクを分析中...</div>
    <div v-else-if="store.corridorRisks.length === 0" class="state-msg">ルートリスクデータがありません</div>
    <table v-else class="corridor-table">
      <thead>
        <tr><th>起点</th><th>終点</th><th>チョーク</th><th>平均</th><th>ホップ</th></tr>
      </thead>
      <tbody>
        <tr
          v-for="(c, idx) in store.corridorRisks" :key="idx"
          :class="{ selected: selectedIndex === idx }"
          @click="selectCorridor(idx)"
        >
          <td>{{ c.origin.name }}</td>
          <td>{{ c.destination.name }}</td>
          <td class="mono">{{ fmt(c.chokePointScore) }}</td>
          <td class="mono">{{ fmt(c.avgRouteRisk) }}</td>
          <td class="mono">{{ c.hops }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="selectedIndex !== null && store.corridorRisks[selectedIndex]" class="detail">
      <div class="detail-label">危険ノード</div>
      <div v-for="n in store.corridorRisks[selectedIndex].riskyNodes" :key="n.name" class="risky-node">
        <span>{{ n.name }}</span>
        <span class="mono">risk: {{ n.risk.toFixed(2) }}</span>
      </div>
      <div class="scope-note">v2: Plantのみスコア有。Warehouse等はrisk=0。</div>
    </div>
  </div>
</template>

<style scoped>
.corridor-tab { overflow-y: auto; height: 100%; }
.state-msg { padding: var(--space-8); text-align: center; color: var(--color-gray-700); font-size: var(--text-sm); }
.corridor-table { width: 100%; border-collapse: collapse; font-size: var(--text-xs); }
.corridor-table th { padding: var(--space-2); text-align: left; font-weight: 600; border-bottom: 2px solid var(--color-gray-200); color: var(--color-gray-700); position: sticky; top: 0; background: #fff; }
.corridor-table td { padding: var(--space-2); border-bottom: 1px solid #f0f0f0; }
.corridor-table tr { cursor: pointer; transition: background var(--transition-fast); }
.corridor-table tr:hover { background: var(--color-primary-50); }
.corridor-table tr.selected { background: rgba(59,130,246,0.08); }
.mono { font-family: var(--font-mono); }
.detail { padding: var(--space-3); border-top: 1px solid var(--color-gray-200); }
.detail-label { font-size: var(--text-xs); font-weight: 600; color: var(--color-gray-700); margin-bottom: var(--space-1); }
.risky-node { display: flex; justify-content: space-between; font-size: var(--text-xs); padding: var(--space-1) 0; }
.scope-note { font-size: 10px; color: var(--color-gray-700); font-style: italic; margin-top: var(--space-2); }
</style>
