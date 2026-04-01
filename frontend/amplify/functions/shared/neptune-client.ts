/**
 * Neptune Analytics 共有クライアント
 * 新規ハンドラー（neptune-risk-query等）が使用する共有接続モジュール。
 * 既存の neptune-query/handler.ts は触らない（Phase 9のオプショナルリファクタまで）。
 */
import {
  NeptuneGraphClient,
  ExecuteQueryCommand,
} from '@aws-sdk/client-neptune-graph';

const GRAPH_ID = process.env.NEPTUNE_GRAPH_ID || 'g-844qqbri1a';
const REGION = process.env.NEPTUNE_REGION || 'us-west-2';

let client: NeptuneGraphClient | null = null;

export function getNeptuneClient(): NeptuneGraphClient {
  if (!client) {
    client = new NeptuneGraphClient({ region: REGION });
  }
  return client;
}

/**
 * openCypherクエリを実行して結果配列を返す
 * 既存handler.tsの transformToString() パターンに合わせる
 */
export async function executeQuery(query: string): Promise<Record<string, unknown>[]> {
  const neptuneClient = getNeptuneClient();
  const command = new ExecuteQueryCommand({
    graphIdentifier: GRAPH_ID,
    queryString: query,
    language: 'OPEN_CYPHER',
  });
  const response = await neptuneClient.send(command);
  const payload = await response.payload?.transformToString();
  if (!payload) {
    throw new Error('Neptune returned empty payload');
  }
  const parsed = JSON.parse(payload);
  if (!parsed.results) {
    throw new Error(
      `Neptune returned no results field: ${JSON.stringify(parsed).slice(0, 200)}`,
    );
  }
  return parsed.results;
}

/**
 * エラー時に空配列を返すセーフバージョン
 */
export async function executeQuerySafe(query: string): Promise<Record<string, unknown>[]> {
  try {
    return await executeQuery(query);
  } catch (error) {
    console.error('Neptune クエリエラー:', error);
    console.error('クエリ:', query.slice(0, 300));
    return [];
  }
}
