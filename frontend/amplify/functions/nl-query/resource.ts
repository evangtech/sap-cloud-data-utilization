import { defineFunction } from '@aws-amplify/backend';

/**
 * 自然言語クエリ関数
 * Bedrockで自然言語を解析し、Neptuneクエリまたはフィルタ命令を生成
 */
export const nlQuery = defineFunction({
  name: 'nl-query',
  entry: './handler.ts',
  environment: {
    NEPTUNE_GRAPH_ID: 'g-844qqbri1a',
    NEPTUNE_REGION: 'us-west-2',
    BEDROCK_REGION: 'us-west-2',
    BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
  },
  timeoutSeconds: 30,
  bundling: {
    // AWS SDKクライアントをバンドルに含める（Lambda runtimeに含まれないため）
    externalPackages: [],
  },
});
