# アーキテクチャ総括レポート

## グローバルサプライチェーン予測システム

---

## 1. 不要または代替推奨のサービス

| 当初提案サービス | 判定 | 理由 | 推奨代替案 |
|-----------------|------|------|-----------|
| **Amazon DynamoDB** | ⚠️ 限定使用 | 分析ワークロードには不向き。OLTPデータベースであり、複雑なクエリや集計に制限あり | S3 + Glue をプライマリストレージとし、DynamoDBは予測結果のキャッシュ（APIアクセス用）のみに使用 |
| **PostgreSQL (RDS)** | ❌ 不要 | 非構造化データ（ニュース）やグラフ関係性の管理に不適切。リレーショナルモデルではサプライチェーンの複雑な関係を表現しにくい | Neptune Analytics（グラフ関係）+ OpenSearch Serverless（ニュース検索） |
| **Neptune Database** | ⚠️ 代替推奨 | OLTPフォーカスでリアルタイムトランザクション向け。バッチ分析には非効率 | **Neptune Analytics** に変更（後述） |
| **Amazon Redshift** | ⚠️ 条件付き | SageMaker/Forecastが予測を担当するため、Redshiftの分析機能は重複。コスト面でも懸念 | **Amazon Athena** で代替可能。必要に応じてRedshift Serverlessを検討 |
| **手動埋め込み生成 (Titan)** | ❌ 不要 | Bedrock Knowledge Baseが自動で埋め込みを生成・管理 | `StartIngestionJob` APIで自動処理 |

---

## 2. 新規追加サービス

### 2.1 Amazon Neptune Analytics

| 項目 | 内容 |
|------|------|
| **概要** | グラフ分析に特化したサーバーレスサービス。Neptune Databaseとは異なり、大規模バッチ分析向けに最適化 |
| **主要機能** | • インメモリグラフアルゴリズム実行<br>• OpenCypherクエリ対応<br>• S3からのバルクロード<br>• ベクトル類似検索（グラフ + ベクトル統合） |
| **本システムでの用途** | • サプライヤー・港湾・配送ルートの関係性モデリング<br>• リスク伝播アルゴリズム（イベント発生時の影響範囲特定）<br>• 代替ルート探索（最短経路・中心性分析） |
| **フィット理由** | 1-x時間のバッチ処理に最適。トランザクション処理不要のため、Neptune Databaseより低コスト・高パフォーマンス |

**グラフモデル例：**
```
(Supplier) -[:SHIPS_FROM]-> (Port) -[:SHIPS_TO]-> (Port) -[:DELIVERS_TO]-> (Customer)
(Supplier) -[:SUPPLIES]-> (Product)
(Supplier) -[:LOCATED_IN]-> (Region)
(Event) -[:IMPACTS]-> (Port|Region|Supplier)
(Route) -[:ALTERNATIVE_TO]-> (Route)
```

---

### 2.1.1 代替サプライヤー推奨機能

**要件：** 影響を受けたサプライヤーに対して、最寄りの影響を受けていないサプライヤーを推奨する

**実装方法：** Neptune Analytics の地理空間クエリ + グラフ探索

**OpenCypherクエリ例：**
```cypher
// 影響を受けたサプライヤーごとに、同じ製品を供給できる最寄りの代替サプライヤーを検索
MATCH (affected:Supplier)-[:SUPPLIES]->(product:Product),
      (affected)-[:LOCATED_IN]->(affectedRegion:Region),
      (alternative:Supplier)-[:SUPPLIES]->(product),
      (alternative)-[:LOCATED_IN]->(altRegion:Region)
WHERE affected.is_impacted = true
  AND alternative.is_impacted = false
  AND affected <> alternative
WITH affected, product, alternative,
     point.distance(
       point({latitude: affectedRegion.lat, longitude: affectedRegion.lon}),
       point({latitude: altRegion.lat, longitude: altRegion.lon})
     ) AS distance
ORDER BY affected.id, distance
RETURN
  affected.id AS impacted_supplier_id,
  affected.name AS impacted_supplier_name,
  product.name AS product_name,
  collect({
    alternative_id: alternative.id,
    alternative_name: alternative.name,
    distance_km: distance/1000,
    capacity: alternative.capacity,
    lead_time_days: alternative.lead_time
  })[0..3] AS top_3_alternatives
```

