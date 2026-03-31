# サプライチェーン可視化Webサイト提案書

## 提案概要

現在のシステムは地震発生時にLambda関数が静的HTMLファイルを生成してS3に保存する方式ですが、以下の課題があります：

### 現在の課題

1. **リアルタイム性の欠如**: 静的HTMLファイルのため、最新情報を見るには再生成が必要
2. **ユーザビリティの制限**: ページング、フィルタリング、ソート機能がない
3. **スケーラビリティの問題**: 工場数が増えると1つのHTMLファイルが肥大化
4. **データ管理の複雑さ**: S3に散在するHTMLファイルの管理が困難

## 提案アーキテクチャ

### システム構成

```
┌─────────────────┐
│  地震データ     │
│  (S3 Trigger)   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Lambda: Neptune Impact Analyzer   │
│  - Neptune Analyticsで影響分析     │
│  - S3に分析結果を保存               │
│  - DynamoDBに影響工場の状態を保存   │
│    (TTL付き、自動期限切れ)          │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  データストア                        │
│  ┌─────────────────────────────┐   │
│  │ Neptune Analytics           │   │
│  │ - サプライチェーン関係      │   │
│  │ - 工場マスタデータ          │   │
│  │ - 供給関係グラフ            │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │ S3                          │   │
│  │ - 地震データ（全履歴）      │   │
│  │ - 影響分析結果JSON          │   │
│  │ - 影響グラフPNG             │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │ DynamoDB (TTL有効)          │   │
│  │ - 影響を受けた工場の状態    │   │
│  │ - 地震イベントとの紐付け    │   │
│  │ - 自動期限切れ（復旧想定）  │   │
│  └─────────────────────────────┘   │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  API Gateway + Lambda (REST API)    │
│  - GET /factories (Neptune)         │
│  - GET /factories/{id} (Neptune)    │
│  - GET /impacted-factories (DynamoDB)│
│  - GET /earthquakes (S3リスト)      │
│  - GET /supply-chain/graph (Neptune)│
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  静的Webサイト (S3 + CloudFront)    │
│  - React/Vue.js SPA                 │
│  - Leaflet.js 地図表示              │
│  - リアルタイム影響状態表示         │
│  - フィルタリング・ソート機能       │
│  - ページング対応                   │
└─────────────────────────────────────┘
```

## 主要機能

### 1. インタラクティブ地図

- **リアルタイム更新**: DynamoDBから最新データを取得
- **工場リスト表示**: 
  - ページング対応（10件/20件/50件表示）
  - クリックで詳細情報表示
  - 生産品目、稼働状況、供給先を表示
- **フィルタリング機能**:
  - 稼働状況（稼働中/停止中）
  - 地域（都道府県、市区町村）
  - 生産品目
  - 影響レベル
- **サプライチェーン可視化**:
  - 供給関係を線で表示
  - クリックで関係詳細を表示
  - 影響範囲のハイライト

### 2. ダッシュボード

```
┌─────────────────────────────────────────────────┐
│  サプライチェーン状況ダッシュボード             │
├─────────────────────────────────────────────────┤
│  統計情報                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ 稼働中   │ │ 停止中   │ │ 影響工場 │       │
│  │   10     │ │    2     │ │    2     │       │
│  └──────────┘ └──────────┘ └──────────┘       │
├─────────────────────────────────────────────────┤
│  最新地震イベント                               │
│  ┌───────────────────────────────────────┐     │
│  │ 2026/01/29 18:00 M6.8 宮古島近海      │     │
│  │ 影響工場: 2箇所                       │     │
│  │ [詳細を見る]                          │     │
│  └───────────────────────────────────────┘     │
├─────────────────────────────────────────────────┤
│  工場リスト                                     │
│  ┌─────────────────────────────────────┐       │
│  │ 検索: [_____________] [検索]        │       │
│  │ フィルタ: [稼働状況▼] [地域▼]      │       │
│  ├─────────────────────────────────────┤       │
│  │ ✓ Miyakojima_Chip_Factory          │       │
│  │   沖縄県 宮古島市                  │       │
│  │   停止中 | 生産品目: Semiconductor  │       │
│  │   [詳細] [供給先を見る]            │       │
│  ├─────────────────────────────────────┤       │
│  │ ✓ Tokyo_Assembly_Plant             │       │
│  │   東京都 千代田区                  │       │
│  │   稼働中 | 生産品目: Electronics    │       │
│  │   [詳細] [供給先を見る]            │       │
│  └─────────────────────────────────────┘       │
│  ページ: [1] 2 3 ... 10  表示件数: [20▼]     │
└─────────────────────────────────────────────────┘
```

