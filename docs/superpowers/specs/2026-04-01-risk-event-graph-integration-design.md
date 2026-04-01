# RiskEvent グラフ統合設計書

> サプライチェーンリスク予測システムにリスクイベントをグラフのファーストクラスエンティティとして統合し、リスクスコアリング、ルート分析、復旧追跡、相関分析を実現する。

---

## 1. グラフスキーマ

### 1.1 新規頂点

#### RiskEvent

| プロパティ | 型 | 説明 |
|----------|------|-------------|
| `id` | string (PK) | UUID v4 |
| `sourceEventId` | string | 元データソースのID |
| `dedupeKey` | string | クロスソース重複排除用ハッシュ |
| `title` | string | 人間が読める概要 (例: "大阪府北部 M6.1 地震") |
| `description` | string | 詳細説明 |
| `eventType` | string | `earthquake`, `typhoon`, `flood`, `port_closure`, `sanction`, `trade_restriction`, `supplier_bankruptcy`, `pandemic`, `factory_incident` |
| `source` | string | `p2pquake`, `gdacs`, `usgs`, `manual`, `ai_extracted` |
| `severity` | int (1-5) | 1=軽微 ~ 5=壊滅的 |
| `lifecycleStatus` | string | `detected`, `active`, `recovering`, `resolved` |
| `reviewStatus` | string | `pending`, `confirmed`, `watching`, `dismissed` |
| `reviewedBy` | string (nullable) | 確認者 (`system` = 自動確認) |
| `reviewedAt` | ISO datetime (nullable) | 確認日時 |
| `trustLevel` | string | `trusted_machine`, `ai_unverified`, `analyst` |
| `lat` | float | 発生地点 緯度 |
| `lon` | float | 発生地点 経度 |
| `radiusKm` | float | 影響半径 |
| `geoScopeType` | string | `point`, `city`, `region`, `country`, `multi_country` |
| `admin1` | string (nullable) | 都道府県/州 |
| `admin2` | string (nullable) | 市区町村 |
| `locationName` | string | 人間が読める地名 |
| `affectedCountryCodes` | string[] | 影響を受ける国コード群 |
| `startDate` | ISO datetime | 発生日時 |
| `endDate` | ISO datetime (nullable) | 終息日時 |
| `updatedAt` | ISO datetime | 最終更新日時 |
| `sourceUrl` | string (nullable) | 元データリンク |
| `sourceSnippetHash` | string (nullable) | AI抽出時の元テキストSHA-256 |
| `confidence` | float (0-1) | AI抽出時の信頼度 |
| `latestPropagationRunId` | string (nullable) | 最新完了伝播実行ID |
| `latestPropagationSequence` | int | 単調増加の伝播順序番号 |
| `propagationStartedAt` | ISO datetime (nullable) | 最新伝播開始日時 |
| `propagationCompletedAt` | ISO datetime (nullable) | 最新伝播完了日時 |

#### RiskCategory

| プロパティ | 型 | 説明 |
|----------|------|-------------|
| `id` | string (PK) | `RC-natural-earthquake` 等 |
| `name` | string | "地震" 等 |
| `parentCategory` | string | `natural_disaster`, `geopolitical`, `operational`, `financial` |
| `description` | string | カテゴリ説明 |
| `avgRecoveryDays` | int | 履歴ベースの平均復旧日数 |

#### LogisticsHub

| プロパティ | 型 | 説明 |
|----------|------|-------------|
| `id` | string (PK) | `LH-tokyo-port` 等 |
| `name` | string | "東京港" 等 |
| `type` | string | `port`, `airport`, `border_crossing` |
| `country_code` | string | 国コード |
| `lat` | float | 緯度 |
| `lon` | float | 経度 |
| `capacity` | string (nullable) | 処理能力 (TEU/年等) |
| `status` | string | `operational`, `disrupted`, `closed` |

### 1.2 新規辺

| 辺 | From → To | プロパティ | 用途 |
|------|-----------|------------|---------|
| `CATEGORIZED_AS` | RiskEvent → RiskCategory | — | リスク分類 |
| `OCCURRED_IN` | RiskEvent → Country | — | 発生国 |
| `IMPACTS` | RiskEvent → Plant\|Supplier\|Warehouse\|Material\|LogisticsHub | `severity` (1-5), `impactType` (direct/downstream), `estimatedRecoveryDays`, `costImpactPct`, `status` (active/recovering/resolved), `firstDetectedAt`, `lastUpdatedAt`, `resolvedAt`, `impactConfidence` (0-1), `assessmentMethod` (automated/manual_override/ai_assisted), `cachedImpactAmount` (JPY), `propagationRunId`, `overrideReviewStatus` (active/stale/dismissed, 手動上書きのみ), `supersededByRunId` (手動上書きのみ) | ノード影響関係 |
| `DISRUPTS` | RiskEvent → HSCode | `originCountry`, `destinationCountry`, `regulatorBody`, `effectiveDate`, `expiryDate`, `tariffIncreasePct`, `exportRestricted` (bool) | 貿易・関税影響 |
| `RELATED_EVENT` | RiskEvent → RiskEvent | `relationshipType` (triggers/contributes_to/coincident/supersedes/empirical), `delayDays`, `confidence` | イベント間の因果・相関 |
| `LOCATED_IN` | LogisticsHub → Country | — | 既存パターンと統一 |
| `ROUTES_THROUGH` | Plant\|Supplier\|Warehouse → LogisticsHub | `transitDays`, `isPrimary` (bool) | サプライルートと物流拠点の接続 |

### 1.3 既存スキーマへの影響

既存の頂点・辺に破壊的変更なし。RiskEventは新規辺のみで既存ノードに接続する。

---

## 2. クエリパターンとリスクスコアリング

### 2.1 リスクスコアモデル — 三層アーキテクチャ

**Layer 1: `baselineRisk`** — 構造的・緩慢変動。Country上の既存`geopolitical_risk`、Supplier上の`credit_score`/`sanction_status`。四半期更新。変更なし。

