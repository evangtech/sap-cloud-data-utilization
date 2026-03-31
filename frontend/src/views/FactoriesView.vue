<script setup lang="ts">
import { onMounted } from 'vue';
import { useSupplyChainStore } from '@/stores/supplyChain';

const store = useSupplyChainStore();

onMounted(async () => {
  if (store.factories.length === 0) {
    await store.loadAllData();
  }
});
</script>

<template>
  <div class="factories-view">
    <header class="header">
      <h1>工場一覧</h1>
      <router-link to="/" class="back-link">地図に戻る</router-link>
    </header>

    <div class="factories-grid">
      <div
        v-for="factory in store.factories"
        :key="factory.factoryId"
        class="factory-card"
        :class="{ affected: factory.impactLevel !== 'none' }"
      >
        <h3>{{ factory.factoryName }}</h3>
        <p class="location">{{ factory.prefecture }} {{ factory.city }}</p>
        <p class="materials">生産品目: {{ factory.materials.join(', ') }}</p>
        <div class="status-row">
          <span class="status" :class="{ active: factory.isActive }">
            {{ factory.isActive ? '稼働中' : '停止中' }}
          </span>
          <span
            v-if="factory.impactLevel !== 'none'"
            class="impact-badge"
            :class="factory.impactLevel"
          >
            {{ factory.impactLevel === 'direct' ? '直接影響' : '下流影響' }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.factories-view {
  padding: 24px;
  background: #f5f7fa;
  min-height: 100vh;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.header h1 {
  margin: 0;
}

.back-link {
  color: #007bff;
  text-decoration: none;
}

.back-link:hover {
  text-decoration: underline;
}

.factories-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.factory-card {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.factory-card.affected {
  border-left: 4px solid #dc3545;
}

.factory-card h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
}

.location {
  color: #666;
  font-size: 14px;
  margin: 4px 0;
}

.materials {
  font-size: 13px;
  color: #888;
  margin: 8px 0;
}

.status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
}

.status {
  font-size: 13px;
  color: #e6a700;
}

.status.active {
  color: #28a745;
}

.impact-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
}

.impact-badge.direct {
  background: #ffebee;
  color: #c62828;
}

.impact-badge.downstream {
  background: #fff3e0;
  color: #e65100;
}
</style>
