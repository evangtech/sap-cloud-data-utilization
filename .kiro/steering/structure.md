---
inclusion: always
---

# プロジェクト構造

```
/
├── config/                    # 設定ファイル
│   └── settings.py           # API URL、バケット名等の設定
│
├── infra/cdk/                # CDKインフラ定義
│   ├── app.py                # CDKアプリケーションエントリーポイント
│   └── stacks/               # CDKスタック定義
│       ├── earthquake_stack.py           # 地震データ取得スタック
│       ├── neptune_impact_analyzer_stack.py  # Neptune影響分析・地図生成スタック
│       └── __init__.py
│
├── src/
│   ├── lambda/               # Lambda関数
│   │   ├── earthquake_fetcher/  # 地震情報取得
│   │   ├── news_fetcher/        # ニュース取得
│   │   ├── s3_writer/           # S3書き込み
│   │   └── neptune_impact_analyzer/  # Neptune影響分析・地図生成
│   │       └── __init__.py      # メイン処理（影響分析、グラフ生成、地図生成）
│   │
│   └── stepfunctions/        # Step Functions定義
│       └── *.asl.json        # ASL (Amazon States Language) ファイル
│
├── tests/                    # テストコード
│   ├── test_earthquake_data.json        # テストデータ（地震情報）
│   └── test_earthquake_miyakojima.json  # テストデータ（宮古島地震）
│
├── frontend/                  # Vue.js フロントエンド（Amplify Gen2）
│   ├── amplify/              # Amplify Gen2バックエンド定義
│   │   ├── auth/resource.ts  # Cognito認証設定
│   │   ├── data/resource.ts  # DynamoDBスキーマ定義
│   │   └── backend.ts        # バックエンドエントリーポイント
│   └── src/
│       ├── components/       # Vueコンポーネント
│       ├── views/            # ページコンポーネント
│       ├── stores/           # Pinia状態管理
│       ├── services/         # APIサービス
│       └── types/            # TypeScript型定義
│
├── amplify/                   # ルートAmplify定義（frontendと同期）
│
├── IMPLEMENTATION_SUMMARY.md  # 実装サマリーレポート
├── PROPOSAL_DYNAMODB_WEBSITE.md  # DynamoDB+Webサイト提案書
│
└── .kiro/steering/           # Kiroステアリングルール
    ├── AGENTS.md             # エージェント行動規則
    ├── product.md            # プロダクト概要
    ├── structure.md          # プロジェクト構造
    ├── tech.md               # 技術スタック
    ├── lambda-guidelines.md  # Lambda開発ガイドライン
    └── cdk-guidelines.md     # CDK開発ガイドライン
```

## S3バケット構造

```
s3://supply-chain-earthquake-data/
├── earthquakes/              # 地震データ（JSONファイル）
│   ├── year=2026/           # 年別パーティション
│   │   └── month=01/        # 月別パーティション
│   └── test_*.json          # テストデータ
│
├── impact-analysis/          # 影響分析結果
│   ├── *_analysis.json      # 分析結果（JSON）
│   │   └── 構造: earthquake_id, earthquake_time, results[]
│   │       └── results[]: location, impact_analysis, alternative_suppliers
│   └── *_impact_graph.png   # 影響グラフ（PNG、色弱対応配色）
│
├── maps/                     # インタラクティブ地図（Leaflet.js）
│   └── supply_chain_map_*.html  # HTML地図ファイル
│       └── 機能: 工場マーカー、都市マーカー、サプライチェーン線、
│                 ページング付き工場リスト、タブ切り替え
│
└── lambda-layers/            # Lambda Layer（matplotlib、networkx等）
```

## 命名規則

- Lambda関数: スネークケース（例: `earthquake_fetcher`）
- CDKスタック: パスカルケース（例: `DataIngestionStack`）
- AWSリソース: ケバブケース（例: `earthquake-data-bucket`）

## ファイル配置ルール

