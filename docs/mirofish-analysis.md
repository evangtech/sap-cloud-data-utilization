# MiroFish と本プロジェクトの関連性分析

## MiroFish とは

MiroFish は2026年3月にGitHubトレンド1位（33,000+ stars）となったオープンソースの**マルチエージェントAI予測エンジン**。シード文書（ニュース記事、政策文書、財務レポート等）を入力すると：

1. **GraphRAG** でエンティティ・関係性を抽出し、ナレッジグラフを構築
2. そのKGに基づいて **数千のAIエージェント** を生成（それぞれ固有の人格・記憶・行動ロジックを持つ）
3. エージェントが **模擬SNS**（Twitter風 + Reddit風）上で投稿・議論・拡散
4. 創発的な社会動態から **予測レポート** を生成

技術スタック：Python 3.11+ / Vue.js / Zep Cloud（メモリ） / OpenAI互換LLM
オフライン版：Neo4j + Ollama（ローカルLLM）

---

## 本プロジェクトとの比較

| 観点 | MiroFish | 本プロジェクト（現行） |
|------|----------|----------------------|
| **グラフDB** | Neo4j（オフライン版） | Neptune Analytics（openCypher） |
| **KG構築方法** | GraphRAG（文書→エンティティ自動抽出） | 手動スキーマ設計 + ローダースクリプト |
| **KGの性質** | 非構造化（文書から自動生成、スキーマ不定） | 構造化（Plant, Supplier, Customer等の固定スキーマ） |
| **用途** | 社会シミュレーションによる予測 | サプライチェーンリスク分析・代替提案 |
| **クエリ方式** | GraphRAG（サブグラフ取得→LLMで回答生成） | NL→openCypher変換→Neptune実行 |
| **AIの役割** | エージェントの行動生成・予測レポート生成 | NL理解、HSコード分類、法改正検知 |

---

## 共通点と相違点

### 共通点
- **ナレッジグラフを中核に据えたアーキテクチャ**
- **LLMをグラフ操作の仲介として使う**（MiroFish: GraphRAG、本PoCr: NL→Cypher）
- **Vue.jsフロントエンド**

### 根本的な相違点
- **MiroFishはシミュレーションエンジン**（「この状況で社会はどう反応するか」を予測）
- **本PoCは分析・意思決定支援ツール**（「この地震でどの工場が止まり、代替はどこか」を回答）
- MiroFishのKGは**文書から自動生成される非構造化グラフ**、本PoCのKGは**ERPデータに基づく構造化グラフ**

---

## 本プロジェクトに取り込めるもの・取り込めないもの

### ✅ 取り込める：GraphRAGの「文書→KGエンティティ抽出」パターン

本PoCのタスク S2-①-2-2-2（法改正自動差分検知）で、ニュースRSSから関税法・規制変更を抽出するパイプラインが計画されている。ここでMiroFishと同様のGraphRAGパターンが適用可能：

```
ニュース記事 → LLMでエンティティ抽出（国名、法令名、HSコード、関税率変更）
           → 抽出結果を既存KGのノードにマッピング
           → 影響範囲を既存KGのグラフ探索で特定
```

ただし、MiroFishのGraphRAGライブラリをそのまま使うのではなく、**エンティティ抽出のプロンプト設計パターン**を参考にする程度が現実的。理由：
- MiroFishはNeo4j前提、本PoCはNeptune Analytics
- MiroFishの抽出スキーマは汎用的、本PoCは通商ドメイン固有

### ✅ 取り込める：マルチエージェントによる「サプライヤー行動シミュレーション」のコンセプト

将来的な拡張として、MiroFishの発想を取り入れた機能が考えられる：
- サプライヤー・顧客・規制当局をエージェントとしてモデル化
- 「関税率が10%上がったら、各サプライヤーはどう動くか」をシミュレーション
- ただし**PoCの範囲外**であり、かつ実用的な精度を得るには実データに基づくエージェント設計が必要

### ❌ 取り込めない：MiroFishのコアエンジン（マルチエージェントSNSシミュレーション）

- 本PoCの課題は「正確なリスク分析と代替提案」であり、社会シミュレーションではない
- 数千エージェントの生成・実行はコンピューティングコストが高く、PoCの工数・予算に見合わない
- エージェントの行動精度は入力文書の質に強く依存し、モックデータ環境では意味のある結果が出ない

### ❌ 取り込めない：Neo4jベースのGraphRAG実装

- 本PoCはNeptune Analytics（openCypher）で統一されている
- Neo4jへの移行はインフラ再構築が必要であり、PoCのスコープ外
- Neptune AnalyticsでもGraphRAG的なパターン（サブグラフ取得→LLMコンテキスト化）は実装可能

---

## 本PoCのKG設計：現状と拡張計画

### 現行スキーマ（Neptune Analytics）

```
ノードラベル:
  - Location    (id, pref, city, lat, lon)
  - Plant       (id, name, location_name, lat, lon, capacity, status)
  - Warehouse   (id, name, location_name, lat, lon, capacity, status)
  - Supplier    (id, name, country, region, lat, lon, status)
  - Customer    (id, name, industry, lat, lon)
  - Product     (id, name, type, unit)
  - SalesOrder  (※neptune-query Lambda内で参照)
  - PurchaseOrder (※neptune-query Lambda内で参照)

エッジラベル:
  - LOCATED_AT      (Plant/Warehouse → Location)
  - SUPPLIES_TO     (Supplier → Supplier/Plant, Plant → Plant/Warehouse/Customer, Warehouse → Customer)
  - MANUFACTURED_AT (Product → Plant)
  - CONSISTS_OF     (Product → Product)  ※BOM構造
  - SUPPLIES_PRODUCT (Supplier/Plant → Product)
  - PLACED_BY       (SalesOrder → Customer)
  - ISSUED_TO       (PurchaseOrder → Supplier)

データ規模:
  - 15 Location, 9 Plant, 5 Warehouse, 10 Supplier (T1+T2), 8 Customer, 10 Product
  - 約30 SUPPLIES_TO関係
```

