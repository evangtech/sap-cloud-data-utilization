import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

/**
 * EventTable クエリ・更新ハンドラー
 * AppSync resolverとして動作し、EventTableからリスクイベントデータを取得・更新
 */

const TABLE_NAME = process.env.EVENT_TABLE_NAME || 'event-table-dev';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

/** 最大ページサイズ */
const MAX_PAGE_SIZE = 50;

/** 有効なステータス値 */
const VALID_STATUSES = ['CONFIRMED', 'PENDING', 'WATCHING', 'DISMISSED'] as const;

/**
 * 標準化エラーレスポンスを生成
 */
function errorResponse(message: string) {
  return { error: true, message };
}

/**
 * limit値をバリデーションし、最大値を制限
 */
function clampLimit(limit?: number): number {
  if (!limit || limit < 1) return MAX_PAGE_SIZE;
  return Math.min(limit, MAX_PAGE_SIZE);
}

/**
 * ステータス別にイベントを取得（GSI1）
 * GSI1PK = STATUS#{status}、GSI1SK = created_at（降順）
 */
async function getEventsByStatus(
  status: string,
  limit?: number,
  nextToken?: string,
) {
  if (!VALID_STATUSES.includes(status as any)) {
    return errorResponse(`無効なステータス: ${status}`);
  }

  const params: any = {
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `STATUS#${status}` },
    ScanIndexForward: false,
    Limit: clampLimit(limit),
  };

  if (nextToken) {
    params.ExclusiveStartKey = JSON.parse(
      Buffer.from(nextToken, 'base64').toString('utf-8'),
    );
  }

  const result = await docClient.send(new QueryCommand(params));

  return {
    events: result.Items || [],
    nextToken: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null,
  };
}

/**
 * カテゴリ別にイベントを取得（GSI2）
 * GSI2PK = CAT#{categoryId}、GSI2SK = created_at（降順）
 */
async function getEventsByCategory(
  categoryId: string,
  limit?: number,
  nextToken?: string,
) {
  const params: any = {
    TableName: TABLE_NAME,
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :pk',
    ExpressionAttributeValues: { ':pk': `CAT#${categoryId}` },
    ScanIndexForward: false,
    Limit: clampLimit(limit),
  };

  if (nextToken) {
    params.ExclusiveStartKey = JSON.parse(
      Buffer.from(nextToken, 'base64').toString('utf-8'),
    );
  }

  const result = await docClient.send(new QueryCommand(params));

  return {
    events: result.Items || [],
    nextToken: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null,
  };
}

/**
 * イベントIDで単一イベントを取得
 * PK = EVT#{eventId}、SK = META
 */
async function getEventById(eventId: string) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `EVT#${eventId}`, SK: 'META' },
    }),
  );

  if (!result.Item) {
    return errorResponse('イベントが見つかりません');
  }

  return result.Item;
}

/**
 * イベントのステータスを更新
 * status、GSI1PK、reviewed_by、updated_at を同時に更新
 */
async function updateEventStatus(
  eventId: string,
  status: string,
  reviewedBy: string,
) {
  if (!VALID_STATUSES.includes(status as any)) {
    return errorResponse(`無効なステータス: ${status}`);
  }

  const now = new Date().toISOString();

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `EVT#${eventId}`, SK: 'META' },
      UpdateExpression:
        'SET #status = :status, #gsi1pk = :gsi1pk, #reviewed_by = :reviewed_by, #updated_at = :updated_at',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#gsi1pk': 'GSI1PK',
        '#reviewed_by': 'reviewed_by',
        '#updated_at': 'updated_at',
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':gsi1pk': `STATUS#${status}`,
        ':reviewed_by': reviewedBy,
        ':updated_at': now,
      },
      ConditionExpression: 'attribute_exists(PK)',
      ReturnValues: 'ALL_NEW',
    }),
  );

  return result.Attributes;
}

/**
 * CONFIRMED と PENDING のイベント件数を取得
 * GSI1 に対して Select=COUNT でクエリ
 */
async function getEventCounts() {
  const countQuery = async (status: string): Promise<number> => {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `STATUS#${status}` },
        Select: 'COUNT',
      }),
    );
    return result.Count || 0;
  };

  const [confirmed, pending, watching, dismissed] = await Promise.all([
    countQuery('CONFIRMED'),
    countQuery('PENDING'),
    countQuery('WATCHING'),
    countQuery('DISMISSED'),
  ]);

  return { confirmed, pending, watching, dismissed };
}

/**
 * Lambda ハンドラー
 * AppSync resolver として fieldName で処理を分岐
 */
export const handler = async (event: any) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const { fieldName, arguments: args } = event;

  try {
    switch (fieldName) {
      case 'getEventsByStatus':
        return await getEventsByStatus(args.status, args.limit, args.nextToken);

      case 'getEventsByCategory':
        return await getEventsByCategory(
          args.categoryId,
          args.limit,
          args.nextToken,
        );

      case 'getEventById':
        return await getEventById(args.eventId);

      case 'updateEventStatus':
        return await updateEventStatus(
          args.eventId,
          args.status,
          args.reviewedBy,
        );

      case 'getEventCounts':
        return await getEventCounts();

      default:
        return errorResponse(`不明なフィールド: ${fieldName}`);
    }
  } catch (error) {
    console.error('Handler error:', error);
    const message =
      error instanceof Error ? error.message : 'DynamoDB操作中にエラーが発生しました';
    return errorResponse(message);
  }
};
