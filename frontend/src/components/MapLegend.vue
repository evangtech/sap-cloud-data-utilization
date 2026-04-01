<script setup lang="ts">
/**
 * 地図凡例コンポーネント - 個別選択機能付き
 */
import { ref } from 'vue';
import { useSupplyChainStore } from '@/stores/supplyChain';

const store = useSupplyChainStore();
const expandedSection = ref<'plants' | 'suppliers' | 'customers' | null>(null);

const props = defineProps<{
  visiblePlants?: Set<string>;
  visibleSuppliers?: Set<string>;
  visibleCustomers?: Set<string>;
}>();

const emit = defineEmits<{
  (e: 'toggle-plant', id: string): void;
  (e: 'toggle-supplier', id: string): void;
  (e: 'toggle-customer', id: string): void;
  (e: 'select-all-plants'): void;
  (e: 'deselect-all-plants'): void;
  (e: 'select-all-suppliers'): void;
  (e: 'deselect-all-suppliers'): void;
  (e: 'select-all-customers'): void;
  (e: 'deselect-all-customers'): void;
}>();

function toggleSection(section: 'plants' | 'suppliers' | 'customers') {
  expandedSection.value = expandedSection.value === section ? null : section;
}

function getPlantStatusClass(impactLevel: string | undefined): string {
  if (impactLevel === 'direct') return 'danger';
  if (impactLevel === 'downstream') return 'warning';
  return 'normal';
}
</script>

<template>
  <div class="legend">
    <!-- レイヤー切替（展開可能） -->
    <div class="legend-group">
      <!-- 工場 -->
      <div class="layer-section">
        <div class="layer-header" @click="toggleSection('plants')">
          <label class="layer-toggle" @click.stop>
            <input type="checkbox" :checked="store.showPlants" @change="store.togglePlants()" />
            <span class="marker plant"></span>
            <span class="label">工場</span>
            <span class="count">{{ store.plants.length }}</span>
          </label>
          <svg class="chevron" :class="{ expanded: expandedSection === 'plants' }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div v-if="expandedSection === 'plants'" class="layer-content">
          <div class="bulk-actions">
            <button @click="emit('select-all-plants')">全選択</button>
            <button @click="emit('deselect-all-plants')">全解除</button>
          </div>
          <div class="item-list">
            <label v-for="plant in store.plants" :key="plant.id" class="item-row">
              <input 
                type="checkbox" 
                :checked="props.visiblePlants?.has(plant.id) ?? true"
                @change="emit('toggle-plant', plant.id)"
              />
              <span class="marker small" :class="getPlantStatusClass(plant.impactLevel)"></span>
              <span class="item-name">{{ plant.name }}</span>
            </label>
          </div>
        </div>
      </div>

      <!-- サプライヤー -->
      <div class="layer-section">
        <div class="layer-header" @click="toggleSection('suppliers')">
          <label class="layer-toggle" @click.stop>
            <input type="checkbox" :checked="store.showSuppliers" @change="store.toggleSuppliers()" />
            <span class="marker supplier"></span>
            <span class="label">サプライヤー</span>
            <span class="count">{{ store.suppliers.length }}</span>
          </label>
          <svg class="chevron" :class="{ expanded: expandedSection === 'suppliers' }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div v-if="expandedSection === 'suppliers'" class="layer-content">
          <div class="bulk-actions">
            <button @click="emit('select-all-suppliers')">全選択</button>
            <button @click="emit('deselect-all-suppliers')">全解除</button>
          </div>
          <div class="item-list">
            <label v-for="supplier in store.suppliers" :key="supplier.id" class="item-row">
              <input 
                type="checkbox" 
                :checked="props.visibleSuppliers?.has(supplier.id) ?? true"
                @change="emit('toggle-supplier', supplier.id)"
              />
              <span class="marker small supplier"></span>
              <span class="item-name">{{ supplier.name }}</span>
            </label>
          </div>
        </div>
      </div>

      <!-- カスタマ -->
      <div class="layer-section">
        <div class="layer-header" @click="toggleSection('customers')">
          <label class="layer-toggle" @click.stop>
            <input type="checkbox" :checked="store.showCustomers" @change="store.toggleCustomers()" />
            <span class="marker customer"></span>
            <span class="label">カスタマ</span>
            <span class="count">{{ store.customers.length }}</span>
          </label>
          <svg class="chevron" :class="{ expanded: expandedSection === 'customers' }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div v-if="expandedSection === 'customers'" class="layer-content">
          <div class="bulk-actions">
            <button @click="emit('select-all-customers')">全選択</button>
            <button @click="emit('deselect-all-customers')">全解除</button>
          </div>
          <div class="item-list">
            <label v-for="customer in store.customers" :key="customer.id" class="item-row">
              <input 
                type="checkbox" 
                :checked="props.visibleCustomers?.has(customer.id) ?? true"
                @change="emit('toggle-customer', customer.id)"
              />
              <span class="marker small" :class="customer.impactLevel === 'downstream' ? 'warning' : 'customer'"></span>
              <span class="item-name">{{ customer.name }}</span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <!-- ステータス凡例 -->
    <div class="legend-group compact">
      <div class="status-row">
        <span class="marker small danger"></span>
        <span class="label-sm">直接影響</span>
      </div>
      <div class="status-row">
        <span class="marker small warning"></span>
        <span class="label-sm">下流影響</span>
      </div>
      <div class="status-row">
        <span class="marker small normal"></span>
        <span class="label-sm">正常</span>
      </div>
    </div>

    <div class="divider"></div>

    <!-- 接続線凡例 -->
    <div class="legend-group compact">
      <div class="line-row">
        <span class="line supplier-line"></span>
        <span class="label-sm">サプライヤー</span>
      </div>
      <div class="line-row">
        <span class="line customer-line"></span>
        <span class="label-sm">カスタマ</span>
      </div>
      <div class="line-row">
        <span class="line plant-line"></span>
        <span class="label-sm">工場間</span>
      </div>
      <div class="line-row">
        <span class="line impacted-line"></span>
        <span class="label-sm">影響経路</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.legend {
  background: white;
  border-top: 3px solid #1b2838;
  border-left: 1px solid #d0d5dd;
  border-right: 1px solid #d0d5dd;
  border-bottom: 1px solid #d0d5dd;
  border-radius: 0 0 4px 4px;
  padding: 12px;
  min-width: 200px;
  max-width: 260px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.legend-group {
  display: flex;
  flex-direction: column;
}

.legend-group.compact {
  gap: 6px;
}

.divider {
  height: 1px;
  background: #d0d5dd;
  margin: 10px 0;
}

/* レイヤーセクション */
.layer-section {
  margin-bottom: 4px;
}

.layer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 4px;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.layer-header:hover {
  background: #fafbfc;
}

.layer-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  cursor: pointer;
}

