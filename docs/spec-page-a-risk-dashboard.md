# Page A: リスクダッシュボード — 機能仕様書

## 1. 概要

サプライチェーンに影響を与えるリスクイベント（地震、関税変更、制裁、品質問題等）を
一覧・管理するダッシュボード画面。DynamoDB EventTable のリスクイベントと
Neptune KG の構造データを組み合わせて表示する。

**ルート**: `/dashboard`
**コンポーネント**: `RiskDashboardView.vue`

---

## 2. データソース

| ソース | 用途 | クエリ |
|--------|------|--------|
| DynamoDB EventTable | イベント一覧、ステータス別件数 | `getEventsByStatus`, `getEventCounts` |
| Neptune KG | 関連ノードの詳細（サプライヤー名、製品名等） | `getSuppliers`, `getPlants` |
| DynamoDB EarthquakeEvent | 地震アラート | Amplify model `EarthquakeEvent.list()` |

**既存APIの再利用**:
- `frontend/src/services/api.ts` — `fetchPlants()`, `fetchSuppliers()`, `fetchCustomers()`
- `frontend/src/stores/notification.ts` — `loadEvents()`, `changeStatus()`, `filteredEvents`

---

## 3. 画面レイアウト

```
+------------------------------------------------------------------+
| [Logo] Supply Chain Risk Monitor    [Dashboard] [Map] [Simulation]|
+------------------------------------------------------------------+
|                                                                    |
| [サマリーカード x4]                                                 |
| +------------+ +------------+ +------------+ +------------+        |
| | CONFIRMED  | | PENDING    | | WATCHING   | | DISMISSED  |        |
| |    3件     | |    2件     | |    2件     | |    1件     |        |
| | risk:4.3   | | risk:3.0   | | risk:3.0   | | risk:1.0   |        |
| +------------+ +------------+ +------------+ +------------+        |
|                                                                    |
| [フィルタバー]                                                      |
| Status: [ALL] [CONFIRMED] [PENDING] [WATCHING]  Risk: [>=3] [ALL] |
| Category: [ALL] [地震] [関税] [制裁] [品質]   Search: [________]   |
|                                                                    |
| [イベントテーブル]                                                   |
| +----------------------------------------------------------------+ |
| | Status | Summary          | Risk | Category | Date    | Action | |
| +----------------------------------------------------------------+ |
| | CONF   | 台湾M6.8地震...  |  5   | 地震     | 03/15   | [詳細] | |
| | CONF   | Section301関税.. |  4   | 関税     | 03/10   | [詳細] | |
| | CONF   | Norilsk制裁...   |  5   | 制裁     | 03/08   | [詳細] | |
| | PEND   | タイ洪水リスク.. |  3   | 自然災害 | 03/20   | [詳細] | |
| | PEND   | Samsung歩留..   |  3   | 品質     | 03/18   | [詳細] | |
| | WATCH  | 中国レアアース.. |  4   | 規制     | 03/12   | [詳細] | |
| +----------------------------------------------------------------+ |
| [< 1/2 >]                                                         |
|                                                                    |
| [影響サマリーパネル] (選択イベント展開時)                              |
| +----------------------------------------------------------------+ |
| | EVT-EQ-001: 台湾M6.8地震 — TSMC生産停止                         | |
| | Risk: 5  Confidence: 85%  Source: P2PQuake API                  | |
| |                                                                  | |
| | 関連ノード:                                                      | |
| |   - SUP001 TSMC (Supplier) — 主力fab停止リスク                   | |
| |   - MAT001 先端ロジック半導体 (Material) — 供給途絶             | |
| |   - PRD001 5G基地局モジュール (Product) — 生産遅延               | |
| |                                                                  | |
| | 事実ソース:                                                      | |
| |   [P2PQuake] M6.8 震源:花蓮縣 2025-03-15T02:30:00              | |
| |   [Reuters] TSMC fab halt confirmed                              | |
| |                                                                  | |
| | [ステータス変更: CONFIRMED → WATCHING ▼]  [影響分析へ →]          | |
| +----------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

---

## 4. コンポーネント構成

```
RiskDashboardView.vue
├── DashboardSummaryCards.vue       # ステータス別カード (4枚)
├── EventFilterBar.vue              # フィルタ操作バー
├── EventTable.vue                  # イベントテーブル (ページネーション付き)
│   └── EventRow.vue                # 各行 (クリックで展開)
└── EventDetailPanel.vue            # 選択イベントの詳細パネル
    ├── RelatedNodesList.vue        # 関連ノード一覧
    └── FactSourcesList.vue         # 事実ソース一覧
