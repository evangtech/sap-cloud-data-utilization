import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { RiskEvent, EventCounts } from '@/types';
import {
  fetchEventsByStatus,
  fetchEventCounts,
  updateEventStatus,
} from '@/services/notificationApi';

/**
 * 通知ストア
 * リスクイベント通知の状態管理
 */
export const useNotificationStore = defineStore('notification', () => {
  // ========================================
  // State
  // ========================================

  /** 現在表示中のイベントリスト */
  const events = ref<RiskEvent[]>([]);

  /** 各ステータスのイベント件数 */
  const counts = ref<EventCounts>({
    confirmed: 0,
    pending: 0,
    watching: 0,
    dismissed: 0,
  });

  /** 現在のステータスフィルタ（null = 全件） */
  const currentStatus = ref<string | null>(null);

  /** 現在のカテゴリフィルタ */
  const currentCategory = ref<string | null>(null);

  /** 現在のリスクレベルフィルタ */
  const currentRiskLevel = ref<number | null>(null);

  /** ページネーショントークン */
  const nextToken = ref<string | null>(null);

  /** ローディング状態 */
  const isLoading = ref(false);

  /** エラーメッセージ */
  const error = ref<string | null>(null);

  // ========================================
  // Computed
  // ========================================

  /**
   * フロントエンドフィルタ適用後のイベントリスト
   * リスクレベルとカテゴリで前端フィルタリング
   */
  const filteredEvents = computed<RiskEvent[]>(() => {
    let result = events.value;

    // リスクレベルでフィルタ
    if (currentRiskLevel.value !== null) {
      result = result.filter((e) => e.risk_level === currentRiskLevel.value);
    }

    // カテゴリでフィルタ
    if (currentCategory.value !== null) {
      result = result.filter((e) => e.category_id === currentCategory.value);
    }

    return result;
  });

  /**
   * 注目すべきイベント数（CONFIRMED + PENDING）
   * ナビゲーションバッジに使用
   */
  const attentionCount = computed<number>(() => {
    return counts.value.confirmed + counts.value.pending;
  });

  // ========================================
  // Actions - データ読み込み
  // ========================================

  /**
   * イベントリストを読み込み
   * currentStatusが設定されている場合はステータス別に取得、
   * 未設定の場合は全ステータスを取得
   */
  async function loadEvents() {
    isLoading.value = true;
    error.value = null;

    try {
      if (currentStatus.value) {
        // ステータス指定時: GSI1経由で取得
        const result = await fetchEventsByStatus(currentStatus.value, 50);
        events.value = result.events;
        nextToken.value = result.nextToken;
      } else {
        // 全件取得: 各ステータスをページネーションで全件取得
        const statuses = ['CONFIRMED', 'PENDING', 'WATCHING', 'DISMISSED'];

        async function fetchAllForStatus(status: string): Promise<RiskEvent[]> {
          const all: RiskEvent[] = [];
          let token: string | undefined = undefined;
          do {
            const result = await fetchEventsByStatus(status, 50, token);
            all.push(...result.events);
            token = result.nextToken ?? undefined;
          } while (token);
          return all;
        }

        const results = await Promise.all(
          statuses.map((s) => fetchAllForStatus(s)),
        );
        const allEvents: RiskEvent[] = [];
        for (const r of results) {
          allEvents.push(...r);
        }
        // created_at降順でソート
        allEvents.sort((a, b) => {
          const dateA = a.created_at || '';
          const dateB = b.created_at || '';
          return dateB.localeCompare(dateA);
        });
        events.value = allEvents;
        nextToken.value = null;
      }

      console.log('イベント読み込み完了:', events.value.length, '件');
    } catch (e) {
      error.value =
        e instanceof Error ? e.message : 'イベントの読み込みに失敗しました';
      console.error('イベント読み込みエラー:', e);
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 次ページのイベントを追加読み込み
   */
  async function loadMoreEvents() {
    if (!nextToken.value || !currentStatus.value) return;

    isLoading.value = true;
    error.value = null;

    try {
      const result = await fetchEventsByStatus(
        currentStatus.value,
        50,
        nextToken.value,
      );
      events.value = [...events.value, ...result.events];
      nextToken.value = result.nextToken;

      console.log('追加イベント読み込み完了、合計:', events.value.length, '件');
    } catch (e) {
      error.value =
        e instanceof Error
          ? e.message
          : '追加イベントの読み込みに失敗しました';
      console.error('追加イベント読み込みエラー:', e);
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 各ステータスのイベント件数を読み込み
   */
  async function loadCounts() {
    try {
      counts.value = await fetchEventCounts();
      console.log('イベント件数読み込み完了:', counts.value);
    } catch (e) {
      console.error('イベント件数読み込みエラー:', e);
    }
  }

  // ========================================
  // Actions - ステータス変更
  // ========================================

  /**
   * 単一イベントのステータスを変更（楽観的更新）
   * 1. ローカル状態を即座に更新
   * 2. API呼び出し
   * 3. 失敗時はロールバック
   */
  async function changeStatus(eventId: string, newStatus: string) {
    // 対象イベントを検索
    const idx = events.value.findIndex((e) => e.event_id === eventId);
    if (idx === -1) return;

    // 元のステータスを保存（ロールバック用）
    const originalStatus = events.value[idx].status;
    const originalReviewedBy = events.value[idx].reviewed_by;

    // 楽観的更新: ローカル状態を即座に変更
    events.value[idx] = {
      ...events.value[idx],
      status: newStatus as RiskEvent['status'],
      reviewed_by: 'current_user',
      updated_at: new Date().toISOString(),
    };

    try {
      // API呼び出し
      await updateEventStatus(eventId, newStatus, 'current_user');
      // 件数を再取得
      await loadCounts();
      console.log('ステータス変更成功:', eventId, '->', newStatus);
    } catch (e) {
      // 失敗時: ロールバック
      events.value[idx] = {
        ...events.value[idx],
        status: originalStatus,
        reviewed_by: originalReviewedBy,
      };
      error.value =
        e instanceof Error
          ? e.message
          : 'ステータスの更新に失敗しました';
      console.error('ステータス変更エラー（ロールバック済み）:', e);
    }
  }

  /**
   * 複数イベントを一括でDISMISSEDに変更
   * 各イベントを順次更新
   */
  async function batchDismiss(eventIds: string[]) {
    for (const eventId of eventIds) {
      await changeStatus(eventId, 'DISMISSED');
    }
  }

  // ========================================
  // Actions - フィルタ設定
  // ========================================

  /**
   * フィルタ条件を設定してイベントを再読み込み
   */
  async function setFilter(
    status?: string | null,
    category?: string | null,
    riskLevel?: number | null,
  ) {
    if (status !== undefined) currentStatus.value = status ?? null;
    if (category !== undefined) currentCategory.value = category ?? null;
    if (riskLevel !== undefined) currentRiskLevel.value = riskLevel ?? null;

    // ステータス変更時はバックエンドから再取得
    if (status !== undefined) {
      await loadEvents();
    }
  }

  // ========================================
  // Getter関数
  // ========================================

  /**
   * 指定ノードIDに関連するイベントを取得
   * related_nodesに該当ノードIDを含むイベントをフィルタ
   */
  function getEventsByNodeId(nodeId: string): RiskEvent[] {
    return events.value.filter((event) =>
      event.related_nodes?.some((node) => node.id === nodeId),
    );
  }

  return {
    // State
    events,
    counts,
    currentStatus,
    currentCategory,
    currentRiskLevel,
    nextToken,
    isLoading,
    error,

    // Computed
    filteredEvents,
    attentionCount,

    // Actions
    loadEvents,
    loadMoreEvents,
    loadCounts,
    changeStatus,
    batchDismiss,
    setFilter,

    // Getter関数
    getEventsByNodeId,
  };
});