.layer-toggle input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: #1b2838;
  cursor: pointer;
}

.chevron {
  color: #8a8a8a;
  transition: transform 0.2s ease;
}

.chevron.expanded {
  transform: rotate(180deg);
}

/* マーカー */
.marker {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.marker.small {
  width: 10px;
  height: 10px;
}

.marker.plant {
  background: #3b82f6;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(59, 130, 246, 0.4);
}

.marker.supplier {
  background: #0891b2;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(8, 145, 178, 0.4);
  border-radius: 0;
  clip-path: polygon(50% 0%, 100% 100%, 0% 100%);
}

.marker.customer {
  background: #22c55e;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(34, 197, 94, 0.4);
  border-radius: 2px;
}

.marker.danger {
  background: #ef4444;
  border: 1.5px solid white;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.5);
}

.marker.warning {
  background: #f59e0b;
  border: 1.5px solid white;
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.5);
}

.marker.normal {
  background: #3b82f6;
  border: 1.5px solid white;
}

/* ラベル */
.label {
  font-size: 13px;
  font-weight: 700;
  color: #1a1a1a;
  flex: 1;
}

.label-sm {
  font-size: 11px;
  font-weight: 500;
  color: #4a4a4a;
}

.count {
  font-size: 10px;
  font-weight: 700;
  color: #4a4a4a;
  background: #eef1f5;
  padding: 2px 6px;
  border-radius: 3px;
  margin-left: auto;
  margin-right: 8px;
}

/* 展開コンテンツ */
.layer-content {
  padding: 8px 4px 4px 26px;
}

.bulk-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.bulk-actions button {
  font-size: 10px;
  font-weight: 700;
  color: #4a4a4a;
  background: #ffffff;
  border: 1px solid #d0d5dd;
  padding: 3px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.bulk-actions button:hover {
  background: #eef1f5;
  color: #1b2838;
}

.item-list {
  max-height: 140px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item-list::-webkit-scrollbar {
  width: 4px;
}

.item-list::-webkit-scrollbar-thumb {
  background: var(--color-gray-300);
  border-radius: 2px;
}

.item-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  cursor: pointer;
}

.item-row input[type="checkbox"] {
  width: 12px;
  height: 12px;
  accent-color: #1b2838;
}

.item-name {
  font-size: 11px;
  color: #4a4a4a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ステータス・ライン行 */
.status-row, .line-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px;
}

/* 接続線 - 実際の地図と一致 */
.line {
  width: 28px;
  height: 3px;
  border-radius: 1px;
  flex-shrink: 0;
}

/* サプライヤー線: シアン、点線 */
.line.supplier-line {
  background: repeating-linear-gradient(
    90deg,
    #0891b2 0px,
    #0891b2 5px,
    transparent 5px,
    transparent 9px
  );
}

/* カスタマ線: 緑、点線 */
.line.customer-line {
  background: repeating-linear-gradient(
    90deg,
    #22c55e 0px,
    #22c55e 5px,
    transparent 5px,
    transparent 9px
  );
}

/* 工場間線: グレー、点線 */
.line.plant-line {
  background: repeating-linear-gradient(
    90deg,
    #64748b 0px,
    #64748b 4px,
    transparent 4px,
    transparent 7px
  );
}

/* 影響経路線: 赤、実線 */
.line.impacted-line {
  
  background: repeating-linear-gradient(
    90deg,
    #ef4444 0px,
    #ef4444 5px,
    transparent 5px,
    transparent 9px
  );
}
</style>
