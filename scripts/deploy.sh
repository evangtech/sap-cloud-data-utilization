#!/usr/bin/env bash
set -euo pipefail
# ─────────────────────────────────────────────────────────────────
# deploy.sh — 新規環境にゼロからデプロイ / 既存環境を更新
#
# 使い方:
#   scripts/deploy.sh              # フルデプロイ（全ステップ）
#   scripts/deploy.sh --step 3     # ステップ 3 から再開
#   scripts/deploy.sh --only 5     # ステップ 5 のみ実行
#
# 前提:
#   - AWS CLI v2 インストール済み
#   - Node.js 20+ / npm
#   - Python 3.11+ / pip
#   - scripts/env.sh を環境に合わせて編集済み
# ─────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$SCRIPT_DIR/env.sh"

# ── CLI 引数パース ──
START_STEP=1
ONLY_STEP=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --step) START_STEP="$2"; shift 2 ;;
    --only) ONLY_STEP="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

should_run() {
  local step=$1
  if [[ $ONLY_STEP -ne 0 ]]; then
    [[ $step -eq $ONLY_STEP ]]
  else
    [[ $step -ge $START_STEP ]]
  fi
}

log() { echo -e "\n\033[1;36m[$1/7] $2\033[0m"; }

# ═════════════════════════════════════════════════════════════════
# Step 1: SSO ログイン確認
# ═════════════════════════════════════════════════════════════════
if should_run 1; then
  log 1 "AWS SSO ログイン確認"
  if ! aws sts get-caller-identity --profile "$AWS_PROFILE" &>/dev/null; then
    echo "SSO セッション切れ — ログインを開始します"
    aws sso login --profile "$AWS_PROFILE"
  fi
  CALLER=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query 'Account' --output text)
  echo "  Account: $CALLER"
  if [[ "$CALLER" != "$AWS_ACCOUNT_ID" ]]; then
    echo "❌ アカウント不一致: expected=$AWS_ACCOUNT_ID actual=$CALLER"
    exit 1
  fi
  echo "  ✅ SSO OK"
fi

# ═════════════════════════════════════════════════════════════════
# Step 2: CDK Bootstrap（未実施の場合）
# ═════════════════════════════════════════════════════════════════
if should_run 2; then
  log 2 "CDK Bootstrap"
  cd "$PROJECT_ROOT/infra/cdk"
  pip install -q -r requirements.txt

  for region in "$AWS_REGION" "$NEPTUNE_REGION"; do
    STACK="CDKToolkit"
    EXISTS=$(aws cloudformation describe-stacks \
      --stack-name "$STACK" \
      --profile "$AWS_PROFILE" \
      --region "$region" \
      --query 'Stacks[0].StackStatus' \
      --output text 2>/dev/null || echo "NONE")
    if [[ "$EXISTS" == "NONE" ]]; then
      echo "  Bootstrapping $region ..."
      npx cdk bootstrap "aws://${AWS_ACCOUNT_ID}/${region}" \
        --profile "$AWS_PROFILE"
    else
      echo "  $region already bootstrapped ($EXISTS)"
    fi
  done
  cd "$PROJECT_ROOT"
fi

# ═════════════════════════════════════════════════════════════════
# Step 3: Neptune Analytics グラフ作成
# ═════════════════════════════════════════════════════════════════
if should_run 3; then
  log 3 "Neptune Analytics グラフ"

  STATUS=$(aws neptune-graph get-graph \
    --graph-identifier "$NEPTUNE_GRAPH_ID" \
    --profile "$AWS_PROFILE" \
    --region "$NEPTUNE_REGION" \
    --query 'status' --output text 2>/dev/null || echo "NOT_FOUND")

  if [[ "$STATUS" == "NOT_FOUND" ]]; then
    echo "  グラフ $NEPTUNE_GRAPH_ID が見つかりません — 新規作成"
    RESULT=$(aws neptune-graph create-graph \
      --graph-name "$NEPTUNE_GRAPH_NAME" \
      --provisioned-memory "$NEPTUNE_MEMORY_MB" \
      --public-connectivity \
      --replica-count 0 \
      --tags "Key=Project,Value=sap-cloud-data-utilization" \
      --profile "$AWS_PROFILE" \
      --region "$NEPTUNE_REGION" 2>&1)
    NEW_ID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
    echo "  新規グラフID: $NEW_ID"
    echo "  ⚠  env.sh の NEPTUNE_GRAPH_ID を $NEW_ID に更新してください"
    export NEPTUNE_GRAPH_ID="$NEW_ID"

    echo "  グラフ作成中 (5-15分) — 待機..."
    aws neptune-graph wait graph-available \
      --graph-identifier "$NEPTUNE_GRAPH_ID" \
      --profile "$AWS_PROFILE" \
      --region "$NEPTUNE_REGION" 2>/dev/null || \
    while true; do
      S=$(aws neptune-graph get-graph \
        --graph-identifier "$NEPTUNE_GRAPH_ID" \
        --profile "$AWS_PROFILE" \
        --region "$NEPTUNE_REGION" \
        --query 'status' --output text 2>/dev/null)
      echo "    status: $S"
      [[ "$S" == "AVAILABLE" ]] && break
      sleep 30
    done
  elif [[ "$STATUS" == "AVAILABLE" ]]; then
    echo "  ✅ グラフ $NEPTUNE_GRAPH_ID は AVAILABLE"
  else
    echo "  グラフ status=$STATUS — 完了を待機中..."
    while true; do
      S=$(aws neptune-graph get-graph \
        --graph-identifier "$NEPTUNE_GRAPH_ID" \
        --profile "$AWS_PROFILE" \
        --region "$NEPTUNE_REGION" \
        --query 'status' --output text)
      echo "    status: $S"
      [[ "$S" == "AVAILABLE" ]] && break
      sleep 30
    done
  fi