**Layer 2: `liveEventRisk`** — 運用的・イベント駆動。アクティブ/復旧中のIMPACTSエッジから算出:

```cypher
MATCH (p:Plant)<-[i:IMPACTS]-(re:RiskEvent)
WHERE i.status IN ['active', 'recovering']
  AND re.reviewStatus = 'confirmed'
WITH p, i, re,
     i.severity
       * i.impactConfidence
       * (1.0 / (1 + (epochMillis(datetime()) - epochMillis(re.startDate)) / 2592000000.0))
       * CASE i.impactType WHEN 'direct' THEN 1.0 ELSE 0.5 END AS eventWeight
RETURN p.id, p.name,
       sum(eventWeight) AS liveEventRisk,
       count(re) AS activeEventCount
ORDER BY liveEventRisk DESC
```

**Layer 3: `combinedOperationalRisk`** — 事業重要度加重スコア。ライブリスク × ノード重要度:

```cypher
MATCH (p:Plant)<-[i:IMPACTS]-(re:RiskEvent)
WHERE i.status IN ['active', 'recovering']
  AND re.reviewStatus = 'confirmed'
WITH p,
     sum(i.severity * i.impactConfidence
       * (1.0 / (1 + (epochMillis(datetime()) - epochMillis(re.startDate)) / 2592000000.0))
       * CASE i.impactType WHEN 'direct' THEN 1.0 ELSE 0.5 END
     ) AS liveEventRisk,
     count(re) AS activeEventCount
OPTIONAL MATCH (p)-[:SUPPLIES_TO*1..3]->(c:Customer)<-[o:ORDERED_BY]-(prod:Product)
WITH p, liveEventRisk, activeEventCount,
     coalesce(sum(o.annual_order_qty * o.unit_price_jpy), 0) AS revenueExposure
OPTIONAL MATCH (p)-[:LOCATED_IN]->(country:Country)
RETURN p.id, p.name,
       country.geopolitical_risk AS baselineRisk,
       liveEventRisk,
       revenueExposure,
       liveEventRisk * (1 + log(1 + revenueExposure / 100000000.0)) AS combinedOperationalRisk,
       activeEventCount
ORDER BY combinedOperationalRisk DESC
```

全リスクスコアリングクエリは `re.reviewStatus = 'confirmed'` を必須フィルタとする。未確認イベント（AI抽出等）はスコアに影響しない。

### 2.2 サプライルート分析 — チョークポイント + ルート健全性

```cypher
MATCH path = (s:Supplier)-[:SUPPLIES_TO*1..4]->(c:Customer)
WITH path, nodes(path) AS pathNodes, s, c
UNWIND pathNodes AS node
OPTIONAL MATCH (node)<-[i:IMPACTS]-(re:RiskEvent)
  WHERE i.status IN ['active', 'recovering']
    AND re.reviewStatus = 'confirmed'
WITH path, s, c, node,
     coalesce(sum(i.severity * i.impactConfidence), 0) AS nodeRisk,
     coalesce(max(i.cachedImpactAmount), 0) AS nodeExposure
WITH path, s, c,
     max(nodeRisk) AS chokePointScore,
     avg(nodeRisk) AS avgRouteRisk,
     sum(nodeRisk) AS rawRiskSum,
     [n IN collect({name: node.name, risk: nodeRisk, exposure: nodeExposure})
       WHERE n.risk > 0] AS riskyNodes,
     length(path) AS hops
RETURN s.name AS origin, c.name AS destination,
       chokePointScore, avgRouteRisk, rawRiskSum,
       hops, riskyNodes
ORDER BY chokePointScore DESC, avgRouteRisk DESC
```

- `chokePointScore`: 経路上の最弱リンク特定（緩和判断用）
- `avgRouteRisk`: ルート全体の健全性（ルート比較用）
- `rawRiskSum`: 二次指標として保持

### 2.3 HSコード貿易レーンリスク

```cypher
MATCH (re:RiskEvent)-[d:DISRUPTS]->(hs:HSCode {code: $hsCode})
WHERE re.lifecycleStatus IN ['active', 'recovering']
  AND re.reviewStatus = 'confirmed'
WITH d.originCountry AS origin, d.destinationCountry AS dest,
     max(d.tariffIncreasePct) AS currentTariffBurden,
     max(re.severity) AS maxSeverity,
     count(re) AS activeDisruptions,
     collect(DISTINCT {event: re.title, restricted: d.exportRestricted,
                       effective: d.effectiveDate}) AS measures
RETURN origin, dest, currentTariffBurden, maxSeverity,
       activeDisruptions, measures
ORDER BY maxSeverity DESC, currentTariffBurden DESC
```

`max(tariffIncreasePct)` — 重複措置は最新/最大の有効措置で評価。累積合計ではない。

### 2.4 復旧ダッシュボード

```cypher
MATCH (re:RiskEvent)-[i:IMPACTS]->(target)
WHERE re.lifecycleStatus <> 'resolved'
  AND re.reviewStatus = 'confirmed'
WITH re,
     count(CASE WHEN i.status = 'active' THEN 1 END) AS activeImpacts,
     count(CASE WHEN i.status = 'recovering' THEN 1 END) AS recoveringImpacts,
     count(CASE WHEN i.status = 'resolved' THEN 1 END) AS resolvedImpacts,
     sum(CASE WHEN i.status <> 'resolved'
         THEN i.cachedImpactAmount ELSE 0 END) AS outstandingExposureJpy,
     avg(CASE WHEN i.status <> 'resolved'
         THEN i.estimatedRecoveryDays END) AS avgRemainingRecoveryDays
RETURN re.id, re.title, re.severity, re.lifecycleStatus,
       activeImpacts, recoveringImpacts, resolvedImpacts,
       outstandingExposureJpy, avgRemainingRecoveryDays
ORDER BY outstandingExposureJpy DESC
```

