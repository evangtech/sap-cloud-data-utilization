# EventTable データ設計書

外部システム連携向け EventTable クエリインターフェース仕様

---

## 1. 概要

### ■ 目的

EventTable は、SCMリスク監視システム（trend-monitor）が検知・判定したリスクイベントを格納する DynamoDB テーブルである。外部システム（ダッシュボード、通知基盤、BIツール等）がリスクイベントを照会し、対応アクションに繋げるためのデータストアとして機能する。

### ■ テーブル概要

| 項目 | 内容 |
|------|------|
| テーブル名 | `event-table-${StageName}` |
| 課金モード | PAY_PER_REQUEST（オンデマンド） |
| TTL | `ttl` 属性（作成から30日後に自動削除） |
| GSI数 | 2（GSI1: ステータス別、GSI2: カテゴリ別） |

### ■ データ投入元

| Lambda関数 | トリガー | 概要 |
|-----------|---------|------|
| FactChecker | S3 classified/ / facts/ イベント | AI分類結果・ファクトデータからリスクイベントを生成 |
| RoadwayFactChecker | RoadwayTraffic DynamoDB Streams | 交通規制情報からリスクイベントを生成 |

> EventTable は読み取り専用で利用すること。書き込みは上記 Lambda 関数のみが行う。

---

## 2. キー設計

### ■ プライマリキー

| キー | 属性名 | 型 | 値パターン | 説明 |
|------|--------|-----|-----------|------|
| Partition Key | `PK` | S | `EVT#{event_id}` | イベント単位の一意識別子（ULID） |
| Sort Key | `SK` | S | `META` | 固定値（将来の拡張用） |

### ■ GSI1（ステータス別検索）

| キー | 属性名 | 型 | 値パターン | 説明 |
|------|--------|-----|-----------|------|
| Partition Key | `GSI1PK` | S | `STATUS#{status}` | ステータス別パーティション |
| Sort Key | `GSI1SK` | S | `{created_at}` (ISO 8601) | 作成日時でソート |

### ■ GSI2（カテゴリ別検索）

| キー | 属性名 | 型 | 値パターン | 説明 |
|------|--------|-----|-----------|------|
| Partition Key | `GSI2PK` | S | `CAT#{category_id}` | カテゴリ別パーティション |
| Sort Key | `GSI2SK` | S | `{created_at}` (ISO 8601) | 作成日時でソート |

---

## 3. 属性一覧

### ■ 全属性定義

| # | 属性名 | 型 | 必須 | 説明 |
|---|--------|-----|:----:|------|
| 1 | `PK` | S | ○ | `EVT#{event_id}` |
| 2 | `SK` | S | ○ | `META`（固定値） |
| 3 | `GSI1PK` | S | ○ | `STATUS#{status}` |
| 4 | `GSI1SK` | S | ○ | 作成日時（ISO 8601） |
| 5 | `GSI2PK` | S | ○ | `CAT#{category_id}` |
| 6 | `GSI2SK` | S | ○ | 作成日時（ISO 8601） |
| 7 | `event_id` | S | ○ | ULID形式の一意識別子 |
| 8 | `status` | S | ○ | イベントステータス（後述） |
| 9 | `category_id` | S | ○ | リスクカテゴリID（後述） |
| 10 | `category_name` | S | ○ | リスクカテゴリ日本語名 |
| 11 | `summary` | S | ○ | 影響要約（最大200文字） |
| 12 | `source_type` | S | ○ | イベント起点種別（後述） |
| 13 | `ai_confidence` | N | − | AI分類信頼度（0〜100）。fact起点時は未設定 |
| 14 | `fact_score` | N | ○ | ファクト照合スコア合計 |
| 15 | `final_confidence` | N | ○ | 最終信頼度（0〜100） |
| 16 | `risk_level` | N | ○ | リスクレベル（1/2/3） |
| 17 | `related_nodes` | L | ○ | 影響を受けるサプライチェーンノード一覧 |
| 18 | `fact_sources` | L | ○ | ファクトソース一覧 |
| 19 | `classified_s3_key` | S | − | 元の classified/ S3キー（nullable） |
| 20 | `raw_s3_key` | S | − | 元の raw/ S3キー（nullable） |
| 21 | `created_at` | S | ○ | 作成日時（ISO 8601 UTC） |
| 22 | `updated_at` | S | ○ | 最終更新日時（ISO 8601 UTC） |
| 23 | `reviewed_by` | S | − | 人的確認者（将来用、nullable） |
| 24 | `ttl` | N | ○ | TTLエポック秒（created_at + 30日） |

