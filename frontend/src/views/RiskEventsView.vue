<script setup lang="ts">
/**
 * /risk-events — リスクイベント全ページ管理
 * RiskEventTabのフルページ版。アナリストの一括レビュー用メイン画面。
 */
import RiskEventTab from '@/components/RiskEventTab.vue';
</script>

<template>
  <div class="risk-events-page">
    <h1 class="page-title">リスクイベント管理</h1>
    <p class="page-subtitle">全リスクイベントの一覧表示、フィルタリング、レビューアクション</p>
    <div class="tab-container">
      <RiskEventTab />
    </div>
  </div>
</template>

<style scoped>
.risk-events-page {
  padding: var(--space-6);
  height: 100%;
  display: flex;
  flex-direction: column;
}
.page-title { font-size: var(--text-xl); font-weight: 700; margin-bottom: var(--space-1); flex-shrink: 0; }
.page-subtitle { font-size: var(--text-sm); color: var(--color-gray-700); margin-bottom: var(--space-4); flex-shrink: 0; }
.tab-container { flex: 1; overflow: hidden; border: 1px solid var(--color-gray-200); border-radius: var(--radius-md); }
</style>