イベントライフサイクルとエッジステータスの両方でフィルタ。イベントがアクティブでも一部ノードは既に復旧済の可能性がある。

### 2.5 因果チェーンナビゲーション vs 経験的相関発見

**Feature A: 因果チェーンナビゲーション** — モデル化されたRELATED_EVENTの走査:

```cypher
MATCH chain = (origin:RiskEvent)-[:RELATED_EVENT*1..3]->(downstream:RiskEvent)
WHERE origin.lifecycleStatus IN ['active', 'recovering']
  AND origin.reviewStatus = 'confirmed'
WITH origin, downstream, chain,
     [r IN relationships(chain) | {type: r.relationshipType, confidence: r.confidence}] AS links
RETURN origin.title AS triggerEvent,
       downstream.title AS resultingEvent,
       links, length(chain) AS depth
ORDER BY depth DESC, downstream.severity DESC
```

**Feature B: 経験的同時発生パターン発見** — データからのパターン発見:

```cypher
MATCH (re1:RiskEvent)-[:OCCURRED_IN]->(c:Country {code: $countryCode})
MATCH (re2:RiskEvent)-[:OCCURRED_IN]->(c2:Country)
WHERE re1 <> re2
  AND abs(epochMillis(re1.startDate) - epochMillis(re2.startDate)) < $timeWindowMs
WITH re1.eventType AS eventTypeA, re2.eventType AS eventTypeB,
     c.code AS regionA, c2.code AS regionB,
     count(*) AS coOccurrences
WHERE coOccurrences >= $minOccurrences
RETURN eventTypeA, regionA, eventTypeB, regionB,
       coOccurrences
ORDER BY coOccurrences DESC
```

発見されたパターンは `RELATED_EVENT` エッジ (`relationshipType: 'empirical'`) として書き戻し可能。

### 2.6 複合リスク検出

```cypher
MATCH (re:RiskEvent)-[i:IMPACTS]->(target)
WHERE i.status IN ['active', 'recovering']
  AND re.reviewStatus = 'confirmed'
WITH target, labels(target)[0] AS nodeType,
     count(DISTINCT re) AS simultaneousEvents,
     collect({event: re.title, severity: i.severity, type: re.eventType}) AS events,
     sum(i.cachedImpactAmount) AS totalExposure
WHERE simultaneousEvents >= 2
RETURN target.id, target.name, nodeType,
       simultaneousEvents, totalExposure, events
ORDER BY simultaneousEvents DESC, totalExposure DESC
```

### 2.7 時系列リスク履歴

```cypher
MATCH (re:RiskEvent)-[i:IMPACTS]->(target {id: $nodeId})
WHERE epochMillis(re.startDate) >= epochMillis(datetime()) - 31536000000
  AND re.reviewStatus = 'confirmed'
RETURN re.id, re.title, re.eventType, re.severity,
       re.startDate, re.endDate, re.lifecycleStatus,
       i.estimatedRecoveryDays, i.costImpactPct,
       i.assessmentMethod
ORDER BY re.startDate DESC
```

### 2.8 過去類似イベント検索（What-If基盤）

```cypher
MATCH (re:RiskEvent)-[:CATEGORIZED_AS]->(rc:RiskCategory {parentCategory: $parentCategory})
WHERE re.eventType = $eventType
  AND re.reviewStatus = 'confirmed'
MATCH (re)-[i:IMPACTS]->(target)
WITH re, avg(i.estimatedRecoveryDays) AS avgRecovery,
     sum(i.cachedImpactAmount) AS totalImpact,
     count(target) AS affectedNodes
RETURN re.title, re.severity, re.startDate, re.endDate,
       avgRecovery, totalImpact, affectedNodes
ORDER BY re.startDate DESC
LIMIT 5
```

### 2.9 NLクエリスキーマ拡張

`nl-query/handler.ts` のBedrockプロンプトに以下を追加:
- RiskEvent, RiskCategory, LogisticsHub頂点定義
- IMPACTS, DISRUPTS, RELATED_EVENT, ROUTES_THROUGH辺定義
- リスクスコアリングガイダンス
- リスク関連NL→クエリマッピング例

---

## 3. データ取り込みと移行アーキテクチャ

### 3.1 概要

全リスクイベントソースは単一の取り込みパイプラインを使用する。ソース固有の取得ロジックは異なるが、正規化・重複排除・永続化・アーカイブ・影響伝播は共通パスに従う。

**基本原則:** 一つの書き込みパス、一つの情報源。

```text
Automated Feeds      AI Extraction      Manual Entry
      |                   |                  |
      +-------- RawRiskEvent / input --------+
                          |
                          v
                 RiskEventService
        1. normalize and enrich input
        2. resolve canonical event by dedupeKey
        3. upsert RiskEvent in Neptune
        4. archive raw payload to S3
        5. invoke impact_propagator
                          |
                          v
                 impact_propagator
        1. compute direct impacts
        2. compute downstream impacts
        3. compute logistics impacts
        4. write versioned IMPACTS edges
        5. promote latest completed run
```

Neptuneが全リスクイベントデータの情報源。DynamoDBは条件付き書き込みや同時実行制御が必要な運用上の関心事にのみ使用。

### 3.2 アーキテクチャ原則

- 全チャネルは一つの共通取り込み契約に収束する
- 全イベントは `dedupeKey` を持つ
- リスクスコアリングクエリは `RiskEvent.reviewStatus = 'confirmed'` のみ考慮する
- 影響伝播はイベント単位かつ冪等
- 派生影響は追加ではなく再計算
- アナリスト上書きは保持・バージョン管理・監査可能
- ワークフロー検証はアプリケーションロジックに永続的に所在する（Neptuneはワークフローエンジンにならない）

### 3.3 共通取り込みパス: `RiskEventService`

`RiskEventService` は全チャネルが使用する共有Lambda内モジュール。独立したマイクロサービスではなく、各取り込みエントリポイントから呼び出される共通書き込みパス。