---

## 4. 列挙値定義

### ■ status（イベントステータス）

| 値 | 意味 | final_confidence 範囲 |
|----|------|:--------------------:|
| `CONFIRMED` | 確定リスク。公式データで裏付けあり | 80〜100 |
| `PENDING` | 要確認。情報はあるが公式裏付け不十分 | 50〜79 |
| `WATCHING` | 監視継続。リスク兆候はあるが影響限定的 | 30〜49 |
| `DISMISSED` | 除外。誤検知または無関係 | 0〜29 |

> ステータスは原則上昇方向のみ更新される（WATCHING → PENDING → CONFIRMED）。
> ただし final_confidence が30ポイント以上低下した場合はダウングレードされる。

### ■ category_id（リスクカテゴリ）

| category_id | category_name | 概要 |
|-------------|--------------|------|
| `earthquake` | 地震・津波 | 気象庁データ・ニュース・SNS |
| `flood` | 風水害 | 台風・豪雨・洪水 |
| `fire` | 火災・爆発 | 工場火災・爆発事故 |
| `traffic` | 交通障害 | 道路通行止め・鉄道運休 |
| `infra` | 停電・インフラ障害 | 停電・断水・通信障害 |
| `labor` | 労務・操業リスク | ストライキ・操業停止・倒産 |
| `geopolitics` | 地政学・貿易 | 輸出規制・制裁・関税 |
| `pandemic` | 感染症 | 感染拡大・ロックダウン |

### ■ source_type（イベント起点種別）

| 値 | 説明 |
|----|------|
| `classified` | CategoryClassifier のAI分類結果を起点に生成 |
| `fact` | ファクトデータ（JMA/ニュース/公式SNS）を起点に生成 |
| `roadway` | 交通規制情報（RoadwayTraffic DynamoDB Streams）を起点に生成 |

### ■ risk_level（リスクレベル）

| level | 条件 | 通知レベル（将来） |
|:-----:|------|------------------|
| 3 | CONFIRMED かつ重大事象（震度5以上、主要道路通行止め等） | 即時電話＋メール＋Slack |
| 2 | relevance_score 60以上 | メール＋Slack |
| 1 | 上記以外 | Slackのみ / ダッシュボード |

---

## 5. ネスト属性詳細

### ■ related_nodes 要素

`related_nodes` はリスト型（L）で、各要素は以下の構造を持つ。

| 属性名 | 型 | 説明 |
|--------|-----|------|
| `id` | S | サプライチェーンノードID（例: `PLT001`） |
| `name` | S | ノード名称（例: `豊田組立工場`） |
| `node_type` | S | ノード種別（`plant` / `warehouse` / `supplier` / `port` / `road` 等） |
| `impact_summary` | S | 影響概要（AI生成テキスト） |
| `relevance_score` | N | 関連度スコア（0〜100） |

サンプル:

```json
{
  "id": "PLT001",
  "name": "豊田組立工場",
  "node_type": "plant",
  "impact_summary": "震度4の揺れにより生産ライン停止の可能性",
  "relevance_score": 90
}
```

### ■ fact_sources 要素

`fact_sources` はリスト型（L）で、各要素は以下の構造を持つ。

