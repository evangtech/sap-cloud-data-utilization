<script setup lang="ts">
/**
 * ノードリストコンポーネント - サイドバー用
 * 工場・サプライヤー・カスタマを統合表示
 */
import { ref, computed } from 'vue';
import { useSupplyChainStore } from '@/stores/supplyChain';
import type { Plant } from '@/types';

const store = useSupplyChainStore();

const emit = defineEmits<{
  (e: 'select-plant', plant: Plant): void;
  (e: 'focus-node', nodeId: string): void;
}>();

// ノードの統合型
interface NodeItem {
  id: string;
  name: string;
  type: 'plant' | 'supplier' | 'customer';
  subtitle: string;
  impactLevel: string;
}

// ローカルフィルタ・ページネーション
const filterTab = ref<'all' | 'affected'>('all');
const currentPage = ref(1);
const itemsPerPage = 10;

// 全ノードを統合
const allNodes = computed<NodeItem[]>(() => {
  const nodes: NodeItem[] = [];

  store.plants.forEach((p) => {
    nodes.push({
      id: p.id,
      name: p.name,
      type: 'plant',
      subtitle: p.locationName,
      impactLevel: p.impactLevel || 'none',
    });
  });

  store.suppliers.forEach((s) => {
    nodes.push({
      id: s.id,
      name: s.name,
      type: 'supplier',
      subtitle: `${s.country} / ${s.region}`,
      impactLevel: s.impactLevel || 'none',
    });
  });

  store.customers.forEach((c) => {
    nodes.push({
      id: c.id,
      name: c.name,
      type: 'customer',
      subtitle: c.industry,
      impactLevel: c.impactLevel || 'none',
    });
  });

  return nodes;
});

// フィルタ済みノード
const filteredNodes = computed(() => {
  if (filterTab.value === 'all') return allNodes.value;
  return allNodes.value.filter(
    (n) => n.impactLevel === 'direct' || n.impactLevel === 'downstream'
  );
});

// 影響ノード数
const affectedCount = computed(() =>
  allNodes.value.filter((n) => n.impactLevel === 'direct' || n.impactLevel === 'downstream').length
);

// ページネーション
const totalPages = computed(() => Math.ceil(filteredNodes.value.length / itemsPerPage) || 1);

const paginatedNodes = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage;
  return filteredNodes.value.slice(start, start + itemsPerPage);
});

function setTab(tab: 'all' | 'affected') {
  filterTab.value = tab;
  currentPage.value = 1;
}

function prevPage() {
  if (currentPage.value > 1) currentPage.value--;
}

function nextPage() {
  if (currentPage.value < totalPages.value) currentPage.value++;
}

function handleNodeClick(node: NodeItem) {
  // 全ノードタイプで地図フォーカス
  emit('focus-node', node.id);
  
  if (node.type === 'plant') {
    const plant = store.plants.find((p) => p.id === node.id);
    if (plant) {
      store.selectPlant(plant);
      emit('select-plant', plant);
    }
  }
}

// カードインジケーターのクラス
function getIndicatorClass(node: NodeItem): string {
  if (node.impactLevel === 'direct') return 'danger';
  if (node.impactLevel === 'downstream') return 'warning';
  // 通常時はノードタイプ別の色
  return node.type;
}

// ステータスバッジ
function getStatusClass(node: NodeItem): string {
  if (node.impactLevel === 'direct') return 'danger';
  if (node.impactLevel === 'downstream') return 'warning';
  return node.type;
}

function getStatusText(node: NodeItem): string {
  if (node.impactLevel === 'direct') return '直接影響';
  if (node.impactLevel === 'downstream') return '下流影響';
  if (node.type === 'plant') return '正常';
  if (node.type === 'supplier') return 'サプライヤー';
  return 'カスタマ';
}

// ノードタイプアイコン
function getTypeIcon(type: string): string {
  if (type === 'plant') return '🏭';
  if (type === 'supplier') return '📦';
  return '🏢';
}
</script>

<template>
  <div class="node-panel">
    <!-- ヘッダー -->
    <div class="panel-header">
      <div class="header-title">
        <h2>ノード一覧</h2>
      </div>
      <div class="header-badge">{{ allNodes.length }}</div>
    </div>

    <!-- タブ -->
    <div class="tabs">
      <button
        class="tab"
        :class="{ active: filterTab === 'all' }"
        @click="setTab('all')"
      >
        <span class="tab-text">すべて</span>
        <span class="tab-count">{{ allNodes.length }}</span>
      </button>
      <button
        class="tab"
        :class="{ active: filterTab === 'affected', alert: affectedCount > 0 }"
        @click="setTab('affected')"
      >
        <span class="tab-text">影響あり</span>
        <span class="tab-count" :class="{ alert: affectedCount > 0 }">{{ affectedCount }}</span>
      </button>
    </div>

    <!-- リスト -->
    <div class="node-list">
      <div
        v-for="node in paginatedNodes"
        :key="node.id"
        class="node-card"
        :class="{
          danger: node.impactLevel === 'direct',
          warning: node.impactLevel === 'downstream',
        }"
        @click="handleNodeClick(node)"
      >
        <div class="card-indicator" :class="getIndicatorClass(node)"></div>
        <div class="card-content">
          <div class="card-header">
            <span class="node-name">
              <span class="type-icon">{{ getTypeIcon(node.type) }}</span>
              {{ node.name }}
            </span>
            <span class="status-badge" :class="getStatusClass(node)">
              {{ getStatusText(node) }}
            </span>
          </div>
          <div class="node-subtitle">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            {{ node.subtitle }}
          </div>
        </div>
      </div>

      <div v-if="paginatedNodes.length === 0" class="empty-state">
        <span class="empty-icon">🔍</span>
        <span>該当するノードがありません</span>
      </div>
    </div>

    <!-- ページネーション -->
    <div class="pagination">
      <button class="page-btn" :disabled="currentPage === 1" @click="prevPage()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <div class="page-info">
        <span class="page-current">{{ currentPage }}</span>
        <span class="page-sep">/</span>
        <span class="page-total">{{ totalPages }}</span>
      </div>
      <button class="page-btn" :disabled="currentPage >= totalPages" @click="nextPage()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.node-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
}

