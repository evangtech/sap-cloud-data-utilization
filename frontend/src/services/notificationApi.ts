/**
 * 通知API サービス
 * EventTable からリスクイベントデータを取得・更新
 */
import type {
  RiskEvent,
  EventCounts,
  RelatedNode,
  FactSource,
} from '@/types';

// Amplify Data Client（遅延初期化）
let client: any = null;
let amplifyAvailable = false;

/**
 * Amplifyクライアントを取得
 */
async function getClient() {
  if (client !== null) {
    return amplifyAvailable ? client : null;
  }

  try {
    const { generateClient } = await import('aws-amplify/data');
    client = generateClient();
    amplifyAvailable = true;
    console.log('通知API: Amplifyクライアント初期化成功');
    return client;
  } catch (error) {
    console.warn('通知API: Amplifyクライアント初期化失敗:', error);
    amplifyAvailable = false;
    client = false;
    return null;
  }
}

// ========================================
// ヘルパー関数
// ========================================

/**
 * 関連ノードのレスポンスデータをマッピング
 */
function mapRelatedNode(node: any): RelatedNode {
  return {
    id: node?.id || '',
    name: node?.name || '',
    node_type: node?.node_type || '',
    impact_summary: node?.impact_summary || undefined,
    relevance_score: node?.relevance_score ?? undefined,
  };
}

/**
 * 事実ソースのレスポンスデータをマッピング
 */
function mapFactSource(source: any): FactSource {
  return {
    source: source?.source || '',
    data_type: source?.data_type || undefined,
    matched_text: source?.matched_text || undefined,
    matched_at: source?.matched_at || undefined,
    score_added: source?.score_added ?? undefined,
  };
}

/**
 * リスクイベントのレスポンスデータをマッピング
 */
function mapRiskEvent(event: any): RiskEvent {
  return {
    event_id: event?.event_id || '',
    status: event?.status || 'PENDING',
    category_id: event?.category_id || '',
    category_name: event?.category_name || undefined,
    summary: event?.summary || undefined,
    risk_level: event?.risk_level ?? undefined,
    final_confidence: event?.final_confidence ?? undefined,
    related_nodes: (event?.related_nodes || []).map(mapRelatedNode),
    fact_sources: (event?.fact_sources || []).map(mapFactSource),
    source_type: event?.source_type || undefined,
    created_at: event?.created_at || undefined,
    updated_at: event?.updated_at || undefined,
    reviewed_by: event?.reviewed_by || null,
  };
}

// ========================================
// リスクイベント取得関数
// ========================================

/**
 * ステータス別にリスクイベントを取得（GSI1使用）
 * @param status イベントステータス（CONFIRMED / PENDING / WATCHING / DISMISSED）
 * @param limit 取得件数上限（最大50）
 * @param nextToken ページネーショントークン
 * @returns イベントリストとページネーショントークン
 */
export async function fetchEventsByStatus(
  status: string,
  limit?: number,
  nextToken?: string,
): Promise<{ events: RiskEvent[]; nextToken: string | null }> {
  const c = await getClient();
  if (!c) {
    console.warn('Amplify未接続: リスクイベントを取得できません');
    return { events: [], nextToken: null };
  }

  try {
    const args: Record<string, any> = { status };
    if (limit !== undefined) args.limit = limit;
    if (nextToken !== undefined) args.nextToken = nextToken;

    const { data, errors } = await c.queries.getEventsByStatus(args);
    if (errors) {
      console.error('ステータス別イベント取得エラー:', errors);
      return { events: [], nextToken: null };
    }
    return {
      events: (data?.events || []).map(mapRiskEvent),
      nextToken: data?.nextToken || null,
    };
  } catch (error) {
    console.error('ステータス別イベント取得エラー:', error);
    return { events: [], nextToken: null };
  }
}

/**
 * カテゴリ別にリスクイベントを取得（GSI2使用）
 * @param categoryId カテゴリID（earthquake / flood / fire 等）
 * @param limit 取得件数上限（最大50）
 * @param nextToken ページネーショントークン
 * @returns イベントリストとページネーショントークン
 */
