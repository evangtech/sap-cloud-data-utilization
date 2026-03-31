import { defineBackend } from '@aws-amplify/backend';
import { data, neptuneQueryFunction, nlQueryFunction, eventQueryFunction } from './data/resource';
import { auth } from './auth/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

/**
 * Amplify Gen2 Backend Definition
 * Supply Chain Map Visualization System
 */
const backend = defineBackend({
  auth,
  data,
  neptuneQueryFunction,
  nlQueryFunction,
  eventQueryFunction,
});

// Neptune Analytics へのアクセス権限を追加
backend.neptuneQueryFunction.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'neptune-graph:ExecuteQuery',
      'neptune-graph:GetQueryStatus',
      'neptune-graph:CancelQuery',
      'neptune-graph:ReadDataViaQuery',
    ],
    resources: ['arn:aws:neptune-graph:us-west-2:*:graph/g-1my3glnp96'],
  })
);

// NLクエリ関数: Neptune + Bedrock へのアクセス権限
backend.nlQueryFunction.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'neptune-graph:ExecuteQuery',
      'neptune-graph:GetQueryStatus',
      'neptune-graph:CancelQuery',
      'neptune-graph:ReadDataViaQuery',
    ],
    resources: ['arn:aws:neptune-graph:us-west-2:*:graph/g-1my3glnp96'],
  })
);

backend.nlQueryFunction.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'bedrock:InvokeModel',
    ],
    resources: ['arn:aws:bedrock:us-west-2::foundation-model/*'],
  })
);

// EventTable（DynamoDB外部テーブル）への読み書き権限を追加
backend.eventQueryFunction.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'dynamodb:Query',
      'dynamodb:GetItem',
      'dynamodb:UpdateItem',
    ],
    resources: [
      'arn:aws:dynamodb:*:*:table/event-table-*',
      'arn:aws:dynamodb:*:*:table/event-table-*/index/*',
    ],
  })
);
