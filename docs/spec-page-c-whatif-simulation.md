# Page C: What-if シミュレーション — 機能仕様書

## 1. 概要

関税率・為替レート・サプライヤー可用性・発注量をスライダーで操作し、
サプライチェーン全体のコスト影響をリアルタイムで可視化する画面。

**2段階の計算エンジン**:
1. **即時計算** (クライアント側 Pinia computed) — スライダー操作で即時反映
2. **最適化計算** (OR-Tools Lambda) — 「最適化実行」ボタンで起動、最適サプライヤー配分を提案

**ルート**: `/simulation`
**コンポーネント**: `SimulationView.vue`

---

## 2. データソース

| ソース | 用途 | クエリ |
|--------|------|--------|
| Neptune KG | BOM構成 + 素材価格 + サプライヤー情報 | `getSimulationData` (新規) |
| Neptune KG | 関税率 | TARIFF_APPLIES エッジ |
| Neptune KG | 為替レート | Country.exchange_rate_jpy |
| Neptune KG | 代替サプライヤー差分 | ALTERNATIVE_TO エッジ |
| Neptune KG | 受注データ | ORDERED_BY エッジ |
| OR-Tools Lambda | 最適サプライヤー配分 | `runOptimization` (新規) |

---

## 3. 画面レイアウト

```
+------------------------------------------------------------------+
| [Logo] Supply Chain Risk Monitor    [Dashboard] [Map] [Simulation]|
+------------------------------------------------------------------+
|                                                                    |
| +-------------------------------+---------------------------------+|
| | [操作パネル]                    | [結果パネル]                    ||
| |                               |                                 ||
| | --- 関税率 ---                | [サマリーカード x3]              ||
| | Section 301 (CN→US)          | +----------+----------+---------+||
| |   25% [========|===] 35%     | | 総コスト  | マージン  | 影響額  |||
| | MFN (CN→JP)                  | | +12.3%   | -4.1pt   | ¥8.2億  |||
| |   0% [|============] 15%     | +----------+----------+---------+||
| | CBAM (EU)                    |                                 ||
| |   0% [|============] 10%     | [棒グラフ: 製品別コスト比較]     ||
| | EPA (KR→JP)                  | Before/After 横並び棒グラフ      ||
| |   0% [|============] 5%      |  PRD001 |████ ████████|         ||
| |                               |  PRD002 |████████ ████████████| ||
| | --- 為替レート ---            |  PRD003 |████ ██████|           ||
| | USD/JPY                      |  ...                             ||
| |   149 [========|===] 160     |                                 ||
| | CNY/JPY                      | [ウォーターフォール] (選択製品)   ||
| |   20.3 [======|====] 25      | 基準コスト → +関税 → +為替 → 新 ||
| | EUR/JPY                      |  85000 [+3200][+1800] = 90000   ||
| |   161 [========|===] 175     |                                 ||
| |                               | [製品別詳細テーブル]             ||
| | --- サプライヤー ---          | Product | Base | New | Delta %  ||
| | [x] SUP001 TSMC       TW    | PRD001  | 85k  | 90k | +5.9%   ||
| | [x] SUP002 Samsung    KR    | PRD002  | 320k | 348k| +8.7%   ||
| | [x] SUP003 Infineon   DE    | PRD003  | 150k | 158k| +5.3%   ||
| | [ ] SUP005 BYD        CN    | ...                             ||
| | [x] SUP009 LG Chem    KR    |                                 ||
| | [ ] SUP109 Norilsk    RU    | [代替サプライヤー推奨]           ||
| | ...                          | (無効化されたサプライヤーの代替)  ||
| |                               | SUP005 BYD → SUP009 LG Chem   ||
| | --- 発注量 ---               |   price: +15%, LT: +3d         ||
| | 倍率: 1.0x [====|====] 2.0x | SUP109 Norilsk → SUP110 Aneka  ||
| |                               |   price: +8%, LT: +3d          ||
| | [リセット]                    |                                 ||
| | [最適化実行 (OR-Tools)] 🔄   | [最適化結果パネル]               ||
| |                               | (OR-Tools実行後に表示)          ||
| +-------------------------------+---------------------------------+|
+------------------------------------------------------------------+
```

---

## 4. 2段階計算アーキテクチャ

### 4.1 即時計算 (Pinia computed — クライアント側)

スライダー操作のたびに即時再計算。サーバー通信なし。