**責務:**
- 入力を正規的な `RiskEvent` 形式に正規化
- `dedupeKey` の計算と検証
- 正規的イベントIDの解決
- NeptuneへのRiskEvent upsert
- 生ソースペイロードのS3アーカイブ
- `impact_propagator` の呼び出し
- ソース信頼ポリシーの適用
- チャネル間で一貫したデフォルトメタデータの強制

**デフォルト信頼・レビュー動作:**

| ソース種別 | trustLevel | reviewStatus | reviewedBy | reviewedAt | スコア影響 |
|---|---|---|---|---|---|
| `p2pquake`, `usgs`, `gdacs` | `trusted_machine` | `confirmed` | `system` | 取り込み時に設定 | あり |
| `ai_extracted` | `ai_unverified` | `pending` | null | null | なし（確認まで） |
| `manual` | `analyst` | `confirmed` | アナリストユーザー | 取り込み時に設定 | あり |

### 3.4 取り込みチャネル

#### 3.4.1 チャネル1: 自動フィード

自動プロバイダーはスケジュールでポーリングし、正規的な `RawRiskEvent` ペイロードに変換。

**フロー:**
- EventBridgeスケジュールルール → `risk_event_ingester` Lambda → プロバイダー固有のフェッチとカーソル前進 → `RiskEventService.ingest()`

**プロバイダー契約:**
- カーソルベースのイベント取得（タイムスタンプだけではない）
- ソースネイティブIDと更新タイムスタンプの返却
- 共有取り込み用の正規的な生ペイロード出力

**プロバイダーカーソル格納:**
DynamoDBのみ。テーブル: `risk-event-provider-cursors`

| フィールド | 用途 |
|---|---|
| `providerId` | プロバイダーキー (`p2pquake`, `gdacs`, `usgs`) |
| `lastSourceEventId` | 最終取り込みソースイベント |
| `lastUpdatedAt` | 最終ソース更新タイムスタンプ |
| `providerSpecific` | ページングトークン、オフセット等 |
| `lastFetchedAt` | 最終ポーリング成功日時 |
| `version` | 同時実行時の楽観的ロック |

カーソル更新は `version` に対する条件付き書き込みを使用すること。

#### 3.4.2 チャネル2: AI支援抽出

非構造化テキストをBedrockで構造化リスクイベントに変換し、同じ取り込みパスを通す。

**フロー:**
- 生ドキュメントを `S3/raw_alerts/...` に格納 → `risk_event_extractor` Lambda → Bedrock構造化抽出 → `RiskEventService.ingest()`

**トレーサビリティフィールド:**
- `sourceUrl`
- `sourceSnippetHash` (元テキストのSHA-256)
- S3生ドキュメントポインタ
- `confidence`
- `trustLevel = ai_unverified`
- `reviewStatus = pending`

AI抽出イベントは明示的に確認されるまでリスクスコアに影響しない。

#### 3.4.3 チャネル3: 手動入力

アナリストはAppSyncミューテーション経由でイベントを作成・管理。

**サポートされる操作:**
- `createRiskEvent`
- `updateRiskEventLifecycle`
- `overrideRiskEventImpact`

手動影響変更はオーバーライドとしてモデル化（汎用エッジ挿入ではない）。

**オーバーライド必須フィールド:**
- `reason` — なぜ手動で上書きするのか
- `reviewedBy` — 誰が上書きしたのか
- `assessmentMethod = manual_override`
- `overrideReviewStatus` — active/stale/dismissed
- `supersededByRunId`（オプション）

これにより自動伝播とアナリスト介入が区別可能になる。

### 3.5 重複排除と同時実行制御

重複排除には正規的ID管理と安全な同時処理の両方が必要。別々のDynamoDBテーブルで管理する。

#### 3.5.1 正規的イベントレジストリ

テーブル: `risk-event-registry`

| フィールド | 用途 |
|---|---|
| `dedupeKey` | 正規的イベントIDキー |
| `eventId` | Neptune上の正規的 `RiskEvent.id` |
| `createdAt` | 初回登録日時 |
| `updatedAt` | 最終レジストリ更新日時 |

TTLなし。`dedupeKey` と正規的イベントの永続的マッピング。

#### 3.5.2 短期取り込みロック

テーブル: `risk-event-ingest-lock`

| フィールド | 用途 |
|---|---|
| `dedupeKey` | ロックキー |
| `lockedAt` | 取得日時 |
| `lockedBy` | 実行IDまたはチャネル |
| `ttl` | 短期リース期限 (数分) |

同時取り込みレースの防止用。短期リースでリトライセーフ。

**処理モデル:**
1. `dedupeKey` に対する短期ロックを取得
2. レジストリから正規的イベントマッピングを読み取り
3. Neptune頂点をupsert
4. 必要に応じてレジストリを更新
5. ロックを解放またはTTL期限切れ

### 3.6 影響伝播

`impact_propagator` は単一イベントの全派生 `IMPACTS` エッジを計算する。

**中心ルール:** イベントの影響セットを再計算する。増分追加しない。

**スコープ:**
- 地理的近接による直接影響
- `SUPPLIES_TO*1..3` による下流影響
- `ROUTES_THROUGH` による物流影響
- `cachedImpactAmount` 等の財務集計キャッシュ

### 3.7 バージョン管理付き伝播とクラッシュ安全性

伝播はステージドバージョニングを使用する（削除してから書き込みではない）。

**伝播モデル:**
1. 新しい `propagationRunId` を割り当て
2. 新しい影響セットを計算
3. その `propagationRunId` で新しい派生IMPACTSエッジを書き込み
4. 実行完了をマーク
5. 実行をRiskEvent上で現行として昇格
6. 古い派生実行を削除
7. アナリスト上書きの陳腐化を再評価

**昇格ルール（compare-and-swap）:**
昇格は、完了した実行の `propagationSequence` がRiskEvent頂点の現在の `latestPropagationSequence` より大きい場合のみ成功する。より新しい実行が既に昇格されている場合、遅延完了した実行は昇格をスキップし、古い実行のエッジではなく自身のエッジを削除する。

