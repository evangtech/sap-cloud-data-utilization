<script setup lang="ts">
/**
 * 通知一覧ビュー（リデザイン版）
 * リスクイベント通知の一覧表示・フィルタ・ステータス変更・バッチ操作
 */
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useNotificationStore } from '@/stores/notification';
import type { RiskEvent } from '@/types';

const router = useRouter();
const store = useNotificationStore();

// ========================================
// 定数定義
// ========================================

/** ステータスタブ定義 */
const STATUS_TABS = [
  { value: null, label: '全件' },
  { value: 'CONFIRMED', label: '確認済み' },
  { value: 'PENDING', label: '保留中' },
  { value: 'WATCHING', label: '監視中' },
  { value: 'DISMISSED', label: '却下' },
] as const;

/** ステータス表示設定 */
const STATUS_CONFIG: Record<string, { label: string; class: string }> = {
  CONFIRMED: { label: '確認済み', class: 'status--confirmed' },
  PENDING: { label: '保留中', class: 'status--pending' },
  WATCHING: { label: '監視中', class: 'status--watching' },
  DISMISSED: { label: '却下', class: 'status--dismissed' },
};

/** カテゴリ設定 */
const CATEGORY_CONFIG: Record<string, { label: string }> = {
  earthquake: { label: '地震' },
  flood: { label: '洪水' },
  fire: { label: '火災' },
  traffic: { label: '交通' },
  infra: { label: 'インフラ' },
  labor: { label: '労働' },
  geopolitics: { label: '地政学' },
  pandemic: { label: 'パンデミック' },
};

/** ステータス選択肢 */
const STATUS_OPTIONS = ['CONFIRMED', 'PENDING', 'WATCHING', 'DISMISSED'];

/** ノードタイプアイコン */
const NODE_TYPE_LABELS: Record<string, string> = {
  plant: '工場',
  warehouse: '倉庫',
  supplier: '供給元',
  port: '港湾',
  road: '輸送',
};

/** 1ページあたりの表示件数 */
const PAGE_SIZE = 12;

// ========================================
// ローカル状態
// ========================================
const selectedIds = ref<Set<string>>(new Set());
const expandedId = ref<string | null>(null);
const currentPage = ref(1);
const riskLevelFilter = ref<number | null>(null);
const categoryFilter = ref<string | null>(null);

// ========================================
// 算出プロパティ
// ========================================
const filteredEvents = computed<RiskEvent[]>(() => {
  let result = store.events;
  if (riskLevelFilter.value !== null) {
    result = result.filter((e) => e.risk_level === riskLevelFilter.value);
  }
  if (categoryFilter.value !== null) {
    result = result.filter((e) => e.category_id === categoryFilter.value);
  }
  return result;
});

const totalPages = computed(() => Math.ceil(filteredEvents.value.length / PAGE_SIZE));

const pagedEvents = computed<RiskEvent[]>(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return filteredEvents.value.slice(start, start + PAGE_SIZE);
});

const showPagination = computed(() => filteredEvents.value.length > PAGE_SIZE);

const isAllSelected = computed(() => {
  if (pagedEvents.value.length === 0) return false;
  return pagedEvents.value.every((e) => selectedIds.value.has(e.event_id));
});

const selectedCount = computed(() => selectedIds.value.size);

const totalCount = computed(() => filteredEvents.value.length);

// ========================================
// メソッド
// ========================================
async function onTabChange(status: string | null) {
  currentPage.value = 1;
  selectedIds.value.clear();
  expandedId.value = null;
  await store.setFilter(status);
}

function onRiskLevelChange(level: number | null) {
  riskLevelFilter.value = level;
  currentPage.value = 1;
}

function onCategoryChange(event: Event) {
  const val = (event.target as HTMLSelectElement).value;
  categoryFilter.value = val || null;
  currentPage.value = 1;
}

function toggleExpand(eventId: string) {
  expandedId.value = expandedId.value === eventId ? null : eventId;
}

