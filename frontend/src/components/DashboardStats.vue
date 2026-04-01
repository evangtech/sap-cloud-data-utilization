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
  gap: 18px;
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
  font-size: 18px;
  font-weight: 700;
  color: #ffffff;
  font-variant-numeric: tabular-nums;
}

.stat-value.danger {
  color: #ffb4b4;
}

.stat-value.warning {
  color: #f0d38a;
}

.stat-label {
  font-size: 11px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.56);
}

.stat-divider {
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.16);
}

.stat-item.alert {
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 3px;
}
</style>
