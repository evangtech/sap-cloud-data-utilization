# グローバルサプライチェーン予測システム

地震・天候・港湾状況などの外部イベントがサプライチェーンに与える影響を予測し、リスク軽減のための代替サプライヤー・ルートを提案するシステムです。

## 機能

- 外部データ収集（地震情報、ニュース、天候、港湾状況）
- AI/MLによるリスク分析・予測
- グラフ分析による影響範囲特定
- 代替サプライヤー・ルートの自動推奨

## 技術スタック

- **言語**: Python 3.11+
- **IaC**: AWS CDK
- **オーケストレーション**: AWS Step Functions
- **AI/ML**: Amazon Bedrock, Comprehend, Forecast, SageMaker
- **データ基盤**: S3, Glue, Neptune Analytics, OpenSearch Serverless

## プロジェクト構造

```
├── config/           # 設定ファイル
├── infra/cdk/        # CDKインフラ定義
├── src/
│   ├── lambda/       # Lambda関数
│   └── stepfunctions/ # Step Functions定義
└── tests/            # テストコード
```

## デプロイ手順

### 前提条件

- Python 3.11+
- AWS CLI（認証設定済み）
- Node.js（CDK CLI用）

### セットアップ

```bash
# CDK CLIのインストール
npm install -g aws-cdk

# 依存関係のインストール
cd infra/cdk
pip install -r requirements.txt
```

### デプロイ

```bash
cd infra/cdk

# 初回のみ: CDKブートストラップ
cdk bootstrap

# デプロイ
cdk deploy -y

# ポーリング間隔を変更する場合（分単位）
cdk deploy -y -c polling_interval_minutes=30
```

### 動作確認

```bash
# Lambdaを手動実行
aws lambda invoke --function-name earthquake-fetcher response.json
cat response.json
```

### 削除

```bash
cdk destroy
```

