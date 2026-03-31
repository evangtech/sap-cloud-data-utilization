#!/usr/bin/env bash
set -euo pipefail
# ─────────────────────────────────────────────────────────────────
# update-env-refs.sh — env.sh の値をコードベース全体に反映
#
# 新しい環境にデプロイする際、env.sh を書き換えた後にこれを実行すると
# コード内のハードコードされた Graph ID / バケット名 / テーブル名を
# 一括で更新する。
#
# 使い方:
#   1. scripts/env.sh を新環境の値に編集
#   2. scripts/update-env-refs.sh          (dry-run)
#   3. scripts/update-env-refs.sh --apply  (実適用)
# ─────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$SCRIPT_DIR/env.sh"

DRY_RUN=true
[[ "${1:-}" == "--apply" ]] && DRY_RUN=false

# ── 現在の値を検出 ──
# 最も信頼できるソース = amplify/data/resource.ts の NEPTUNE_GRAPH_ID
CURRENT_GRAPH_ID=$(grep -oP "NEPTUNE_GRAPH_ID.*?'(g-[a-z0-9]+)'" \
  "$PROJECT_ROOT/frontend/amplify/data/resource.ts" | head -1 | grep -oP "g-[a-z0-9]+" || echo "")

CURRENT_BUCKET=$(grep -oP "bucket_name=\"([^\"]+)\"" \
  "$PROJECT_ROOT/infra/cdk/stacks/earthquake_stack.py" | head -1 | grep -oP '"[^"]+"' | tr -d '"' || echo "")

echo "═══════════════════════════════════════════════"
echo "  環境変数参照の更新"
echo "═══════════════════════════════════════════════"
echo "  Graph ID:  ${CURRENT_GRAPH_ID:-?} → $NEPTUNE_GRAPH_ID"
echo "  S3 Bucket: ${CURRENT_BUCKET:-?} → $S3_DATA_BUCKET"
echo "  Table:     event-table-dev → $EVENT_TABLE_NAME"
echo "  Mode:      $( $DRY_RUN && echo 'DRY RUN' || echo 'APPLY' )"
echo ""

# ── 置換対象ファイル ──
FILES=(
  # Amplify backend
  "frontend/amplify/data/resource.ts"
  "frontend/amplify/backend.ts"
  "frontend/amplify/functions/neptune-query/handler.ts"
  "frontend/amplify/functions/neptune-query/resource.ts"
  "frontend/amplify/functions/nl-query/handler.ts"
  "frontend/amplify/functions/nl-query/resource.ts"
  "frontend/amplify/functions/event-query/handler.ts"
  "frontend/amplify/functions/event-query/resource.ts"
  # CDK
  "infra/cdk/app.py"
  "infra/cdk/stacks/earthquake_stack.py"
  "infra/cdk/stacks/neptune_impact_analyzer_stack.py"
  # Lambda
  "src/lambda/neptune_impact_analyzer/__init__.py"
  "src/lambda/earthquake_fetcher/__init__.py"
  # Scripts
  "scripts/load_neptune_data.py"
)

replace() {
  local old="$1" new="$2" file="$3"
  if [[ -z "$old" || "$old" == "$new" ]]; then return; fi
  if grep -q "$old" "$PROJECT_ROOT/$file" 2>/dev/null; then
    if $DRY_RUN; then
      echo "  [DRY] $file: '$old' → '$new'"
    else
      sed -i'' -e "s|$old|$new|g" "$PROJECT_ROOT/$file"
      echo "  [OK]  $file: '$old' → '$new'"
    fi
  fi
}

for f in "${FILES[@]}"; do
  if [[ ! -f "$PROJECT_ROOT/$f" ]]; then continue; fi
  # Graph ID
  if [[ -n "$CURRENT_GRAPH_ID" && "$CURRENT_GRAPH_ID" != "$NEPTUNE_GRAPH_ID" ]]; then
    replace "$CURRENT_GRAPH_ID" "$NEPTUNE_GRAPH_ID" "$f"
  fi
  # S3 bucket
  if [[ -n "$CURRENT_BUCKET" && "$CURRENT_BUCKET" != "$S3_DATA_BUCKET" ]]; then
    replace "$CURRENT_BUCKET" "$S3_DATA_BUCKET" "$f"
  fi
done

echo ""
if $DRY_RUN; then
  echo "ℹ  Dry run 完了。適用するには: scripts/update-env-refs.sh --apply"
else
  echo "✅ 更新完了"
fi
