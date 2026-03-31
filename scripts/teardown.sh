#!/usr/bin/env bash
set -euo pipefail
# ─────────────────────────────────────────────────────────────────
# teardown.sh — 環境のリソースを削除
#
# 使い方:
#   scripts/teardown.sh              # 確認プロンプト付きで全削除
#   scripts/teardown.sh --confirm    # 確認なしで全削除
# ─────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/env.sh"

PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

AUTO_CONFIRM=false
[[ "${1:-}" == "--confirm" ]] && AUTO_CONFIRM=true

confirm() {
  if $AUTO_CONFIRM; then return 0; fi
  echo -n "  $1 [y/N]: "
  read -r ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

echo "═══════════════════════════════════════════════"
echo "  ⚠  環境リソース削除"
echo "  Account: $AWS_ACCOUNT_ID"
echo "═══════════════════════════════════════════════"

# 1. CDK stacks
echo ""
echo "[1] CDK スタック削除"
STACKS=$(aws cloudformation list-stacks \
  --stack-name-prefix "" \
  --profile "$AWS_PROFILE" \
  --region "$NEPTUNE_REGION" \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query 'StackSummaries[?contains(StackName,`Earthquake`) || contains(StackName,`Neptune`)].StackName' \
  --output text 2>/dev/null || echo "")
if [[ -n "$STACKS" ]]; then
  echo "  検出: $STACKS"
  if confirm "CDK スタックを削除しますか?"; then
    cd "$PROJECT_ROOT/infra/cdk"
    npx cdk destroy --all --profile "$AWS_PROFILE" --force 2>/dev/null || true
    cd "$PROJECT_ROOT"
    echo "  ✅ 削除済み"
  fi
else
  echo "  CDK スタックなし — スキップ"
fi

# 2. Amplify sandbox
echo ""
echo "[2] Amplify Sandbox 削除"
if confirm "Amplify sandbox リソースを削除しますか?"; then
  cd "$PROJECT_ROOT/frontend"
  npx ampx sandbox delete --profile "$AWS_PROFILE" -y 2>/dev/null || echo "  (sandbox なし)"
  cd "$PROJECT_ROOT"
fi

# 3. DynamoDB EventTable
echo ""
echo "[3] DynamoDB EventTable"
EXISTS=$(aws dynamodb describe-table \
  --table-name "$EVENT_TABLE_NAME" \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --query 'Table.TableStatus' --output text 2>/dev/null || echo "NOT_FOUND")
if [[ "$EXISTS" != "NOT_FOUND" ]]; then
  echo "  $EVENT_TABLE_NAME ($EXISTS)"
  if confirm "削除しますか?"; then
    aws dynamodb delete-table \
      --table-name "$EVENT_TABLE_NAME" \
      --profile "$AWS_PROFILE" \
      --region "$AWS_REGION"
    echo "  ✅ 削除済み"
  fi
else
  echo "  テーブルなし — スキップ"
fi

# 4. S3 bucket
echo ""
echo "[4] S3 バケット"
if aws s3api head-bucket --bucket "$S3_DATA_BUCKET" --profile "$AWS_PROFILE" 2>/dev/null; then
  echo "  $S3_DATA_BUCKET"
  if confirm "バケットを空にして削除しますか?"; then
    aws s3 rm "s3://$S3_DATA_BUCKET" --recursive --profile "$AWS_PROFILE" 2>/dev/null || true
    aws s3api delete-bucket \
      --bucket "$S3_DATA_BUCKET" \
      --profile "$AWS_PROFILE" \
      --region "$NEPTUNE_REGION"
    echo "  ✅ 削除済み"
  fi
else
  echo "  バケットなし — スキップ"
fi

# 5. Neptune graph
echo ""
echo "[5] Neptune Analytics グラフ"
STATUS=$(aws neptune-graph get-graph \
  --graph-identifier "$NEPTUNE_GRAPH_ID" \
  --profile "$AWS_PROFILE" \
  --region "$NEPTUNE_REGION" \
  --query 'status' --output text 2>/dev/null || echo "NOT_FOUND")
if [[ "$STATUS" != "NOT_FOUND" ]]; then
  echo "  $NEPTUNE_GRAPH_ID ($STATUS)"
  if confirm "Neptune グラフを削除しますか? (復元不可)"; then
    # 削除保護を解除
    aws neptune-graph update-graph \
      --graph-identifier "$NEPTUNE_GRAPH_ID" \
      --no-deletion-protection \
      --profile "$AWS_PROFILE" \
      --region "$NEPTUNE_REGION" 2>/dev/null || true
    sleep 3
    aws neptune-graph delete-graph \
      --graph-identifier "$NEPTUNE_GRAPH_ID" \
      --skip-snapshot \
      --profile "$AWS_PROFILE" \
      --region "$NEPTUNE_REGION"
    echo "  ✅ 削除開始 (完了まで数分)"
  fi
else
  echo "  グラフなし — スキップ"
fi

echo ""
echo "═══════════════════════════════════════════════"
echo "  teardown 完了"
echo "═══════════════════════════════════════════════"