```
入力: スライダー値 (関税オーバーライド, FXオーバーライド, 無効サプライヤー, 数量倍率)
処理: BOM走査 → コスト積上げ → 差分計算
出力: 製品別コスト変動、ポートフォリオ総影響額、マージン変動
```

**計算ロジック** (各製品について):
```
for each (material, bomQty) in product.BOM:
  supplier = primarySupplier(material)
  if supplier is disabled:
    supplier = alternativeSupplier(material)  // ALTERNATIVE_TO から
    if no alternative: mark DISRUPTED

  // 素材単価をJPYに変換
  fxRate = overrideFX[material.currency] ?? baseFX[material.currency]
  unitPriceJpy = material.unit_price / fxRate
  // ※ exchange_rate_jpy は「1 JPYあたりの外貨額」
  //    例: USD=0.0067 → 1 USD = 1/0.0067 = 149.25 JPY
  //    price_jpy = price_foreign / exchange_rate_jpy

  // 関税適用
  tariffKey = (material.hs_code, supplier.origin_country, "JP")
  tariffRate = overrideTariff[tariffKey] ?? baseTariff[tariffKey] ?? 0
  costWithTariff = unitPriceJpy * (1 + tariffRate / 100)

  // BOM数量で乗算
  componentCost = costWithTariff * bomQty
  productCost += componentCost

delta = productCost - product.cost_estimate_jpy
deltaPct = delta / product.cost_estimate_jpy * 100
newMargin = (product.sales_price_jpy - productCost) / product.sales_price_jpy
```

**ポートフォリオ影響**:
```
portfolioImpact = Σ (productDelta * orderQty * volumeMultiplier)
                  for all (product, customer) in ORDERED_BY
```

### 4.2 最適化計算 (OR-Tools Lambda — サーバー側)

「最適化実行」ボタンで起動。2-5秒のレイテンシ。

**最適化問題**: 各素材のサプライヤー配分を最適化し、総調達コストを最小化。

```
目的関数:
  minimize Σ_m Σ_s (unitPrice[m,s] * fxRate[s] * (1 + tariff[m,s]/100) * x[m,s])

決定変数:
  x[m,s] = サプライヤー s から素材 m を調達する数量 (≥ 0)

制約条件:
  1. 需要充足: Σ_s x[m,s] >= Σ_p (bomQty[p,m] * Σ_c orderQty[p,c] * volumeMultiplier)
     (各素材の総調達量 >= 全製品のBOM所要量合計)

  2. 供給能力: x[m,s] <= annualVolume[s,m]
     (各サプライヤーの供給量 <= 年間供給能力)

  3. 可用性: x[m,s] = 0  if supplier s is disabled
     (無効化されたサプライヤーからの調達量 = 0)

  4. 非負: x[m,s] >= 0

  5. (オプション) リードタイム制約:
     leadTime[m,s] * x[m,s] / totalDemand[m] <= maxLeadTimeDays
```

**OR-Tools ソルバー**: `pywraplp.Solver` (GLOP for LP / CBC for MILP)

---

## 5. OR-Tools Lambda 設計

### 5.1 デプロイアーキテクチャ

```
Vue (SimulationView)
  ↓ AppSync query: runOptimization
Amplify TS function (optimization-query/handler.ts)
  ↓ Lambda.invoke()
Python Lambda (supply-chain-optimizer)  ← OR-Tools here
  ↓ Neptune query (boto3)
Neptune Analytics
```

- **Python Lambda**: `src/lambda/supply_chain_optimizer/__init__.py`
  - OR-Tools Layer (ortools + protobuf)
  - Neptune 直接クエリ (boto3 neptune-graph client)
  - 最適化モデル構築 + 求解 + 結果フォーマット
- **Amplify TS proxy**: `frontend/amplify/functions/optimization-query/handler.ts`
  - AppSync から呼ばれ、Python Lambda を invoke して結果を返すだけ
- **CDK Stack**: `infra/cdk/stacks/optimizer_stack.py`
  - Python Lambda + OR-Tools Layer デプロイ
  - Neptune 読み取り権限付与

### 5.2 Python Lambda 実装概要

