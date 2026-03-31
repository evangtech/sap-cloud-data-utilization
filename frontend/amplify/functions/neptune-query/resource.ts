import { defineFunction } from '@aws-amplify/backend';

/**
 * Neptune Analytics クエリ関数
 * GraphQL resolverとして使用し、Neptuneからデータを取得
 */
export const neptuneQuery = defineFunction({
  name: 'neptune-query',
  entry: './handler.ts',
  environment: {
    NEPTUNE_GRAPH_ID: 'g-844qqbri1a',
    NEPTUNE_REGION: 'us-west-2',
  },
  timeoutSeconds: 30,
});