### 3. 工場詳細ページ

- 基本情報（名前、所在地、生産能力）
- 稼働状況の履歴
- 生産品目リスト
- 供給先リスト（クリックで詳細表示）
- 供給元リスト
- 影響を受けた地震イベント履歴

### 4. 地震イベント詳細ページ

- 地震情報（震源地、マグニチュード、時刻）
- 影響を受けた工場リスト
- 下流への影響範囲
- 代替サプライヤー提案
- 影響グラフ（PNG画像）

## 技術スタック

### フロントエンド

- **フレームワーク**: React 18 + TypeScript
- **地図ライブラリ**: Leaflet.js
- **UIコンポーネント**: Material-UI / Ant Design
- **状態管理**: React Query (サーバー状態) + Zustand (クライアント状態)
- **ルーティング**: React Router v6
- **ビルドツール**: Vite

### バックエンド

- **API**: API Gateway + Lambda (Python)
- **データベース**: DynamoDB
  - On-Demand課金モード
  - GSI（Global Secondary Index）でクエリ最適化
- **認証**: Amazon Cognito（オプション）

### インフラ

- **ホスティング**: S3 + CloudFront
- **CI/CD**: AWS CodePipeline + CodeBuild
- **監視**: CloudWatch + X-Ray

## DynamoDBテーブル設計

### FactoryImpactStatus テーブル（TTL有効）

影響を受けた工場の一時的な状態を保存。TTLにより自動的に期限切れになり、工場が復旧したと見なされる。

```
PK: factory_id (String)
SK: earthquake_id (String)
Attributes:
  - impact_level (String: "high", "medium", "low")
  - impacted_at (Number, Unix timestamp)
  - ttl (Number, Unix timestamp) ← TTL属性
  - earthquake_magnitude (Number)
  - earthquake_location (String)
  - downstream_affected_count (Number)
  - alternative_suppliers (List<String>)
  - s3_analysis_key (String) ← S3の詳細分析結果へのリンク
  - s3_graph_key (String) ← S3の影響グラフPNGへのリンク

GSI:
  - GSI1: earthquake_id-impacted_at-index
    PK: earthquake_id, SK: impacted_at
    用途: 特定の地震で影響を受けた全工場を取得
  
  - GSI2: impact_level-impacted_at-index
    PK: impact_level, SK: impacted_at
    用途: 影響レベル別に工場を取得

TTL設定:
  - TTL属性: ttl
  - デフォルト期限: 地震発生から7日後
  - 期限切れ後: 自動削除（工場は復旧したと見なす）
```

**データフロー:**

1. **地震発生時**: Lambda関数がNeptuneで影響分析を実行
2. **影響検出**: 影響を受けた工場をDynamoDBに記録（TTL = 現在時刻 + 7日）
3. **期限切れ**: 7日後、DynamoDBが自動的にレコードを削除
4. **復旧**: レコードが存在しない = 工場は正常稼働中

**TTL期間の調整:**
- 軽微な影響: 3日
- 中程度の影響: 7日（デフォルト）
- 重大な影響: 14日
- Lambda関数で影響レベルに応じて動的に設定

## API設計

### GET /api/factories

工場リストを取得（Neptuneから）

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 20)
- `city` (optional)
- `material` (optional)

**Response:**
```json
{
  "factories": [
    {
      "factory_id": "P001",
      "factory_name": "Tokyo_Assembly_Plant",
      "prefecture": "東京都",
      "city": "千代田区",
      "latitude": 35.6762,
      "longitude": 139.6503,
      "capacity": 500,
      "materials": ["Electronics", "Components"]
    }
  ],
  "pagination": {
    "current_page": 1,
    "total_pages": 5,
    "total_items": 100,
    "items_per_page": 20
  }
}
```

### GET /api/factories/{factory_id}

工場詳細を取得（Neptuneから）

**Response:**
```json
{
  "factory_id": "P001",
  "factory_name": "Tokyo_Assembly_Plant",
  "prefecture": "東京都",
  "city": "千代田区",
  "latitude": 35.6762,
  "longitude": 139.6503,
  "capacity": 500,
  "materials": ["Electronics", "Components"],
  "suppliers": [
    {
      "supplier_id": "P004",
      "supplier_name": "Miyakojima_Chip_Factory",
      "material": "Semiconductor"
    }
  ],
  "consumers": [
    {
      "consumer_id": "P009",
      "consumer_name": "Yokohama_Assembly",
      "material": "Electronics"
    }
  ]
}
```