```python
# src/lambda/supply_chain_optimizer/__init__.py
from ortools.linear_solver import pywraplp

def handler(event, context):
    params = event.get("arguments", {})
    scenario = json.loads(params.get("scenario", "{}"))

    # 1. Neptune からデータ取得
    bom_data = query_neptune_bom()
    tariff_data = query_neptune_tariffs()
    supplier_data = query_neptune_suppliers()
    order_data = query_neptune_orders()

    # 2. シナリオパラメータ適用
    disabled_suppliers = set(scenario.get("disabledSuppliers", []))
    tariff_overrides = scenario.get("tariffOverrides", {})
    fx_overrides = scenario.get("fxOverrides", {})
    volume_multiplier = scenario.get("volumeMultiplier", 1.0)

    # 3. OR-Tools モデル構築
    solver = pywraplp.Solver.CreateSolver("GLOP")
    # ... 変数・制約・目的関数を設定

    # 4. 求解
    status = solver.Solve()

    # 5. 結果フォーマット
    if status == pywraplp.Solver.OPTIMAL:
        return format_optimization_result(solver, variables)
    else:
        return {"status": "INFEASIBLE", "message": "解なし"}
```

### 5.3 OR-Tools Layer

```
ortools-layer/
├── python/
│   └── ortools/          # pip install ortools -t python/
│       ├── linear_solver/
│       └── ...
└── requirements.txt      # ortools==9.10.4067
```

ビルド: `pip install ortools -t ortools-layer/python/ --platform manylinux2014_x86_64 --only-binary=:all:`
Lambda Layer として CDK でアタッチ。

---

## 6. コンポーネント構成

```
SimulationView.vue
├── SimulationControls.vue            # 左パネル全体
│   ├── TariffSliders.vue             # 関税率スライダー群
│   ├── FxRateSliders.vue             # 為替レートスライダー群
│   ├── SupplierToggles.vue           # サプライヤーON/OFFトグル
│   ├── VolumeSlider.vue              # 発注量倍率スライダー
│   └── OptimizationButton.vue        # OR-Tools実行ボタン
├── SimulationResults.vue             # 右パネル全体
│   ├── SimSummaryCards.vue           # サマリーカード (3枚)
│   ├── ProductCostChart.vue          # 棒グラフ (Chart.js)
│   ├── CostWaterfallChart.vue        # ウォーターフォール (Chart.js stacked)
│   ├── ProductDetailTable.vue        # 製品別詳細テーブル
│   ├── AlternativeRecommendations.vue # 代替サプライヤー推奨
│   └── OptimizationResultPanel.vue   # OR-Tools結果パネル
```

---

## 7. Pinia ストア

**新規: `frontend/src/stores/simulation.ts`**

```typescript
export const useSimulationStore = defineStore('simulation', () => {
  // ── Neptune Data (loaded once) ──
  const bomItems = ref<SimBOMItem[]>([])
  const tariffs = ref<SimTariff[]>([])
  const orders = ref<SimOrder[]>([])
  const alternatives = ref<SimAlternative[]>([])
  const fxRates = ref<Map<string, number>>(new Map())   // currency → rate

  // ── Slider Inputs ──
  const tariffOverrides = ref<Map<string, number>>(new Map())
  // key: "hs_code:origin:importer" → overridden rate %
  const fxOverrides = ref<Map<string, number>>(new Map())
  // key: "USD" → new exchange_rate_jpy value
  const disabledSuppliers = ref<Set<string>>(new Set())
  const volumeMultiplier = ref(1.0)
  const selectedProductId = ref<string | null>(null)

  // ── Computed: Instant Recalculation ──
  const simulationResults = computed<ProductSimResult[]>(() => { ... })
  const portfolioImpact = computed<PortfolioImpact>(() => { ... })
  const disruptedProducts = computed<string[]>(() => { ... })
  const alternativeRecommendations = computed<AltRecommendation[]>(() => { ... })
  const selectedProductBreakdown = computed<CostBreakdownItem[]>(() => { ... })

  // ── OR-Tools Results (server-side) ──
  const optimizationResult = ref<OptimizationResult | null>(null)
  const isOptimizing = ref(false)

  // ── Actions ──
  async function loadSimulationData() { ... }       // Neptune fetch (once)
  function setTariffOverride(key, rate) { ... }
  function setFxOverride(currency, rate) { ... }
  function toggleSupplier(supplierId) { ... }
  function setVolumeMultiplier(mult) { ... }
  function resetAll() { ... }
  async function runOptimization() { ... }           // OR-Tools Lambda call
})
```

---

## 8. AppSync スキーマ追加 (resource.ts)