**削除対象は昇格結果に依存:**
- 昇格成功 → 新しく昇格した実行より古い全実行のエッジを削除
- 昇格スキップ（より新しい実行が既に現行）→ 現行実行のエッジを削除

**RiskEvent上の必須フィールド:**
- `latestPropagationRunId`
- `latestPropagationSequence`（単調増加）
- `propagationStartedAt`
- `propagationCompletedAt`

**派生エッジ上の必須フィールド:**
- `propagationRunId`
- `assessmentMethod`
- キャッシュ済み影響メトリクス

**オーバーライドエッジ上の必須フィールド:**
- `overrideReviewStatus` (active/stale/dismissed)
- `supersededByRunId`

ゼロインパクトウィンドウの防止と順序外完了からの保護を実現。

### 3.8 オーバーライド処理

手動上書きは再計算をまたいで保持されるが、イベントパラメータ変更時に陳腐化する可能性がある。

**オーバーライドポリシー:**
- 上書きは伝播によって暗黙的に削除されない
- 伝播は上書きを `stale` としてマークする可能性がある
- 陳腐化した上書きは再レビューまで表示される
- 下流の消費者は `overrideReviewStatus` でフィルタ可能

### 3.9 ワークフローモデル移行

`event-query/handler.ts` 内の現行レビューワークフローは単純なストレージ関心事ではない。ステータス遷移、キューセマンティクス、アナリストアクションを含む。明示的に移行が必要。

**ターゲットワークフローモデル:**
- RiskEvent上の `reviewStatus`
- RiskEvent上の `reviewedBy`
- RiskEvent上の `reviewedAt`
- リゾルバー/アプリケーションコードでの遷移検証
- openCypherによるレビューキュークエリ

Neptuneはワークフロー状態を格納するが、ワークフロールールはアプリケーション所有のまま永続的に維持される。

### 3.10 移行戦略

#### Phase 1: グラフ優先書き込み、互換性読み取り
- 全新規 `RiskEvent` 書き込みはNeptuneのみ
- レガシーDynamoDBテーブルは読み取り専用
- フロントエンドはNeptune裏付けの `fetchRiskEvents()` と `fetchActiveImpacts()` を導入
- 互換性アダプターがNeptuneデータをレガシーレスポンス形式に変換
- ワークフローリゾルバーはNeptuneからの読み取りを開始

#### Phase 2: 一回限りの履歴移行
- `EarthquakeEvent` → `RiskEvent`
- `PlantImpactStatus` → `IMPACTS`
- `event-table` のワークフローメタデータ移行
- 件数検証と代表レコードのスポットチェック

#### Phase 3: 互換性レイヤー除去
- 旧DynamoDB裏付けモデルとフェッチパスを除去
- アダプターコードを除去
- レガシーワークフローストレージを廃止
- ロックとカーソル用の運用DynamoDBテーブルのみ保持

### 3.11 ターゲット状態のデータストア

**Neptune:** RiskEvent、IMPACTS、カテゴリ、物流拠点、グラフリレーションシップの情報源

**DynamoDB:**
- `risk-event-registry` — 重複排除レジストリ
- `risk-event-ingest-lock` — 取り込みロック
- `risk-event-provider-cursors` — プロバイダー取得状態

**S3:**
- 生プロバイダーペイロードアーカイブ
- 生AI抽出ドキュメント
- オプションの診断伝播アーティファクト

レガシーテーブルは移行完了後に廃止・削除。

### 3.12 シードデータ拡張

`load_neptune_data.py` に以下を追加:
- `RiskCategory` 頂点（4親タイプ × 3サブタイプ = ~12）
- `LogisticsHub` 頂点（~10-15: 東京港, 横浜港, 神戸港, 上海港, 高雄港, シンガポール港, ロサンゼルス港, ロッテルダム港, 成田空港, 関西空港等）
- `ROUTES_THROUGH` エッジ（既存Plants/Warehousesを最寄りハブに接続）
- サンプル履歴 `RiskEvent` 頂点（5-10件: 2024能登半島地震, 2021スエズ運河封鎖, 2022上海ロックダウン等）
- サンプル確認済み `IMPACTS` エッジ

全シードイベントは `reviewStatus = confirmed` とする。

### 3.13 影響を受けるコード領域

- `frontend/amplify/data/resource.ts`
- `frontend/amplify/functions/event-query/handler.ts`
- `frontend/amplify/functions/neptune-query/handler.ts`
- `frontend/amplify/functions/nl-query/handler.ts`
- `frontend/src/services/api.ts`
- `frontend/src/stores/supplyChain.ts`
- `src/lambda/earthquake_fetcher/`
- `src/lambda/neptune_impact_analyzer/`
- `infra/cdk/stacks/`

---

## 4. フロントエンド統合

### 4.1 ストア状態移行

Pinia `supplyChain` ストアは地震固有の状態を汎用リスクイベント状態に置き換える。

**状態変更:**

| 現行 | ターゲット | 備考 |
|---------|--------|-------|
| `earthquakes: EarthquakeEvent[]` | `riskEvents: RiskEvent[]` | 全リスクイベント種別を包含 |
| `plantImpacts: PlantImpactStatus[]` | `activeImpactsByNode: Map<string, NodeImpact[]>` + `activeImpactsByEvent: Map<string, EventImpact[]>` | 正規化インパクトキャッシュに置換 |
| `selectedEarthquake` | `selectedRiskEvent` | |
| `filterTab: 'all' \| 'affected'` | `filterTab: 'all' \| 'affected' \| 'byRisk'` | リスクスコア順フィルタ追加 |
| — | `warehouses: Warehouse[]` | 新規エンティティ |
| — | `logisticsHubs: LogisticsHub[]` | 新規エンティティ |
| — | `routesThrough: RouteThrough[]` | 新規リレーション |
| — | `activeDisrupts: DisruptsEdge[]` | アクティブ貿易影響 |
| — | `riskScores: Map<string, NodeRiskScore>` | ノード別スコア |
| — | `riskEventFilter: RiskEventFilterState` | eventType, severity, lifecycle, review, dateRange |
| — | `showWarehouses: boolean` | 表示トグル |
| — | `showLogisticsHubs: boolean` | 表示トグル |

