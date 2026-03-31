---
inclusion: fileMatch
fileMatchPattern: "**/lambda/**/*.py"
---

# Lambda関数開発ガイドライン

## 基本構造

```python
# -*- coding: utf-8 -*-
"""
関数の説明（日本語）
"""
import json
import logging
from typing import Any

# ロガー設定
logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Lambda関数のエントリーポイント
    
    Args:
        event: イベントデータ
        context: Lambda実行コンテキスト
    
    Returns:
        処理結果
    """
    try:
        # 処理ロジック
        logger.info("処理を開始します")
        
        return {
            "statusCode": 200,
            "body": json.dumps({"message": "成功"}, ensure_ascii=False)
        }
    except Exception as e:
        logger.error(f"エラーが発生しました: {e}")
        raise
```

## エラーハンドリング

- すべての例外をキャッチしてログに記録すること
- エラーメッセージは日本語で記述すること
- Step Functionsと連携する場合は適切なエラー形式で返すこと

## 外部API呼び出し

- タイムアウトを必ず設定すること
- リトライロジックを実装すること
- レスポンスのバリデーションを行うこと