| 属性名 | 型 | 説明 |
|--------|-----|------|
| `source` | S | ソース種別（`jma` / `roadway` / `news` / `google_news` / `official`） |
| `data_type` | S | データ種別（`quake_list` / `tsunami` / `typhoon` / `article` 等） |
| `matched_text` | S | マッチしたテキスト抜粋（最大200文字） |
| `matched_at` | S | マッチ日時（ISO 8601 UTC） |
| `score_added` | N | 加算されたスコア |

サンプル:

```json
{
  "source": "jma",
  "data_type": "quake_list",
  "matched_text": "愛知県西部 震度5弱 豊田市:震度4",
  "matched_at": "2026-03-19T14:25:00Z",
  "score_added": 80
}
```

### ■ fact_sources.score_added 加算ルール

| ソース | マッチ条件 | score_added |
|--------|----------|:-----------:|
| JMA（気象庁） | 拠点所在地の震度/津波/台風 | 80 |
| Roadway（道路交通情報） | 拠点関連道路の通行止め | 80 |
| News（3件以上） | 信頼メディア3件以上マッチ | 50 |
| News（1〜2件） | 信頼メディア1件以上マッチ | 30 |
| Official（公式SNS） | 公式アカウントのツイートマッチ | 40 |

---

## 6. アクセスパターン

外部システムが EventTable を照会する際の推奨クエリパターン。

### ■ パターン一覧

| # | ユースケース | 操作 | 使用インデックス | キー条件 |
|---|------------|------|----------------|---------|
| 1 | 確定リスク一覧取得 | Query | GSI1 | `GSI1PK = "STATUS#CONFIRMED"` |
| 2 | 要確認イベント一覧取得 | Query | GSI1 | `GSI1PK = "STATUS#PENDING"` |
| 3 | 監視中イベント一覧取得 | Query | GSI1 | `GSI1PK = "STATUS#WATCHING"` |
| 4 | カテゴリ別イベント取得 | Query | GSI2 | `GSI2PK = "CAT#{category_id}"` |
| 5 | カテゴリ別・直近N時間 | Query | GSI2 | `GSI2PK = "CAT#{category_id}", GSI2SK > {N時間前のISO 8601}` |
| 6 | 特定イベント取得 | GetItem | テーブル本体 | `PK = "EVT#{event_id}", SK = "META"` |
| 7 | 最新の確定リスク（降順） | Query | GSI1 | `GSI1PK = "STATUS#CONFIRMED"`, ScanIndexForward=false, Limit=N |

### ■ クエリ例

#### パターン1: 確定リスク一覧（最新順）

```python
response = table.query(
    IndexName="GSI1",
    KeyConditionExpression=Key("GSI1PK").eq("STATUS#CONFIRMED"),
    ScanIndexForward=False,  # 降順（最新順）
    Limit=50,
)
```

#### パターン4: カテゴリ別イベント取得（地震）

```python
response = table.query(
    IndexName="GSI2",
    KeyConditionExpression=Key("GSI2PK").eq("CAT#earthquake"),
    ScanIndexForward=False,
)
```

#### パターン5: カテゴリ別・直近24時間

```python
from datetime import datetime, timedelta, timezone

since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

response = table.query(
    IndexName="GSI2",
    KeyConditionExpression=(
        Key("GSI2PK").eq("CAT#traffic") &
        Key("GSI2SK").gte(since)
    ),
)
```

#### パターン6: 特定イベント取得

```python
response = table.get_item(
    Key={"PK": f"EVT#{event_id}", "SK": "META"}
)
```

---

## 7. 信頼度スコア計算ロジック

外部システムが `final_confidence` の意味を理解するための参考情報。

### ■ final_confidence 算出方式

```
classified 起点（ai_confidence あり）:
  capped_fact = min(fact_score, 100)
  final_confidence = int(0.6 × ai_confidence + 0.4 × capped_fact)

fact 起点（ai_confidence なし）:
  final_confidence = min(fact_score, 100)

収束時（classified + fact が合流）:
  ai_confidence が後から付与された場合、上記の加重平均方式で再計算
```

### ■ 収束型イベントモデル

同一事象について複数ソースが時間差で情報をもたらす場合、新規イベントを作成せず既存イベントに統合（マージ）される。