/* ヘッダー */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  background: linear-gradient(135deg, #1e293b 0%, #4e6990 100%);
  border-radius: 4px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}

.panel-header h2 {
  font-size: 15px;
  font-weight: 600;
  color: white;
  letter-spacing: -0.01em;
}

.header-badge {
  font-size: 13px;
  font-weight: 700;
  color: white;
  background: rgba(255,255,255,0.15);
  padding: 4px 12px;
  border-radius: 12px;
  backdrop-filter: blur(4px);
}

/* タブ */
.tabs {
  display: flex;
  padding: 12px 14px;
  gap: 8px;
  background: white;
  border-bottom: 1px solid var(--color-border-light);
}

.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-gray-500);
  background: var(--color-gray-50);
  border: 1px solid var(--color-gray-200);
  border-radius: 10px;
  transition: all 0.2s ease;
}

.tab:hover {
  background: var(--color-gray-100);
  color: var(--color-gray-700);
}

.tab.active {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  border-color: transparent;
  color: white;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.tab.active.alert {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
}

.tab-count {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  background: rgba(0,0,0,0.08);
  border-radius: 8px;
}

.tab.active .tab-count {
  background: rgba(255,255,255,0.25);
}

.tab-count.alert {
  background: rgba(239, 68, 68, 0.15);
  color: var(--color-danger-600);
}

/* リスト */
.node-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.node-card {
  display: flex;
  align-items: stretch;
  margin-bottom: 10px;
  background: white;
  border: 1px solid var(--color-gray-200);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

.node-card:hover {
  border-color: var(--color-gray-300);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  transform: translateY(-1px);
}

.node-card.danger { border-left: none; }
.node-card.warning { border-left: none; }

/* カードインジケーター（左端の色帯） */
.card-indicator {
  width: 4px;
  flex-shrink: 0;
}

/* ノードタイプ別の通常色 */
.card-indicator.plant {
  background: linear-gradient(180deg, #3b82f6, #2563eb);
}

.card-indicator.supplier {
  background: linear-gradient(180deg, #0891b2, #0e7490);
}

.card-indicator.customer {
  background: linear-gradient(180deg, #22c55e, #16a34a);
}

/* 影響状態の色（タイプより優先） */
.card-indicator.danger {
  background: linear-gradient(180deg, #ef4444, #dc2626);
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.4);
}

.card-indicator.warning {
  background: linear-gradient(180deg, #f59e0b, #d97706);
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);
}

.card-content {
  flex: 1;
  padding: 12px 14px;
  min-width: 0;
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.node-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-gray-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.type-icon {
  font-size: 14px;
  flex-shrink: 0;
}

/* ステータスバッジ */
.status-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.status-badge.plant {
  background: linear-gradient(135deg, #dbeafe, #bfdbfe);
  color: #1d4ed8;
}

.status-badge.supplier {
  background: linear-gradient(135deg, #ecfeff, #cffafe);
  color: #0e7490;
}

.status-badge.customer {
  background: linear-gradient(135deg, #dcfce7, #bbf7d0);
  color: #15803d;
}

.status-badge.danger {
  background: linear-gradient(135deg, #fee2e2, #fecaca);
  color: #b91c1c;
}

.status-badge.warning {
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  color: #b45309;
}

.node-subtitle {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--color-gray-500);
}

.node-subtitle svg {
  color: var(--color-gray-400);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  color: var(--color-gray-400);
  font-size: 13px;
}

.empty-icon {
  font-size: 28px;
  opacity: 0.6;
}

/* ページネーション */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 14px;
  background: white;
  border-top: 1px solid var(--color-border-light);
}

.page-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  color: var(--color-gray-600);
  background: var(--color-gray-50);
  border: 1px solid var(--color-gray-200);
  border-radius: 10px;
  transition: all 0.2s ease;
}

.page-btn:hover:not(:disabled) {
  background: var(--color-gray-100);
  border-color: var(--color-gray-300);
  color: var(--color-gray-900);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.page-current {
  font-weight: 700;
  color: var(--color-gray-900);
}

.page-sep {
  color: var(--color-gray-400);
}

.page-total {
  color: var(--color-gray-500);
}
</style>