function toggleSelect(eventId: string, event: Event) {
  event.stopPropagation();
  if (selectedIds.value.has(eventId)) {
    selectedIds.value.delete(eventId);
  } else {
    selectedIds.value.add(eventId);
  }
}

function toggleSelectAll() {
  if (isAllSelected.value) {
    pagedEvents.value.forEach((e) => selectedIds.value.delete(e.event_id));
  } else {
    pagedEvents.value.forEach((e) => selectedIds.value.add(e.event_id));
  }
}

async function onStatusChange(eventId: string, newStatus: string) {
  await store.changeStatus(eventId, newStatus);
}

async function batchDismiss() {
  if (selectedIds.value.size === 0) return;
  await store.batchDismiss(Array.from(selectedIds.value));
  selectedIds.value.clear();
}

function goToPage(page: number) {
  if (page < 1 || page > totalPages.value) return;
  currentPage.value = page;
  expandedId.value = null;
}

function navigateToNode(nodeType: string, nodeId: string) {
  router.push(`/node/${nodeType}/${nodeId}`);
}

function goBack() {
  router.push('/');
}

function formatDateTime(isoStr?: string): string {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRelativeTime(isoStr?: string): string {
  if (!isoStr) return '';
  const now = Date.now();
  const diff = now - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}分前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  return `${days}日前`;
}

function getCategoryConfig(categoryId: string) {
  return CATEGORY_CONFIG[categoryId] || { label: categoryId };
}

function getNodeTypeLabel(nodeType: string): string {
  return NODE_TYPE_LABELS[nodeType] || nodeType;
}

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] || { label: status, class: '' };
}

function getTabCount(tabValue: string | null): number {
  if (tabValue === null) {
    // 全件タブ: 各ステータスの件数合計を使用
    return store.counts.confirmed + store.counts.pending + store.counts.watching + store.counts.dismissed;
  }
  const key = tabValue.toLowerCase() as keyof typeof store.counts;
  return store.counts[key] ?? 0;
}

const pageNumbers = computed<(number | string)[]>(() => {
  const total = totalPages.value;
  const current = currentPage.value;
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | string)[] = [1];
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
});

// ========================================
// ライフサイクル
// ========================================
onMounted(async () => {
  await Promise.all([store.loadEvents(), store.loadCounts()]);
});

watch([riskLevelFilter, categoryFilter], () => {
  currentPage.value = 1;
});
</script>

