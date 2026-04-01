# Page B: 影響分析・代替提案 — 機能仕様書

## 1. 概要

Page A で選択したリスクイベントの影響範囲をグラフ探索で可視化し、
代替サプライヤー候補をスコアリング付きで提案する画面。
Neptune KG の構造探索と DynamoDB のイベントスナップショットを組み合わせる。

**ルート**: `/impact/:eventId`
**コンポーネント**: `ImpactAnalysisView.vue`

---

## 2. データソース

| ソース | 用途 | クエリ |
|--------|------|--------|
| DynamoDB EventTable | 選択イベントの詳細 + related_nodes | `getEventById` |
| Neptune KG | 影響チェーン探索 (サプライヤー→素材→製品→顧客) | `getImpactChain` (新規) |
| Neptune KG | 代替サプライヤー候補 + スコア | `getAlternativeSuppliers` (新規) |
| Neptune KG | 影響金額算出 | `getImpactAmount` (新規) |

**既存APIの再利用**:
- `getEventById` — EventTable からイベント詳細取得
- `getProductsWithBOM` — BOM構成取得 (部分的に再利用)
- `getImpactedProducts` — 影響製品取得 (部分的に再利用)

---

## 3. 画面レイアウト

```
+------------------------------------------------------------------+
| [Logo] Supply Chain Risk Monitor    [Dashboard] [Map] [Simulation]|
+------------------------------------------------------------------+
| [< ダッシュボードに戻る]                                            |
|                                                                    |
| [イベントヘッダー]                                                   |
| +-----------------------------------------------------------------+|
| | EVT-EQ-001: 台湾M6.8地震 — TSMC新竹fab生産停止                  ||
| | Status: CONFIRMED  Risk: 5  Confidence: 85%  Date: 2025-03-15  ||
| +-----------------------------------------------------------------+|
|                                                                    |
| [影響サマリーカード x3]                                              |
| +----------------+ +----------------+ +----------------+           |
| | 影響サプライヤー | | 影響製品       | | 影響金額        |           |
| |     3社        | |    5品目       | | ¥18.2億/年     |           |
| +----------------+ +----------------+ +----------------+           |
|                                                                    |
| +-------------------------------+---------------------------------+|
| | [影響チェーンマップ]            | [影響詳細テーブル]               ||
| |                               |                                 ||
| | TSMC ──→ MAT001 ──→ PRD001   | Tier | Node    | Impact        ||
| |    ↘                  ↘      | T1   | TSMC    | fab停止       ||
| |     MAT001 ──→ PRD003  CUS006| T1   | MAT001  | 供給途絶      ||
| |           ──→ PRD004         | T2   | PRD001  | 生産遅延      ||
| |           ──→ PRD005         | T2   | PRD003  | 部品不足      ||
| |           ──→ PRD007         | T3   | CUS006  | 納期遅延      ||
| |                               | T3   | CUS002  | 納期遅延      ||
| | [凡例]                        |                                 ||
| | ● 直接影響  ● 下流影響        |                                 ||
| +-------------------------------+---------------------------------+|
|                                                                    |
| [代替サプライヤー提案]                                               |
| +----------------------------------------------------------------+ |
| | Material        | Current      | Alternative  | Score | Action | |
| +----------------------------------------------------------------+ |
| | MAT001          | TSMC (TW)    | Samsung (KR) |       |        | |
| | 先端ロジック半導体|              |              |       |        | |
| |                 | 45 USD/unit  | 47.25 USD    |       |        | |
| |                 | LT: 14days   | LT: 7days    |       |        | |
| |                 | Quality: 98  | Quality: 96  | 78/100| [採用] | |
| +----------------------------------------------------------------+ |
| | MAT004          | Foxconn (TW) | Flex (MY)    |       |        | |
| | HDI基板         |              |              |       |        | |
| |                 | 8.20 USD     | 8.45 USD     |       |        | |
| |                 | LT: 21days   | LT: 27days   |       |        | |
| |                 | Quality: 95  | Quality: 93  | 65/100| [採用] | |
| +----------------------------------------------------------------+ |
|                                                                    |
| [影響金額内訳]                                                      |
| +----------------------------------------------------------------+ |
| | Product          | Customer   | Annual Qty | Price  | Impact   | |
| +----------------------------------------------------------------+ |
| | PRD001 5G基地局  | NTTドコモ  | 5,000      | 120k   | ¥6.0億   | |
| | PRD001 5G基地局  | Samsung    | 3,000      | 115k   | ¥3.45億  | |
| | PRD003 ロボコン  | 三菱重工   | 2,000      | 220k   | ¥4.4億   | |
| | PRD005 サーバー  | ソニー     | 3,000      | 380k   | ¥11.4億  | |
| |                  |            |            | Total  | ¥25.25億 | |
| +----------------------------------------------------------------+ |
|                                                                    |
| [What-ifシミュレーションへ →]                                       |
+------------------------------------------------------------------+
```

