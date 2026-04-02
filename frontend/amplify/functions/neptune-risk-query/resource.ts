import { defineFunction } from '@aws-amplify/backend';

export const neptuneRiskQueryFunction = defineFunction({
  name: 'neptune-risk-query',
  entry: './handler.ts',
  timeoutSeconds: 30,
  environment: {
    NEPTUNE_GRAPH_ID: 'g-844qqbri1a',
    NEPTUNE_REGION: 'us-west-2',
  },
});