<template>
  <div class="nv">
    <!-- サイドバー -->
    <aside class="nv-sidebar">
      <div class="nv-sidebar__header">
        <button class="nv-back" @click="goBack" aria-label="地図に戻る">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div class="nv-brand">
          <span class="nv-brand__text">リスク通知</span>
        </div>
      </div>

      <!-- ステータスナビ -->
      <nav class="nv-nav">
        <button
          v-for="tab in STATUS_TABS"
          :key="tab.label"
          class="nv-nav__item"
          :class="{ 'nv-nav__item--active': store.currentStatus === tab.value }"
          @click="onTabChange(tab.value)"
        >
          <span class="nv-nav__label">{{ tab.label }}</span>
          <span class="nv-nav__count">{{ getTabCount(tab.value) }}</span>
        </button>
      </nav>

      <!-- サマリーカード -->
      <div class="nv-summary">
        <div class="nv-summary__title">リスクサマリー</div>
        <div class="nv-summary__grid">
          <div class="nv-summary__item nv-summary__item--danger">
            <span class="nv-summary__num">{{ store.counts.confirmed }}</span>
            <span class="nv-summary__label">確認済み</span>
          </div>
          <div class="nv-summary__item nv-summary__item--warning">
            <span class="nv-summary__num">{{ store.counts.pending }}</span>
            <span class="nv-summary__label">保留中</span>
          </div>
          <div class="nv-summary__item nv-summary__item--info">
            <span class="nv-summary__num">{{ store.counts.watching }}</span>
            <span class="nv-summary__label">監視中</span>
          </div>
          <div class="nv-summary__item nv-summary__item--muted">
            <span class="nv-summary__num">{{ store.counts.dismissed }}</span>
            <span class="nv-summary__label">却下</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- メインコンテンツ -->
    <main class="nv-main">
      <!-- ツールバー -->
      <div class="nv-toolbar">
        <div class="nv-toolbar__left">
          <h1 class="nv-toolbar__title">
            {{ STATUS_TABS.find(t => t.value === store.currentStatus)?.label || '全件' }}
            <span class="nv-toolbar__total">{{ totalCount }}件</span>
          </h1>
        </div>
        <div class="nv-toolbar__right">
          <!-- リスクレベルフィルタ（ピル型） -->
          <div class="nv-risk-pills">
            <button
              class="nv-risk-pill"
              :class="{ 'nv-risk-pill--active': riskLevelFilter === null }"
              @click="onRiskLevelChange(null)"
            >全て</button>
            <button
              class="nv-risk-pill nv-risk-pill--high"
              :class="{ 'nv-risk-pill--active': riskLevelFilter === 3 }"
              @click="onRiskLevelChange(3)"
            >Lv3</button>
            <button
              class="nv-risk-pill nv-risk-pill--mid"
              :class="{ 'nv-risk-pill--active': riskLevelFilter === 2 }"
              @click="onRiskLevelChange(2)"
            >Lv2</button>
            <button
              class="nv-risk-pill nv-risk-pill--low"
              :class="{ 'nv-risk-pill--active': riskLevelFilter === 1 }"
              @click="onRiskLevelChange(1)"
            >Lv1</button>
          </div>

          <select class="nv-select" @change="onCategoryChange" :value="categoryFilter ?? ''">
            <option value="">カテゴリ: 全て</option>
            <option v-for="(cfg, key) in CATEGORY_CONFIG" :key="key" :value="key">
              {{ cfg.label }}
            </option>
          </select>
        </div>
      </div>

      <!-- バッチ操作バー -->
      <transition name="batch-bar">
        <div v-if="selectedCount > 0" class="nv-batch">
          <div class="nv-batch__info">
            <span class="nv-batch__count">{{ selectedCount }}</span>件選択中
          </div>
          <div class="nv-batch__actions">
            <button class="nv-batch__btn nv-batch__btn--dismiss" @click="batchDismiss">
              一括却下
            </button>
            <button class="nv-batch__btn nv-batch__btn--clear" @click="selectedIds.clear()">
              選択解除
            </button>
          </div>
        </div>
      </transition>

      <!-- ローディング -->
      <div v-if="store.isLoading" class="nv-loading">
        <div class="nv-loading__spinner"></div>
        <p class="nv-loading__text">データを読み込み中...</p>
      </div>

      <!-- エラー -->
      <div v-else-if="store.error" class="nv-error">
        <p class="nv-error__text">{{ store.error }}</p>
        <button class="nv-error__retry" @click="store.loadEvents()">再試行</button>
      </div>

      <!-- イベントリスト -->
      <div v-else class="nv-list">
        <!-- ヘッダー行 -->
        <div class="nv-list__header">
          <label class="nv-check" @click.stop>
            <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll" aria-label="全選択" />
            <span class="nv-check__box"></span>
          </label>
          <span class="nv-list__col nv-list__col--status">ステータス</span>
          <span class="nv-list__col nv-list__col--risk">リスク</span>
          <span class="nv-list__col nv-list__col--category">カテゴリ</span>
          <span class="nv-list__col nv-list__col--summary">摘要</span>
          <span class="nv-list__col nv-list__col--nodes">関連ノード</span>
          <span class="nv-list__col nv-list__col--time">日時</span>
          <span class="nv-list__col nv-list__col--action">操作</span>
        </div>

        <!-- イベント行 -->
        <template v-for="evt in pagedEvents" :key="evt.event_id">
          <div
            class="nv-row"
            :class="{
              'nv-row--expanded': expandedId === evt.event_id,
              'nv-row--selected': selectedIds.has(evt.event_id),
            }"
            @click="toggleExpand(evt.event_id)"
          >
            <label class="nv-check" @click.stop>
              <input
                type="checkbox"
                :checked="selectedIds.has(evt.event_id)"
                @change="toggleSelect(evt.event_id, $event)"
                :aria-label="`${evt.event_id}を選択`"
              />
              <span class="nv-check__box"></span>
            </label>

            <!-- ステータス -->
            <span class="nv-list__col nv-list__col--status">
              <span class="nv-status" :class="getStatusConfig(evt.status).class">
                {{ getStatusConfig(evt.status).label }}
              </span>
            </span>

            <!-- リスクレベル -->
            <span class="nv-list__col nv-list__col--risk">
              <span v-if="evt.risk_level" class="nv-risk" :class="`nv-risk--${evt.risk_level}`">
                {{ evt.risk_level }}
              </span>
            </span>

            <!-- カテゴリ -->
            <span class="nv-list__col nv-list__col--category">
              <span class="nv-category">{{ getCategoryConfig(evt.category_id).label }}</span>
            </span>

            <!-- 摘要 -->
            <span class="nv-list__col nv-list__col--summary">
              <span class="nv-summary-text">{{ evt.summary || '-' }}</span>
            </span>

            <!-- 関連ノード -->
            <span class="nv-list__col nv-list__col--nodes" @click.stop>
              <template v-if="evt.related_nodes && evt.related_nodes.length > 0">
                <span
                  v-for="node in evt.related_nodes.slice(0, 2)"
                  :key="node.id"
                  class="nv-node-chip"
                  @click="navigateToNode(node.node_type, node.id)"
                >
                  <span class="nv-node-chip__type">{{ getNodeTypeLabel(node.node_type) }}</span>
                  <span>{{ node.name }}</span>
                </span>
                <span v-if="evt.related_nodes.length > 2" class="nv-node-more">
                  +{{ evt.related_nodes.length - 2 }}
                </span>
              </template>
              <span v-else class="nv-empty">-</span>
            </span>

            <!-- 日時 -->
            <span class="nv-list__col nv-list__col--time">
              <span class="nv-time">{{ formatRelativeTime(evt.created_at) }}</span>
              <span class="nv-time-full">{{ formatDateTime(evt.created_at) }}</span>
            </span>

            <!-- 操作 -->
            <span class="nv-list__col nv-list__col--action" @click.stop>
              <select
                class="nv-action-select"
                :value="evt.status"
                @change="onStatusChange(evt.event_id, ($event.target as HTMLSelectElement).value)"
                aria-label="ステータス変更"
              >
                <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">
                  {{ STATUS_CONFIG[s]?.label || s }}
                </option>
              </select>
            </span>

            <!-- 展開アイコン -->
            <span class="nv-row__chevron" :class="{ 'nv-row__chevron--open': expandedId === evt.event_id }">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </span>
          </div>

          <!-- 展開詳細 -->
          <transition name="detail">
            <div v-if="expandedId === evt.event_id" class="nv-detail">
              <div class="nv-detail__grid">
                <!-- 摘要セクション -->
                <div class="nv-detail__section">
                  <h4 class="nv-detail__heading">摘要</h4>
                  <p class="nv-detail__body">{{ evt.summary || '摘要なし' }}</p>
                </div>

                <!-- 関連ノード -->
                <div v-if="evt.related_nodes && evt.related_nodes.length > 0" class="nv-detail__section">
                  <h4 class="nv-detail__heading">関連ノード</h4>
                  <div class="nv-detail__nodes">
                    <div
                      v-for="node in evt.related_nodes"
                      :key="node.id"
                      class="nv-detail__node"
                      @click="navigateToNode(node.node_type, node.id)"
                    >
                      <div class="nv-detail__node-head">
                        <span class="nv-detail__node-kind">{{ getNodeTypeLabel(node.node_type) }}</span>
                        <span class="nv-detail__node-name">{{ node.name }}</span>
                        <span class="nv-detail__node-type">{{ node.node_type }}</span>
                      </div>
                      <p v-if="node.impact_summary" class="nv-detail__node-impact">{{ node.impact_summary }}</p>
                      <div v-if="node.relevance_score != null" class="nv-detail__node-score">
                        関連度: <strong>{{ node.relevance_score }}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 事実ソース -->
                <div v-if="evt.fact_sources && evt.fact_sources.length > 0" class="nv-detail__section nv-detail__section--full">
                  <h4 class="nv-detail__heading">事実ソース</h4>
                  <div class="nv-detail__sources">
                    <div v-for="(src, idx) in evt.fact_sources" :key="idx" class="nv-detail__source">
                      <div class="nv-detail__source-head">
                        <span class="nv-detail__source-name">{{ src.source }}</span>
                        <span v-if="src.data_type" class="nv-detail__source-type">{{ src.data_type }}</span>
                        <span v-if="src.matched_at" class="nv-detail__source-time">{{ formatDateTime(src.matched_at) }}</span>
                      </div>
                      <p v-if="src.matched_text" class="nv-detail__source-text">{{ src.matched_text }}</p>
                    </div>
                  </div>
                </div>

                <!-- メタ情報 -->
                <div class="nv-detail__section">
                  <h4 class="nv-detail__heading">メタ情報</h4>
                  <div class="nv-detail__meta">
                    <div class="nv-detail__meta-row">
                      <span class="nv-detail__meta-label">確認者</span>
                      <span>{{ evt.reviewed_by || '未確認' }}</span>
                    </div>
                    <div class="nv-detail__meta-row">
                      <span class="nv-detail__meta-label">作成日時</span>
                      <span>{{ formatDateTime(evt.created_at) }}</span>
                    </div>
                    <div class="nv-detail__meta-row">
                      <span class="nv-detail__meta-label">更新日時</span>
                      <span>{{ formatDateTime(evt.updated_at) }}</span>
                    </div>
                    <div v-if="evt.final_confidence != null" class="nv-detail__meta-row">
                      <span class="nv-detail__meta-label">信頼度</span>
                      <span>{{ evt.final_confidence }}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </transition>
        </template>

        <!-- 空状態 -->
        <div v-if="pagedEvents.length === 0 && !store.isLoading" class="nv-empty-state">
          <p class="nv-empty-state__text">該当するイベントはありません</p>
        </div>
      </div>

      <!-- ページネーション -->
      <nav v-if="showPagination" class="nv-pagination" aria-label="ページネーション">
        <button class="nv-page-btn" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)" aria-label="前のページ">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <template v-for="p in pageNumbers" :key="p">
          <span v-if="p === '...'" class="nv-page-ellipsis">…</span>
          <button v-else class="nv-page-btn" :class="{ 'nv-page-btn--active': p === currentPage }" @click="goToPage(p as number)">
            {{ p }}
          </button>
        </template>
        <button class="nv-page-btn" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)" aria-label="次のページ">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 6 15 12 9 18"/></svg>
        </button>
      </nav>
    </main>
  </div>