```typescript
// ── シミュレーションデータ型 ──
SimBOMItem: a.customType({
  productId: a.string().required(),
  productName: a.string(),
  baseCostJpy: a.float(),
  salesPriceJpy: a.float(),
  marginRate: a.float(),
  materialId: a.string().required(),
  materialName: a.string(),
  materialUnitPrice: a.float(),
  materialCurrency: a.string(),
  hsCode: a.string(),
  originCountry: a.string(),
  bomQuantity: a.integer(),
  supplierId: a.string(),
  supplierName: a.string(),
  isPrimary: a.boolean(),
})

SimTariff: a.customType({
  hsCode: a.string().required(),
  originCountry: a.string().required(),
  importingCountry: a.string().required(),
  tariffRatePct: a.float(),
  tariffType: a.string(),
})

SimOrder: a.customType({
  productId: a.string().required(),
  productName: a.string(),
  customerId: a.string().required(),
  customerName: a.string(),
  annualOrderQty: a.integer(),
  unitPriceJpy: a.float(),
})

SimAlternative: a.customType({
  supplierId: a.string().required(),
  supplierName: a.string(),
  altSupplierId: a.string().required(),
  altSupplierName: a.string(),
  qualityDiff: a.integer(),
  priceDiffPct: a.float(),
  leadTimeDiff: a.integer(),
  riskScoreDiff: a.integer(),
})

SimFXRate: a.customType({
  currencyCode: a.string().required(),
  countryCode: a.string().required(),
  exchangeRateJpy: a.float(),
})

SimulationData: a.customType({
  bomItems: a.ref('SimBOMItem').array(),
  tariffs: a.ref('SimTariff').array(),
  orders: a.ref('SimOrder').array(),
  alternatives: a.ref('SimAlternative').array(),
  fxRates: a.ref('SimFXRate').array(),
})

// ── OR-Tools結果型 ──
OptAllocation: a.customType({
  materialId: a.string().required(),
  supplierId: a.string().required(),
  allocatedQty: a.float(),
  unitCostJpy: a.float(),
  totalCostJpy: a.float(),
})

OptimizationResult: a.customType({
  status: a.string().required(),       // OPTIMAL | INFEASIBLE
  totalCostJpy: a.float(),
  costReductionPct: a.float(),
  allocations: a.ref('OptAllocation').array(),
  solveTimeMs: a.integer(),
})

// ── クエリ ──
getSimulationData: a.query()
  .returns(a.ref('SimulationData'))
  .handler(a.handler.function(neptuneQueryFunction))
  .authorization((allow) => [allow.publicApiKey()])

runOptimization: a.query()
  .arguments({ scenario: a.string().required() })  // JSON文字列
  .returns(a.ref('OptimizationResult'))
  .handler(a.handler.function(optimizationQueryFunction))
  .authorization((allow) => [allow.publicApiKey()])
```

---

## 9. FX レート変換規約

KG の `Country.exchange_rate_jpy` は「1 JPY あたりの外貨額」:

| 通貨 | exchange_rate_jpy | 意味 | 変換式 |
|------|-------------------|------|--------|
| JPY | 1.0 | 1 JPY = 1 JPY | そのまま |
| USD | 0.0067 | 1 JPY = 0.0067 USD | 1 USD = 149.25 JPY |
| EUR | 0.0062 | 1 JPY = 0.0062 EUR | 1 EUR = 161.29 JPY |
| CNY | 0.0493 | 1 JPY = 0.0493 CNY | 1 CNY = 20.28 JPY |

**変換**: `price_jpy = price_foreign / exchange_rate_jpy`

**スライダー表示**: ユーザーには「1 USD = XXX JPY」形式で表示。
内部値: `exchange_rate_jpy = 1 / display_value`

---

## 10. チャートライブラリ

**Chart.js + vue-chartjs** を採用 (軽量: ~15KB gzipped)

### 10.1 棒グラフ (製品別コスト比較)
- 横軸: 製品名
- 縦軸: コスト (JPY)
- 2本バー: Before (blue) / After (赤 or 緑)
- delta が正なら赤、負なら緑

### 10.2 ウォーターフォール (選択製品のコスト内訳)
- Chart.js stacked bar で実装 (transparent base + colored segment)
- セグメント: 基準コスト → +関税影響 → +為替影響 → +サプライヤー切替影響 → 新コスト

---

## 11. Page B → Page C 連携