export async function fetchEventsByCategory(
  categoryId: string,
  limit?: number,
  nextToken?: string,
): Promise<{ events: RiskEvent[]; nextToken: string | null }> {
  const c = await getClient();
  if (!c) {
    console.warn('Amplify未接続: リスクイベントを取得できません');
    return { events: [], nextToken: null };
  }

  try {
    const args: Record<string, any> = { categoryId };
    if (limit !== undefined) args.limit = limit;
    if (nextToken !== undefined) args.nextToken = nextToken;

    const { data, errors } = await c.queries.getEventsByCategory(args);
    if (errors) {
      console.error('カテゴリ別イベント取得エラー:', errors);
      return { events: [], nextToken: null };
    }
    return {
      events: (data?.events || []).map(mapRiskEvent),
      nextToken: data?.nextToken || null,
    };
  } catch (error) {
    console.error('カテゴリ別イベント取得エラー:', error);
    return { events: [], nextToken: null };
  }
}

/**
 * イベントIDで単一リスクイベントを取得
 * @param eventId イベントID
 * @returns リスクイベント（存在しない場合はnull）
 */
export async function fetchEventById(
  eventId: string,
): Promise<RiskEvent | null> {
  const c = await getClient();
  if (!c) {
    console.warn('Amplify未接続: リスクイベントを取得できません');
    return null;
  }

  try {
    const { data, errors } = await c.queries.getEventById({ eventId });
    if (errors) {
      console.error('イベント詳細取得エラー:', errors);
      return null;
    }
    if (!data) return null;
    return mapRiskEvent(data);
  } catch (error) {
    console.error('イベント詳細取得エラー:', error);
    return null;
  }
}

// ========================================
// リスクイベント更新関数
// ========================================

/**
 * リスクイベントのステータスを更新
 * 失敗時はエラーをスローし、Store側で捕捉・回滚する
 * @param eventId イベントID
 * @param status 新しいステータス
 * @param reviewedBy 操作者の識別子
 * @returns 更新後のリスクイベント
 * @throws エラー発生時にスロー（Store側で乐観更新の回滚に使用）
 */
export async function updateEventStatus(
  eventId: string,
  status: string,
  reviewedBy: string,
): Promise<RiskEvent> {
  const c = await getClient();
  if (!c) {
    throw new Error('Amplify未接続: ステータスを更新できません');
  }

  try {
    const { data, errors } = await c.mutations.updateEventStatus({
      eventId,
      status,
      reviewedBy,
    });
    if (errors && errors.length > 0) {
      const message = errors.map((e: any) => e.message).join(', ');
      throw new Error(`ステータス更新エラー: ${message}`);
    }
    if (!data) {
      throw new Error('ステータス更新エラー: レスポンスデータが空です');
    }
    return mapRiskEvent(data);
  } catch (error) {
    // 既にErrorインスタンスの場合はそのままスロー
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('ステータス更新中に予期しないエラーが発生しました');
  }
}

// ========================================
// イベント件数取得関数
// ========================================

/**
 * 各ステータスのイベント件数を取得
 * @returns 各ステータスの件数（CONFIRMED / PENDING / WATCHING / DISMISSED）
 */
export async function fetchEventCounts(): Promise<EventCounts> {
  const defaultCounts: EventCounts = {
    confirmed: 0,
    pending: 0,
    watching: 0,
    dismissed: 0,
  };

  const c = await getClient();
  if (!c) {
    console.warn('Amplify未接続: イベント件数を取得できません');
    return defaultCounts;
  }

  try {
    const { data, errors } = await c.queries.getEventCounts();
    if (errors) {
      console.error('イベント件数取得エラー:', errors);
      return defaultCounts;
    }
    return {
      confirmed: data?.confirmed ?? 0,
      pending: data?.pending ?? 0,
      watching: data?.watching ?? 0,
      dismissed: data?.dismissed ?? 0,
    };
  } catch (error) {
    console.error('イベント件数取得エラー:', error);
    return defaultCounts;
  }
}