---

## 4. コンポーネント構成

```
ImpactAnalysisView.vue
├── EventHeader.vue                  # イベント概要ヘッダー
├── ImpactSummaryCards.vue           # 影響サマリー (3枚)
├── ImpactChainVisualization.vue     # 影響チェーンの可視化
│   └── (Leaflet map or D3 tree)    # 地図 or ツリー表示
├── ImpactDetailTable.vue            # Tier別影響ノードテーブル
├── AlternativeSupplierTable.vue     # 代替サプライヤー提案テーブル
│   └── SupplierComparisonCard.vue   # 現行 vs 代替の比較カード
└── ImpactAmountTable.vue            # 影響金額内訳テーブル
```

---

## 5. Pinia ストア

**新規: `frontend/src/stores/impact.ts`**

```typescript
// State
selectedEventId: string
event: RiskEvent | null                 // EventTable から
impactChain: ImpactChainNode[]          // Neptune 影響チェーン
alternatives: AlternativeProposal[]     // Neptune 代替提案
impactAmount: ImpactAmountBreakdown     // 金額内訳
isLoading: boolean

// Actions
loadImpactAnalysis(eventId: string)     // 全データ並列取得
  → Promise.all([getEventById, getImpactChain, getAlternatives, getImpactAmount])

// Computed
totalImpactAmount                       // 影響金額合計
affectedSupplierCount                   // 影響サプライヤー数
affectedProductCount                    // 影響製品数
impactChainByTier                       // Tier別グループ化
```

---

## 6. 新規 Neptune クエリ (handler.ts に追加)

### 6.1 `getImpactChain`

イベントの related_nodes から出発し、影響の下流チェーンを探索。

```cypher
// Step 1: 影響サプライヤーから素材を取得
MATCH (s:Supplier {id: $supplierId})-[:SUPPLIES]->(m:Material)
WHERE s.status = 'active'
RETURN s.id AS supplierId, s.name AS supplierName,
       m.id AS materialId, m.description AS materialName

// Step 2: 影響素材を使う製品を取得
MATCH (p:Product)-[bom:HAS_COMPONENT]->(m:Material {id: $materialId})
RETURN p.id AS productId, p.description AS productName,
       bom.quantity AS bomQuantity

// Step 3: 影響製品の顧客を取得
MATCH (p:Product {id: $productId})-[ord:ORDERED_BY]->(c:Customer)
RETURN c.id AS customerId, c.name AS customerName,
       ord.annual_order_qty AS orderQty, ord.unit_price_jpy AS unitPrice
```

**引数**: `supplierIds: string[]` (EventTable の related_nodes から抽出)
**戻り値**: `ImpactChainResult` (サプライヤー→素材→製品→顧客のツリー構造)

### 6.2 `getAlternativeSuppliers`

影響サプライヤーの代替候補を ALTERNATIVE_TO エッジから取得。

```cypher
MATCH (s:Supplier {id: $supplierId})-[alt:ALTERNATIVE_TO]->(altSup:Supplier)
OPTIONAL MATCH (altSup)-[:LOCATED_IN]->(c:Country)
OPTIONAL MATCH (altSup)-[sup:SUPPLIES]->(m:Material {id: $materialId})
RETURN altSup.id AS altSupplierId, altSup.name AS altSupplierName,
       altSup.quality_score AS qualityScore,
       altSup.lead_time_days AS leadTimeDays,
       c.name AS countryName, c.geopolitical_risk AS countryRisk,
       alt.quality_score_diff AS qualityDiff,
       alt.price_diff_pct AS priceDiffPct,
       alt.lead_time_diff_days AS leadTimeDiff,
       alt.risk_score_diff AS riskScoreDiff
```

**スコアリング** (フロントエンド計算):
```
score = w1 * (100 - abs(qualityDiff))     // 品質近似度 (weight: 0.3)
      + w2 * (100 - priceDiffPct)         // コスト効率 (weight: 0.25)
      + w3 * (100 - leadTimeDiff/maxLT*100) // リードタイム (weight: 0.25)
      + w4 * (100 - countryRisk)           // カントリーリスク (weight: 0.2)
```

### 6.3 `getImpactAmount`

影響製品の年間受注金額を算出。