**NodeRiskScore:**

```typescript
interface NodeRiskScore {
  nodeId: string
  nodeType: 'Plant' | 'Supplier' | 'Warehouse' | 'LogisticsHub'
  baselineRisk: number
  liveEventRisk: number
  combinedOperationalRisk: number
  activeEventCount: number
  topEvent: { title: string; severity: number } | null
}
```

**NodeImpact:**

```typescript
interface NodeImpact {
  eventId: string
  eventTitle: string
  severity: number
  impactType: 'direct' | 'downstream'
  status: 'active' | 'recovering' | 'resolved'
  estimatedRecoveryDays: number | null
  cachedImpactAmount: number
  assessmentMethod: 'automated' | 'manual_override' | 'ai_assisted'
}
```

**EventImpact:**

```typescript
interface EventImpact {
  nodeId: string
  nodeType: string
  nodeName: string
  severity: number
  impactType: 'direct' | 'downstream'
  status: 'active' | 'recovering' | 'resolved'
  cachedImpactAmount: number
}
```

**DisruptsEdge:**

```typescript
interface DisruptsEdge {
  eventId: string
  eventTitle: string
  hsCode: string
  originCountry: string
  destinationCountry: string
  regulatorBody: string | null
  effectiveDate: string
  expiryDate: string | null
  tariffIncreasePct: number
  exportRestricted: boolean
}
```

**データ読み込み戦略 — キャッシュ vs オンデマンド:**

| データ | 戦略 | 理由 |
|------|----------|--------|
| `riskEvents` | ストアキャッシュ、初回読み込み、フィルタ変更時リフレッシュ | ダッシュボード・パネルで常時参照 |
| `activeImpactsByNode` | ストアキャッシュ、初回データフェッチで読み込み | マップマーカー色・KPI算出に毎フレーム必要 |
| `activeImpactsByEvent` | ストアキャッシュ、初回データフェッチで読み込み | イベント選択時のインパクト表示 |
| `activeDisrupts` | ストアキャッシュ、初回データフェッチで読み込み | シミュレーションアダプターが参照 |
| `riskScores` | ストアキャッシュ、初回読み込み、イベント変更時リフレッシュ | マップマーカー色・ランキングに常時参照 |
| リスク履歴（ノード別） | オンデマンドフェッチ | 詳細パネル展開時のみ |
| ルートリスク分析 | オンデマンドフェッチ | 分析ビュー表示時のみ、計算コスト高 |
| RELATED_EVENTチェーン | オンデマンドフェッチ | イベント詳細展開時のみ |
| 複合リスクノード | オンデマンドフェッチ | 分析ビュー用 |
| 復旧ダッシュボード | オンデマンドフェッチ | ダッシュボードビュー表示時 |

**ブートストラップ協調:**

全インパクト関連キャッシュは単一の `Promise.all` でハイドレートし、`$patch` でアトミックに適用。部分状態での中間レンダリングなし。

```typescript
async function loadAllData() {
  const [
    plants, suppliers, customers,
    warehouses, logisticsHubs,
    supplyRelations, routesThrough,
    riskEvents, activeImpacts, activeDisrupts, riskScores
  ] = await Promise.all([
    fetchPlants(), fetchSuppliers(), fetchCustomers(),
    fetchWarehouses(), fetchLogisticsHubs(),
    fetchSupplyRelations(), fetchRoutesThrough(),
    fetchRiskEvents({ lifecycleStatus: ['active', 'recovering'] }),
    fetchActiveImpacts(),
    fetchActiveDisrupts(),
    fetchNodeRiskScores()
  ])

  $patch({
    plants, suppliers, customers,
    warehouses, logisticsHubs,
    supplyRelations, routesThrough,
    riskEvents,
    activeImpactsByNode: indexByNodeId(activeImpacts),
    activeImpactsByEvent: indexByEventId(activeImpacts),
    activeDisrupts,
    riskScores: indexByNodeId(riskScores)
  })
}
```

### 4.2 フロントエンド型定義

既存の `types/index.ts` に追加。フロントエンド規約に合わせて `latitude`/`longitude` を使用:

```typescript
interface Warehouse {
  id: string
  name: string
  countryCode: string
  latitude: number
  longitude: number
  capacity: number
  status: string
}

interface LogisticsHub {
  id: string
  name: string
  type: 'port' | 'airport' | 'border_crossing'
  countryCode: string
  latitude: number
  longitude: number
  capacity: string | null
  status: 'operational' | 'disrupted' | 'closed'
}

interface MapMarker {
  id: string
  type: 'plant' | 'supplier' | 'customer' | 'warehouse' | 'logisticsHub'
  // ... 既存フィールド
  riskScore: NodeRiskScore | null
}
```

Neptuneクエリレスポンスはハンドラーで `lat`/`lon` → `latitude`/`longitude` に変換。

### 4.3 APIレイヤー変更 (`api.ts`)

**削除:**
- `fetchEarthquakes()` → 置換
- `fetchPlantImpacts()` → 置換

**追加:**

