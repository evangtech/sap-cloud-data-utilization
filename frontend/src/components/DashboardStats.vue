<script setup lang="ts">
/**
 * ダッシュボード統計 - ヘッダー内コンパクト表示
 */
import { useSupplyChainStore } from '@/stores/supplyChain';

const store = useSupplyChainStore();
</script>

<template>
  <div class="stats-row">
    <div class="stat-item">
      <span class="stat-value">{{ store.dashboardStats.totalPlants }}</span>
      <span class="stat-label">工場</span>
    </div>
    <div class="stat-item">
      <span class="stat-value">{{ store.dashboardStats.totalSuppliers }}</span>
      <span class="stat-label">サプライヤー</span>
    </div>
    <div class="stat-item">
      <span class="stat-value">{{ store.dashboardStats.totalCustomers }}</span>
      <span class="stat-label">カスタマ</span>
    </div>
    
    <template v-if="store.dashboardStats.directlyAffectedPlants > 0 || store.dashboardStats.downstreamAffectedPlants > 0">
      <div class="stat-divider"></div>
      <div class="stat-item alert" v-if="store.dashboardStats.directlyAffectedPlants > 0">
        <span class="stat-value danger">{{ store.dashboardStats.directlyAffectedPlants }}</span>
        <span class="stat-label">直接影響</span>
      </div>
      <div class="stat-item alert" v-if="store.dashboardStats.downstreamAffectedPlants > 0">
        <span class="stat-value warning">{{ store.dashboardStats.downstreamAffectedPlants }}</span>
        <span class="stat-label">下流影響</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stats-row {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
}

.stat-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-gray-800);
  font-variant-numeric: tabular-nums;
}

.stat-value.danger {
  color: #dc2626;
}

.stat-value.warning {
  color: #d97706;
}

.stat-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-gray-500);
}

.stat-divider {
  width: 1px;
  height: 24px;
  background: var(--color-gray-300);
}

.stat-item.alert {
  padding: 4px 10px;
  background: var(--color-gray-100);
  border-radius: 6px;
}
</style>