</template>

<style scoped>
/* ========================================
 * リスク通知ビュー - リデザイン
 * 美学: クリーンなエンタープライズダッシュボード
 * サイドバー + リスト型レイアウト
 * ======================================== */

/* レイアウト */
.nv {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 100vh;
  background: #f1f5f9;
}

/* ========================================
 * サイドバー
 * ======================================== */
.nv-sidebar {
  background: #fff;
  color: #334155;
  display: flex;
  flex-direction: column;
  padding: 0;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  border-right: 1px solid #e2e8f0;
}

.nv-sidebar__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 16px;
  border-bottom: 1px solid #f1f5f9;
}

.nv-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  outline: none;
  color: #94a3b8;
  transition: all 0.15s;
  flex-shrink: 0;
}
.nv-back:hover {
  background: #f1f5f9;
  color: #475569;
}

.nv-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}
.nv-brand__text {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #0f172a;
}

/* ナビゲーション */
.nv-nav {
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nv-nav__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: #64748b;
  border: none;
  outline: none;
  transition: all 0.15s;
  text-align: left;
  width: 100%;
}
.nv-nav__item:hover {
  background: #f1f5f9;
  color: #334155;
}
.nv-nav__item--active {
  background: #eef2ff;
  color: #4f46e5;
}
.nv-nav__label {
  flex: 1;
  font-weight: 500;
}
.nv-nav__count {
  font-size: 11px;
  font-weight: 600;
  background: #f1f5f9;
  color: #64748b;
  padding: 2px 7px;
  border-radius: 10px;
  min-width: 24px;
  text-align: center;
}
.nv-nav__item--active .nv-nav__count {
  background: #e0e7ff;
  color: #4f46e5;
}