| 関数 | バックエンド | 用途 |
|----------|---------|---------|
| `fetchRiskEvents(filter?)` | Neptune via AppSync | フィルタ付きリスクイベント一覧 |
| `fetchActiveImpacts(nodeId?, eventId?)` | Neptune via AppSync | ノード/イベント別アクティブIMPACTS |
| `fetchActiveDisrupts()` | Neptune via AppSync | アクティブDISRUPTSエッジ |
| `fetchNodeRiskScores()` | Neptune via AppSync | 全ノードリスクスコア |
| `fetchCorridorRisks(options?)` | Neptune via AppSync | ルートリスク分析 |
| `fetchRiskEventHistory(nodeId, months?)` | Neptune via AppSync | ノード別リスク履歴 |
| `fetchRiskEventChain(eventId)` | Neptune via AppSync | RELATED_EVENT因果チェーン |
| `fetchWarehouses()` | Neptune via AppSync | 倉庫一覧 |
| `fetchLogisticsHubs()` | Neptune via AppSync | 物流拠点一覧 |
| `fetchRoutesThrough()` | Neptune via AppSync | ROUTES_THROUGHリレーション |
| `createRiskEvent(input)` | AppSync mutation | 手動リスクイベント作成 |
| `updateRiskEventLifecycle(id, status)` | AppSync mutation | ライフサイクル更新 |
| `overrideRiskEventImpact(input)` | AppSync mutation | アナリスト手動上書き |

**互換性アダプター（Phase 1のみ）:**

```typescript
async function fetchEarthquakes(): Promise<EarthquakeEvent[]> {
  const events = await fetchRiskEvents({ eventType: 'earthquake' })
  return events.map(reshapeToLegacyEarthquake)
}
```

### 4.4 Neptuneクエリハンドラー分割

現行 `neptune-query/handler.ts` は1012行。リスク分析クエリは別ハンドラーに分離。

| ハンドラー | スコープ | クエリ |
|---------|-------|---------|
| `neptune-query/handler.ts` (既存) | サプライチェーントポロジー | getPlants, getSuppliers, getCustomers, getSupplyRelations, getSimulationData, 既存影響クエリ |
| `neptune-risk-query/handler.ts` (新規) | リスク分析 | getRiskEvents, getActiveImpacts, getActiveDisrupts, getNodeRiskScores, getCorridorRisks, getRiskEventHistory, getRiskEventChain, getRecoveryDashboard, getCompoundRiskNodes |

両ハンドラーはNeptune接続ユーティリティを共有モジュールとして抽出。各々は `frontend/amplify/functions/` 内の別々のAmplify関数定義。

### 4.5 NLクエリルーティング — アーキテクチャ変更

現行 `nl-query/handler.ts` はNeptuneクエリをインプロセスで直接実行している（136行目）。リスク分析クエリの追加にはルーティングの変更が必要。

**v1アプローチ: 共有モジュール抽出**
- Neptune接続とクエリ実行を共有モジュール (`amplify/functions/shared/neptune-client.ts`) に抽出
- `neptune-query` と `neptune-risk-query` の両方がインポート
- `nl-query` も同じモジュールからインポートし、インプロセスで実行（クロスLambda呼び出しなし）
- クエリ関数はモジュール別に整理: トポロジークエリとリスククエリ

```text
nl-query/handler.ts
  ├── imports: shared/neptune-client.ts (接続管理)
  ├── imports: neptune-query/queries.ts (トポロジークエリ関数)
  └── imports: neptune-risk-query/queries.ts (リスククエリ関数)
```

これは実質的なリファクタリング: 現行NLハンドラーのインラインNeptuneクエリ実行を、インポート可能なモジュールに再構成する必要がある。

**NLレスポンス型拡張 (`risk_summary`) はv1.1:**
- 現行レスポンス型: `filter`, `cypher`, `multi_cypher`, `no_result`
- `risk_summary` はプロトコル変更（プロンプトのみの変更ではない）: ハンドラーパーサー、フロントエンドレンダリングの両方に変更が必要
- v1ではリスクNLクエリは `cypher` 型として返し、既存の汎用テーブル形式でレンダリング

### 4.6 マップ可視化変更

**ノードレンダリング:**
- 全ノード (Plant, Supplier, Customer, Warehouse, LogisticsHub) に `combinedOperationalRisk` ベースの連続カラースケール
- 色範囲: 緑 (0) → 黄 → 橙 → 赤 → 濃赤 (critical)
- ノードサイズは `revenueExposure` でスケール（事業重要度の視覚的伝達）
- 複合リスク指標: 2+アクティブイベントのノードに特殊マーカー
- マーカー形状: Plant=円, Supplier=菱形, Customer=四角, Warehouse=三角, LogisticsHub=アンカー/飛行機/ゲート（サブタイプ別）
- 5タイプ全ての表示トグル

**エッジレンダリング:**
- サプライルートラインを `chokePointScore` で色分け
- ルートホバー時に `avgRouteRisk`, `chokePointScore`, 危険ノード表示
- `ROUTES_THROUGH` エッジは破線でハブと依存ノードを接続

**イベントオーバーレイ:**
- RiskEventを半透明の円で `radiusKm` 範囲表示
- 色は severity (1-5)、透明度は lifecycle (active=不透明, recovering=半透明, resolved=デフォルト非表示)
- クリックでIMPACTSノードとRELATED_EVENTチェーン表示

**LogisticsHubマーカー:**
- ステータス色 (operational=緑, disrupted=橙, closed=赤)

### 4.7 新規UIコンポーネント

**リスクイベントパネル** — 現行地震固有イベントリストの置換:
- eventType, severity, lifecycleStatus, reviewStatus, dateRangeでフィルタ
- イベントカード: タイトル、重大度バッジ、ライフサイクル状態、影響ノード数、合計エクスポージャーJPY
- 展開でIMPACTSリストとRELATED_EVENTチェーン
- アナリストアクション: 確認/却下（pending用）、ライフサイクル更新

**リスクスコアダッシュボード** — 新規トップレベルビュー:
- `combinedOperationalRisk` で全ノードランキングテーブル
- `baselineRisk`, `liveEventRisk`, `combinedOperationalRisk` の3カラム
- リスクトレンドスパークライン
- ノード詳細へのクリックスルー

**ルート分析ビュー** — 新規ビュー/タブ:
- `chokePointScore` でルートランキングテーブル
- 選択時にマップ上でルートハイライト
- チョークポイントノードへのドリルダウン