重複判定条件:
```
category_id + related_nodes[].id + time_window（2時間以内）
```

統合時の動作:
- `fact_sources` に新しいソースを追加
- `fact_score` を全 fact_sources の score_added 合計で再計算
- `final_confidence` を再計算
- `status` は上昇方向のみ更新（例外: confidence が30ポイント以上低下時はダウングレード）
- `related_nodes` に新しいノードを追加（既存ノードは保持）
- `risk_level` は上昇方向のみ更新
- `updated_at` を更新

---

## 8. 注意事項

### ■ TTL による自動削除

- `ttl` 属性に `created_at + 30日` のエポック秒が設定されている
- DynamoDB の TTL 機能により、期限切れアイテムは自動削除される
- 削除タイミングは DynamoDB の内部スケジュールに依存し、即時ではない（通常48時間以内）
- 長期保存が必要な場合は、外部システム側でデータをエクスポートすること

### ■ 結果整合性

- GSI（GSI1/GSI2）は結果整合性モデルである
- 書き込み直後のクエリでは最新データが反映されていない場合がある
- リアルタイム性が求められる場合は、テーブル本体への GetItem を使用すること

### ■ ページネーション

- Query 結果が1MB を超える場合、`LastEvaluatedKey` が返却される
- 全件取得が必要な場合は、`ExclusiveStartKey` を使用してページネーションを実装すること

### ■ IAM 権限

外部システムから EventTable を照会するには、以下の IAM アクションが必要:

```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:Query",
    "dynamodb:GetItem"
  ],
  "Resource": [
    "arn:aws:dynamodb:{region}:{account_id}:table/event-table-{stage}",
    "arn:aws:dynamodb:{region}:{account_id}:table/event-table-{stage}/index/*"
  ]
}
```

---

## 9. レスポンスサンプル

### ■ 完全なイベントアイテム例

```json
{
  "PK": "EVT#01JQXYZ1234567890ABCDEF",
  "SK": "META",
  "GSI1PK": "STATUS#CONFIRMED",
  "GSI1SK": "2026-03-19T14:25:00+00:00",
  "GSI2PK": "CAT#earthquake",
  "GSI2SK": "2026-03-19T14:25:00+00:00",
  "event_id": "01JQXYZ1234567890ABCDEF",
  "status": "CONFIRMED",
  "category_id": "earthquake",
  "category_name": "地震・津波",
  "summary": "愛知県西部で震度5弱を観測。豊田組立工場周辺で震度4、生産ライン停止の可能性。",
  "source_type": "fact",
  "ai_confidence": 75,
  "fact_score": 160,
  "final_confidence": 85,
  "risk_level": 3,
  "related_nodes": [
    {
      "id": "PLT001",
      "name": "豊田組立工場",
      "node_type": "plant",
      "impact_summary": "震度4の揺れにより生産ライン停止の可能性",
      "relevance_score": 90
    }
  ],
  "fact_sources": [
    {
      "source": "jma",
      "data_type": "quake_list",
      "matched_text": "愛知県西部 震度5弱 豊田市:震度4",
      "matched_at": "2026-03-19T14:25:00Z",
      "score_added": 80
    },
    {
      "source": "news",
      "data_type": "article",
      "matched_text": "愛知県で震度5弱の地震 豊田市で被害確認",
      "matched_at": "2026-03-19T14:30:00Z",
      "score_added": 50
    },
    {
      "source": "official",
      "data_type": "tweet",
      "matched_text": "@UN_NERV 【地震情報】愛知県西部 最大震度5弱",
      "matched_at": "2026-03-19T14:26:00Z",
      "score_added": 40
    }
  ],
  "classified_s3_key": "classified/earthquake/2026-03-19T14-28-00Z.json",
  "raw_s3_key": null,
  "created_at": "2026-03-19T14:25:00+00:00",
  "updated_at": "2026-03-19T14:30:00+00:00",
  "reviewed_by": null,
  "ttl": 1745330700
}
```