/* サマリーカード */
.nv-summary {
  margin: auto 12px 16px;
  padding: 14px;
  background: #f8fafc;
  border-radius: 10px;
  border: 1px solid #f1f5f9;
}
.nv-summary__title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #94a3b8;
  margin-bottom: 12px;
}
.nv-summary__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.nv-summary__item {
  padding: 10px;
  border-radius: 8px;
  text-align: center;
}
.nv-summary__item--danger { background: #fef2f2; }
.nv-summary__item--warning { background: #fffbeb; }
.nv-summary__item--info { background: #eff6ff; }
.nv-summary__item--muted { background: #f1f5f9; }

.nv-summary__num {
  display: block;
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  margin-bottom: 4px;
}
.nv-summary__item--danger .nv-summary__num { color: #dc2626; }
.nv-summary__item--warning .nv-summary__num { color: #d97706; }
.nv-summary__item--info .nv-summary__num { color: #2563eb; }
.nv-summary__item--muted .nv-summary__num { color: #94a3b8; }

.nv-summary__label {
  font-size: 10px;
  color: #94a3b8;
  font-weight: 500;
}

/* ========================================
 * メインコンテンツ
 * ======================================== */
.nv-main {
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

/* ツールバー */
.nv-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.nv-toolbar__title {
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.nv-toolbar__total {
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
}
.nv-toolbar__right {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* リスクレベルピル */
.nv-risk-pills {
  display: flex;
  gap: 6px;
}
.nv-risk-pill {
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  background: #f1f5f9;
  border: none;
  outline: none;
  border-radius: 20px;
  transition: all 0.15s;
}
.nv-risk-pill:hover { background: #e2e8f0; color: #334155; }
.nv-risk-pill--active { background: #0f172a; color: #fff; }
.nv-risk-pill--active:hover { background: #1e293b; color: #fff; }
.nv-risk-pill--high.nv-risk-pill--active { background: #dc2626; }
.nv-risk-pill--high:not(.nv-risk-pill--active) { color: #dc2626; background: #fef2f2; }
.nv-risk-pill--mid.nv-risk-pill--active { background: #d97706; }
.nv-risk-pill--mid:not(.nv-risk-pill--active) { color: #d97706; background: #fffbeb; }
.nv-risk-pill--low.nv-risk-pill--active { background: #2563eb; }
.nv-risk-pill--low:not(.nv-risk-pill--active) { color: #2563eb; background: #eff6ff; }

/* セレクト */
.nv-select {
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  color: #334155;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.nv-select:hover { border-color: #cbd5e1; }
.nv-select:focus { outline: none; border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }

/* バッチ操作バー */
.nv-batch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #eef2ff;
  border: 1px solid #c7d2fe;
  border-radius: 10px;
}
.nv-batch__info {
  font-size: 13px;
  color: #4338ca;
  font-weight: 500;
}
.nv-batch__count {
  font-weight: 700;
  font-size: 15px;
}
.nv-batch__actions {
  display: flex;
  gap: 8px;
}
.nv-batch__btn {
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  transition: all 0.15s;
}
.nv-batch__btn--dismiss {
  background: #4338ca;
  color: #fff;
}
.nv-batch__btn--dismiss:hover { background: #3730a3; }
.nv-batch__btn--clear {
  background: transparent;
  color: #4338ca;
  border: 1px solid #c7d2fe;
}
.nv-batch__btn--clear:hover { background: #e0e7ff; }

/* バッチバーアニメーション */
.batch-bar-enter-active,
.batch-bar-leave-active {
  transition: all 0.2s ease;
}
.batch-bar-enter-from,
.batch-bar-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ローディング */
.nv-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  gap: 16px;
}
.nv-loading__spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e2e8f0;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.nv-loading__text {
  font-size: 13px;
  color: #64748b;
}

/* エラー */
.nv-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 0;
  gap: 12px;
}
.nv-error__text { font-size: 14px; color: #dc2626; }
.nv-error__retry {
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: #dc2626;
  border-radius: 8px;
}
.nv-error__retry:hover { background: #b91c1c; }

/* ========================================
 * リスト
 * ======================================== */
.nv-list {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

/* ヘッダー行 */
.nv-list__header {
  display: grid;
  grid-template-columns: 40px 96px 48px 90px 1fr 200px 90px 100px 28px;
  align-items: center;
  padding: 0 16px;
  height: 36px;
  background: transparent;
  border-bottom: 1px solid #e2e8f0;
  font-size: 12px;
  font-weight: 500;
  color: #94a3b8;
  letter-spacing: 0;
}

/* イベント行 */
.nv-row {
  display: grid;
  grid-template-columns: 40px 96px 48px 90px 1fr 200px 90px 100px 28px;
  align-items: center;
  padding: 0 16px;
  min-height: 52px;
  border-bottom: 1px solid #f1f5f9;
  cursor: pointer;
  transition: background 0.12s;
}
.nv-row:hover {
  background: #f8fafc;
}
.nv-row--expanded {
  background: #fafafe;
  border-bottom-color: transparent;
}
.nv-row--selected {
  background: #eef2ff;
}

/* チェックボックス */
.nv-check {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.nv-check input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.nv-check__box {
  width: 16px;
  height: 16px;
  border: 2px solid #cbd5e1;
  border-radius: 4px;
  transition: all 0.15s;
  position: relative;
}
.nv-check input:checked + .nv-check__box {
  background: #4f46e5;
  border-color: #4f46e5;
}
.nv-check input:checked + .nv-check__box::after {
  content: '';
  position: absolute;
  top: 1px;
  left: 4px;
  width: 5px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.nv-check:hover .nv-check__box {
  border-color: #94a3b8;
}

/* 列 */
.nv-list__col {
  font-size: 13px;
  color: #334155;
  padding: 8px 4px;
  min-width: 0;
}

/* ステータスバッジ */
.nv-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.nv-status::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status--confirmed { background: #fef2f2; color: #dc2626; }
.status--confirmed::before { background: #ef4444; }
.status--pending { background: #fffbeb; color: #d97706; }
.status--pending::before { background: #f59e0b; }
.status--watching { background: #eff6ff; color: #2563eb; }
.status--watching::before { background: #3b82f6; }
.status--dismissed { background: #f8fafc; color: #94a3b8; }
.status--dismissed::before { background: #cbd5e1; }

/* リスクレベル */
.nv-risk {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
}
.nv-risk--3 { background: #fef2f2; color: #dc2626; border: 1.5px solid #fecaca; }
.nv-risk--2 { background: #fffbeb; color: #d97706; border: 1.5px solid #fde68a; }
.nv-risk--1 { background: #eff6ff; color: #2563eb; border: 1.5px solid #bfdbfe; }

/* カテゴリ */
.nv-category {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: #475569;
}

/* 摘要テキスト */
.nv-summary-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 12.5px;
  line-height: 1.5;
  color: #475569;
}

/* ノードチップ */
.nv-node-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  background: #f1f5f9;
  border-radius: 6px;
  font-size: 11px;
  color: #334155;
  cursor: pointer;
  transition: all 0.12s;
  margin-right: 4px;
  margin-bottom: 2px;
  white-space: nowrap;
}
.nv-node-chip__type {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #475569;
  font-size: 10px;
  font-weight: 700;
}
.nv-node-chip:hover {
  background: #e0e7ff;
  color: #4338ca;
}
.nv-node-more {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 500;
}

/* 日時 */
.nv-time {
  display: block;
  font-size: 12px;
  color: #334155;
  font-weight: 500;
}
.nv-time-full {
  display: block;
  font-size: 10px;
  color: #94a3b8;
  margin-top: 1px;
}

/* 操作セレクト */
.nv-action-select {
  padding: 4px 8px;
  font-size: 11px;
  font-family: inherit;
  font-weight: 500;
  color: #334155;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s;
  width: 100%;
}
.nv-action-select:hover { border-color: #cbd5e1; }
.nv-action-select:focus { outline: none; border-color: #6366f1; }

/* 展開シェブロン */
.nv-row__chevron {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  transition: transform 0.2s;
}
.nv-row__chevron--open {
  transform: rotate(180deg);
  color: #6366f1;
}

.nv-empty {
  color: #cbd5e1;
}

/* ========================================
 * 展開詳細
 * ======================================== */
.nv-detail {
  background: #fafafe;
  border-bottom: 1px solid #e2e8f0;
  padding: 20px 24px 20px 56px;
}
.nv-detail__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.nv-detail__section--full {
  grid-column: 1 / -1;
}
.nv-detail__heading {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
  margin-bottom: 10px;
}
.nv-detail__body {
  font-size: 13px;
  line-height: 1.7;
  color: #334155;
}

/* 関連ノードカード */
.nv-detail__nodes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.nv-detail__node {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 14px;
  min-width: 200px;
  flex: 1;
  max-width: 320px;
  cursor: pointer;
  transition: all 0.15s;
}
.nv-detail__node:hover {
  border-color: #c7d2fe;
  box-shadow: 0 2px 8px rgba(99,102,241,0.08);
}
.nv-detail__node-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.nv-detail__node-kind {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #475569;
  font-size: 10px;
  font-weight: 700;
}
.nv-detail__node-name {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
}
.nv-detail__node-type {
  font-size: 10px;
  color: #94a3b8;
  background: #f1f5f9;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: auto;
}
.nv-detail__node-impact {
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
  margin-bottom: 4px;
}
.nv-detail__node-score {
  font-size: 11px;
  color: #94a3b8;
}
.nv-detail__node-score strong {
  color: #4f46e5;
}

/* 事実ソース */
.nv-detail__sources {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nv-detail__source {
  background: #fff;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
  padding: 10px 14px;
}
.nv-detail__source-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.nv-detail__source-name {
  font-size: 12px;
  font-weight: 600;
  color: #1e293b;
}
.nv-detail__source-type {
  font-size: 10px;
  color: #64748b;
  background: #f1f5f9;
  padding: 1px 6px;
  border-radius: 4px;
}
.nv-detail__source-time {
  font-size: 10px;
  color: #94a3b8;
  margin-left: auto;
}
.nv-detail__source-text {
  font-size: 12px;
  color: #475569;
  line-height: 1.6;
}

/* メタ情報 */
.nv-detail__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.nv-detail__meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #334155;
}
.nv-detail__meta-label {
  font-weight: 600;
  color: #64748b;
  min-width: 70px;
}

/* 詳細アニメーション */
.detail-enter-active,
.detail-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.detail-enter-from,
.detail-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}
.detail-enter-to,
.detail-leave-from {
  opacity: 1;
  max-height: 600px;
}

/* 空状態 */
.nv-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 0;
  gap: 8px;
}
.nv-empty-state__text {
  font-size: 14px;
  color: #94a3b8;
}

/* ========================================
 * ページネーション
 * ======================================== */
.nv-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 0;
}
.nv-page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
  background: #f8fafc;
  border: none;
  border-radius: 8px;
  transition: all 0.15s;
}
.nv-page-btn:hover:not(:disabled) {
  background: #e2e8f0;
  color: #334155;
}
.nv-page-btn--active {
  background: #4f46e5;
  color: #fff;
}
.nv-page-btn--active:hover:not(:disabled) {
  background: #4338ca;
  color: #fff;
}
.nv-page-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.nv-page-ellipsis {
  padding: 0 6px;
  color: #94a3b8;
  font-size: 13px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