**復旧タイムライン** — 新規ウィジェット:
- アクティブイベント別の水平タイムライン
- イベント内ノード別復旧進捗バー
- `estimatedRecoveryDays` ベースの推定解決日

**レビューキュー** — アナリストワークフロー:
- 確認待ちイベント (AI抽出、未確認) の表示
- ソーストレーサビリティ: sourceURL、信頼度スコア、生ドキュメントリンク
- ワンクリック確認/却下（却下時は理由必須）

### 4.8 シミュレーションストア統合

#### リスク→シミュレーションアダプター

明示的な変換レイヤー (`services/riskSimulationAdapter.ts`):

```typescript
interface RiskScenarioSnapshot {
  disabledSuppliers: Set<string>
  tariffOverrides: Map<string, number>   // "hsCode:origin:importer" → rate
  fxOverrides: Map<string, number>
  volumeMultipliers: Map<string, number>
  metadata: {
    sourceEventIds: string[]
    snapshotDate: string
    description: string
  }
}
```

**アダプターの入力:** `supplyChain` ストアの `activeImpactsByNode` と `activeDisrupts`。両方とも同じブートストラップ呼び出しで読み込み済み。

**変換ロジック:**
- `IMPACTS` (severity >= 4, direct) → `disabledSuppliers`
- `DISRUPTS` → `tariffOverrides` (キー形式: `hsCode:originCountry:importingCountry`、現行simulation.tsの `tariffOverrides` キーと一致)

**「現在のリスク状況を適用」ボタンフロー:**
1. アダプターが `activeImpactsByNode` + `activeDisrupts` をストアから読み取り
2. `buildScenarioFromActiveRisks()` でシミュレーション入力キーに変換
3. simulation ストアが具体的なオーバーライドを受信
4. コスト/影響再計算が即座に実行

**「過去シナリオ再現」:**
- 過去のRiskEventを選択 → そのIMPACTSとDISRUPTSをシミュレーション入力としてロード

---

## 5. 競争的価値提案

### 5.1 "生きたリスクメモリー"

多くのサプライチェーンツールはリスクを一時的なアラートとして扱う。本システムは全てのリスクを永続的でクエリ可能なグラフノードにする。何に影響し、何がカスケードし、復旧にどれだけかかったか — グラフは時間とともに賢くなる制度的知識を蓄積する。

### 5.2 "事業重要度加重リスク"

`combinedOperationalRisk = liveEventRisk × 事業重要度`。売上40%を担うプラント近くのM3.0地震は、エクスポージャー2%のプラント近くのM7.0より上位にランクされる。ビジネスユーザーの実際の懸念に合致する優先順位付け。

### 5.3 "ネットワーク全体のチョークポイント検出"

「どのノードがリスクにさらされているか」だけでなく「どのノードが途絶した場合に最大の下流被害を引き起こすか」。デュアルスコアリング（チョークポイント + ルート健全性）による脆弱性の可視化。

### 5.4 "ワンクリックシナリオ適用"

アラートから対策シミュレーションまでワンクリック。「この港が閉鎖された → 影響を表示 → 代替サプライヤーへの切替をシミュレーション」。手動データ入力なし、ツール切替なし。

### 5.5 "自然言語リスクインテリジェンス"

ビジネスユーザーはopenCypherを書かない。「半導体ICの供給ルートで最もリスクが高いのは？」と聞けば、ハイライトされたルートのマップが返る。

### 5.6 "イベント間パターン発見"

経験的同時発生分析で隠れたリスク相関を発見: 「台湾で台風が発生すると72%の確率で高雄港の遅延も発生」。発見されたパターンはRELATED_EVENTエッジとして書き戻し、データをナビゲーション可能な知識に変換。

### 5.7 "監査可能なAI支援モニタリング"

AIがニュースやアラートからリスクイベントを抽出するが、スコアに影響する前にアナリストが確認。完全な来歴追跡: ソースURL、信頼度スコア、確認者、確認日時。コンプライアンス重視のビジネスユーザーに信頼を構築。

---

## 付録A: 影響を受けるファイル一覧

| ファイル | 変更内容 |
|------|--------|
| `frontend/amplify/data/resource.ts` | EarthquakeEvent/PlantImpactStatusモデル除去、RiskEvent AppSync型追加 |
| `frontend/amplify/functions/event-query/handler.ts` | Neptuneベースのワークフローリゾルバーに移行 |
| `frontend/amplify/functions/neptune-query/handler.ts` | クエリ関数を共有モジュールに抽出 |
| `frontend/amplify/functions/nl-query/handler.ts` | スキーマプロンプト拡張、共有モジュールからインポート |
| `frontend/amplify/functions/neptune-risk-query/` (新規) | リスク分析クエリハンドラー |
| `frontend/amplify/functions/shared/neptune-client.ts` (新規) | Neptune接続共有モジュール |
| `frontend/src/types/index.ts` | Warehouse, LogisticsHub, RiskEvent関連型追加 |
| `frontend/src/services/api.ts` | fetchRiskEvents, fetchActiveImpacts等に置換 |
| `frontend/src/services/riskSimulationAdapter.ts` (新規) | リスク→シミュレーション変換レイヤー |
| `frontend/src/stores/supplyChain.ts` | riskEvents, activeImpactsByNode等に移行 |
| `frontend/src/components/SupplyChainMap.vue` | 5タイプマーカー、リスクカラースケール、イベントオーバーレイ |
| `scripts/load_neptune_data.py` | RiskCategory, LogisticsHub, サンプルRiskEventシードデータ |
| `src/lambda/earthquake_fetcher/` | `risk_event_ingester/` にリファクタ |
| `src/lambda/neptune_impact_analyzer/` | `impact_propagator/` にリファクタ |
| `src/lambda/risk_event_service/` (新規) | 共通取り込みパスモジュール |
| `src/lambda/risk_event_extractor/` (新規) | AI支援抽出Lambda |
| `infra/cdk/stacks/` | RiskEventIngesterStack, ImpactPropagatorStack |
