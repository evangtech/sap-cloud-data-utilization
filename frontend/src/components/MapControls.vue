<script setup lang="ts">
/**
 * マップコントロール — NL検索バー + ノードタイプ表示トグル5種
 * FactoryListを置換するMapView内のローカルコントロール
 */
import { useSupplyChainStore } from '@/stores/supplyChain';
import NlSearchBar from '@/components/NlSearchBar.vue';

const store = useSupplyChainStore();

const emit = defineEmits<{
  (e: 'nl-result', result: unknown): void;
  (e: 'nl-clear'): void;
}>();

const toggles = [
  { key: 'showPlants' as const, label: '工場', icon: '🏭', action: () => store.togglePlants() },
  { key: 'showSuppliers' as const, label: 'サプライヤー', icon: '🔷', action: () => store.toggleSuppliers() },
  { key: 'showCustomers' as const, label: '顧客', icon: '🟩', action: () => store.toggleCustomers() },
  { key: 'showWarehouses' as const, label: '倉庫', icon: '🟪', action: () => store.toggleWarehouses() },
  { key: 'showLogisticsHubs' as const, label: '物流拠点', icon: '⚓', action: () => store.toggleLogisticsHubs() },
];
</script>

<template>
  <div class="map-controls">
    <div class="controls-section">
      <NlSearchBar
        @result="(r: unknown) => emit('nl-result', r)"
        @clear="emit('nl-clear')"
      />
    </div>
    <div class="controls-section">
      <div class="toggle-label">表示ノード</div>
      <div class="toggle-row">
        <button
          v-for="t in toggles"
          :key="t.key"
          class="toggle-btn"
          :class="{ active: store[t.key] }"
          @click="t.action()"
          :title="t.label"
        >
          <span class="toggle-icon">{{ t.icon }}</span>
          <span class="toggle-text">{{ t.label }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.map-controls {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
}
.controls-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.toggle-label {
  font-size: var(--text-xs);
  color: var(--color-gray-700);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.toggle-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.toggle-btn {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-gray-200);
  border-radius: var(--radius-sm);
  background: #fff;
  font-size: var(--text-xs);
  cursor: pointer;
  transition: all var(--transition-fast);
  opacity: 0.5;
}
.toggle-btn.active {
  opacity: 1;
  border-color: var(--color-primary-600);
  background: var(--color-primary-50);
}
.toggle-icon { font-size: 14px; }
.toggle-text { white-space: nowrap; }
</style>