**出力例：**
```json
{
  "impacted_supplier_id": "SUP-001",
  "impacted_supplier_name": "東京部品製造",
  "product_name": "半導体チップ Type-A",
  "top_3_alternatives": [
    {
      "alternative_id": "SUP-042",
      "alternative_name": "大阪電子工業",
      "distance_km": 402.5,
      "capacity": 10000,
      "lead_time_days": 3
    },
    {
      "alternative_id": "SUP-108",
      "alternative_name": "名古屋精密",
      "distance_km": 267.3,
      "capacity": 5000,
      "lead_time_days": 5
    },
    {
      "alternative_id": "SUP-215",
      "alternative_name": "福岡テック",
      "distance_km": 882.1,
      "capacity": 15000,
      "lead_time_days": 4
    }
  ]
}
```

**考慮要素：**
| 要素 | 説明 |
|------|------|
| 地理的距離 | `point.distance()` で緯度経度から計算 |
| 製品互換性 | 同じ `Product` ノードに `SUPPLIES` 関係を持つこと |
| キャパシティ | 代替サプライヤーの生産能力 |
| リードタイム | 調達までの所要日数 |
| 影響状態 | `is_impacted` フラグで現在の影響有無を判定 |

---

### 2.2 Amazon Forecast

| 項目 | 内容 |
|------|------|
| **概要** | 機械学習ベースの時系列予測サービス。AutoMLで最適なアルゴリズムを自動選択 |
| **主要機能** | • DeepAR+、ETS、ARIMA等の複数アルゴリズム<br>• 確率的予測（P10/P50/P90）<br>• 関連時系列データの組み込み<br>• What-if分析 |
| **本システムでの用途** | • サプライヤー在庫レベルの予測<br>• 配送遅延の発生確率予測<br>• 需要予測に基づく先行発注アラート |
| **フィット理由** | 既存の在庫・配送データを活用し、外部要因（ニュースイベント）と組み合わせて予測精度を向上 |

---

### 2.3 SageMaker (異常検知)

| 項目 | 内容 |
|------|------|
| **概要** | カスタムMLモデルのトレーニング・推論基盤 |
| **主要機能** | • Random Cut Forest（異常検知）<br>• バッチ変換ジョブ<br>• リアルタイム推論エンドポイント |
| **本システムでの用途** | • サプライヤー在庫レベルの急激な変動検知<br>• 通常パターンからの逸脱アラート<br>• 品質異常の早期発見 |
| **フィット理由** | Forecastは「将来予測」、SageMakerは「現在の異常検知」と役割分担 |

---

### 2.4 Amazon Bedrock（拡張利用）

| コンポーネント | 用途 |
|--------------|------|
| **InvokeModel (Claude)** | ニュースからの構造化イベント抽出、重大度分類、レポート生成 |
| **InvokeAgent** | 複数データソース（予測結果、リスクスコア、イベント）の統合分析 |
| **Knowledge Base** | ニュース・ドキュメントのRAG検索基盤。埋め込み自動生成 |
| **Guardrails** | 出力の品質管理、ハルシネーション防止 |

---

### 2.5 Amazon Comprehend

| 項目 | 内容 |
|------|------|
| **概要** | NLPサービス。エンティティ抽出・感情分析をバッチ処理 |
| **本システムでの用途** | • ニュース記事からの地名・組織名抽出<br>• 記事のネガティブ/ポジティブ判定<br>• Bedrockの前処理として活用（コスト削減） |
| **フィット理由** | 大量記事の一次フィルタリングに最適。Bedrockは高価値な分析にのみ使用 |

---

## 3. Neptune + QuickSight 統合に関する課題と代替案

### 3.1 課題

お客様の当初要件：
> 「Neptuneからグラフデータをエクスポートし、QuickSightでグローバルなノードとルートを可視化したい」

**問題点：**