```cypher
MATCH (p:Product)-[ord:ORDERED_BY]->(c:Customer)
WHERE p.id IN $productIds
RETURN p.id AS productId, p.description AS productName,
       c.id AS customerId, c.name AS customerName,
       ord.annual_order_qty AS orderQty,
       ord.unit_price_jpy AS unitPrice,
       (ord.annual_order_qty * ord.unit_price_jpy) AS annualAmount
```

---

## 7. AppSync スキーマ追加 (resource.ts)

```typescript
// 新規カスタム型
ImpactChainNode: a.customType({
  nodeId: a.string().required(),
  nodeName: a.string(),
  nodeType: a.string(),      // 'Supplier' | 'Material' | 'Product' | 'Customer'
  tier: a.integer(),         // 影響ティア (0=直接, 1=素材, 2=製品, 3=顧客)
  children: a.string().array(),  // 子ノードID
})

AlternativeProposal: a.customType({
  materialId: a.string().required(),
  materialName: a.string(),
  currentSupplierId: a.string().required(),
  currentSupplierName: a.string(),
  altSupplierId: a.string().required(),
  altSupplierName: a.string(),
  countryName: a.string(),
  qualityDiff: a.integer(),
  priceDiffPct: a.float(),
  leadTimeDiff: a.integer(),
  riskScoreDiff: a.integer(),
  score: a.float(),
})

ImpactAmountItem: a.customType({
  productId: a.string().required(),
  productName: a.string(),
  customerId: a.string().required(),
  customerName: a.string(),
  orderQty: a.integer(),
  unitPrice: a.float(),
  annualAmount: a.float(),
})

ImpactAnalysisResult: a.customType({
  impactChain: a.ref('ImpactChainNode').array(),
  alternatives: a.ref('AlternativeProposal').array(),
  impactAmounts: a.ref('ImpactAmountItem').array(),
  totalImpactAmount: a.float(),
})

// 新規クエリ
getImpactAnalysis: a.query()
  .arguments({ eventId: a.string().required() })
  .returns(a.ref('ImpactAnalysisResult'))
  .handler(a.handler.function(neptuneQueryFunction))
  .authorization((allow) => [allow.publicApiKey()])
```

---

## 8. ユーザーインタラクション

| 操作 | 動作 |
|------|------|
| ページロード | eventId から全データ並列取得 |
| 影響チェーンノードホバー | ツールチップで詳細表示 |
| 影響チェーンノードクリック | `/node/:type/:id` へナビゲート |
| 代替サプライヤー「採用」ボタン | (PoC: 視覚フィードバックのみ、実際の切替は Page C) |
| 「What-ifシミュレーションへ」 | `/simulation?disableSupplier=SUP001` へ遷移 (プリセット付き) |
| テーブルソート | 列ヘッダークリックで昇順/降順切替 |

---

## 9. 変更対象ファイル

| ファイル | 操作 |
|----------|------|
| `frontend/src/views/ImpactAnalysisView.vue` | **新規作成** |
| `frontend/src/components/impact/EventHeader.vue` | **新規作成** |
| `frontend/src/components/impact/ImpactSummaryCards.vue` | **新規作成** |
| `frontend/src/components/impact/ImpactChainVisualization.vue` | **新規作成** |
| `frontend/src/components/impact/AlternativeSupplierTable.vue` | **新規作成** |
| `frontend/src/components/impact/ImpactAmountTable.vue` | **新規作成** |
| `frontend/src/stores/impact.ts` | **新規作成** |
| `frontend/src/types/index.ts` | 影響分析型追加 |
| `frontend/src/services/api.ts` | `fetchImpactAnalysis()` 追加 |
| `frontend/src/router/index.ts` | `/impact/:eventId` ルート追加 |
| `frontend/amplify/functions/neptune-query/handler.ts` | `getImpactAnalysis` ケース追加 |
| `frontend/amplify/data/resource.ts` | カスタム型・クエリ追加 |

---

## 10. 受入基準

- [ ] URL `/impact/EVT-EQ-001` でページが正しく表示される
- [ ] 影響チェーンが Supplier → Material → Product → Customer の順で表示される
- [ ] 代替サプライヤーが ALTERNATIVE_TO エッジから取得・スコアリングされる
- [ ] 影響金額が ORDERED_BY の `annual_order_qty * unit_price_jpy` で正しく計算される
- [ ] 「What-ifシミュレーションへ」で Page C に影響サプライヤーがプリセットされる
- [ ] イベントが存在しない場合 404 エラー表示
- [ ] ローディング状態とエラー状態が適切に表示される
