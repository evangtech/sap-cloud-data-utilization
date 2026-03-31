<script setup lang="ts">
/**
 * 自然言語検索バー
 * Bedrockを使ってサプライチェーンを自然言語で検索・フィルタ
 */
import { ref } from 'vue';
import { executeNlQuery } from '@/services/api';
import type { NlQueryResult } from '@/services/api';

const emit = defineEmits<{
  (e: 'result', result: NlQueryResult): void;
  (e: 'clear'): void;
}>();

const query = ref('');
const isLoading = ref(false);
const lastResult = ref<NlQueryResult | null>(null);
const isExpanded = ref(false);
const showQuery = ref(false);

// サンプルクエリ
const sampleQueries = [
  '影響を受けた工場だけ表示して',
  '生産能力3000以上の工場を探して',
  '宮古島半導体工場の供給先を表示',
  'トヨタに供給している工場は？',
  '沖縄のサプライヤーを表示',
];

async function handleSearch() {
  const q = query.value.trim();
  if (!q) return;

  isLoading.value = true;
  lastResult.value = null;

  try {
    const result = await executeNlQuery(q);
    lastResult.value = result;
    emit('result', result);
  } catch (error) {
    lastResult.value = {
      type: 'error',
      description: 'クエリの実行に失敗しました',
      results: [],
    };
  } finally {
    isLoading.value = false;
  }
}

function handleSampleClick(sample: string) {
  query.value = sample;
  handleSearch();
}

function handleClear() {
  query.value = '';
  lastResult.value = null;
  isExpanded.value = false;
  showQuery.value = false;
  emit('clear');
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSearch();
  }
  if (e.key === 'Escape') {
    handleClear();
  }
}
</script>

<template>
  <div class="nl-search" :class="{ expanded: isExpanded || lastResult }">
    <!-- 検索入力 -->
    <div class="search-input-row">
      <div class="search-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.3-4.3"/>
        </svg>
      </div>
      <input
        v-model="query"
        type="text"
        class="search-input"
        placeholder="自然言語で検索... 例: 影響を受けた工場を表示"
        @keydown="handleKeydown"
        @focus="isExpanded = true"
      />
      <button
        v-if="query || lastResult"
        class="clear-btn"
        @click="handleClear"
        title="クリア"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
        </svg>
      </button>
      <button
        class="search-btn"
        :disabled="!query.trim() || isLoading"
        @click="handleSearch"
      >
        <span v-if="isLoading" class="spinner-sm"></span>
        <span v-else>検索</span>
      </button>
    </div>

    <!-- サンプルクエリ（展開時） -->
    <div v-if="isExpanded && !lastResult && !isLoading" class="sample-queries">
      <span class="sample-label">例:</span>
      <button
        v-for="sample in sampleQueries"
        :key="sample"
        class="sample-chip"
        @click="handleSampleClick(sample)"
      >
        {{ sample }}
      </button>
    </div>

    <!-- ローディング -->
    <div v-if="isLoading" class="result-status loading">
      <span class="spinner-sm"></span>
      <span>Bedrockで解析中...</span>
    </div>

    <!-- 結果表示 -->
    <div v-if="lastResult && !isLoading" class="result-status" :class="lastResult.type">
      <span class="result-icon">
        {{ lastResult.type === 'error' ? '❌' : lastResult.type === 'no_result' ? '🔎' : lastResult.type === 'filter' ? '🔍' : '📊' }}
      </span>
      <span class="result-desc">{{ lastResult.description }}</span>
      <span v-if="lastResult.type === 'cypher' && lastResult.results.length > 0" class="result-count">
        {{ lastResult.results.length }}件
      </span>
      <span v-if="lastResult.query" class="cypher-badge" :title="lastResult.query" @click="showQuery = !showQuery">
        Cypher
      </span>
    </div>
    <!-- 生成クエリ表示 -->
    <div v-if="lastResult && lastResult.query && showQuery && !isLoading" class="query-display">
      <code>{{ lastResult.query }}</code>
    </div>
  </div>
</template>

<style scoped>
.nl-search {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  transition: all 0.2s ease;
  min-width: 320px;
  max-width: 560px;
}

.nl-search.expanded {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

/* 検索入力行 */
.search-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-icon {
  color: #94a3b8;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding-left: 4px;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 13px;
  color: #1e293b;
  background: transparent;
  padding: 6px 0;
}

.search-input::placeholder {
  color: #94a3b8;
}

.clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: #94a3b8;
  border-radius: 6px;
  flex-shrink: 0;
  cursor: pointer;
  background: none;
  border: none;
  transition: all 0.15s;
}

.clear-btn:hover {
  background: #f1f5f9;
  color: #64748b;
}

.search-btn {
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  color: white;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.search-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
}

.search-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* サンプルクエリ */
.sample-queries {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 4px 4px;
  border-top: 1px solid #f1f5f9;
  margin-top: 8px;
  align-items: center;
}

.sample-label {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 500;
}

.sample-chip {
  font-size: 11px;
  color: #64748b;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  padding: 3px 10px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.sample-chip:hover {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #2563eb;
}

/* 結果ステータス */
.result-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px 2px;
  border-top: 1px solid #f1f5f9;
  margin-top: 8px;
  font-size: 12px;
}

.result-status.loading {
  color: #64748b;
}

.result-status.error {
  color: #dc2626;
}

.result-status.filter,
.result-status.cypher {
  color: #334155;
}

.result-status.no_result {
  color: #92400e;
}

.result-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.result-desc {
  flex: 1;
  line-height: 1.4;
}

.result-count {
  font-size: 11px;
  font-weight: 600;
  background: #dbeafe;
  color: #1d4ed8;
  padding: 2px 8px;
  border-radius: 6px;
  flex-shrink: 0;
}

.cypher-badge {
  font-size: 10px;
  font-weight: 600;
  background: #f0fdf4;
  color: #15803d;
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
  cursor: pointer;
}

/* 生成クエリ表示 */
.query-display {
  padding: 6px 8px;
  margin-top: 4px;
  background: #f8fafc;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.query-display code {
  font-size: 11px;
  color: #475569;
  word-break: break-all;
  white-space: pre-wrap;
  font-family: 'Consolas', 'Monaco', monospace;
}

/* スピナー */
.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid #e2e8f0;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