Page B の「What-ifシミュレーションへ」ボタンから遷移時、
URLクエリパラメータでプリセットを渡す:

```
/simulation?disable=SUP001,SUP004&event=EVT-EQ-001
```

`SimulationView.vue` の `onMounted` で:
```typescript
const route = useRoute()
if (route.query.disable) {
  const ids = (route.query.disable as string).split(',')
  ids.forEach(id => store.toggleSupplier(id))
}
```

---

## 12. 変更対象ファイル

| ファイル | 操作 |
|----------|------|
| **フロントエンド** | |
| `frontend/src/views/SimulationView.vue` | **新規作成** |
| `frontend/src/components/simulation/SimulationControls.vue` | **新規作成** |
| `frontend/src/components/simulation/TariffSliders.vue` | **新規作成** |
| `frontend/src/components/simulation/FxRateSliders.vue` | **新規作成** |
| `frontend/src/components/simulation/SupplierToggles.vue` | **新規作成** |
| `frontend/src/components/simulation/ProductCostChart.vue` | **新規作成** |
| `frontend/src/components/simulation/CostWaterfallChart.vue` | **新規作成** |
| `frontend/src/components/simulation/OptimizationResultPanel.vue` | **新規作成** |
| `frontend/src/stores/simulation.ts` | **新規作成** |
| `frontend/src/types/index.ts` | シミュレーション型追加 |
| `frontend/src/services/api.ts` | `fetchSimulationData()`, `runOptimization()` 追加 |
| `frontend/src/router/index.ts` | `/simulation` ルート追加 |
| `frontend/package.json` | `chart.js`, `vue-chartjs` 追加 |
| **AppSync / Lambda** | |
| `frontend/amplify/functions/neptune-query/handler.ts` | `getSimulationData` ケース追加 |
| `frontend/amplify/functions/optimization-query/handler.ts` | **新規作成** (TS proxy) |
| `frontend/amplify/data/resource.ts` | カスタム型・クエリ追加 |
| `frontend/amplify/backend.ts` | optimization-query Lambda 権限追加 |
| **OR-Tools Lambda** | |
| `src/lambda/supply_chain_optimizer/__init__.py` | **新規作成** |
| `src/lambda/supply_chain_optimizer/requirements.txt` | **新規作成** (`ortools`) |
| **CDK** | |
| `infra/cdk/stacks/optimizer_stack.py` | **新規作成** |
| `infra/cdk/app.py` | OptimizerStack 追加 |

---

## 13. 受入基準

### 即時計算
- [ ] 関税スライダー操作で棒グラフ・テーブルが即時更新される (< 100ms)
- [ ] 為替レートスライダーで USD/CNY/EUR 建て素材のコストが正しく変動する
- [ ] サプライヤー無効化で代替サプライヤーが自動選択される
- [ ] 代替なしの場合「供給途絶」警告が表示される
- [ ] 「リセット」ボタンで全スライダーが初期値に戻る
- [ ] ウォーターフォールチャートが選択製品のコスト構成を正しく分解する

### OR-Tools 最適化
- [ ] 「最適化実行」ボタンでローディング表示 → 2-5秒で結果返却
- [ ] 最適配分結果が素材×サプライヤーのテーブルで表示される
- [ ] OPTIMAL / INFEASIBLE ステータスが正しく表示される
- [ ] 制約不充足時（全サプライヤー無効等）に適切なエラーメッセージ

### Page B 連携
- [ ] Page B から `?disable=SUP001` 付きで遷移時、該当サプライヤーが無効状態

### 検証用計算例
PRD001 (5G基地局モジュール) の基準コスト検証:
```
MAT001 x4: 45 USD / 0.0067 = 6,716 JPY × 4 = 26,866 JPY (tariff 0% MFN)
MAT004 x2: 8.20 USD / 0.0046 = 1,783 JPY × 2 = 3,565 JPY (tariff 0% MFN, TW origin)
MAT014 x12: 6.80 USD / 1.0 = 6.80 JPY... 
  ※ MAT014 origin=JP, currency=USD → 6.80 / 0.0067 = 1,015 JPY × 12 = 12,179 JPY
MAT010 x1: 8.50 USD / 0.0322 = 264 JPY (MY origin, hs=3920.62)
合計: ~42,874 JPY (BOM直接材料費のみ — 間接費込みで cost_estimate_jpy=85,000)
```
