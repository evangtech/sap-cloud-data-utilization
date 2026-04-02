<script setup lang="ts">
/**
 * Tab 5: ノードリスト
 * 工場・サプライヤー・顧客の個別表示切替とマップフォーカス
 */
import { ref } from 'vue';
import { useSupplyChainStore } from '@/stores/supplyChain';

const store = useSupplyChainStore();

const props = defineProps<{
  visiblePlants: Set<string>;
  visibleSuppliers: Set<string>;
  visibleCustomers: Set<string>;
}>();

const emit = defineEmits<{
  (e: 'toggle-node', type: string, id: string): void;
  (e: 'select-all', type: string): void;
  (e: 'deselect-all', type: string): void;
  (e: 'focus-node', id: string): void;
}>();

const expandedSection = ref<'plants' | 'suppliers' | 'customers' | null>('plants');

function toggleSection(section: typeof expandedSection.value) {
  expandedSection.value = expandedSection.value === section ? null : section;
}

function impactClass(level: string | undefined): string {
  if (level === 'direct') return 'danger';
  if (level === 'downstream') return 'warning';
  return 'normal';
}
</script>

<template>
  <div class="node-list-tab">
    <!-- 工場 -->
    <div class="section">
      <button class="section-header" @click="toggleSection('plants')">
        <span class="section-icon">🏭</span>
        <span class="section-title">工場</span>
        <span class="section-count">{{ store.plants.length }}</span>
        <svg class="chevron" :class="{ open: expandedSection === 'plants' }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div v-if="expandedSection === 'plants'" class="section-body">
        <div class="bulk-row">
          <button class="bulk-btn" @click="emit('select-all', 'plant')">全選択</button>
          <button class="bulk-btn" @click="emit('deselect-all', 'plant')">全解除</button>
        </div>
        <div class="node-scroll">
          <div
            v-for="p in store.plants" :key="p.id"
            class="node-row"
            @click="emit('focus-node', p.id)"
          >
            <input
              type="checkbox"
              :checked="props.visiblePlants.has(p.id)"
              @click.stop
              @change="emit('toggle-node', 'plant', p.id)"
            />
            <span class="dot" :class="impactClass(p.impactLevel)"></span>
            <span class="node-name">{{ p.name }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- サプライヤー -->
    <div class="section">
      <button class="section-header" @click="toggleSection('suppliers')">
        <span class="section-icon">🔷</span>
        <span class="section-title">サプライヤー</span>
        <span class="section-count">{{ store.suppliers.length }}</span>
        <svg class="chevron" :class="{ open: expandedSection === 'suppliers' }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div v-if="expandedSection === 'suppliers'" class="section-body">
        <div class="bulk-row">
          <button class="bulk-btn" @click="emit('select-all', 'supplier')">全選択</button>
          <button class="bulk-btn" @click="emit('deselect-all', 'supplier')">全解除</button>
        </div>
        <div class="node-scroll">
          <div
            v-for="s in store.suppliers" :key="s.id"
            class="node-row"
            @click="emit('focus-node', s.id)"
          >
            <input
              type="checkbox"
              :checked="props.visibleSuppliers.has(s.id)"
              @click.stop
              @change="emit('toggle-node', 'supplier', s.id)"
            />
            <span class="dot supplier"></span>
            <span class="node-name">{{ s.name }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 顧客 -->
    <div class="section">
      <button class="section-header" @click="toggleSection('customers')">
        <span class="section-icon">🟩</span>
        <span class="section-title">顧客</span>
        <span class="section-count">{{ store.customers.length }}</span>
        <svg class="chevron" :class="{ open: expandedSection === 'customers' }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div v-if="expandedSection === 'customers'" class="section-body">
        <div class="bulk-row">
          <button class="bulk-btn" @click="emit('select-all', 'customer')">全選択</button>
          <button class="bulk-btn" @click="emit('deselect-all', 'customer')">全解除</button>
        </div>
        <div class="node-scroll">
          <div
            v-for="c in store.customers" :key="c.id"
            class="node-row"
            @click="emit('focus-node', c.id)"
          >
            <input
              type="checkbox"
              :checked="props.visibleCustomers.has(c.id)"
              @click.stop
              @change="emit('toggle-node', 'customer', c.id)"
            />
            <span class="dot" :class="c.impactLevel === 'downstream' ? 'warning' : 'customer'"></span>
            <span class="node-name">{{ c.name }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.node-list-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.section {
  border-bottom: 1px solid var(--color-gray-200);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 10px 12px;
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--color-gray-800);
  cursor: pointer;
  transition: background 0.15s ease;
}

.section-header:hover {
  background: var(--color-primary-50);
}

.section-icon {
  font-size: 14px;
}

.section-title {
  flex: 1;
  text-align: left;
}

.section-count {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-gray-600);
  background: var(--color-gray-100);
  padding: 1px 6px;
  border-radius: 3px;
}

.chevron {
  color: var(--color-gray-400);
  transition: transform 0.2s ease;
}

.chevron.open {
  transform: rotate(180deg);
}

.section-body {
  padding: 0 12px 10px;
}

.bulk-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.bulk-btn {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-gray-600);
  background: #fff;
  border: 1px solid var(--color-gray-200);
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.bulk-btn:hover {
  background: var(--color-primary-50);
  color: var(--color-gray-800);
}

.node-scroll {
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.node-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.1s ease;
}

.node-row:hover {
  background: var(--color-primary-50);
}

.node-row input[type="checkbox"] {
  width: 12px;
  height: 12px;
  accent-color: #1b2838;
  cursor: pointer;
  flex-shrink: 0;
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
.dot.supplier { background: #0891b2; }
.dot.customer { background: #22c55e; }

.node-name {
  font-size: 11px;
  color: var(--color-gray-800);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
</style>
