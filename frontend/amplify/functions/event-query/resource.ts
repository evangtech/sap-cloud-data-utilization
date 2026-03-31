import { defineFunction } from '@aws-amplify/backend';

/**
 * EventTable クエリ・更新関数
 * GraphQL resolverとして使用し、EventTableから風険事件データを取得・更新
 */
export const eventQuery = defineFunction({
  name: 'event-query',
  entry: './handler.ts',
  environment: {
    EVENT_TABLE_NAME: 'event-table-dev',
    AWS_REGION: 'ap-northeast-1',
  },
  timeoutSeconds: 30,
});
