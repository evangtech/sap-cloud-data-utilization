---
inclusion: always
---

# Kiro エージェント行動規則

## 言語ルール

- **ユーザーが使用する言語に合わせて回答すること**（英語で質問されたら英語で、日本語で質問されたら日本語で回答）
- **コード内のコメントはすべて日本語で記述すること**
- **ドキュメント、README、設計書はすべて日本語で作成すること**
- 変数名・関数名は英語で記述可（ただしコメントで日本語説明を付与）

## プロジェクト概要

このプロジェクトは「グローバルサプライチェーン予測システム」です。
地震・天候・港湾状況などの外部イベントがサプライチェーンに与える影響を予測し、
リスク軽減のための代替サプライヤー・ルートを提案します。

## 技術スタック

- **言語**: Python 3.11+
- **IaC**: AWS CDK (Python)
- **オーケストレーション**: AWS Step Functions
- **データレイク**: Amazon S3 + AWS Glue
- **AI/ML**: Amazon Bedrock, Amazon Comprehend, Amazon Forecast, SageMaker
- **グラフ分析**: Neptune Analytics
- **検索**: OpenSearch Serverless

## コーディング規約

- PEP 8に準拠すること
- 型ヒントを積極的に使用すること
- docstringは日本語で記述すること
- エラーメッセージは日本語で記述すること

## ファイル構成

```
/
├── config/           # 設定ファイル
├── infra/cdk/        # CDKインフラ定義
│   └── stacks/       # CDKスタック
├── src/
│   ├── lambda/       # Lambda関数
│   └── stepfunctions/ # Step Functions定義
└── tests/            # テストコード
```

## 参照ドキュメント

- アーキテクチャ概要: #[[file:architecture-summary-jp.md]]
- Step Functions定義例: #[[file:supply-chain-prediction-pipeline-demo-jp.asl.json]]