### Expanded schema (adding trade/tariff domain)

Design principle:
- **Structural data → KG nodes/properties** (queryable by graph traversal)
- **Temporal events → DynamoDB EventTable** (queryable by time range)
- Tariff rate changes, sanction announcements, exchange rate movements are EVENTS.
  They UPDATE existing KG node properties rather than creating new event nodes.

```
Added node labels:
  - HSCode      (code, description, level, tariff_rate, prev_rate, updated_at)
  - Regulation  (id, name, type, effective_date)     ← persistent structural rules
  - Country     (code, name, region, risk_level, sanctioned, sanction_source)

Added edge labels:
  - CLASSIFIED_AS  (Product → HSCode)               HS classification
  - SUBJECT_TO     (Product/HSCode → Regulation)     which regulations apply
  - ORIGINATED_IN  (Product/Supplier → Country)      country of origin
  - IMPORTS_FROM   (Country → Country)               trade route (for tariff lookup)

Properties enriched on existing nodes (not new nodes):
  - Supplier.sanctioned          (bool, updated by OFAC/EU sanction events)
  - Supplier.sanction_source     (string, e.g. 'OFAC_SDN')
  - Supplier.credit_score        (number, updated by external data feed)
  - HSCode.tariff_rate           (number, updated when tariff law changes)
  - HSCode.prev_rate             (number, for diff display)
  - Country.risk_level           (string, updated by geopolitical events)
  - Country.exchange_rate_jpy    (number, updated daily)

Event flow:
  News/RSS detected
      ↓ Bedrock extracts entities (S2-①-2-2-2)
      ↓
  DynamoDB EventTable ← log the event (who, what, when, status)
      ↓
  Neptune KG ← UPDATE affected node properties
      ↓
  Graph traversal ← find impacted Products → Plants → Customers
      ↓
  Alert/Report generation

Expanded data flow:
  T2 Supplier → T1 Supplier → Plant → Warehouse → Customer
       │              │          │
       └── Country ──┘    Product ── HSCode
            (origin)          │          (tariff_rate as property)
                         Regulation
                      (persistent rules)
```

Why NOT add TariffRate/ExchangeRate/SanctionEntry as separate nodes:
- They are temporal and high-volume (exchange rates change daily)
- Querying "current tariff for this product" becomes a date-filter problem, not a traversal problem
- Graph bloat with stale historical nodes
- DynamoDB EventTable already handles time-series event storage
- The existing event-query Lambda already supports status-based filtering (CONFIRMED/PENDING/DISMISSED)

### GraphRAG的パターンの適用箇所

既存のNL→Cypher変換パイプラインに加えて、以下の場面でGraphRAG的パターン（サブグラフ取得→LLMコンテキスト化）が有効：

1. **法改正ニュースの影響分析**（S2-①-2-2-2）
   ```
   ニュース記事 → Bedrockでエンティティ抽出
                → 「HSコード 8542.31 の関税率変更」を検知
                → KGから CLASSIFIED_AS → SUBJECT_TO の経路で影響Product特定
                → さらに MANUFACTURED_AT → SUPPLIES_TO で影響Plant・Customer特定
                → 影響範囲の要約レポートをBedrockで生成
   ```

2. **自然言語による複合クエリ**（既存nl-queryの拡張）
   ```
   「制裁リストに載っているサプライヤーから調達している製品は？」
   → KGで Supplier -[:SANCTIONED]-> SanctionEntry のパスを持つSupplierを特定
   → そのSupplierから SUPPLIES_TO → MANUFACTURED_AT で製品を追跡
   → 結果をBedrockで日本語要約
   ```

3. **GraphRAG検証タスク**（S3-①-2-3-1）の現実的なスコープ
   ```
   既存NL→Cypher: ユーザー質問 → Cypher生成 → Neptune実行 → 構造化結果
   GraphRAG:       ユーザー質問 → サブグラフ取得 → LLMに渡して回答生成 → 自然言語回答

   比較ポイント:
   - 精度: NL→Cypherが有利（確定的結果）
   - 柔軟性: GraphRAGが有利（スキーマを知らなくても回答可能）
   - 速度: NL→Cypherが有利（LLM呼出1回 vs 2回）
   - 説明性: 同等（どちらもクエリ/サブグラフを根拠として提示可能）
   ```

---

## 結論：MiroFishの位置づけ

MiroFishは「社会シミュレーションによる予測」というまったく異なるアプローチのプロジェクトであり、**本PoCに直接組み込むことは適切ではない**。ただし、以下の2点で参考になる：

1. **GraphRAGのエンティティ抽出パターン** → 法改正検知（S2-①-2-2-2）に応用可能
2. **「KGからエージェントのコンテキストを生成する」設計思想** → 将来的なサプライヤー行動予測の参考に

本PoCのKG設計は、MiroFishのような非構造化・自動生成型ではなく、**ERPデータに基づく構造化スキーマの拡張**として進めるのが適切。既存のNeptune Analytics + openCypherの基盤を維持しつつ、通商ドメインのノード・エッジを追加する方針。