| 課題 | 詳細 |
|------|------|
| **QuickSightはグラフ可視化非対応** | QuickSightは表・グラフ（棒・折れ線・円）向けBIツール。ノード・エッジのネットワーク図は描画不可 |
| **データ構造の不一致** | グラフDBの出力（ノード・エッジ関係）はQuickSightの表形式入力と互換性が低い |
| **インタラクティブ操作不可** | ノードのドリルダウン、パス探索などグラフ特有の操作ができない |

### 3.2 推奨代替案

| ツール | 概要 | 適用シーン |
|--------|------|-----------|
| **Neptune Graph Explorer** | Neptune組み込みの可視化ツール。ブラウザベースでノード・エッジを探索可能 | 開発者・アナリスト向け探索分析 |
| **Neptune Notebooks** | JupyterベースのノートブックでOpenCypherクエリ実行＋可視化 | アドホック分析、レポート作成 |
| **G.V() (Graph Visualization)** | オープンソースのグラフ可視化ライブラリ。Neptuneと統合可能 | カスタムダッシュボード構築 |
| **Amazon Managed Grafana** | Neptuneプラグインでグラフメトリクス可視化 | 運用監視、リアルタイムモニタリング |

### 3.3 推奨アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                    可視化レイヤー                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   QuickSight    │  │ Graph Explorer  │  │ Managed Grafana │ │
│  │                 │  │                 │  │                 │ │
│  │  • KPI表示      │  │  • ノード探索    │  │  • リアルタイム  │ │
│  │  • トレンド分析  │  │  • パス可視化    │  │    モニタリング  │ │
│  │  • 集計レポート  │  │  • 影響範囲表示  │  │  • アラート      │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘ │
│           │                    │                    │          │
│           ▼                    ▼                    ▼          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    データソース                              ││
│  │  S3 (集計データ)    Neptune Analytics    CloudWatch Metrics ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 QuickSightで可能な表現

QuickSightを活用する場合、以下の形式でグラフデータを表現可能：

| 可視化タイプ | 用途 |
|-------------|------|
| **サンキー図** | サプライヤー→港湾→顧客のフロー量 |
| **ヒートマップ** | リスクスコア × 地域のマトリクス |
| **地理マップ** | 港湾・サプライヤーの地理的分布とリスク色分け |
| **ツリーマップ** | サプライヤー階層とリスク重み付け |

---

## 4. 最終アーキテクチャサマリー

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         採用サービス一覧                                 │
├─────────────────────────────────────────────────────────────────────────┤
│ データレイク    : S3 + Glue (Crawler, ETL, Data Quality, Catalog)      │
│ AI/GenAI       : Bedrock (Claude, Titan, Agent, Knowledge Base)        │
│                  Comprehend (BatchDetectEntities/Sentiment)            │
│ ML予測         : Amazon Forecast, SageMaker (異常検知)                  │
│ グラフ分析      : Neptune Analytics                                     │
│ ベクトル検索    : OpenSearch Serverless                                 │
│ オーケストレーション: Step Functions + EventBridge Scheduler            │
│ 可視化         : QuickSight (KPI) + Graph Explorer (ネットワーク図)     │
│ キャッシュ      : DynamoDB (予測結果API用)                              │
│ 通知           : SNS + EventBridge                                      │
│ 監視           : CloudWatch (Metrics, Logs)                            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. 確認事項

1. **グラフ可視化の主要ユースケースは？**
   - 経営層向けダッシュボード → QuickSight + サンキー/地図
   - アナリスト向け探索 → Graph Explorer
   - 両方必要 → ハイブリッド構成

2. **Neptune Databaseの既存利用はあるか？**
   - 既存あり → Neptune Analytics への移行検討
   - 新規構築 → Neptune Analytics で開始

3. **リアルタイム要件の有無**
   - 1時間バッチで十分 → 現行設計で対応
   - 分単位の更新必要 → Kinesis + Lambda 追加検討

---

## 6. 関連ファイル

- Step Functions定義: `supply-chain-prediction-pipeline-demo-jp.asl.json`
- アーキテクチャ計画: `~/.claude/plans/bright-mixing-bengio.md`