### GET /api/impacted-factories

現在影響を受けている工場リストを取得（DynamoDBから、TTL未期限のみ）

**Query Parameters:**
- `impact_level` (optional: "high", "medium", "low")
- `limit` (default: 50)

**Response:**
```json
{
  "impacted_factories": [
    {
      "factory_id": "P004",
      "factory_name": "Miyakojima_Chip_Factory",
      "earthquake_id": "test_miyakojima_001",
      "impact_level": "high",
      "impacted_at": "2026-01-29T18:00:00Z",
      "expires_at": "2026-02-05T18:00:00Z",
      "earthquake_magnitude": 6.8,
      "earthquake_location": "宮古島近海",
      "downstream_affected_count": 2,
      "alternative_suppliers": ["P002", "P012"],
      "analysis_url": "https://s3.../impact-analysis/..._analysis.json",
      "graph_url": "https://s3.../impact-analysis/..._graph.png"
    }
  ],
  "total_count": 2
}
```

### GET /api/earthquakes

地震イベントリストを取得（S3から）

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 10)
- `from_date` (optional, ISO8601)
- `to_date` (optional, ISO8601)

**Response:**
```json
{
  "earthquakes": [
    {
      "earthquake_id": "test_miyakojima_001",
      "timestamp": "2026-01-29T18:00:00Z",
      "magnitude": 6.8,
      "location": "宮古島近海",
      "depth": 50,
      "max_scale": 60,
      "affected_factories_count": 2,
      "s3_data_url": "https://s3.../earthquakes/test_miyakojima_001.json",
      "s3_analysis_url": "https://s3.../impact-analysis/..._analysis.json",
      "s3_map_url": "https://s3.../maps/supply_chain_map_....html"
    }
  ],
  "pagination": {
    "current_page": 1,
    "total_pages": 10,
    "total_items": 95
  }
}
```

### GET /api/earthquakes/{earthquake_id}

地震イベント詳細を取得（S3から）

**Response:**
```json
{
  "earthquake_id": "test_miyakojima_001",
  "timestamp": "2026-01-29T18:00:00Z",
  "magnitude": 6.8,
  "location": "宮古島近海",
  "hypocenter": {
    "latitude": 24.8,
    "longitude": 125.4,
    "depth": 50
  },
  "max_scale": 60,
  "affected_points": [...],
  "impact_analysis": {
    "directly_affected": [...],
    "downstream_impact": [...],
    "alternative_suppliers": [...]
  },
  "s3_data_url": "https://s3.../earthquakes/test_miyakojima_001.json",
  "s3_analysis_url": "https://s3.../impact-analysis/..._analysis.json",
  "s3_graph_url": "https://s3.../impact-analysis/..._graph.png",
  "s3_map_url": "https://s3.../maps/supply_chain_map_....html"
}
```

### GET /api/supply-chain/graph

サプライチェーン関係グラフを取得（Neptuneから）

**Query Parameters:**
- `factory_id` (optional: 特定の工場を中心としたグラフ)
- `depth` (default: 2, 最大: 5)

**Response:**
```json
{
  "nodes": [
    {
      "id": "P001",
      "name": "Tokyo_Assembly_Plant",
      "type": "factory",
      "latitude": 35.6762,
      "longitude": 139.6503,
      "is_impacted": false
    }
  ],
  "edges": [
    {
      "source": "P004",
      "target": "P001",
      "material": "Semiconductor"
    }
  ]
}
```

## データストア責任分担

### Neptune Analytics
- **役割**: サプライチェーンマスタデータとグラフ関係の管理
- **データ**:
  - 工場マスタ（ID、名前、位置、生産能力、生産品目）
  - 都市・ロケーション情報
  - サプライチェーン関係（SUPPLIES_TO、SUPPLIES）
  - 供給関係の詳細（素材、数量）
- **クエリ**:
  - 工場リスト取得
  - 工場詳細取得
  - サプライヤー・消費者の検索
  - 影響範囲分析（下流への影響）
  - 代替サプライヤー検索

### S3
- **役割**: 大量の履歴データと分析結果の長期保存
- **データ**:
  - 地震データJSON（全履歴、無期限保存）
  - 影響分析結果JSON（詳細データ）
  - 影響グラフPNG（可視化）
  - インタラクティブ地図HTML（スナップショット）
- **アクセスパターン**:
  - 地震イベント一覧（S3 ListObjects）
  - 特定の地震詳細（S3 GetObject）
  - 分析結果のダウンロード

