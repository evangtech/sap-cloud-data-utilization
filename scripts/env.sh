#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# env.sh — 環境変数定義（デプロイ先ごとに書き換える唯一のファイル）
#
# 使い方:  source scripts/env.sh
# ─────────────────────────────────────────────────────────────────

# ── AWS アカウント / リージョン ──────────────────────────────────
export AWS_ACCOUNT_ID="454953018734"
export AWS_PROFILE="AdministratorAccess-454953018734"
export AWS_REGION="ap-northeast-1"          # Amplify / DynamoDB / primary region
export NEPTUNE_REGION="us-west-2"           # Neptune Analytics region

# ── Neptune Analytics ───────────────────────────────────────────
export NEPTUNE_GRAPH_ID="g-844qqbri1a"
export NEPTUNE_GRAPH_NAME="supply-chain-kg"
export NEPTUNE_MEMORY_MB=128                # m-NGPUs  (128 = smallest)

# ── S3 ──────────────────────────────────────────────────────────
export S3_DATA_BUCKET="supply-chain-earthquake-data-${AWS_ACCOUNT_ID}"

# ── DynamoDB ────────────────────────────────────────────────────
export EVENT_TABLE_NAME="event-table-dev"

# ── Amplify ─────────────────────────────────────────────────────
export AMPLIFY_APP_ID="d6ufl4ft8wda4"       # 空 = 新規作成時は deploy.sh が設定

# ── Bedrock ─────────────────────────────────────────────────────
export BEDROCK_REGION="us-west-2"
export BEDROCK_MODEL_ID="anthropic.claude-3-haiku-20240307-v1:0"

# ── SSO ─────────────────────────────────────────────────────────
export SSO_START_URL="https://evangtech.awsapps.com/start/#"

echo "✅ env loaded — account=${AWS_ACCOUNT_ID}  region=${AWS_REGION}  neptune=${NEPTUNE_GRAPH_ID}"
