# サプライチェーン地図可視化 - フロントエンド

Vue 3 + TypeScript + Amplify Gen2を使用したサプライチェーン地図可視化アプリケーション。

## 技術スタック

- **フレームワーク**: Vue 3 + TypeScript
- **状態管理**: Pinia
- **地図ライブラリ**: Leaflet.js
- **バックエンド**: AWS Amplify Gen2 (AppSync + DynamoDB)
- **ビルドツール**: Vite

## セットアップ

### 1. 依存関係のインストール

```bash
cd frontend
npm install
```

### 2. Amplifyサンドボックスの起動

```bash
npx ampx sandbox
```

これにより以下が作成されます：
- DynamoDBテーブル（Factory, SupplyRelation, FactoryImpactStatus, EarthquakeEvent）
- AppSync API
- Cognito認証
- `amplify_outputs.json`設定ファイル

### 3. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで http://localhost:5173 を開きます。

## プロジェクト構造

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
│   ├── types/               # TypeScript型定義
│   │   └── index.ts
│   │
│   ├── router/              # Vue Router
│   │   └── index.ts
│   │
│   ├── App.vue              # ルートコンポーネント
│   └── main.ts              # エントリーポイント
│
└── package.json
```

## 主要機能

### 地図表示
- 日本地図上に工場と都市を表示
- 工場の影響レベルに応じた色分け
  - 赤: 直接影響
  - オレンジ: 下流影響
  - 青: 通常
- サプライチェーン関係を点線で表示
- クリックで工場詳細をポップアップ表示

### 工場リスト
- ページング機能（10件/ページ）
- タブ切り替え（全工場/影響工場）
- クリックで地図上の工場にフォーカス

### ダッシュボード
- 全工場数
- 稼働中/停止中の工場数
- 直接影響/下流影響の工場数

## DynamoDBテーブル

### Factory
工場マスタデータ（Neptuneからの同期用キャッシュ）

| 属性 | 型 | 説明 |
|------|-----|------|
| factoryId | String (PK) | 工場ID |
| factoryName | String | 工場名 |
| prefecture | String | 都道府県 |
| city | String | 市区町村 |
| latitude | Float | 緯度 |
| longitude | Float | 経度 |
| capacity | Integer | 生産能力 |
| isActive | Boolean | 稼働状況 |
| materials | String | 生産品目（カンマ区切り） |

### SupplyRelation
サプライチェーン関係（Neptuneからの同期用キャッシュ）

| 属性 | 型 | 説明 |
|------|-----|------|
| supplierId | String (PK) | サプライヤーID |
| consumerId | String (SK) | 消費者ID |
| supplierName | String | サプライヤー名 |
| consumerName | String | 消費者名 |
| supplierLat/Lon | Float | サプライヤー位置 |
| consumerLat/Lon | Float | 消費者位置 |

### FactoryImpactStatus
影響を受けた工場の一時状態（TTL有効）

| 属性 | 型 | 説明 |
|------|-----|------|
| factoryId | String (PK) | 工場ID |
| earthquakeId | String (SK) | 地震ID |
| impactLevel | Enum | 影響レベル（direct/downstream） |
| impactedAt | DateTime | 影響を受けた日時 |
| ttl | Integer | TTL期限（Unix timestamp） |
| earthquakeMagnitude | Float | マグニチュード |
| earthquakeLocation | String | 震源地 |

### EarthquakeEvent
地震イベント情報

| 属性 | 型 | 説明 |
|------|-----|------|
| earthquakeId | String (PK) | 地震ID |
| timestamp | DateTime | 発生日時 |
| magnitude | Float | マグニチュード |
| location | String | 震源地名 |
| depth | Integer | 震源の深さ |
| maxScale | Integer | 最大震度 |

## 開発コマンド

```bash
# 開発サーバー起動
npm run dev

# ビルド
npm run build

# 型チェック
npm run type-check

# プレビュー
npm run preview
```

## Amplifyデプロイ

```bash
# サンドボックス（開発環境）
npx ampx sandbox

# 本番デプロイ
npx ampx pipeline-deploy --branch main
```