### DynamoDB（TTL有効）
- **役割**: 現在影響を受けている工場の一時的な状態管理
- **データ**:
  - 影響を受けた工場の状態（TTL付き）
  - 地震イベントとの紐付け
  - 影響レベル、期限切れ日時
  - S3の詳細データへのリンク
- **TTL動作**:
  - 地震発生時: レコード作成（TTL = 現在 + 7日）
  - 期限前: 工場は影響を受けている状態
  - 期限後: 自動削除（工場は復旧）
- **クエリ**:
  - 現在影響を受けている工場リスト
  - 特定の地震で影響を受けた工場
  - 影響レベル別の工場リスト

## データフロー例

### 地震発生時

```
1. 地震データがS3にアップロード
   ↓
2. Lambda関数がトリガー
   ↓
3. Neptuneで影響分析実行
   - 影響を受けた工場を特定
   - 下流への影響を計算
   - 代替サプライヤーを検索
   ↓
4. S3に結果を保存
   - 分析結果JSON
   - 影響グラフPNG
   - インタラクティブ地図HTML
   ↓
5. DynamoDBに影響工場を記録（TTL付き）
   - factory_id + earthquake_id
   - TTL = 現在時刻 + 7日
   - S3の分析結果へのリンク
```

### Webサイトでの表示

```
1. ユーザーが地図ページにアクセス
   ↓
2. API呼び出し
   - GET /api/factories (Neptune) → 全工場リスト
   - GET /api/impacted-factories (DynamoDB) → 影響工場リスト
   - GET /api/supply-chain/graph (Neptune) → サプライチェーン関係
   ↓
3. フロントエンドで統合
   - 工場マーカーを地図に表示
   - 影響工場を赤色でハイライト
   - サプライチェーン線を描画
   ↓
4. ユーザーが工場をクリック
   - GET /api/factories/{id} (Neptune) → 工場詳細
   - DynamoDBで影響状態を確認
   - 影響がある場合、S3の分析結果へのリンクを表示
```

### TTLによる自動復旧

```
1. 地震発生から7日経過
   ↓
2. DynamoDBがTTLをチェック
   ↓
3. 期限切れレコードを自動削除
   ↓
4. 次回のAPI呼び出し時
   - GET /api/impacted-factories → 該当工場が含まれない
   - フロントエンドで通常状態（青色）で表示
   ↓
5. 工場は自動的に復旧したと見なされる
```

### Phase 1: DynamoDB統合（2週間）

1. DynamoDBテーブル作成（CDK）
2. Lambda関数修正（DynamoDB書き込み追加）
3. API Gateway + Lambda（読み取りAPI）作成
4. 既存機能の動作確認

### Phase 2: フロントエンド開発（3週間）

1. React プロジェクトセットアップ
2. 地図コンポーネント実装
3. 工場リスト・詳細ページ実装
4. ダッシュボード実装
5. フィルタリング・ページング実装

### Phase 3: 統合・テスト（1週間）

1. フロントエンド・バックエンド統合
2. E2Eテスト
3. パフォーマンステスト
4. セキュリティレビュー

### Phase 4: デプロイ・運用（1週間）

1. CloudFront設定
2. CI/CDパイプライン構築
3. 監視・アラート設定
4. ドキュメント作成

## コスト見積もり

### 月間コスト（想定）

| サービス | 使用量 | 月額コスト（USD） |
|---------|--------|------------------|
| DynamoDB | 100万リクエスト/月 | $1.25 |
| API Gateway | 100万リクエスト/月 | $3.50 |
| Lambda | 100万実行/月 | $0.20 |
| CloudFront | 10GB転送/月 | $0.85 |
| S3 | 1GB保存 | $0.02 |
| **合計** | | **約$6/月** |

※ 実際のコストは使用量により変動します

## メリット

1. **リアルタイム性**: 最新情報を即座に反映
2. **ユーザビリティ**: 直感的なUI、高度な検索・フィルタリング
3. **スケーラビリティ**: DynamoDBの自動スケーリング
4. **保守性**: APIとフロントエンドの分離
5. **拡張性**: 新機能の追加が容易
6. **コスト効率**: サーバーレスアーキテクチャで低コスト

## 次のステップ

1. 提案内容のレビュー・承認
2. 詳細設計書の作成
3. Phase 1の実装開始
4. プロトタイプのデモ

---

**作成日**: 2026年1月29日  
**バージョン**: 1.0  
**ステータス**: 提案中
