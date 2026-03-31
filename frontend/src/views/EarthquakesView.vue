<script setup lang="ts">
/**
 * Earthquakes View
 * Shows list of earthquake events and their impact
 */
</script>

<template>
  <div class="earthquakes-view">
    <header class="header">
      <h1>地震イベント一覧</h1>
      <router-link to="/" class="back-link">地図に戻る</router-link>
    </header>

    <div class="placeholder">
      <p>地震イベントデータは準備中です</p>
      <p class="hint">S3から地震データを取得して表示します</p>
    </div>
  </div>
</template>

<style scoped>
.earthquakes-view {
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

.placeholder {
  background: white;
  padding: 48px;
  border-radius: 8px;
  text-align: center;
  color: #666;
}

.hint {
  font-size: 14px;
  color: #999;
  margin-top: 8px;
}
</style>
