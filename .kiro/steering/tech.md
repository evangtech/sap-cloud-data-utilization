---
inclusion: always
---

# 技術スタック

## 言語・ランタイム

- Python 3.13+
- TypeScript 5.x（フロントエンド）
- 型ヒント必須
- PEP 8準拠

## フロントエンド

- **フレームワーク**: Vue 3 + TypeScript
- **状態管理**: Pinia
- **地図ライブラリ**: Leaflet.js
- **バックエンド**: AWS Amplify Gen2
  - AppSync (GraphQL API)
  - DynamoDB (データストア)
  - Cognito (認証)
- **ビルドツール**: Vite

## インフラストラクチャ

- IaC: AWS CDK (Python)
- オーケストレーション: AWS Step Functions
- コンピュート: AWS Lambda

## データ基盤

- データレイク: Amazon S3 + AWS Glue (Crawler, ETL, Data Quality, Catalog)
- グラフ分析: Neptune Analytics
- 検索: OpenSearch Serverless
- キャッシュ: DynamoDB
- **地図可視化: Leaflet.js (インタラクティブHTML)**
  - 純粋なJavaScript実装（外部依存関係なし）
  - 工場マーカー（赤：影響工場、青：通常工場、円形）
  - 都市マーカー（緑の円）
  - サプライチェーン関係の線表示（点線）
  - ページング機能付き工場リスト（1ページ10件）
  - クリック可能な工場リスト（地図上にフォーカス、ズームレベル10）
  - タブ切り替え（全工場/影響工場）
  - イベントリスナー方式のイベント処理
  - 日本地図に限定（緯度経度範囲制限）
  - レスポンシブデザイン対応

## AI/ML

- GenAI: Amazon Bedrock (Claude, Titan, Agent, Knowledge Base)
- NLP: Amazon Comprehend
- 予測: Amazon Forecast
- 異常検知: SageMaker

## 監視・通知

- CloudWatch (Metrics, Logs)
- SNS + EventBridge

## 主要コマンド

```bash
# CDKデプロイ
cd infra/cdk
cdk deploy --all

# CDK差分確認
cdk diff

# テスト実行
pytest tests/

# 型チェック
mypy src/
```

## 外部API

- 地震情報: https://api.p2pquake.net/v2/jma/quake?quake_type=DetailScale
- ニュース: https://newsapi.org/v2/everything