- Lambda関数は `src/lambda/{機能名}/` 配下に配置
- Step Functions定義は `src/stepfunctions/` 配下に `.asl.json` 形式で配置
- CDKスタックは `infra/cdk/stacks/` 配下に配置
- 設定値は `config/settings.py` に集約
- 地震データは `s3://supply-chain-earthquake-data/earthquakes/` に保存
- 影響分析結果は `s3://supply-chain-earthquake-data/impact-analysis/` に保存
- 地図HTMLは `s3://supply-chain-earthquake-data/maps/` に保存
- テストデータは `tests/` 配下に配置
- 実装ドキュメントはルートディレクトリに配置（`IMPLEMENTATION_SUMMARY.md`等）

## 主要な実装ファイル

### Lambda関数
- `src/lambda/neptune_impact_analyzer/__init__.py` (約1300行)
  - `handler()`: Lambda関数エントリーポイント
  - `analyze_downstream_impact()`: 下流影響分析
  - `find_alternative_suppliers()`: 代替サプライヤー検索
  - `generate_impact_graph()`: 影響グラフ生成（PNG）
  - `generate_interactive_map()`: インタラクティブ地図生成（HTML）
  - `_fetch_all_locations()`: 全ロケーション取得
  - `_fetch_all_plants()`: 全工場情報取得
  - `_fetch_supply_relations()`: サプライチェーン関係取得
  - `_generate_leaflet_map()`: Leaflet.js地図HTML生成

### CDKスタック
- `infra/cdk/stacks/neptune_impact_analyzer_stack.py`
  - Lambda関数定義
  - S3イベント通知設定
  - IAM権限設定（Neptune、S3アクセス）


## フロントエンド構造（Amplify Gen2 + Vue.js）

```
frontend/
├── amplify/                  # Amplify Gen2バックエンド定義
│   ├── auth/
│   │   └── resource.ts      # Cognito認証設定
│   ├── data/
│   │   └── resource.ts      # DynamoDBスキーマ定義
│   └── backend.ts           # バックエンドエントリーポイント
│
├── src/
│   ├── components/          # Vueコンポーネント
│   │   ├── SupplyChainMap.vue   # Leaflet地図コンポーネント
│   │   ├── FactoryList.vue      # 工場リストコンポーネント
│   │   ├── DashboardStats.vue   # ダッシュボード統計
│   │   └── MapLegend.vue        # 地図凡例
│   │
│   ├── views/               # ページコンポーネント
│   │   ├── MapView.vue          # メイン地図ページ
│   │   ├── FactoriesView.vue    # 工場一覧ページ
│   │   └── EarthquakesView.vue  # 地震イベントページ
│   │
│   ├── stores/              # Pinia状態管理
│   │   └── supplyChain.ts       # サプライチェーンストア
│   │
│   ├── services/            # APIサービス
│   │   └── api.ts               # Amplify AppSync API呼び出し
│   │
│   └── types/               # TypeScript型定義
│       └── index.ts
│
└── package.json
```

## DynamoDBテーブル（Amplify Gen2）

### Factory
工場マスタデータ（Neptuneからの同期用キャッシュ）
- PK: factoryId
- GSI: byLocation (prefecture, city)

### SupplyRelation
サプライチェーン関係
- PK: supplierId, SK: consumerId
- GSI: byConsumer (consumerId)

### FactoryImpactStatus
影響を受けた工場の一時状態（TTL有効）
- PK: factoryId, SK: earthquakeId
- GSI: byEarthquake (earthquakeId, impactedAt)
- GSI: byImpactLevel (impactLevel, impactedAt)
- TTL属性: ttl

### EarthquakeEvent
地震イベント情報
- PK: earthquakeId
- GSI: byTimestamp (timestamp)

## フロントエンド開発コマンド

```bash
# 依存関係インストール
cd frontend
npm install

# Amplifyサンドボックス起動
npx ampx sandbox

# 開発サーバー起動
npm run dev

# ビルド
npm run build
```