```

---

## 5. Pinia ストア

**既存ストア `notification.ts` を使用** — 追加不要。

```typescript
// 既にある機能:
notification.loadEvents()          // ステータス別イベント取得
notification.changeStatus(id, st)  // ステータス更新 (楽観更新+ロールバック)
notification.filteredEvents        // リスクレベル・カテゴリフィルタ
notification.counts                // ステータス別件数
notification.attentionCount        // CONFIRMED + PENDING 件数
```

---

## 6. ユーザーインタラクション

| 操作 | 動作 |
|------|------|
| サマリーカードをクリック | 対応ステータスでフィルタ |
| イベント行をクリック | 詳細パネルを展開/折りたたみ |
| ステータス変更ドロップダウン | `changeStatus()` 楽観更新 |
| 「影響分析へ」ボタン | `/impact/:eventId` へナビゲート (Page B) |
| 関連ノードリンク | `/node/:type/:id` へナビゲート |
| フィルタ変更 | テーブル即時フィルタ (クライアント側) |
| ページネーション | 10件/ページ、サーバー側 `nextToken` |

---

## 7. API 追加不要

既存の `eventQuery` Lambda + `notification.ts` ストアで全機能カバー:
- `getEventsByStatus` — ステータス別取得 (GSI1)
- `getEventsByCategory` — カテゴリ別取得 (GSI2)
- `getEventById` — 単一イベント詳細
- `getEventCounts` — 件数集計
- `updateEventStatus` — ステータス更新ミューテーション

---

## 8. スタイリング方針

- 既存 `base.css` のCSS変数を使用
- ステータス色:
  - CONFIRMED: `var(--color-danger)` (赤 #ef4444)
  - PENDING: `var(--color-warning)` (琥珀 #f59e0b)
  - WATCHING: `var(--color-primary)` (藍 #6366f1)
  - DISMISSED: `var(--color-text-tertiary)` (グレー)
- リスクレベルバッジ: 1-2 (低/緑), 3 (中/黄), 4-5 (高/赤)
- カード: `var(--shadow-sm)`, `var(--radius-md)`

---

## 9. 変更対象ファイル

| ファイル | 操作 |
|----------|------|
| `frontend/src/views/RiskDashboardView.vue` | **新規作成** |
| `frontend/src/components/dashboard/DashboardSummaryCards.vue` | **新規作成** |
| `frontend/src/components/dashboard/EventFilterBar.vue` | **新規作成** |
| `frontend/src/components/dashboard/EventTable.vue` | **新規作成** |
| `frontend/src/components/dashboard/EventDetailPanel.vue` | **新規作成** |
| `frontend/src/router/index.ts` | `/dashboard` ルート追加 |
| `frontend/src/stores/notification.ts` | 変更なし (既存で十分) |

---

## 10. 受入基準

- [ ] 4つのサマリーカードにステータス別件数が正しく表示される
- [ ] ステータスフィルタでテーブルが正しく絞り込まれる
- [ ] イベント行クリックで詳細パネルが展開される
- [ ] 関連ノード (related_nodes) がリンク付きで表示される
- [ ] ステータス変更が即座に反映される (楽観更新)
- [ ] seed_event_table.py の8件のテストイベントが全て表示される
- [ ] 「影響分析へ」ボタンで Page B に遷移できる
- [ ] レスポンシブ: 1024px以上で2カラム、768px以下で1カラム
