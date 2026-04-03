<script setup lang="ts">
/**
 * 右パネルシェル — 折りたたみ/展開、リサイズ可能、4タブ
 * 幅とアクティブタブを localStorage に記憶
 */
import { ref, onMounted, watch } from 'vue';
import { useSupplyChainStore } from '@/stores/supplyChain';

const store = useSupplyChainStore();

const STORAGE_KEY = 'riskPanel';
const MIN_WIDTH = 300;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 400;

const isExpanded = ref(true);
const panelWidth = ref(DEFAULT_WIDTH);
const activeTab = ref<'events' | 'impacts' | 'corridors' | 'recovery' | 'nodes'>('events');
const isResizing = ref(false);

const emit = defineEmits<{
  (e: 'tab-change', tab: string): void;
}>();

onMounted(() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const state = JSON.parse(saved);
      panelWidth.value = Math.min(Math.max(state.width || DEFAULT_WIDTH, MIN_WIDTH), MAX_WIDTH);
      activeTab.value = state.tab || 'events';
      isExpanded.value = state.expanded !== false;
    }
  } catch { /* 無視 */ }
});

watch([panelWidth, activeTab, isExpanded], () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    width: panelWidth.value,
    tab: activeTab.value,
    expanded: isExpanded.value,
  }));
});

function setTab(tab: typeof activeTab.value) {
  activeTab.value = tab;
  if (!isExpanded.value) isExpanded.value = true;
  emit('tab-change', tab);
}

function openTab(tab: string) {
  setTab(tab as typeof activeTab.value);
}

function startResize(e: MouseEvent) {
  isResizing.value = true;
  const startX = e.clientX;
  const startWidth = panelWidth.value;

  function onMove(ev: MouseEvent) {
    const delta = startX - ev.clientX;
    panelWidth.value = Math.min(Math.max(startWidth + delta, MIN_WIDTH), MAX_WIDTH);
  }
  function onUp() {
    isResizing.value = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

defineExpose({ openTab });

const tabs = [
  { id: 'events' as const, label: 'イベント' },
  { id: 'impacts' as const, label: 'インパクト' },
  { id: 'corridors' as const, label: 'ルート' },
  { id: 'recovery' as const, label: '復旧' },
  { id: 'nodes' as const, label: 'ノード' },
];
</script>

<template>
  <div
    class="risk-panel"
    :class="{ collapsed: !isExpanded, resizing: isResizing }"
    :style="{ width: isExpanded ? `${panelWidth}px` : '40px' }"
  >
    <!-- 折りたたみバー -->
    <div v-if="!isExpanded" class="collapsed-bar" @click="isExpanded = true">
      <span class="collapsed-badge" v-if="store.riskDashboardStats.activeEventCount > 0">
        {{ store.riskDashboardStats.activeEventCount }}
      </span>
      <span class="collapsed-label">リスク</span>
    </div>

    <!-- 展開パネル -->
    <template v-else>
      <div class="resize-handle" @mousedown="startResize"></div>

      <div class="panel-header">
        <div class="tab-row">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="tab-btn"
            :class="{ active: activeTab === tab.id }"
            @click="setTab(tab.id)"
          >
            <span class="tab-label">{{ tab.label }}</span>
          </button>
        </div>
        <button class="collapse-btn" @click="isExpanded = false" title="折りたたむ">
          ›
        </button>
      </div>

      <div class="panel-content">
        <slot :name="activeTab"></slot>
      </div>
    </template>
  </div>
</template>

<style scoped>
.risk-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-left: 1px solid var(--color-gray-200);
  transition: width var(--transition-base);
  overflow: hidden;
  flex-shrink: 0;
}
.risk-panel.resizing { transition: none; user-select: none; }
.risk-panel.collapsed { cursor: pointer; }

.collapsed-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding-top: var(--space-4);
  width: 40px;
}
.collapsed-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #ef4444;
  color: #fff;
  font-size: var(--text-xs);
  font-weight: 700;
}
.collapsed-label {
  writing-mode: vertical-rl;
  font-size: var(--text-xs);
  color: var(--color-gray-700);
  letter-spacing: 0.1em;
}

.resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
}
.resize-handle:hover { background: rgba(59,130,246,0.3); }

.panel-header {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--color-gray-200);
  padding: 0 var(--space-1);
  height: 40px;
  flex-shrink: 0;
  min-width: 0;
}
.tab-row {
  display: flex;
  flex: 1;
  gap: 0;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.tab-row::-webkit-scrollbar {
  display: none;
}
.tab-btn {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-2);
  border: none;
  background: transparent;
  font-size: var(--text-xs);
  color: var(--color-gray-700);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all var(--transition-fast);
  white-space: nowrap;
  flex: 0 0 auto;
}
.tab-btn:hover { color: var(--color-primary-600); }
.tab-btn.active {
  color: var(--color-primary-700);
  border-bottom-color: var(--color-primary-700);
  font-weight: 600;
}

.collapse-btn {
  border: none;
  background: transparent;
  font-size: 18px;
  color: var(--color-gray-700);
  cursor: pointer;
  padding: var(--space-1);
  line-height: 1;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