fi

# ═════════════════════════════════════════════════════════════════
# Step 4: S3 バケット & DynamoDB テーブル
# ═════════════════════════════════════════════════════════════════
if should_run 4; then
  log 4 "S3 バケット & DynamoDB テーブル"

  # S3
  if aws s3api head-bucket --bucket "$S3_DATA_BUCKET" --profile "$AWS_PROFILE" 2>/dev/null; then
    echo "  S3 $S3_DATA_BUCKET ✅ 存在"
  else
    echo "  S3 $S3_DATA_BUCKET を作成中..."
    aws s3api create-bucket \
      --bucket "$S3_DATA_BUCKET" \
      --create-bucket-configuration "LocationConstraint=$NEPTUNE_REGION" \
      --profile "$AWS_PROFILE" \
      --region "$NEPTUNE_REGION"
    echo "  ✅ 作成完了"
  fi

  # DynamoDB EventTable
  EXISTS=$(aws dynamodb describe-table \
    --table-name "$EVENT_TABLE_NAME" \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --query 'Table.TableStatus' --output text 2>/dev/null || echo "NOT_FOUND")
  if [[ "$EXISTS" != "NOT_FOUND" ]]; then
    echo "  DynamoDB $EVENT_TABLE_NAME ✅ $EXISTS"
  else
    echo "  DynamoDB $EVENT_TABLE_NAME を作成中..."
    aws dynamodb create-table \
      --table-name "$EVENT_TABLE_NAME" \
      --attribute-definitions \
        AttributeName=event_id,AttributeType=S \
        AttributeName=status,AttributeType=S \
        AttributeName=created_at,AttributeType=S \
        AttributeName=category_id,AttributeType=S \
      --key-schema AttributeName=event_id,KeyType=HASH \
      --global-secondary-indexes '[
        {"IndexName":"gsi1-status-index","KeySchema":[{"AttributeName":"status","KeyType":"HASH"},{"AttributeName":"created_at","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}},
        {"IndexName":"gsi2-category-index","KeySchema":[{"AttributeName":"category_id","KeyType":"HASH"},{"AttributeName":"created_at","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}
      ]' \
      --billing-mode PAY_PER_REQUEST \
      --tags "Key=Project,Value=sap-cloud-data-utilization" \
      --profile "$AWS_PROFILE" \
      --region "$AWS_REGION"
    echo "  ✅ 作成完了"
  fi
fi

# ═════════════════════════════════════════════════════════════════
# Step 5: KG データ投入
# ═════════════════════════════════════════════════════════════════
if should_run 5; then
  log 5 "Neptune KG データ投入"
  cd "$PROJECT_ROOT"
  AWS_PROFILE="$AWS_PROFILE" python3 scripts/load_neptune_data.py
  cd "$PROJECT_ROOT"
fi

# ═════════════════════════════════════════════════════════════════
# Step 6: CDK スタックデプロイ
# ═════════════════════════════════════════════════════════════════
if should_run 6; then
  log 6 "CDK スタックデプロイ"
  cd "$PROJECT_ROOT/infra/cdk"

  npx cdk deploy --all \
    --profile "$AWS_PROFILE" \
    --context "neptune_graph_id=$NEPTUNE_GRAPH_ID" \
    --context "neptune_region=$NEPTUNE_REGION" \
    --context "s3_bucket_name=$S3_DATA_BUCKET" \
    --require-approval never

  cd "$PROJECT_ROOT"
fi

# ═════════════════════════════════════════════════════════════════
# Step 7: Amplify バックエンド + フロントエンド
# ═════════════════════════════════════════════════════════════════
if should_run 7; then
  log 7 "Amplify デプロイ"
  cd "$PROJECT_ROOT/frontend"

  npm install

  # Sandbox deploy (generates amplify_outputs.json + deploys backend)
  npx ampx sandbox --once --profile "$AWS_PROFILE"

  # Build frontend
  npm run build

  echo "  ✅ Amplify デプロイ完了"
  echo "  ローカル確認: npx vite (frontend/ にて)"
  cd "$PROJECT_ROOT"
fi

# ═════════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ デプロイ完了"
echo "═══════════════════════════════════════════════"
echo "  Neptune:  $NEPTUNE_GRAPH_ID ($NEPTUNE_REGION)"
echo "  S3:       $S3_DATA_BUCKET"
echo "  DynamoDB: $EVENT_TABLE_NAME ($AWS_REGION)"
echo "  Amplify:  ${AMPLIFY_APP_ID:-N/A}"
echo "═══════════════════════════════════════════════"
