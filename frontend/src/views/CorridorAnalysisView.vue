<script setup lang="ts">
/**
 * /corridor-analysis — ルート分析フルページ
 * CorridorTabのフルページ版。詳細なrisky-nodes内訳とドリルダウン。
 */
import CorridorTab from '@/components/CorridorTab.vue';
</script>

<template>
  <div class="corridor-page">
    <h1 class="page-title">サプライルートリスク分析</h1>
    <p class="page-subtitle">サプライチェーンルートのチョークポイント検出と平均リスク分析</p>
    <div class="tab-container">
      <CorridorTab />
    </div>
  </div>
</template>

<style scoped>
.corridor-page {
  padding: var(--space-6);
  height: 100%;
  display: flex;
  flex-direction: column;
}
.page-title { font-size: var(--text-xl); font-weight: 700; margin-bottom: var(--space-1); flex-shrink: 0; }
.page-subtitle { font-size: var(--text-sm); color: var(--color-gray-700); margin-bottom: var(--space-4); flex-shrink: 0; }
.tab-container { flex: 1; overflow: hidden; border: 1px solid var(--color-gray-200); border-radius: var(--radius-md); }
</style>
