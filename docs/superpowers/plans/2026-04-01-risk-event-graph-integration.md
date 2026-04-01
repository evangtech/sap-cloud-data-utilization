# RiskEvent Graph Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate risk events as first-class graph entities in Neptune Analytics, replacing the earthquake-only DynamoDB impact system with a generalized risk scoring, corridor analysis, and simulation platform.

**Architecture:** Three new vertex types (RiskEvent, RiskCategory, LogisticsHub) and seven new edge types integrate into the existing Neptune graph. A single ingestion pipeline (RiskEventService) feeds all risk event sources. The frontend migrates from DynamoDB-backed earthquake state to graph-backed risk event state with risk scoring, corridor analysis, and a risk-to-simulation adapter.

**Tech Stack:** Python 3.13 (Lambda), TypeScript (Amplify/Vue 3), Neptune Analytics (openCypher), DynamoDB (operational state), Pinia (state management), Leaflet (maps), Vitest (testing), AWS CDK (infrastructure).

**Spec:** `docs/superpowers/specs/2026-04-01-risk-event-graph-integration-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `frontend/amplify/functions/shared/neptune-client.ts` | Shared Neptune connection and query execution module |
| `frontend/amplify/functions/neptune-risk-query/handler.ts` | Risk analysis query handler (risk scoring, corridor, recovery, correlation) |
| `frontend/amplify/functions/neptune-risk-query/resource.ts` | Amplify function definition for risk query handler |
| `frontend/src/services/riskSimulationAdapter.ts` | Translates graph risk state into simulation store overrides |
| `src/lambda/risk_event_service/__init__.py` | Shared ingestion path: normalize, dedupe, upsert, propagate |
| `src/lambda/risk_event_service/providers.py` | Provider interface and P2PQuake provider implementation |
| `src/lambda/risk_event_ingester/__init__.py` | EventBridge-triggered Lambda, polls providers via RiskEventService |
| `src/lambda/impact_propagator/__init__.py` | Event-scoped idempotent impact propagation with versioned swap |
| `infra/cdk/stacks/risk_event_ingester_stack.py` | CDK stack: ingester Lambda + EventBridge + DynamoDB tables |
| `infra/cdk/stacks/impact_propagator_stack.py` | CDK stack: propagator Lambda + Neptune permissions |
| `scripts/migrate_dynamodb_to_graph.py` | One-time DynamoDB → Neptune migration script |
| `tests/lambda/test_risk_event_service.py` | Unit tests for ingestion service |
| `tests/lambda/test_impact_propagator.py` | Unit tests for impact propagation |
| `tests/frontend/services/riskSimulationAdapter.test.ts` | Unit tests for risk-to-simulation adapter |

### Modified Files

| File | Change |
|------|--------|
| `scripts/load_neptune_data.py` | Add RiskCategory, LogisticsHub, ROUTES_THROUGH, sample RiskEvents |
| `frontend/src/types/index.ts` | Add Warehouse, LogisticsHub, RouteThrough, RiskEvent graph types, NodeRiskScore, NodeImpact, EventImpact, DisruptsEdge |
| `frontend/amplify/data/resource.ts` | Add risk query/mutation definitions, remove DynamoDB models (Phase 3) |
| `frontend/amplify/functions/neptune-query/handler.ts` | Extract query functions to importable modules, add Warehouse/LogisticsHub queries |
| `frontend/amplify/functions/nl-query/handler.ts` | Expand schema prompt with risk entities, import from shared module |
| `frontend/amplify/functions/event-query/handler.ts` | Rewire to Neptune for review workflow (Phase 1) |
| `frontend/src/services/api.ts` | Add risk event fetch functions, compatibility adapters |
| `frontend/src/stores/supplyChain.ts` | Replace earthquake/plantImpacts with riskEvents/activeImpacts/riskScores |
| `frontend/src/components/SupplyChainMap.vue` | Add 5-type markers, risk color scale, event overlay, LogisticsHub rendering |
| `frontend/src/views/MapView.vue` | Handle risk event selection, risk score display |
| `frontend/src/router/index.ts` | Add risk dashboard, corridor analysis routes |
| `frontend/src/App.vue` | Add navigation items for new views |
| `infra/cdk/app.py` | Register new stacks, wire dependencies |

---

## Phase 0: Foundation (Graph Schema & Types)

### Task 1: Extend Graph Seed Data

**Files:**
- Modify: `scripts/load_neptune_data.py`

This task adds RiskCategory, LogisticsHub vertices, ROUTES_THROUGH edges, and sample historical RiskEvents to the Neptune graph seeder. This is the foundation all other tasks build on.

- [ ] **Step 1: Add RiskCategory vertices**

Add after the existing `create_regulations()` section (around line 180) in `scripts/load_neptune_data.py`:

```python
def create_risk_categories(neptune_client, graph_id):
    """リスクカテゴリ頂点の作成"""
    categories = [
        # 自然災害
        {"id": "RC-natural-earthquake", "name": "地震", "parentCategory": "natural_disaster",
         "description": "地震による供給網への影響", "avgRecoveryDays": 30},
        {"id": "RC-natural-typhoon", "name": "台風", "parentCategory": "natural_disaster",
         "description": "台風・暴風雨による供給網への影響", "avgRecoveryDays": 14},
        {"id": "RC-natural-flood", "name": "洪水", "parentCategory": "natural_disaster",
         "description": "洪水・浸水による供給網への影響", "avgRecoveryDays": 21},
        # 地政学的
        {"id": "RC-geopolitical-sanction", "name": "制裁措置", "parentCategory": "geopolitical",
         "description": "経済制裁による貿易制限", "avgRecoveryDays": 180},
        {"id": "RC-geopolitical-trade_restriction", "name": "貿易規制", "parentCategory": "geopolitical",
         "description": "関税引上げ・輸出規制", "avgRecoveryDays": 365},
        {"id": "RC-geopolitical-conflict", "name": "紛争", "parentCategory": "geopolitical",
         "description": "武力紛争・政情不安による供給網への影響", "avgRecoveryDays": 90},
        # 運用上
        {"id": "RC-operational-port_closure", "name": "港湾閉鎖", "parentCategory": "operational",
         "description": "港湾の閉鎖・機能停止", "avgRecoveryDays": 7},
        {"id": "RC-operational-factory_incident", "name": "工場事故", "parentCategory": "operational",
         "description": "工場での事故・火災", "avgRecoveryDays": 45},
        {"id": "RC-operational-pandemic", "name": "パンデミック", "parentCategory": "operational",
         "description": "感染症流行による操業停止", "avgRecoveryDays": 60},
        # 財務
        {"id": "RC-financial-bankruptcy", "name": "サプライヤー倒産", "parentCategory": "financial",
         "description": "サプライヤーの経営破綻", "avgRecoveryDays": 120},
        {"id": "RC-financial-credit", "name": "信用リスク", "parentCategory": "financial",
         "description": "サプライヤーの信用悪化", "avgRecoveryDays": 90},
        {"id": "RC-financial-fx", "name": "為替変動", "parentCategory": "financial",
         "description": "急激な為替レート変動", "avgRecoveryDays": 30},
    ]

    for cat in categories:
        query = f"""
        MERGE (rc:RiskCategory {{id: '{cat["id"]}'}})
        SET rc.name = '{cat["name"]}',
            rc.parentCategory = '{cat["parentCategory"]}',
            rc.description = '{cat["description"]}',
            rc.avgRecoveryDays = {cat["avgRecoveryDays"]}
        """
        execute_query(neptune_client, graph_id, query)

    print(f"  RiskCategory: {len(categories)} 件作成")
```

- [ ] **Step 2: Add LogisticsHub vertices**

```python
def create_logistics_hubs(neptune_client, graph_id):
    """物流拠点頂点の作成"""
    hubs = [
        {"id": "LH-tokyo-port", "name": "東京港", "type": "port",
         "country_code": "JP", "lat": 35.6220, "lon": 139.7753, "capacity": "4500000 TEU/年", "status": "operational"},
        {"id": "LH-yokohama-port", "name": "横浜港", "type": "port",
         "country_code": "JP", "lat": 35.4437, "lon": 139.6500, "capacity": "2900000 TEU/年", "status": "operational"},
        {"id": "LH-kobe-port", "name": "神戸港", "type": "port",
         "country_code": "JP", "lat": 34.6600, "lon": 135.2100, "capacity": "2800000 TEU/年", "status": "operational"},
        {"id": "LH-shanghai-port", "name": "上海港", "type": "port",
         "country_code": "CN", "lat": 31.3600, "lon": 121.6100, "capacity": "47000000 TEU/年", "status": "operational"},
        {"id": "LH-kaohsiung-port", "name": "高雄港", "type": "port",
         "country_code": "TW", "lat": 22.6100, "lon": 120.2800, "capacity": "9900000 TEU/年", "status": "operational"},
        {"id": "LH-singapore-port", "name": "シンガポール港", "type": "port",
         "country_code": "SG", "lat": 1.2600, "lon": 103.8400, "capacity": "37000000 TEU/年", "status": "operational"},
        {"id": "LH-la-port", "name": "ロサンゼルス港", "type": "port",
         "country_code": "US", "lat": 33.7400, "lon": -118.2700, "capacity": "9600000 TEU/年", "status": "operational"},
        {"id": "LH-rotterdam-port", "name": "ロッテルダム港", "type": "port",
         "country_code": "NL", "lat": 51.9500, "lon": 4.1300, "capacity": "14500000 TEU/年", "status": "operational"},
        {"id": "LH-narita-airport", "name": "成田国際空港", "type": "airport",
         "country_code": "JP", "lat": 35.7648, "lon": 140.3864, "capacity": "2500000 t/年", "status": "operational"},
        {"id": "LH-kansai-airport", "name": "関西国際空港", "type": "airport",
         "country_code": "JP", "lat": 34.4320, "lon": 135.2304, "capacity": "800000 t/年", "status": "operational"},
        {"id": "LH-laem-chabang-port", "name": "レムチャバン港", "type": "port",
         "country_code": "TH", "lat": 13.0700, "lon": 100.8800, "capacity": "8000000 TEU/年", "status": "operational"},
        {"id": "LH-haiphong-port", "name": "ハイフォン港", "type": "port",
         "country_code": "VN", "lat": 20.8500, "lon": 106.6800, "capacity": "5000000 TEU/年", "status": "operational"},
    ]

    for hub in hubs:
        query = f"""
        MERGE (lh:LogisticsHub {{id: '{hub["id"]}'}})
        SET lh.name = '{hub["name"]}',
            lh.type = '{hub["type"]}',
            lh.country_code = '{hub["country_code"]}',
            lh.lat = {hub["lat"]},
            lh.lon = {hub["lon"]},
            lh.capacity = '{hub["capacity"]}',
            lh.status = '{hub["status"]}'
        """
        execute_query(neptune_client, graph_id, query)

    # LOCATED_IN エッジ
    for hub in hubs:
        query = f"""
        MATCH (lh:LogisticsHub {{id: '{hub["id"]}'}}), (c:Country {{code: '{hub["country_code"]}'}})
        MERGE (lh)-[:LOCATED_IN]->(c)
        """
        execute_query(neptune_client, graph_id, query)

    print(f"  LogisticsHub: {len(hubs)} 件作成")
```

- [ ] **Step 3: Add ROUTES_THROUGH edges**

```python
def create_routes_through(neptune_client, graph_id):
    """サプライルートと物流拠点の接続"""
    routes = [
        # 日本の工場 → 日本の港湾
        {"from": "PLT001", "to": "LH-tokyo-port", "transitDays": 1, "isPrimary": True},
        {"from": "PLT002", "to": "LH-kobe-port", "transitDays": 1, "isPrimary": True},
        {"from": "PLT003", "to": "LH-yokohama-port", "transitDays": 1, "isPrimary": True},
        # 日本の倉庫 → 日本の港湾
        {"from": "WHS001", "to": "LH-tokyo-port", "transitDays": 1, "isPrimary": True},
        {"from": "WHS002", "to": "LH-kobe-port", "transitDays": 1, "isPrimary": True},
        # 中国のサプライヤー → 上海港
        {"from": "SUP005", "to": "LH-shanghai-port", "transitDays": 2, "isPrimary": True},
        {"from": "SUP006", "to": "LH-shanghai-port", "transitDays": 3, "isPrimary": True},
        # 台湾のサプライヤー → 高雄港
        {"from": "SUP001", "to": "LH-kaohsiung-port", "transitDays": 1, "isPrimary": True},
        # タイの工場 → レムチャバン港
        {"from": "PLT005", "to": "LH-laem-chabang-port", "transitDays": 2, "isPrimary": True},
        # ベトナムの工場 → ハイフォン港
        {"from": "PLT006", "to": "LH-haiphong-port", "transitDays": 2, "isPrimary": True},
        # シンガポール倉庫 → シンガポール港
        {"from": "WHS003", "to": "LH-singapore-port", "transitDays": 1, "isPrimary": True},
        # 米国の工場 → ロサンゼルス港
        {"from": "PLT008", "to": "LH-la-port", "transitDays": 1, "isPrimary": True},
    ]

    for route in routes:
        is_primary_str = "true" if route["isPrimary"] else "false"
        query = f"""
        MATCH (from {{id: '{route["from"]}'}}), (to:LogisticsHub {{id: '{route["to"]}'}})
        MERGE (from)-[r:ROUTES_THROUGH]->(to)
        SET r.transitDays = {route["transitDays"]}, r.isPrimary = {is_primary_str}
        """
        execute_query(neptune_client, graph_id, query)

    print(f"  ROUTES_THROUGH: {len(routes)} 件作成")
```

- [ ] **Step 4: Add sample historical RiskEvents**

```python
def create_sample_risk_events(neptune_client, graph_id):
    """サンプル履歴リスクイベントの作成（デモ・テスト用）"""
    import uuid
    events = [
        {
            "id": str(uuid.uuid4()), "sourceEventId": "p2pquake-20240101-noto",
            "dedupeKey": "p2pquake:noto:20240101", "title": "2024年能登半島地震",
            "description": "石川県能登地方を震源とするM7.6の地震", "eventType": "earthquake",
            "source": "p2pquake", "severity": 5, "lifecycleStatus": "resolved",
            "reviewStatus": "confirmed", "reviewedBy": "system",
            "trustLevel": "trusted_machine",
            "lat": 37.5, "lon": 137.2, "radiusKm": 200,
            "geoScopeType": "region", "admin1": "石川県", "locationName": "能登半島",
            "startDate": "2024-01-01T16:10:00Z", "endDate": "2024-03-31T00:00:00Z",
            "updatedAt": "2024-03-31T00:00:00Z", "confidence": 1.0,
            "categoryId": "RC-natural-earthquake", "countryCode": "JP",
        },
        {
            "id": str(uuid.uuid4()), "sourceEventId": "manual-suez-2021",
            "dedupeKey": "manual:suez:20210323", "title": "2021年スエズ運河封鎖",
            "description": "コンテナ船エバーギブンの座礁によるスエズ運河の6日間封鎖",
            "eventType": "port_closure", "source": "manual", "severity": 4,
            "lifecycleStatus": "resolved", "reviewStatus": "confirmed", "reviewedBy": "analyst",
            "trustLevel": "analyst",
            "lat": 30.0, "lon": 32.58, "radiusKm": 50,
            "geoScopeType": "point", "admin1": None, "locationName": "スエズ運河",
            "startDate": "2021-03-23T00:00:00Z", "endDate": "2021-03-29T00:00:00Z",
            "updatedAt": "2021-03-29T00:00:00Z", "confidence": 1.0,
            "categoryId": "RC-operational-port_closure", "countryCode": "EG",
        },
        {
            "id": str(uuid.uuid4()), "sourceEventId": "manual-shanghai-2022",
            "dedupeKey": "manual:shanghai:20220328", "title": "2022年上海ロックダウン",
            "description": "COVID-19対策による上海市全域の都市封鎖、港湾・工場の操業停止",
            "eventType": "pandemic", "source": "manual", "severity": 4,
            "lifecycleStatus": "resolved", "reviewStatus": "confirmed", "reviewedBy": "analyst",
            "trustLevel": "analyst",
            "lat": 31.23, "lon": 121.47, "radiusKm": 100,
            "geoScopeType": "city", "admin1": "上海市", "locationName": "上海",
            "startDate": "2022-03-28T00:00:00Z", "endDate": "2022-06-01T00:00:00Z",
            "updatedAt": "2022-06-01T00:00:00Z", "confidence": 1.0,
            "categoryId": "RC-operational-pandemic", "countryCode": "CN",
        },
        {
            "id": str(uuid.uuid4()), "sourceEventId": "manual-chips-act-2022",
            "dedupeKey": "manual:chips-act:20220809", "title": "米国CHIPS法施行",
            "description": "半導体製造の国内回帰促進と対中輸出規制強化",
            "eventType": "trade_restriction", "source": "manual", "severity": 3,
            "lifecycleStatus": "active", "reviewStatus": "confirmed", "reviewedBy": "analyst",
            "trustLevel": "analyst",
            "lat": 38.9, "lon": -77.04, "radiusKm": 0,
            "geoScopeType": "multi_country", "admin1": None, "locationName": "米国（グローバル影響）",
            "startDate": "2022-08-09T00:00:00Z", "endDate": None,
            "updatedAt": "2026-01-15T00:00:00Z", "confidence": 1.0,
            "categoryId": "RC-geopolitical-trade_restriction", "countryCode": "US",
        },
        {
            "id": str(uuid.uuid4()), "sourceEventId": "manual-typhoon-tw-2025",
            "dedupeKey": "manual:typhoon-tw:20250815", "title": "2025年台風15号（台湾直撃）",
            "description": "大型台風が台湾を直撃、TSMCファブ一時操業停止",
            "eventType": "typhoon", "source": "manual", "severity": 3,
            "lifecycleStatus": "resolved", "reviewStatus": "confirmed", "reviewedBy": "system",
            "trustLevel": "trusted_machine",
            "lat": 25.03, "lon": 121.57, "radiusKm": 300,
            "geoScopeType": "country", "admin1": None, "locationName": "台湾",
            "startDate": "2025-08-15T00:00:00Z", "endDate": "2025-08-22T00:00:00Z",
            "updatedAt": "2025-08-22T00:00:00Z", "confidence": 1.0,
            "categoryId": "RC-natural-typhoon", "countryCode": "TW",
        },
    ]

    for ev in events:
        admin1_val = f"'{ev['admin1']}'" if ev['admin1'] else 'null'
        end_date_val = f"datetime('{ev['endDate']}')" if ev['endDate'] else 'null'
        query = f"""
        MERGE (re:RiskEvent {{dedupeKey: '{ev["dedupeKey"]}'}})
        SET re.id = '{ev["id"]}',
            re.sourceEventId = '{ev["sourceEventId"]}',
            re.title = '{ev["title"]}',
            re.description = '{ev["description"]}',
            re.eventType = '{ev["eventType"]}',
            re.source = '{ev["source"]}',
            re.severity = {ev["severity"]},
            re.lifecycleStatus = '{ev["lifecycleStatus"]}',
            re.reviewStatus = '{ev["reviewStatus"]}',
            re.reviewedBy = '{ev["reviewedBy"]}',
            re.trustLevel = '{ev["trustLevel"]}',
            re.lat = {ev["lat"]},
            re.lon = {ev["lon"]},
            re.radiusKm = {ev["radiusKm"]},
            re.geoScopeType = '{ev["geoScopeType"]}',
            re.admin1 = {admin1_val},
            re.locationName = '{ev["locationName"]}',
            re.startDate = datetime('{ev["startDate"]}'),
            re.endDate = {end_date_val},
            re.updatedAt = datetime('{ev["updatedAt"]}'),
            re.confidence = {ev["confidence"]},
            re.latestPropagationSequence = 0
        """
        execute_query(neptune_client, graph_id, query)

        # CATEGORIZED_AS エッジ
        query = f"""
        MATCH (re:RiskEvent {{dedupeKey: '{ev["dedupeKey"]}'}}),
              (rc:RiskCategory {{id: '{ev["categoryId"]}'}})
        MERGE (re)-[:CATEGORIZED_AS]->(rc)
        """
        execute_query(neptune_client, graph_id, query)

        # OCCURRED_IN エッジ
        query = f"""
        MATCH (re:RiskEvent {{dedupeKey: '{ev["dedupeKey"]}'}}),
              (c:Country {{code: '{ev["countryCode"]}'}})
        MERGE (re)-[:OCCURRED_IN]->(c)
        """
        execute_query(neptune_client, graph_id, query)

    print(f"  RiskEvent: {len(events)} 件作成")
```

- [ ] **Step 5: Add sample IMPACTS edges for demo events**

```python
def create_sample_impacts(neptune_client, graph_id):
    """サンプルIMPACTSエッジの作成"""
    impacts = [
        # 能登半島地震 → 日本の工場に直接影響
        {"eventKey": "p2pquake:noto:20240101", "targetId": "PLT003", "severity": 4,
         "impactType": "direct", "estimatedRecoveryDays": 30, "costImpactPct": 15.0,
         "status": "resolved", "cachedImpactAmount": 500000000,
         "assessmentMethod": "automated", "impactConfidence": 0.95},
        # 能登半島地震 → 下流影響
        {"eventKey": "p2pquake:noto:20240101", "targetId": "PLT001", "severity": 2,
         "impactType": "downstream", "estimatedRecoveryDays": 14, "costImpactPct": 5.0,
         "status": "resolved", "cachedImpactAmount": 200000000,
         "assessmentMethod": "automated", "impactConfidence": 0.8},
        # 上海ロックダウン → 中国サプライヤーに直接影響
        {"eventKey": "manual:shanghai:20220328", "targetId": "SUP005", "severity": 4,
         "impactType": "direct", "estimatedRecoveryDays": 60, "costImpactPct": 25.0,
         "status": "resolved", "cachedImpactAmount": 800000000,
         "assessmentMethod": "manual_override", "impactConfidence": 1.0},
        # 上海ロックダウン → 上海港にも影響
        {"eventKey": "manual:shanghai:20220328", "targetId": "LH-shanghai-port", "severity": 5,
         "impactType": "direct", "estimatedRecoveryDays": 45, "costImpactPct": 30.0,
         "status": "resolved", "cachedImpactAmount": 1200000000,
         "assessmentMethod": "automated", "impactConfidence": 0.9},
        # CHIPS法 → HSCode 8542に貿易影響（DISRUPTSエッジ）
        # (別途 create_sample_disrupts で作成)
        # 台風 → TSMCに直接影響
        {"eventKey": "manual:typhoon-tw:20250815", "targetId": "SUP001", "severity": 3,
         "impactType": "direct", "estimatedRecoveryDays": 7, "costImpactPct": 10.0,
         "status": "resolved", "cachedImpactAmount": 350000000,
         "assessmentMethod": "automated", "impactConfidence": 0.85},
    ]

    now = "2026-04-01T00:00:00Z"
    for imp in impacts:
        query = f"""
        MATCH (re:RiskEvent {{dedupeKey: '{imp["eventKey"]}'}}),
              (target {{id: '{imp["targetId"]}'}})
        MERGE (re)-[i:IMPACTS]->(target)
        SET i.severity = {imp["severity"]},
            i.impactType = '{imp["impactType"]}',
            i.estimatedRecoveryDays = {imp["estimatedRecoveryDays"]},
            i.costImpactPct = {imp["costImpactPct"]},
            i.status = '{imp["status"]}',
            i.cachedImpactAmount = {imp["cachedImpactAmount"]},
            i.assessmentMethod = '{imp["assessmentMethod"]}',
            i.impactConfidence = {imp["impactConfidence"]},
            i.firstDetectedAt = datetime('{now}'),
            i.lastUpdatedAt = datetime('{now}'),
            i.propagationRunId = 'seed-data'
        """
        execute_query(neptune_client, graph_id, query)

    print(f"  IMPACTS: {len(impacts)} 件作成")


def create_sample_disrupts(neptune_client, graph_id):
    """サンプルDISRUPTSエッジの作成"""
    disrupts = [
        {"eventKey": "manual:chips-act:20220809", "hsCode": "8542.31",
         "originCountry": "CN", "destinationCountry": "US",
         "regulatorBody": "US Department of Commerce",
         "effectiveDate": "2022-10-07", "expiryDate": None,
         "tariffIncreasePct": 25.0, "exportRestricted": True},
        {"eventKey": "manual:chips-act:20220809", "hsCode": "8542.31",
         "originCountry": "TW", "destinationCountry": "CN",
         "regulatorBody": "US Department of Commerce",
         "effectiveDate": "2022-10-07", "expiryDate": None,
         "tariffIncreasePct": 0.0, "exportRestricted": True},
    ]

    for d in disrupts:
        expiry = f"'{d['expiryDate']}'" if d['expiryDate'] else 'null'
        restricted = "true" if d["exportRestricted"] else "false"
        query = f"""
        MATCH (re:RiskEvent {{dedupeKey: '{d["eventKey"]}'}}),
              (hs:HSCode {{code: '{d["hsCode"]}'}})
        MERGE (re)-[r:DISRUPTS]->(hs)
        SET r.originCountry = '{d["originCountry"]}',
            r.destinationCountry = '{d["destinationCountry"]}',
            r.regulatorBody = '{d["regulatorBody"]}',
            r.effectiveDate = '{d["effectiveDate"]}',
            r.expiryDate = {expiry},
            r.tariffIncreasePct = {d["tariffIncreasePct"]},
            r.exportRestricted = {restricted}
        """
        execute_query(neptune_client, graph_id, query)

    print(f"  DISRUPTS: {len(disrupts)} 件作成")
```

- [ ] **Step 6: Add RELATED_EVENT edges between sample events**

```python
def create_sample_related_events(neptune_client, graph_id):
    """サンプルRELATED_EVENTエッジの作成"""
    relations = [
        # 台風 → 高雄港遅延を引き起こす可能性
        {"fromKey": "manual:typhoon-tw:20250815", "toKey": "manual:suez-2021",
         "relationshipType": "coincident", "delayDays": 0, "confidence": 0.3},
    ]

    for rel in relations:
        query = f"""
        MATCH (from:RiskEvent {{dedupeKey: '{rel["fromKey"]}'}}),
              (to:RiskEvent {{dedupeKey: '{rel["toKey"]}'}})
        MERGE (from)-[r:RELATED_EVENT]->(to)
        SET r.relationshipType = '{rel["relationshipType"]}',
            r.delayDays = {rel["delayDays"]},
            r.confidence = {rel["confidence"]}
        """
        execute_query(neptune_client, graph_id, query)

    print(f"  RELATED_EVENT: {len(relations)} 件作成")
```

- [ ] **Step 7: Wire new functions into main()**

Add calls to the new functions in the main execution flow, after the existing `create_regulations()` call:

```python
    # 既存の create_regulations() の後に追加
    print("リスクカテゴリの作成...")
    create_risk_categories(neptune_client, graph_id)

    print("物流拠点の作成...")
    create_logistics_hubs(neptune_client, graph_id)

    print("ROUTES_THROUGHエッジの作成...")
    create_routes_through(neptune_client, graph_id)

    print("サンプルリスクイベントの作成...")
    create_sample_risk_events(neptune_client, graph_id)

    print("サンプルIMPACTSエッジの作成...")
    create_sample_impacts(neptune_client, graph_id)

    print("サンプルDISRUPTSエッジの作成...")
    create_sample_disrupts(neptune_client, graph_id)

    print("サンプルRELATED_EVENTエッジの作成...")
    create_sample_related_events(neptune_client, graph_id)
```

- [ ] **Step 8: Update verify_data() to check new entities**

Add verification queries after the existing ones:

```python
    # 既存の検証クエリの後に追加
    {"label": "RiskCategory", "query": "MATCH (n:RiskCategory) RETURN count(n) AS count"},
    {"label": "LogisticsHub", "query": "MATCH (n:LogisticsHub) RETURN count(n) AS count"},
    {"label": "RiskEvent", "query": "MATCH (n:RiskEvent) RETURN count(n) AS count"},
    {"label": "ROUTES_THROUGH", "query": "MATCH ()-[r:ROUTES_THROUGH]->() RETURN count(r) AS count"},
    {"label": "IMPACTS", "query": "MATCH ()-[r:IMPACTS]->() RETURN count(r) AS count"},
    {"label": "DISRUPTS", "query": "MATCH ()-[r:DISRUPTS]->() RETURN count(r) AS count"},
    {"label": "RELATED_EVENT", "query": "MATCH ()-[r:RELATED_EVENT]->() RETURN count(r) AS count"},
```

- [ ] **Step 9: Run seed script and verify**

Run: `python scripts/load_neptune_data.py`

Expected output should include:
```
  RiskCategory: 12 件作成
  LogisticsHub: 12 件作成
  ROUTES_THROUGH: 12 件作成
  RiskEvent: 5 件作成
  IMPACTS: 5 件作成
  DISRUPTS: 2 件作成
  RELATED_EVENT: 1 件作成
```

- [ ] **Step 10: Commit**

```bash
git add scripts/load_neptune_data.py
git commit -m "feat: add RiskCategory, LogisticsHub, and sample RiskEvent seed data"
```

---

### Task 2: Frontend Type Definitions

**Files:**
- Modify: `frontend/src/types/index.ts`

Add all new types required by the spec. These types are used by every subsequent frontend task.

- [ ] **Step 1: Add graph entity types after existing Customer interface (line 94)**

Add after the `Customer` interface in `frontend/src/types/index.ts`:

```typescript
// --- リスクイベント関連の型定義 ---

export interface Warehouse {
  id: string
  name: string
  countryCode: string
  latitude: number
  longitude: number
  capacity: number
  status: string
}

export interface LogisticsHub {
  id: string
  name: string
  type: 'port' | 'airport' | 'border_crossing'
  countryCode: string
  latitude: number
  longitude: number
  capacity: string | null
  status: 'operational' | 'disrupted' | 'closed'
}

export interface RouteThrough {
  fromId: string
  fromType: 'Plant' | 'Supplier' | 'Warehouse'
  fromName: string
  toId: string
  toName: string
  transitDays: number
  isPrimary: boolean
}

export interface GraphRiskEvent {
  id: string
  sourceEventId: string
  dedupeKey: string
  title: string
  description: string
  eventType: string
  source: string
  severity: number
  lifecycleStatus: 'detected' | 'active' | 'recovering' | 'resolved'
  reviewStatus: 'pending' | 'confirmed' | 'watching' | 'dismissed'
  reviewedBy: string | null
  reviewedAt: string | null
  trustLevel: 'trusted_machine' | 'ai_unverified' | 'analyst'
  latitude: number
  longitude: number
  radiusKm: number
  geoScopeType: 'point' | 'city' | 'region' | 'country' | 'multi_country'
  admin1: string | null
  admin2: string | null
  locationName: string
  affectedCountryCodes: string[]
  startDate: string
  endDate: string | null
  updatedAt: string
  sourceUrl: string | null
  sourceSnippetHash: string | null
  confidence: number
  latestPropagationRunId: string | null
  latestPropagationSequence: number
  propagationStartedAt: string | null
  propagationCompletedAt: string | null
}

export interface NodeRiskScore {
  nodeId: string
  nodeType: 'Plant' | 'Supplier' | 'Warehouse' | 'LogisticsHub'
  baselineRisk: number
  liveEventRisk: number
  revenueExposure: number
  combinedOperationalRisk: number
  activeEventCount: number
  topEvent: { title: string; severity: number } | null
}

export interface NodeImpact {
  eventId: string
  eventTitle: string
  severity: number
  impactType: 'direct' | 'downstream'
  status: 'active' | 'recovering' | 'resolved'
  estimatedRecoveryDays: number | null
  costImpactPct: number | null
  cachedImpactAmount: number
  impactConfidence: number
  assessmentMethod: 'automated' | 'manual_override' | 'ai_assisted'
  firstDetectedAt: string | null
  lastUpdatedAt: string | null
  resolvedAt: string | null
  propagationRunId: string | null
  overrideReviewStatus: 'active' | 'stale' | 'dismissed' | null
}

export interface EventImpact {
  nodeId: string
  nodeType: string
  nodeName: string
  severity: number
  impactType: 'direct' | 'downstream'
  status: 'active' | 'recovering' | 'resolved'
  cachedImpactAmount: number
  impactConfidence: number
  costImpactPct: number | null
  assessmentMethod: string
}

export interface DisruptsEdge {
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

export interface RiskEventFilterState {
  eventTypes: string[]
  minSeverity: number
  maxSeverity: number
  lifecycleStatuses: string[]
  reviewStatuses: string[]
  dateRange: { start: string | null; end: string | null }
}

export interface CorridorRisk {
  origin: { id: string; name: string; type: string }
  destination: { id: string; name: string; type: string }
  chokePointScore: number
  avgRouteRisk: number
  hops: number
  riskyNodes: { name: string; risk: number; exposure: number }[]
}

export interface RiskScenarioSnapshot {
  disabledSuppliers: Set<string>
  tariffOverrides: Map<string, number>
  fxOverrides: Map<string, number>
  volumeMultipliers: Map<string, number>
  metadata: {
    sourceEventIds: string[]
    snapshotDate: string
    description: string
  }
}
```

- [ ] **Step 2: Update MapMarker type (line ~238)**

Replace the existing `MapMarker` interface:

```typescript
export interface MapMarker {
  id: string
  type: 'plant' | 'supplier' | 'customer' | 'warehouse' | 'logisticsHub' | 'location'
  name: string
  latitude: number
  longitude: number
  impactLevel?: 'none' | 'direct' | 'downstream'
  details?: Record<string, unknown>
  riskScore?: NodeRiskScore | null
}
```

- [ ] **Step 3: Run type check**

Run: `cd frontend && npx vue-tsc --noEmit`
Expected: No new errors (existing code doesn't reference new types yet)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat: add risk event, logistics hub, and risk scoring type definitions"
```

---

### Task 3: Shared Neptune Client Module

**Files:**
- Create: `frontend/amplify/functions/shared/neptune-client.ts`
- Modify: `frontend/amplify/functions/neptune-query/handler.ts`

Extract Neptune connection logic into a shared module that both `neptune-query` and the new `neptune-risk-query` handler can import.

- [ ] **Step 1: Create shared Neptune client**

Create `frontend/amplify/functions/shared/neptune-client.ts`:

```typescript
import { NeptuneGraphClient, ExecuteQueryCommand } from '@aws-sdk/client-neptune-graph';

const GRAPH_ID = process.env.NEPTUNE_GRAPH_ID || 'g-844qqbri1a';
const REGION = process.env.NEPTUNE_REGION || 'us-west-2';

let client: NeptuneGraphClient | null = null;

export function getNeptuneClient(): NeptuneGraphClient {
  if (!client) {
    client = new NeptuneGraphClient({ region: REGION });
  }
  return client;
}

export async function executeQuery(query: string): Promise<Record<string, unknown>[]> {
  const neptuneClient = getNeptuneClient();
  const command = new ExecuteQueryCommand({
    graphIdentifier: GRAPH_ID,
    queryString: query,
    language: 'OPEN_CYPHER',
  });
  const response = await neptuneClient.send(command);
  const payload = JSON.parse(new TextDecoder().decode(response.payload));
  return payload.results || [];
}

export async function executeQuerySafe(query: string): Promise<Record<string, unknown>[]> {
  try {
    return await executeQuery(query);
  } catch (error) {
    console.error('Neptune クエリエラー:', error);
    console.error('クエリ:', query);
    return [];
  }
}
```

- [ ] **Step 2: Refactor neptune-query/handler.ts to import from shared module**

At the top of `frontend/amplify/functions/neptune-query/handler.ts`, replace the inline Neptune client initialization (lines 1-42) with:

```typescript
import { executeQuery, executeQuerySafe } from '../shared/neptune-client';
```

Remove the duplicated `NeptuneGraphClient` import, `GRAPH_ID`, `REGION`, `client` variable, and the local `executeQuery`/`executeQuerySafe` functions. All query functions (`getPlants`, `getSuppliers`, etc.) remain unchanged — they already call `executeQuery()` / `executeQuerySafe()`.

- [ ] **Step 3: Verify neptune-query still compiles**

Run: `cd frontend && npx tsc --noEmit -p amplify/tsconfig.json 2>&1 | head -20`

If there's no amplify tsconfig, run: `cd frontend && npx vue-tsc --noEmit`

Expected: No new errors from neptune-query handler.

- [ ] **Step 4: Commit**

```bash
git add frontend/amplify/functions/shared/neptune-client.ts frontend/amplify/functions/neptune-query/handler.ts
git commit -m "refactor: extract shared Neptune client module from neptune-query handler"
```

---

### Task 4: Neptune Risk Query Handler

**Files:**
- Create: `frontend/amplify/functions/neptune-risk-query/handler.ts`
- Create: `frontend/amplify/functions/neptune-risk-query/resource.ts`

New Amplify Lambda function for all risk analysis queries (Section 2 of spec).

- [ ] **Step 1: Create resource definition**

Create `frontend/amplify/functions/neptune-risk-query/resource.ts`:

```typescript
import { defineFunction } from '@aws-amplify/backend';

export const neptuneRiskQueryFunction = defineFunction({
  name: 'neptune-risk-query',
  entry: './handler.ts',
  timeoutSeconds: 30,
  environment: {
    NEPTUNE_GRAPH_ID: 'g-844qqbri1a',
    NEPTUNE_REGION: 'us-west-2',
  },
});
```

- [ ] **Step 2: Create handler with risk event queries**

Create `frontend/amplify/functions/neptune-risk-query/handler.ts`:

```typescript
import { executeQuery, executeQuerySafe } from '../shared/neptune-client';

// --- リスクイベント基本クエリ ---

async function getRiskEvents(filter?: {
  lifecycleStatuses?: string[];
  reviewStatuses?: string[];
  eventTypes?: string[];
  minSeverity?: number;
}) {
  let where = 'WHERE 1=1';
  if (filter?.lifecycleStatuses?.length) {
    const statuses = filter.lifecycleStatuses.map(s => `'${s}'`).join(', ');
    where += ` AND re.lifecycleStatus IN [${statuses}]`;
  }
  if (filter?.reviewStatuses?.length) {
    const statuses = filter.reviewStatuses.map(s => `'${s}'`).join(', ');
    where += ` AND re.reviewStatus IN [${statuses}]`;
  }
  if (filter?.eventTypes?.length) {
    const types = filter.eventTypes.map(t => `'${t}'`).join(', ');
    where += ` AND re.eventType IN [${types}]`;
  }
  if (filter?.minSeverity) {
    where += ` AND re.severity >= ${filter.minSeverity}`;
  }

  const query = `
    MATCH (re:RiskEvent)
    ${where}
    OPTIONAL MATCH (re)-[:CATEGORIZED_AS]->(rc:RiskCategory)
    RETURN re.id AS id, re.sourceEventId AS sourceEventId,
           re.dedupeKey AS dedupeKey, re.title AS title,
           re.description AS description, re.eventType AS eventType,
           re.source AS source, re.severity AS severity,
           re.lifecycleStatus AS lifecycleStatus,
           re.reviewStatus AS reviewStatus,
           re.reviewedBy AS reviewedBy, re.reviewedAt AS reviewedAt,
           re.trustLevel AS trustLevel,
           re.lat AS latitude, re.lon AS longitude,
           re.radiusKm AS radiusKm, re.geoScopeType AS geoScopeType,
           re.admin1 AS admin1, re.admin2 AS admin2,
           re.locationName AS locationName,
           re.startDate AS startDate, re.endDate AS endDate,
           re.updatedAt AS updatedAt, re.sourceUrl AS sourceUrl,
           re.confidence AS confidence,
           rc.name AS categoryName, rc.parentCategory AS parentCategory
    ORDER BY re.startDate DESC
  `;
  return executeQuerySafe(query);
}

async function getActiveImpacts(nodeId?: string, eventId?: string) {
  let matchClause = 'MATCH (re:RiskEvent)-[i:IMPACTS]->(target)';
  let whereClause = "WHERE i.status IN ['active', 'recovering'] AND re.reviewStatus = 'confirmed'";

  if (nodeId) {
    whereClause += ` AND target.id = '${nodeId}'`;
  }
  if (eventId) {
    whereClause += ` AND re.id = '${eventId}'`;
  }

  const query = `
    ${matchClause}
    ${whereClause}
    RETURN re.id AS eventId, re.title AS eventTitle,
           target.id AS nodeId, labels(target)[0] AS nodeType,
           target.name AS nodeName,
           i.severity AS severity, i.impactType AS impactType,
           i.status AS status, i.estimatedRecoveryDays AS estimatedRecoveryDays,
           i.cachedImpactAmount AS cachedImpactAmount,
           i.assessmentMethod AS assessmentMethod,
           i.impactConfidence AS impactConfidence
    ORDER BY i.severity DESC
  `;
  return executeQuerySafe(query);
}

async function getImpactsByEvent(eventId: string) {
  const query = `
    MATCH (re:RiskEvent {id: '${eventId}'})-[i:IMPACTS]->(target)
    RETURN re.id AS eventId, re.title AS eventTitle,
           target.id AS nodeId, labels(target)[0] AS nodeType,
           target.name AS nodeName,
           i.severity AS severity, i.impactType AS impactType,
           i.status AS status, i.estimatedRecoveryDays AS estimatedRecoveryDays,
           i.cachedImpactAmount AS cachedImpactAmount,
           i.assessmentMethod AS assessmentMethod
    ORDER BY i.severity DESC
  `;
  return executeQuerySafe(query);
}

async function getActiveDisrupts() {
  const query = `
    MATCH (re:RiskEvent)-[d:DISRUPTS]->(hs:HSCode)
    WHERE re.lifecycleStatus IN ['active', 'recovering']
      AND re.reviewStatus = 'confirmed'
    RETURN re.id AS eventId, re.title AS eventTitle,
           hs.code AS hsCode,
           d.originCountry AS originCountry,
           d.destinationCountry AS destinationCountry,
           d.regulatorBody AS regulatorBody,
           d.effectiveDate AS effectiveDate,
           d.expiryDate AS expiryDate,
           d.tariffIncreasePct AS tariffIncreasePct,
           d.exportRestricted AS exportRestricted
    ORDER BY re.severity DESC
  `;
  return executeQuerySafe(query);
}

async function getDisruptsByEvent(eventId: string) {
  const query = `
    MATCH (re:RiskEvent {id: '${eventId}'})-[d:DISRUPTS]->(hs:HSCode)
    RETURN re.id AS eventId, re.title AS eventTitle,
           hs.code AS hsCode,
           d.originCountry AS originCountry,
           d.destinationCountry AS destinationCountry,
           d.regulatorBody AS regulatorBody,
           d.effectiveDate AS effectiveDate,
           d.expiryDate AS expiryDate,
           d.tariffIncreasePct AS tariffIncreasePct,
           d.exportRestricted AS exportRestricted
  `;
  return executeQuerySafe(query);
}

// --- リスクスコアリング ---

async function getNodeRiskScores() {
  const query = `
    MATCH (p:Plant)
    OPTIONAL MATCH (p)<-[i:IMPACTS]-(re:RiskEvent)
      WHERE i.status IN ['active', 'recovering']
        AND re.reviewStatus = 'confirmed'
    WITH p,
         coalesce(sum(
           i.severity * i.impactConfidence
           * (1.0 / (1 + (epochMillis(datetime()) - epochMillis(re.startDate)) / 2592000000.0))
           * CASE i.impactType WHEN 'direct' THEN 1.0 ELSE 0.5 END
         ), 0) AS liveEventRisk,
         count(re) AS activeEventCount,
         head(collect(CASE WHEN re IS NOT NULL THEN {title: re.title, severity: i.severity} END)) AS topEvent
    OPTIONAL MATCH (p)-[:SUPPLIES_TO*1..3]->(c:Customer)<-[o:ORDERED_BY]-(prod:Product)
    WITH p, liveEventRisk, activeEventCount, topEvent,
         coalesce(sum(o.annual_order_qty * o.unit_price_jpy), 0) AS revenueExposure
    OPTIONAL MATCH (p)-[:LOCATED_IN]->(country:Country)
    RETURN p.id AS nodeId, 'Plant' AS nodeType,
           coalesce(country.geopolitical_risk, 0) AS baselineRisk,
           liveEventRisk,
           revenueExposure,
           liveEventRisk * (1 + log(1 + revenueExposure / 100000000.0)) AS combinedOperationalRisk,
           activeEventCount,
           topEvent
    ORDER BY combinedOperationalRisk DESC
  `;
  return executeQuerySafe(query);
}

// --- ルート分析 ---

async function getCorridorRisks() {
  const query = `
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
         [n IN collect({name: node.name, risk: nodeRisk, exposure: nodeExposure})
           WHERE n.risk > 0] AS riskyNodes,
         length(path) AS hops
    RETURN s.id AS originId, s.name AS originName, 'Supplier' AS originType,
           c.id AS destId, c.name AS destName, 'Customer' AS destType,
           chokePointScore, avgRouteRisk, hops, riskyNodes
    ORDER BY chokePointScore DESC, avgRouteRisk DESC
    LIMIT 50
  `;
  return executeQuerySafe(query);
}

// --- 復旧ダッシュボード ---

async function getRecoveryDashboard() {
  const query = `
    MATCH (re:RiskEvent)-[i:IMPACTS]->(target)
    WHERE re.lifecycleStatus <> 'resolved'
      AND re.reviewStatus = 'confirmed'
    WITH re,
         count(CASE WHEN i.status = 'active' THEN 1 END) AS activeImpacts,
         count(CASE WHEN i.status = 'recovering' THEN 1 END) AS recoveringImpacts,
         count(CASE WHEN i.status = 'resolved' THEN 1 END) AS resolvedImpacts,
         sum(CASE WHEN i.status <> 'resolved' THEN i.cachedImpactAmount ELSE 0 END) AS outstandingExposureJpy,
         avg(CASE WHEN i.status <> 'resolved' THEN i.estimatedRecoveryDays END) AS avgRemainingRecoveryDays
    RETURN re.id AS id, re.title AS title, re.severity AS severity,
           re.lifecycleStatus AS lifecycleStatus,
           activeImpacts, recoveringImpacts, resolvedImpacts,
           outstandingExposureJpy, avgRemainingRecoveryDays
    ORDER BY outstandingExposureJpy DESC
  `;
  return executeQuerySafe(query);
}

// --- リスク履歴 ---

async function getRiskEventHistory(nodeId: string) {
  const query = `
    MATCH (re:RiskEvent)-[i:IMPACTS]->(target {id: '${nodeId}'})
    WHERE re.reviewStatus = 'confirmed'
    RETURN re.id AS id, re.title AS title, re.eventType AS eventType,
           re.severity AS severity,
           re.startDate AS startDate, re.endDate AS endDate,
           re.lifecycleStatus AS lifecycleStatus,
           i.estimatedRecoveryDays AS estimatedRecoveryDays,
           i.costImpactPct AS costImpactPct,
           i.assessmentMethod AS assessmentMethod
    ORDER BY re.startDate DESC
  `;
  return executeQuerySafe(query);
}

// --- 因果チェーン ---

async function getRiskEventChain(eventId: string) {
  const query = `
    MATCH chain = (origin:RiskEvent {id: '${eventId}'})-[:RELATED_EVENT*1..3]->(downstream:RiskEvent)
    WITH origin, downstream, chain,
         [r IN relationships(chain) | {type: r.relationshipType, confidence: r.confidence}] AS links
    RETURN origin.title AS triggerEvent,
           downstream.id AS downstreamId,
           downstream.title AS resultingEvent,
           downstream.severity AS downstreamSeverity,
           links, length(chain) AS depth
    ORDER BY depth DESC, downstream.severity DESC
  `;
  return executeQuerySafe(query);
}

// --- 物流拠点クエリ ---

async function getWarehouses() {
  const query = `
    MATCH (w:Warehouse)
    OPTIONAL MATCH (w)-[:LOCATED_IN]->(c:Country)
    RETURN w.id AS id, w.name AS name,
           w.country_code AS countryCode,
           w.lat AS latitude, w.lon AS longitude,
           w.capacity AS capacity, w.status AS status,
           c.name AS countryName
  `;
  return executeQuerySafe(query);
}

async function getLogisticsHubs() {
  const query = `
    MATCH (lh:LogisticsHub)
    OPTIONAL MATCH (lh)-[:LOCATED_IN]->(c:Country)
    RETURN lh.id AS id, lh.name AS name,
           lh.type AS type, lh.country_code AS countryCode,
           lh.lat AS latitude, lh.lon AS longitude,
           lh.capacity AS capacity, lh.status AS status,
           c.name AS countryName
  `;
  return executeQuerySafe(query);
}

async function getRoutesThrough() {
  const query = `
    MATCH (from)-[r:ROUTES_THROUGH]->(lh:LogisticsHub)
    RETURN from.id AS fromId, labels(from)[0] AS fromType,
           from.name AS fromName,
           lh.id AS toId, lh.name AS toName,
           r.transitDays AS transitDays, r.isPrimary AS isPrimary
  `;
  return executeQuerySafe(query);
}

// --- ハンドラー ---

export const handler = async (event: { fieldName: string; arguments?: Record<string, unknown> }) => {
  const { fieldName, arguments: args } = event;

  switch (fieldName) {
    case 'getRiskEvents':
      return getRiskEvents(args?.filter as Parameters<typeof getRiskEvents>[0]);
    case 'getActiveImpacts':
      return getActiveImpacts(args?.nodeId as string, args?.eventId as string);
    case 'getImpactsByEvent':
      return getImpactsByEvent(args?.eventId as string);
    case 'getActiveDisrupts':
      return getActiveDisrupts();
    case 'getDisruptsByEvent':
      return getDisruptsByEvent(args?.eventId as string);
    case 'getNodeRiskScores':
      return getNodeRiskScores();
    case 'getCorridorRisks':
      return getCorridorRisks();
    case 'getRecoveryDashboard':
      return getRecoveryDashboard();
    case 'getRiskEventHistory':
      return getRiskEventHistory(args?.nodeId as string);
    case 'getRiskEventChain':
      return getRiskEventChain(args?.eventId as string);
    case 'getWarehouses':
      return getWarehouses();
    case 'getLogisticsHubs':
      return getLogisticsHubs();
    case 'getRoutesThrough':
      return getRoutesThrough();
    default:
      throw new Error(`不明なフィールド名: ${fieldName}`);
  }
};
```

- [ ] **Step 3: Commit**

```bash
git add frontend/amplify/functions/neptune-risk-query/
git commit -m "feat: add neptune-risk-query handler with risk scoring, corridor, and recovery queries"
```

---

### Task 5: AppSync Schema Extension

**Files:**
- Modify: `frontend/amplify/data/resource.ts`

Add risk query and mutation definitions to the Amplify schema. This wires the new neptune-risk-query handler into AppSync.

- [ ] **Step 1: Import the new function**

At the top of `frontend/amplify/data/resource.ts`, add the import:

```typescript
import { neptuneRiskQueryFunction } from '../functions/neptune-risk-query/resource';
```

- [ ] **Step 2: Add custom types for risk entities**

Add after the existing custom type definitions (around line 442):

```typescript
  // --- リスクイベント関連の型 ---
  GraphRiskEvent: a.customType({
    id: a.string().required(),
    sourceEventId: a.string(),
    dedupeKey: a.string(),
    title: a.string().required(),
    description: a.string(),
    eventType: a.string().required(),
    source: a.string(),
    severity: a.integer().required(),
    lifecycleStatus: a.string().required(),
    reviewStatus: a.string().required(),
    reviewedBy: a.string(),
    reviewedAt: a.string(),
    trustLevel: a.string(),
    latitude: a.float(),
    longitude: a.float(),
    radiusKm: a.float(),
    geoScopeType: a.string(),
    admin1: a.string(),
    admin2: a.string(),
    locationName: a.string(),
    startDate: a.string(),
    endDate: a.string(),
    updatedAt: a.string(),
    sourceUrl: a.string(),
    confidence: a.float(),
    categoryName: a.string(),
    parentCategory: a.string(),
  }),

  NodeRiskScoreResult: a.customType({
    nodeId: a.string().required(),
    nodeType: a.string().required(),
    baselineRisk: a.float(),
    liveEventRisk: a.float(),
    revenueExposure: a.float(),
    combinedOperationalRisk: a.float(),
    activeEventCount: a.integer(),
  }),

  ImpactResult: a.customType({
    eventId: a.string().required(),
    eventTitle: a.string(),
    nodeId: a.string().required(),
    nodeType: a.string(),
    nodeName: a.string(),
    severity: a.integer(),
    impactType: a.string(),
    status: a.string(),
    estimatedRecoveryDays: a.integer(),
    cachedImpactAmount: a.float(),
    assessmentMethod: a.string(),
    impactConfidence: a.float(),
  }),

  DisruptsResult: a.customType({
    eventId: a.string().required(),
    eventTitle: a.string(),
    hsCode: a.string().required(),
    originCountry: a.string(),
    destinationCountry: a.string(),
    regulatorBody: a.string(),
    effectiveDate: a.string(),
    expiryDate: a.string(),
    tariffIncreasePct: a.float(),
    exportRestricted: a.boolean(),
  }),

  WarehouseResult: a.customType({
    id: a.string().required(),
    name: a.string(),
    countryCode: a.string(),
    latitude: a.float(),
    longitude: a.float(),
    capacity: a.float(),
    status: a.string(),
  }),

  LogisticsHubResult: a.customType({
    id: a.string().required(),
    name: a.string(),
    type: a.string(),
    countryCode: a.string(),
    latitude: a.float(),
    longitude: a.float(),
    capacity: a.string(),
    status: a.string(),
  }),

  RouteThroughResult: a.customType({
    fromId: a.string().required(),
    fromType: a.string(),
    fromName: a.string(),
    toId: a.string().required(),
    toName: a.string(),
    transitDays: a.integer(),
    isPrimary: a.boolean(),
  }),
```

- [ ] **Step 3: Add query definitions**

Add in the queries section (after existing query definitions):

```typescript
  // --- リスク分析クエリ ---
  getRiskEvents: a.query()
    .arguments({
      lifecycleStatuses: a.string().array(),
      reviewStatuses: a.string().array(),
      eventTypes: a.string().array(),
      minSeverity: a.integer(),
    })
    .returns(a.ref('GraphRiskEvent').array())
    .authorization(allow => [allow.publicApiKey()])
    .handler(a.handler.function(neptuneRiskQueryFunction)),

  getActiveImpacts: a.query()
    .arguments({ nodeId: a.string(), eventId: a.string() })
    .returns(a.ref('ImpactResult').array())
    .authorization(allow => [allow.publicApiKey()])
    .handler(a.handler.function(neptuneRiskQueryFunction)),

  getImpactsByEvent: a.query()
    .arguments({ eventId: a.string().required() })
    .returns(a.ref('ImpactResult').array())
    .authorization(allow => [allow.publicApiKey()])
    .handler(a.handler.function(neptuneRiskQueryFunction)),

  getActiveDisrupts: a.query()
    .returns(a.ref('DisruptsResult').array())
    .authorization(allow => [allow.publicApiKey()])
    .handler(a.handler.function(neptuneRiskQueryFunction)),

  getDisruptsByEvent: a.query()
    .arguments({ eventId: a.string().required() })
    .returns(a.ref('DisruptsResult').array())
    .authorization(allow => [allow.publicApiKey()])
    .handler(a.handler.function(neptuneRiskQueryFunction)),

  getNodeRiskScores: a.query()
    .returns(a.ref('NodeRiskScoreResult').array())
    .authorization(allow => [allow.publicApiKey()])
    .handler(a.handler.function(neptuneRiskQueryFunction)),

  getCorridorRisks: a.query()
    .returns(a.json().array())
    .authorization(allow => [allow.publicApiKey()])
    .handler(a.handler.function(neptuneRiskQueryFunction)),

  getRecoveryDashboard: a.query()
    .returns(a.json().array())
    .authorization(allow => [allow.publicApiKey()])
    .handler(a.handler.function(neptuneRiskQueryFunction)),

  getRiskEventHistory: a.query()
    .arguments({ nodeId: a.string().required() })
    .returns(a.json().array())
    .authorization(allow => [allow.publicApiKey()])
    .handler(a.handler.function(neptuneRiskQueryFunction)),

  getRiskEventChain: a.query()
    .arguments({ eventId: a.string().required() })
    .returns(a.json().array())
    .authorization(allow => [allow.publicApiKey()])
    .handler(a.handler.function(neptuneRiskQueryFunction)),

  getWarehouses: a.query()
    .returns(a.ref('WarehouseResult').array())
    .authorization(allow => [allow.publicApiKey()])
    .handler(a.handler.function(neptuneRiskQueryFunction)),

  getLogisticsHubs: a.query()
    .returns(a.ref('LogisticsHubResult').array())
    .authorization(allow => [allow.publicApiKey()])
    .handler(a.handler.function(neptuneRiskQueryFunction)),

  getRoutesThrough: a.query()
    .returns(a.ref('RouteThroughResult').array())
    .authorization(allow => [allow.publicApiKey()])
    .handler(a.handler.function(neptuneRiskQueryFunction)),
```

- [ ] **Step 4: Commit**

```bash
git add frontend/amplify/data/resource.ts
git commit -m "feat: add risk event AppSync schema types and query definitions"
```

---

### Task 6: API Service Layer — Risk Event Functions

**Files:**
- Modify: `frontend/src/services/api.ts`

Add all new fetch functions for risk events, impacts, disrupts, risk scores, and supporting entities.

- [ ] **Step 1: Add risk event fetch functions**

Add at the end of `frontend/src/services/api.ts`:

```typescript
import type {
  GraphRiskEvent, NodeRiskScore, NodeImpact, EventImpact,
  DisruptsEdge, Warehouse, LogisticsHub, RouteThrough,
  CorridorRisk,
} from '@/types';

export async function fetchRiskEvents(filter?: {
  lifecycleStatus?: string[];
  eventType?: string;
}): Promise<GraphRiskEvent[]> {
  const client = await getClient();
  const args: Record<string, unknown> = {};
  if (filter?.lifecycleStatus) args.lifecycleStatuses = filter.lifecycleStatus;
  if (filter?.eventType) args.eventTypes = [filter.eventType];

  const { data, errors } = await client.queries.getRiskEvents(args);
  if (errors) console.error('fetchRiskEvents エラー:', errors);
  return (data ?? []) as GraphRiskEvent[];
}

export async function fetchActiveImpacts(
  nodeId?: string, eventId?: string
): Promise<EventImpact[]> {
  const client = await getClient();
  const { data, errors } = await client.queries.getActiveImpacts({ nodeId, eventId });
  if (errors) console.error('fetchActiveImpacts エラー:', errors);
  return (data ?? []) as EventImpact[];
}

export async function fetchImpactsByEvent(eventId: string): Promise<EventImpact[]> {
  const client = await getClient();
  const { data, errors } = await client.queries.getImpactsByEvent({ eventId });
  if (errors) console.error('fetchImpactsByEvent エラー:', errors);
  return (data ?? []) as EventImpact[];
}

export async function fetchActiveDisrupts(): Promise<DisruptsEdge[]> {
  const client = await getClient();
  const { data, errors } = await client.queries.getActiveDisrupts();
  if (errors) console.error('fetchActiveDisrupts エラー:', errors);
  return (data ?? []) as DisruptsEdge[];
}

export async function fetchDisruptsByEvent(eventId: string): Promise<DisruptsEdge[]> {
  const client = await getClient();
  const { data, errors } = await client.queries.getDisruptsByEvent({ eventId });
  if (errors) console.error('fetchDisruptsByEvent エラー:', errors);
  return (data ?? []) as DisruptsEdge[];
}

export async function fetchNodeRiskScores(): Promise<NodeRiskScore[]> {
  const client = await getClient();
  const { data, errors } = await client.queries.getNodeRiskScores();
  if (errors) console.error('fetchNodeRiskScores エラー:', errors);
  return (data ?? []) as NodeRiskScore[];
}

export async function fetchCorridorRisks(): Promise<CorridorRisk[]> {
  const client = await getClient();
  const { data, errors } = await client.queries.getCorridorRisks();
  if (errors) console.error('fetchCorridorRisks エラー:', errors);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    origin: { id: r.originId as string, name: r.originName as string, type: r.originType as string },
    destination: { id: r.destId as string, name: r.destName as string, type: r.destType as string },
    chokePointScore: r.chokePointScore as number,
    avgRouteRisk: r.avgRouteRisk as number,
    hops: r.hops as number,
    riskyNodes: r.riskyNodes as CorridorRisk['riskyNodes'],
  }));
}

export async function fetchWarehouses(): Promise<Warehouse[]> {
  const client = await getClient();
  const { data, errors } = await client.queries.getWarehouses();
  if (errors) console.error('fetchWarehouses エラー:', errors);
  return (data ?? []) as Warehouse[];
}

export async function fetchLogisticsHubs(): Promise<LogisticsHub[]> {
  const client = await getClient();
  const { data, errors } = await client.queries.getLogisticsHubs();
  if (errors) console.error('fetchLogisticsHubs エラー:', errors);
  return (data ?? []) as LogisticsHub[];
}

export async function fetchRoutesThrough(): Promise<RouteThrough[]> {
  const client = await getClient();
  const { data, errors } = await client.queries.getRoutesThrough();
  if (errors) console.error('fetchRoutesThrough エラー:', errors);
  return (data ?? []) as RouteThrough[];
}

export async function fetchRiskEventHistory(nodeId: string): Promise<unknown[]> {
  const client = await getClient();
  const { data, errors } = await client.queries.getRiskEventHistory({ nodeId });
  if (errors) console.error('fetchRiskEventHistory エラー:', errors);
  return data ?? [];
}

export async function fetchRiskEventChain(eventId: string): Promise<unknown[]> {
  const client = await getClient();
  const { data, errors } = await client.queries.getRiskEventChain({ eventId });
  if (errors) console.error('fetchRiskEventChain エラー:', errors);
  return data ?? [];
}

// --- 互換性アダプター（Phase 1のみ、Phase 3で削除） ---

export async function fetchEarthquakesCompat(): Promise<EarthquakeEvent[]> {
  const events = await fetchRiskEvents({ eventType: 'earthquake' });
  return events.map(ev => ({
    earthquakeId: ev.id,
    timestamp: ev.startDate,
    magnitude: ev.severity,
    location: ev.locationName,
    depth: 0,
    latitude: ev.latitude,
    longitude: ev.longitude,
    maxScale: ev.severity * 10,
  }));
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "feat: add risk event, impact, disrupts, and risk score API functions"
```

---

### Task 7: Risk-to-Simulation Adapter

**Files:**
- Create: `frontend/src/services/riskSimulationAdapter.ts`
- Create: `tests/frontend/services/riskSimulationAdapter.test.ts`

- [ ] **Step 1: Write test**

Create `tests/frontend/services/riskSimulationAdapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildScenarioFromActiveRisks } from '../../../frontend/src/services/riskSimulationAdapter';
import type { NodeImpact, DisruptsEdge, SimTariff } from '../../../frontend/src/types';

describe('buildScenarioFromActiveRisks', () => {
  it('severity 4以上の直接影響サプライヤーをdisabledSuppliersに追加', () => {
    const impactsByNode = new Map<string, NodeImpact[]>([
      ['SUP001', [{ eventId: 'e1', eventTitle: 'テスト', severity: 4,
        impactType: 'direct', status: 'active', estimatedRecoveryDays: 30,
        cachedImpactAmount: 100000, assessmentMethod: 'automated' }]],
      ['SUP002', [{ eventId: 'e2', eventTitle: 'テスト2', severity: 2,
        impactType: 'direct', status: 'active', estimatedRecoveryDays: 7,
        cachedImpactAmount: 50000, assessmentMethod: 'automated' }]],
    ]);
    const nodeTypes = new Map<string, string>([['SUP001', 'Supplier'], ['SUP002', 'Supplier']]);
    const disrupts: DisruptsEdge[] = [];
    const currentTariffs: SimTariff[] = [];

    const result = buildScenarioFromActiveRisks(impactsByNode, nodeTypes, disrupts, currentTariffs);
    expect(result.disabledSuppliers.has('SUP001')).toBe(true);
    expect(result.disabledSuppliers.has('SUP002')).toBe(false);
  });

  it('DISRUPTSエッジをtariffOverridesに変換', () => {
    const impactsByNode = new Map<string, NodeImpact[]>();
    const nodeTypes = new Map<string, string>();
    const disrupts: DisruptsEdge[] = [{
      eventId: 'e1', eventTitle: 'CHIPS法', hsCode: '8542.31',
      originCountry: 'CN', destinationCountry: 'JP',
      regulatorBody: null, effectiveDate: '2022-10-07', expiryDate: null,
      tariffIncreasePct: 25.0, exportRestricted: false,
    }];
    const currentTariffs: SimTariff[] = [{
      hsCode: '8542.31', originCountry: 'CN', importingCountry: 'JP',
      tariffRatePct: 0, tariffType: 'MFN',
    }];

    const result = buildScenarioFromActiveRisks(impactsByNode, nodeTypes, disrupts, currentTariffs);
    expect(result.tariffOverrides.get('8542.31:CN:JP')).toBe(25.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/frontend/services/riskSimulationAdapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement adapter**

Create `frontend/src/services/riskSimulationAdapter.ts`:

```typescript
import type {
  NodeImpact, DisruptsEdge, SimTariff, RiskScenarioSnapshot,
} from '@/types';

/**
 * アクティブなリスクイベントからシミュレーション入力を生成
 * グラフのIMPACTS/DISRUPTSエッジを、simulation.tsが期待する
 * 具体的なオーバーライドキーに変換する
 */
export function buildScenarioFromActiveRisks(
  activeImpactsByNode: Map<string, NodeImpact[]>,
  nodeTypes: Map<string, string>,
  activeDisrupts: DisruptsEdge[],
  currentTariffs: SimTariff[],
): RiskScenarioSnapshot {
  const disabledSuppliers = new Set<string>();
  const tariffOverrides = new Map<string, number>();

  // IMPACTS → disabledSuppliers
  for (const [nodeId, impacts] of activeImpactsByNode) {
    if (nodeTypes.get(nodeId) !== 'Supplier') continue;
    const maxSeverity = Math.max(...impacts.map(i => i.severity));
    if (maxSeverity >= 4 && impacts.some(i => i.impactType === 'direct')) {
      disabledSuppliers.add(nodeId);
    }
  }

  // DISRUPTS → tariffOverrides
  for (const d of activeDisrupts) {
    const key = `${d.hsCode}:${d.originCountry}:${d.destinationCountry}`;
    const currentRate = currentTariffs.find(
      t => t.hsCode === d.hsCode
        && t.originCountry === d.originCountry
        && t.importingCountry === d.destinationCountry,
    )?.tariffRatePct ?? 0;
    tariffOverrides.set(key, currentRate + d.tariffIncreasePct);
  }

  return {
    disabledSuppliers,
    tariffOverrides,
    fxOverrides: new Map(),
    volumeMultipliers: new Map(),
    metadata: {
      sourceEventIds: [...new Set([
        ...activeDisrupts.map(d => d.eventId),
        ...[...activeImpactsByNode.values()].flat().map(i => i.eventId),
      ])],
      snapshotDate: new Date().toISOString(),
      description: '現在のリスク状況から自動生成',
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/frontend/services/riskSimulationAdapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/riskSimulationAdapter.ts tests/frontend/services/riskSimulationAdapter.test.ts
git commit -m "feat: add risk-to-simulation adapter with tests"
```

---

### Task 8: Supply Chain Store Migration

**Files:**
- Modify: `frontend/src/stores/supplyChain.ts`

Replace earthquake-specific state with generalized risk event state. This is the largest frontend change.

- [ ] **Step 1: Update imports and add new state fields**

At the top of `frontend/src/stores/supplyChain.ts`, add new imports:

```typescript
import type {
  GraphRiskEvent, NodeRiskScore, NodeImpact, EventImpact,
  DisruptsEdge, Warehouse, LogisticsHub, RouteThrough,
} from '@/types';
import {
  fetchRiskEvents, fetchActiveImpacts, fetchActiveDisrupts,
  fetchNodeRiskScores, fetchWarehouses, fetchLogisticsHubs,
  fetchRoutesThrough,
} from '@/services/api';
```

Replace the state section (lines 35-60) — keep existing fields for Plant, Supplier, Customer, SupplyRelation but replace earthquake-specific fields:

```typescript
  // 既存（維持）
  const plants = ref<Plant[]>([]);
  const suppliers = ref<Supplier[]>([]);
  const customers = ref<Customer[]>([]);
  const locations = ref<Location[]>([]);
  const supplyRelations = ref<SupplyRelation[]>([]);

  // 新規（riskEvent系で置換）
  const warehouses = ref<Warehouse[]>([]);
  const logisticsHubs = ref<LogisticsHub[]>([]);
  const routesThrough = ref<RouteThrough[]>([]);
  const riskEvents = ref<GraphRiskEvent[]>([]);
  const activeImpactsByNode = ref<Map<string, NodeImpact[]>>(new Map());
  const activeImpactsByEvent = ref<Map<string, EventImpact[]>>(new Map());
  const activeDisrupts = ref<DisruptsEdge[]>([]);
  const riskScores = ref<Map<string, NodeRiskScore>>(new Map());
  const selectedRiskEvent = ref<GraphRiskEvent | null>(null);

  // 既存（維持）
  const selectedPlant = ref<Plant | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const currentPage = ref(1);
  const itemsPerPage = ref(10);

  // フィルタ
  const filterTab = ref<'all' | 'affected' | 'byRisk'>('all');
  const showPlants = ref(true);
  const showSuppliers = ref(true);
  const showCustomers = ref(true);
  const showWarehouses = ref(true);
  const showLogisticsHubs = ref(true);

  // レガシー互換性（Phase 3で削除）
  const earthquakes = ref<EarthquakeEvent[]>([]);
  const plantImpacts = ref<PlantImpactStatus[]>([]);
  const selectedEarthquake = ref<EarthquakeEvent | null>(null);
```

- [ ] **Step 2: Update loadAllData()**

Replace the `loadAllData` function body:

```typescript
  async function loadAllData() {
    isLoading.value = true;
    error.value = null;
    try {
      const [
        plantsData, suppliersData, customersData,
        warehousesData, logisticsHubsData,
        relationsData, routesThroughData,
        riskEventsData, activeImpactsData, activeDisruptsData, riskScoresData,
        // レガシー互換性
        earthquakesData, plantImpactsData,
      ] = await Promise.all([
        fetchPlants(), fetchSuppliers(), fetchCustomers(),
        fetchWarehouses(), fetchLogisticsHubs(),
        fetchSupplyRelations(), fetchRoutesThrough(),
        fetchRiskEvents({ lifecycleStatus: ['detected', 'active', 'recovering'] }),
        fetchActiveImpacts(), fetchActiveDisrupts(), fetchNodeRiskScores(),
        // レガシー互換性（Phase 3で削除）
        fetchEarthquakes(), fetchPlantImpacts(),
      ]);

      // アトミックにパッチ適用（フリッカー防止）
      plants.value = plantsData;
      suppliers.value = suppliersData;
      customers.value = customersData;
      warehouses.value = warehousesData;
      logisticsHubs.value = logisticsHubsData;
      supplyRelations.value = relationsData;
      routesThrough.value = routesThroughData;
      riskEvents.value = riskEventsData;
      activeDisrupts.value = activeDisruptsData;

      // インパクトをノード別・イベント別にインデックス化
      const byNode = new Map<string, NodeImpact[]>();
      const byEvent = new Map<string, EventImpact[]>();
      for (const impact of activeImpactsData) {
        const nodeKey = impact.nodeId;
        if (!byNode.has(nodeKey)) byNode.set(nodeKey, []);
        byNode.get(nodeKey)!.push({
          eventId: impact.eventId,
          eventTitle: impact.eventTitle ?? '',
          severity: impact.severity,
          impactType: impact.impactType as 'direct' | 'downstream',
          status: impact.status as 'active' | 'recovering' | 'resolved',
          estimatedRecoveryDays: impact.estimatedRecoveryDays ?? null,
          cachedImpactAmount: impact.cachedImpactAmount ?? 0,
          assessmentMethod: impact.assessmentMethod as NodeImpact['assessmentMethod'],
        });

        const evKey = impact.eventId;
        if (!byEvent.has(evKey)) byEvent.set(evKey, []);
        byEvent.get(evKey)!.push(impact);
      }
      activeImpactsByNode.value = byNode;
      activeImpactsByEvent.value = byEvent;

      // リスクスコアをノードIDでインデックス化
      const scoresMap = new Map<string, NodeRiskScore>();
      for (const score of riskScoresData) {
        scoresMap.set(score.nodeId, score);
      }
      riskScores.value = scoresMap;

      // レガシー互換性: impactLevelをプラントに適用（Phase 3で削除）
      earthquakes.value = earthquakesData;
      plantImpacts.value = plantImpactsData;
      for (const impact of plantImpactsData) {
        const plant = plants.value.find(p => p.id === impact.plantId);
        if (plant) {
          plant.impactLevel = impact.impactLevel;
        }
      }

      // 新方式: riskScoresからimpactLevelも導出（Phase 1互換性用）
      for (const plant of plants.value) {
        const nodeImpacts = byNode.get(plant.id);
        if (nodeImpacts?.some(i => i.impactType === 'direct')) {
          plant.impactLevel = 'direct';
        } else if (nodeImpacts?.some(i => i.impactType === 'downstream')) {
          plant.impactLevel = 'downstream';
        }
      }

      locations.value = parseLocations(plantsData);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'データ読み込みに失敗しました';
      console.error('loadAllData エラー:', e);
    } finally {
      isLoading.value = false;
    }
  }
```

- [ ] **Step 3: Add risk-aware computed properties**

Add after the existing `dashboardStats` computed:

```typescript
  const riskDashboardStats = computed(() => {
    let directCount = 0;
    let downstreamCount = 0;
    let totalExposure = 0;

    for (const [, impacts] of activeImpactsByNode.value) {
      const hasDirect = impacts.some(i => i.impactType === 'direct');
      const hasDownstream = impacts.some(i => i.impactType === 'downstream');
      if (hasDirect) directCount++;
      else if (hasDownstream) downstreamCount++;
      totalExposure += impacts.reduce((sum, i) => sum + i.cachedImpactAmount, 0);
    }

    const activeEventCount = riskEvents.value.filter(
      e => e.lifecycleStatus !== 'resolved' && e.reviewStatus === 'confirmed'
    ).length;

    const pendingReviewCount = riskEvents.value.filter(
      e => e.reviewStatus === 'pending'
    ).length;

    let highestRisk: NodeRiskScore | null = null;
    for (const score of riskScores.value.values()) {
      if (!highestRisk || score.combinedOperationalRisk > highestRisk.combinedOperationalRisk) {
        highestRisk = score;
      }
    }

    return { directCount, downstreamCount, totalExposure, activeEventCount, pendingReviewCount, highestRisk };
  });
```

- [ ] **Step 4: Add new actions**

```typescript
  function selectRiskEvent(event: GraphRiskEvent | null) {
    selectedRiskEvent.value = event;
  }

  function toggleWarehouses() {
    showWarehouses.value = !showWarehouses.value;
  }

  function toggleLogisticsHubs() {
    showLogisticsHubs.value = !showLogisticsHubs.value;
  }
```

- [ ] **Step 5: Update return statement**

Add all new state, computed, and actions to the store's return:

```typescript
  return {
    // 既存 (全て維持)
    plants, suppliers, customers, locations, supplyRelations,
    earthquakes, plantImpacts, selectedPlant, selectedEarthquake,
    isLoading, error, filterTab, currentPage, itemsPerPage,
    showPlants, showSuppliers, showCustomers,
    dashboardStats, filteredPlants, paginatedPlants, totalPages,
    mapMarkers, mapLines,
    loadAllData, selectPlant, selectEarthquake,
    setFilterTab, setPage, nextPage, prevPage,
    toggleSuppliers, toggleCustomers, togglePlants,
    // レガシー互換性
    factories, filteredFactories, paginatedFactories,

    // 新規
    warehouses, logisticsHubs, routesThrough,
    riskEvents, activeImpactsByNode, activeImpactsByEvent,
    activeDisrupts, riskScores, selectedRiskEvent,
    showWarehouses, showLogisticsHubs,
    riskDashboardStats,
    selectRiskEvent, toggleWarehouses, toggleLogisticsHubs,
  };
```

- [ ] **Step 6: Verify type check passes**

Run: `cd frontend && npx vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add frontend/src/stores/supplyChain.ts
git commit -m "feat: migrate supply chain store to graph-backed risk event state"
```

---

### Task 9: NL Query Schema Expansion

**Files:**
- Modify: `frontend/amplify/functions/nl-query/handler.ts`

Expand the Bedrock schema prompt to include RiskEvent, RiskCategory, LogisticsHub, and all new edge types.

- [ ] **Step 1: Update the graph schema section**

In `frontend/amplify/functions/nl-query/handler.ts`, expand the `GRAPH_SCHEMA` constant (around line 27) to include:

```typescript
const GRAPH_SCHEMA = `
ノードラベル:
- Supplier (id, name, country_code, region, lat, lon, credit_score, quality_score, lead_time_days, tier, status)
- Plant (id, name, country_code, plant_type, lat, lon, capacity, status)
- Material (id, description, material_group, origin_country, hs_code, unit_price, currency)
- Product (id, description, product_group, cost_estimate_jpy, sales_price_jpy, margin_rate)
- Customer (id, name, industry, country_code, lat, lon)
- Country (code, name, region, geopolitical_risk, exchange_rate_jpy, lat, lon)
- HSCode (code, description, chapter, heading)
- Warehouse (id, name, country_code, lat, lon, capacity, status)
- Regulation (id, name, type, effective_date, issuing_country)
- RiskEvent (id, title, description, eventType, severity[1-5], lifecycleStatus[detected/active/recovering/resolved], reviewStatus[pending/confirmed/watching/dismissed], lat, lon, radiusKm, locationName, startDate, endDate, source, confidence)
- RiskCategory (id, name, parentCategory[natural_disaster/geopolitical/operational/financial], avgRecoveryDays)
- LogisticsHub (id, name, type[port/airport/border_crossing], country_code, lat, lon, capacity, status[operational/disrupted/closed])

エッジラベル:
- SUPPLIES (Supplier → Material, is_primary)
- SUPPLIES_TO (Supplier/Plant/Warehouse → Supplier/Plant/Warehouse/Customer)
- HAS_COMPONENT (Product → Material, quantity, bom_level)
- PRODUCED_AT (Product → Plant)
- ORDERED_BY (Product → Customer, annual_order_qty, unit_price_jpy)
- LOCATED_IN (Supplier/Plant/Warehouse/Customer/LogisticsHub → Country)
- CLASSIFIED_AS (Material → HSCode)
- TARIFF_APPLIES (HSCode → Country, tariff_rate_pct, tariff_type)
- ALTERNATIVE_TO (Supplier → Supplier, quality_score_diff, price_diff_pct, lead_time_diff_days)
- SUBJECT_TO (Material/HSCode → Regulation)
- IMPACTS (RiskEvent → Plant/Supplier/Warehouse/Material/LogisticsHub, severity, impactType[direct/downstream], status[active/recovering/resolved], estimatedRecoveryDays, cachedImpactAmount, impactConfidence)
- DISRUPTS (RiskEvent → HSCode, originCountry, destinationCountry, tariffIncreasePct, exportRestricted)
- RELATED_EVENT (RiskEvent → RiskEvent, relationshipType[triggers/contributes_to/coincident/supersedes/empirical], delayDays, confidence)
- CATEGORIZED_AS (RiskEvent → RiskCategory)
- OCCURRED_IN (RiskEvent → Country)
- ROUTES_THROUGH (Plant/Supplier/Warehouse → LogisticsHub, transitDays, isPrimary)

リスクスコアリングの注意:
- リスクスコアを聞かれた場合は、IMPACTS エッジの severity と impactConfidence から liveEventRisk を算出し、下流の売上エクスポージャーで重み付けした combinedOperationalRisk も返すこと
- リスクスコアリングクエリでは必ず re.reviewStatus = 'confirmed' でフィルタすること
- 未確認イベント（pending）はスコアに含めないこと
`;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/amplify/functions/nl-query/handler.ts
git commit -m "feat: expand NL query schema with risk event, logistics hub, and impact edge definitions"
```

---

### Task 10: Backend — RiskEventService

**Files:**
- Create: `src/lambda/risk_event_service/__init__.py`
- Create: `src/lambda/risk_event_service/providers.py`
- Create: `tests/lambda/test_risk_event_service.py`

The shared ingestion module that all channels call.

- [ ] **Step 1: Write failing test**

Create `tests/lambda/test_risk_event_service.py`:

```python
import pytest
from unittest.mock import MagicMock, patch
from src.lambda.risk_event_service import RiskEventService, RawRiskEvent


def test_determine_review_status_trusted_source():
    service = RiskEventService(neptune_client=MagicMock(), graph_id='test')
    assert service.determine_review_status('automated', 'p2pquake') == 'confirmed'
    assert service.determine_review_status('automated', 'usgs') == 'confirmed'
    assert service.determine_review_status('automated', 'gdacs') == 'confirmed'


def test_determine_review_status_ai_extracted():
    service = RiskEventService(neptune_client=MagicMock(), graph_id='test')
    assert service.determine_review_status('ai_extraction', 'ai_extracted') == 'pending'


def test_determine_review_status_manual():
    service = RiskEventService(neptune_client=MagicMock(), graph_id='test')
    assert service.determine_review_status('manual', 'manual') == 'confirmed'


def test_compute_dedupe_key():
    service = RiskEventService(neptune_client=MagicMock(), graph_id='test')
    raw = RawRiskEvent(
        source='p2pquake', source_event_id='eq123',
        title='テスト地震', event_type='earthquake',
        severity=3, lat=35.0, lon=135.0,
    )
    key = service.compute_dedupe_key(raw)
    assert key == 'p2pquake:eq123'

    # 同じ入力で同じキー
    assert service.compute_dedupe_key(raw) == key
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nileipan00128/Programs/sap-cloud-data-utilization && python -m pytest tests/lambda/test_risk_event_service.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement RiskEventService**

Create `src/lambda/risk_event_service/__init__.py`:

```python
"""全チャネル共通のリスクイベント書き込みパス"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class RawRiskEvent:
    """チャネルから受け取る生イベント"""
    source: str
    source_event_id: str
    title: str
    event_type: str
    severity: int
    lat: float
    lon: float
    description: str = ''
    radius_km: float = 50.0
    geo_scope_type: str = 'point'
    admin1: str | None = None
    admin2: str | None = None
    location_name: str = ''
    affected_country_codes: list[str] = field(default_factory=list)
    start_date: str | None = None
    end_date: str | None = None
    source_url: str | None = None
    source_snippet_hash: str | None = None
    confidence: float = 1.0
    category_id: str | None = None
    country_code: str | None = None
    channel: str = 'automated'
    updated_at: str | None = None


@dataclass
class IngestResult:
    action: str  # 'created', 'updated', 'skipped'
    event_id: str
    impacts_computed: int = 0


TRUSTED_SOURCES = {'p2pquake', 'usgs', 'gdacs'}


class RiskEventService:
    """全チャネル共通のリスクイベント取り込みサービス"""

    def __init__(self, neptune_client: Any, graph_id: str,
                 s3_client: Any = None, s3_bucket: str = '',
                 dedupe_table: Any = None, registry_table: Any = None):
        self.neptune_client = neptune_client
        self.graph_id = graph_id
        self.s3_client = s3_client
        self.s3_bucket = s3_bucket
        self.dedupe_table = dedupe_table
        self.registry_table = registry_table

    def determine_review_status(self, channel: str, source: str) -> str:
        """ソース信頼度に基づくレビューステータス決定"""
        if source in TRUSTED_SOURCES:
            return 'confirmed'
        if channel == 'manual':
            return 'confirmed'
        return 'pending'

    def determine_trust_level(self, channel: str, source: str) -> str:
        """ソース信頼度レベル決定"""
        if source in TRUSTED_SOURCES:
            return 'trusted_machine'
        if channel == 'manual':
            return 'analyst'
        return 'ai_unverified'

    def compute_dedupe_key(self, raw: RawRiskEvent) -> str:
        """重複排除キーの計算"""
        return f'{raw.source}:{raw.source_event_id}'

    def normalize(self, raw: RawRiskEvent) -> dict[str, Any]:
        """生イベントを正規化RiskEvent形式に変換"""
        now = datetime.now(timezone.utc).isoformat()
        review_status = self.determine_review_status(raw.channel, raw.source)
        trust_level = self.determine_trust_level(raw.channel, raw.source)

        return {
            'id': str(uuid.uuid4()),
            'sourceEventId': raw.source_event_id,
            'dedupeKey': self.compute_dedupe_key(raw),
            'title': raw.title,
            'description': raw.description,
            'eventType': raw.event_type,
            'source': raw.source,
            'severity': raw.severity,
            'lifecycleStatus': 'detected',
            'reviewStatus': review_status,
            'reviewedBy': 'system' if review_status == 'confirmed' else None,
            'reviewedAt': now if review_status == 'confirmed' else None,
            'trustLevel': trust_level,
            'lat': raw.lat,
            'lon': raw.lon,
            'radiusKm': raw.radius_km,
            'geoScopeType': raw.geo_scope_type,
            'admin1': raw.admin1,
            'admin2': raw.admin2,
            'locationName': raw.location_name,
            'startDate': raw.start_date or now,
            'endDate': raw.end_date,
            'updatedAt': raw.updated_at or now,
            'sourceUrl': raw.source_url,
            'sourceSnippetHash': raw.source_snippet_hash,
            'confidence': raw.confidence,
            'latestPropagationSequence': 0,
        }

    def execute_query(self, query: str) -> list[dict]:
        """Neptuneクエリ実行"""
        from botocore.exceptions import ClientError
        try:
            response = self.neptune_client.execute_query(
                graphIdentifier=self.graph_id,
                queryString=query,
                language='OPEN_CYPHER',
            )
            payload = json.loads(response['payload'].read())
            return payload.get('results', [])
        except ClientError as e:
            print(f'Neptune クエリエラー: {e}')
            return []

    def upsert_risk_event(self, event: dict[str, Any]) -> str:
        """RiskEventをNeptuneにupsert"""
        admin1_val = f"'{event['admin1']}'" if event['admin1'] else 'null'
        reviewed_by = f"'{event['reviewedBy']}'" if event['reviewedBy'] else 'null'
        reviewed_at = f"datetime('{event['reviewedAt']}')" if event['reviewedAt'] else 'null'
        end_date = f"datetime('{event['endDate']}')" if event['endDate'] else 'null'

        query = f"""
        MERGE (re:RiskEvent {{dedupeKey: '{event["dedupeKey"]}'}})
        SET re.id = '{event["id"]}',
            re.sourceEventId = '{event["sourceEventId"]}',
            re.title = '{event["title"]}',
            re.description = '{event["description"]}',
            re.eventType = '{event["eventType"]}',
            re.source = '{event["source"]}',
            re.severity = {event["severity"]},
            re.lifecycleStatus = '{event["lifecycleStatus"]}',
            re.reviewStatus = '{event["reviewStatus"]}',
            re.reviewedBy = {reviewed_by},
            re.reviewedAt = {reviewed_at},
            re.trustLevel = '{event["trustLevel"]}',
            re.lat = {event["lat"]},
            re.lon = {event["lon"]},
            re.radiusKm = {event["radiusKm"]},
            re.geoScopeType = '{event["geoScopeType"]}',
            re.admin1 = {admin1_val},
            re.locationName = '{event["locationName"]}',
            re.startDate = datetime('{event["startDate"]}'),
            re.endDate = {end_date},
            re.updatedAt = datetime('{event["updatedAt"]}'),
            re.confidence = {event["confidence"]},
            re.latestPropagationSequence = {event["latestPropagationSequence"]}
        RETURN re.id AS id
        """
        results = self.execute_query(query)
        return results[0]['id'] if results else event['id']

    def ingest(self, raw: RawRiskEvent) -> IngestResult:
        """正規化 → 重複排除 → upsert → アーカイブ → 影響伝播"""
        event = self.normalize(raw)
        dedupe_key = event['dedupeKey']

        # 重複排除チェック
        existing = self.execute_query(
            f"MATCH (re:RiskEvent {{dedupeKey: '{dedupe_key}'}}) RETURN re.id AS id, re.updatedAt AS updatedAt"
        )
        if existing:
            return IngestResult(action='skipped', event_id=existing[0]['id'])

        # Neptune upsert
        event_id = self.upsert_risk_event(event)

        # カテゴリエッジ
        if raw.category_id:
            self.execute_query(f"""
            MATCH (re:RiskEvent {{dedupeKey: '{dedupe_key}'}}),
                  (rc:RiskCategory {{id: '{raw.category_id}'}})
            MERGE (re)-[:CATEGORIZED_AS]->(rc)
            """)

        # 国エッジ
        if raw.country_code:
            self.execute_query(f"""
            MATCH (re:RiskEvent {{dedupeKey: '{dedupe_key}'}}),
                  (c:Country {{code: '{raw.country_code}'}})
            MERGE (re)-[:OCCURRED_IN]->(c)
            """)

        return IngestResult(action='created', event_id=event_id)
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/lambda/test_risk_event_service.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lambda/risk_event_service/ tests/lambda/test_risk_event_service.py
git commit -m "feat: add RiskEventService shared ingestion module with trust-based review"
```

---

### Task 11: Backend — Impact Propagator

**Files:**
- Create: `src/lambda/impact_propagator/__init__.py`
- Create: `tests/lambda/test_impact_propagator.py`

Event-scoped idempotent impact propagation with versioned swap.

- [ ] **Step 1: Write failing test**

Create `tests/lambda/test_impact_propagator.py`:

```python
import pytest
from unittest.mock import MagicMock, patch
import math


def test_find_nodes_in_radius():
    from src.lambda.impact_propagator import ImpactPropagator

    propagator = ImpactPropagator(neptune_client=MagicMock(), graph_id='test')

    # 東京 (35.68, 139.69) から100km以内のノード
    nodes = [
        {'id': 'PLT001', 'lat': 35.68, 'lon': 139.69},  # 東京（0km）
        {'id': 'PLT002', 'lat': 34.69, 'lon': 135.50},  # 大阪（約400km）
        {'id': 'PLT003', 'lat': 35.18, 'lon': 136.91},  # 名古屋（約260km）
    ]

    result = propagator._filter_by_radius(nodes, 35.68, 139.69, 100)
    assert len(result) == 1
    assert result[0]['id'] == 'PLT001'


def test_filter_by_radius_large_radius():
    from src.lambda.impact_propagator import ImpactPropagator

    propagator = ImpactPropagator(neptune_client=MagicMock(), graph_id='test')

    nodes = [
        {'id': 'PLT001', 'lat': 35.68, 'lon': 139.69},
        {'id': 'PLT002', 'lat': 34.69, 'lon': 135.50},
    ]

    result = propagator._filter_by_radius(nodes, 35.68, 139.69, 500)
    assert len(result) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/lambda/test_impact_propagator.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ImpactPropagator**

Create `src/lambda/impact_propagator/__init__.py`:

```python
"""イベント単位の冪等影響伝播（バージョンスワップ方式）"""
from __future__ import annotations

import json
import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass
class PropagationResult:
    edge_count: int
    run_id: str
    promoted: bool


class ImpactPropagator:
    """イベント単位で影響を再計算する冪等伝播エンジン"""

    def __init__(self, neptune_client: Any, graph_id: str,
                 sequence_table: Any = None):
        self.neptune_client = neptune_client
        self.graph_id = graph_id
        self.sequence_table = sequence_table

    def execute_query(self, query: str) -> list[dict]:
        """Neptuneクエリ実行"""
        try:
            response = self.neptune_client.execute_query(
                graphIdentifier=self.graph_id,
                queryString=query,
                language='OPEN_CYPHER',
            )
            payload = json.loads(response['payload'].read())
            return payload.get('results', [])
        except Exception as e:
            print(f'Neptune クエリエラー: {e}')
            return []

    @staticmethod
    def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """2点間の距離をkmで計算（Haversine公式）"""
        R = 6371.0
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (math.sin(dlat / 2) ** 2 +
             math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
             math.sin(dlon / 2) ** 2)
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    def _filter_by_radius(
        self, nodes: list[dict], lat: float, lon: float, radius_km: float
    ) -> list[dict]:
        """地理的近接マッチ（コード内で計算）"""
        return [
            n for n in nodes
            if self._haversine_km(lat, lon, n['lat'], n['lon']) <= radius_km
        ]

    def _get_next_sequence(self) -> int:
        """DynamoDBアトミックカウンターから次のシーケンス番号を取得"""
        if not self.sequence_table:
            return 1
        response = self.sequence_table.update_item(
            Key={'providerId': 'propagation-sequence-counter'},
            UpdateExpression='ADD sequenceValue :inc',
            ExpressionAttributeValues={':inc': 1},
            ReturnValues='UPDATED_NEW',
        )
        return int(response['Attributes']['sequenceValue'])

    def propagate_impact(self, event_id: str) -> PropagationResult:
        """イベント単位で影響を再計算（バージョンスワップ方式・冪等）"""
        run_id = str(uuid.uuid4())
        sequence = self._get_next_sequence()
        now = datetime.now(timezone.utc).isoformat()

        # イベント情報取得
        event_results = self.execute_query(f"""
        MATCH (re:RiskEvent {{id: '{event_id}'}})
        RETURN re.lat AS lat, re.lon AS lon, re.radiusKm AS radiusKm,
               re.severity AS severity, re.eventType AS eventType,
               re.latestPropagationSequence AS currentSequence
        """)
        if not event_results:
            return PropagationResult(edge_count=0, run_id=run_id, promoted=False)

        event = event_results[0]
        lat, lon, radius_km = event['lat'], event['lon'], event['radiusKm']
        current_sequence = event.get('currentSequence', 0) or 0

        # 1. 全ノードを取得（Plant, Supplier, Warehouse, LogisticsHub）
        all_nodes = self.execute_query("""
        MATCH (n) WHERE n:Plant OR n:Supplier OR n:Warehouse OR n:LogisticsHub
        RETURN n.id AS id, n.lat AS lat, n.lon AS lon, labels(n)[0] AS nodeType
        """)

        # 2. 地理的近接による直接影響ノード
        direct_nodes = self._filter_by_radius(all_nodes, lat, lon, radius_km)

        # 3. 直接影響IMPACTSエッジの作成
        edge_count = 0
        for node in direct_nodes:
            self.execute_query(f"""
            MATCH (re:RiskEvent {{id: '{event_id}'}}), (target {{id: '{node["id"]}'}})
            CREATE (re)-[i:IMPACTS]->(target)
            SET i.severity = {event['severity']},
                i.impactType = 'direct',
                i.status = 'active',
                i.firstDetectedAt = datetime('{now}'),
                i.lastUpdatedAt = datetime('{now}'),
                i.impactConfidence = 0.9,
                i.assessmentMethod = 'automated',
                i.propagationRunId = '{run_id}',
                i.cachedImpactAmount = 0
            """)
            edge_count += 1

        # 4. 下流影響の伝播
        if direct_nodes:
            direct_ids = [n['id'] for n in direct_nodes]
            ids_str = ', '.join(f"'{id}'" for id in direct_ids)
            downstream = self.execute_query(f"""
            MATCH (affected) WHERE affected.id IN [{ids_str}]
            MATCH (affected)-[:SUPPLIES_TO*1..3]->(downstream)
            WHERE NOT downstream.id IN [{ids_str}]
            RETURN DISTINCT downstream.id AS id
            """)

            for node in downstream:
                self.execute_query(f"""
                MATCH (re:RiskEvent {{id: '{event_id}'}}), (target {{id: '{node["id"]}'}})
                CREATE (re)-[i:IMPACTS]->(target)
                SET i.severity = {max(1, event['severity'] - 1)},
                    i.impactType = 'downstream',
                    i.status = 'active',
                    i.firstDetectedAt = datetime('{now}'),
                    i.lastUpdatedAt = datetime('{now}'),
                    i.impactConfidence = 0.7,
                    i.assessmentMethod = 'automated',
                    i.propagationRunId = '{run_id}',
                    i.cachedImpactAmount = 0
                """)
                edge_count += 1

        # 5. cachedImpactAmount算出
        self.execute_query(f"""
        MATCH (re:RiskEvent {{id: '{event_id}'}})-[i:IMPACTS {{propagationRunId: '{run_id}'}}]->(target)
        OPTIONAL MATCH (target)-[:SUPPLIES_TO*0..3]->(c:Customer)<-[o:ORDERED_BY]-(prod:Product)
        WITH i, coalesce(sum(o.annual_order_qty * o.unit_price_jpy), 0) AS amount
        SET i.cachedImpactAmount = amount
        """)

        # 6. 昇格（compare-and-swap）
        promoted = False
        if sequence > current_sequence:
            self.execute_query(f"""
            MATCH (re:RiskEvent {{id: '{event_id}'}})
            WHERE re.latestPropagationSequence < {sequence}
            SET re.latestPropagationRunId = '{run_id}',
                re.latestPropagationSequence = {sequence},
                re.propagationCompletedAt = datetime('{now}')
            """)
            promoted = True

            # 7. 古い派生実行のエッジを削除
            self.execute_query(f"""
            MATCH (re:RiskEvent {{id: '{event_id}'}})-[i:IMPACTS]->(target)
            WHERE i.propagationRunId <> '{run_id}'
              AND i.assessmentMethod <> 'manual_override'
            DELETE i
            """)
        else:
            # 昇格スキップ: 自身のエッジを削除
            self.execute_query(f"""
            MATCH (re:RiskEvent {{id: '{event_id}'}})-[i:IMPACTS {{propagationRunId: '{run_id}'}}]->(target)
            DELETE i
            """)
            edge_count = 0

        return PropagationResult(edge_count=edge_count, run_id=run_id, promoted=promoted)


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda ハンドラー"""
    import boto3

    graph_id = event.get('graphId') or 'g-844qqbri1a'
    region = event.get('region') or 'us-west-2'
    risk_event_id = event['riskEventId']

    neptune_client = boto3.client('neptune-graph', region_name=region)

    # DynamoDB シーケンステーブル
    dynamodb = boto3.resource('dynamodb', region_name=region)
    sequence_table = dynamodb.Table('risk-event-provider-cursors')

    propagator = ImpactPropagator(
        neptune_client=neptune_client,
        graph_id=graph_id,
        sequence_table=sequence_table,
    )

    result = propagator.propagate_impact(risk_event_id)

    return {
        'statusCode': 200,
        'body': {
            'eventId': risk_event_id,
            'edgeCount': result.edge_count,
            'runId': result.run_id,
            'promoted': result.promoted,
        },
    }
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/lambda/test_impact_propagator.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lambda/impact_propagator/ tests/lambda/test_impact_propagator.py
git commit -m "feat: add idempotent impact propagator with versioned swap and geo-proximity matching"
```

---

### Task 12: CDK Infrastructure — New Stacks

**Files:**
- Create: `infra/cdk/stacks/risk_event_ingester_stack.py`
- Create: `infra/cdk/stacks/impact_propagator_stack.py`
- Modify: `infra/cdk/app.py`

- [ ] **Step 1: Create Risk Event Ingester stack**

Create `infra/cdk/stacks/risk_event_ingester_stack.py`:

```python
"""リスクイベント取り込みスタック: 取り込みLambda + EventBridge + DynamoDBテーブル"""
from aws_cdk import (
    Stack, Duration, RemovalPolicy,
    aws_lambda as lambda_,
    aws_events as events,
    aws_events_targets as targets,
    aws_dynamodb as dynamodb,
    aws_iam as iam,
)
from constructs import Construct


class RiskEventIngesterStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, *,
                 s3_bucket,
                 neptune_graph_id: str = 'g-844qqbri1a',
                 neptune_region: str = 'us-west-2',
                 polling_interval_minutes: int = 60,
                 **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # DynamoDB: 重複排除レジストリ（TTLなし）
        self.registry_table = dynamodb.Table(
            self, 'RiskEventRegistry',
            table_name='risk-event-registry',
            partition_key=dynamodb.Attribute(name='dedupeKey', type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.RETAIN,
        )

        # DynamoDB: 短期取り込みロック
        self.ingest_lock_table = dynamodb.Table(
            self, 'RiskEventIngestLock',
            table_name='risk-event-ingest-lock',
            partition_key=dynamodb.Attribute(name='dedupeKey', type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
            time_to_live_attribute='ttl',
        )

        # DynamoDB: プロバイダーカーソル
        self.cursor_table = dynamodb.Table(
            self, 'RiskEventProviderCursors',
            table_name='risk-event-provider-cursors',
            partition_key=dynamodb.Attribute(name='providerId', type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.RETAIN,
        )

        # Lambda: リスクイベント取り込み
        self.ingester_function = lambda_.Function(
            self, 'RiskEventIngester',
            function_name='risk-event-ingester',
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler='__init__.handler',
            code=lambda_.Code.from_asset('../../src/lambda/risk_event_ingester'),
            timeout=Duration.seconds(120),
            memory_size=512,
            environment={
                'NEPTUNE_GRAPH_ID': neptune_graph_id,
                'NEPTUNE_REGION': neptune_region,
                'BUCKET_NAME': s3_bucket.bucket_name,
                'REGISTRY_TABLE': self.registry_table.table_name,
                'LOCK_TABLE': self.ingest_lock_table.table_name,
                'CURSOR_TABLE': self.cursor_table.table_name,
            },
        )

        # 権限付与
        s3_bucket.grant_read_write(self.ingester_function)
        self.registry_table.grant_read_write_data(self.ingester_function)
        self.ingest_lock_table.grant_read_write_data(self.ingester_function)
        self.cursor_table.grant_read_write_data(self.ingester_function)

        # Neptune権限
        self.ingester_function.add_to_role_policy(iam.PolicyStatement(
            actions=['neptune-graph:ExecuteQuery', 'neptune-graph:ReadDataViaQuery',
                     'neptune-graph:WriteDataViaQuery', 'neptune-graph:GetGraph'],
            resources=['*'],
        ))

        # EventBridge スケジュール
        rule = events.Rule(
            self, 'IngesterSchedule',
            schedule=events.Schedule.rate(Duration.minutes(polling_interval_minutes)),
        )
        rule.add_target(targets.LambdaFunction(self.ingester_function))
```

- [ ] **Step 2: Create Impact Propagator stack**

Create `infra/cdk/stacks/impact_propagator_stack.py`:

```python
"""影響伝播スタック: 伝播Lambda + Neptune権限"""
from aws_cdk import (
    Stack, Duration,
    aws_lambda as lambda_,
    aws_iam as iam,
)
from constructs import Construct


class ImpactPropagatorStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, *,
                 cursor_table,
                 neptune_graph_id: str = 'g-844qqbri1a',
                 neptune_region: str = 'us-west-2',
                 **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        self.propagator_function = lambda_.Function(
            self, 'ImpactPropagator',
            function_name='impact-propagator',
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler='__init__.handler',
            code=lambda_.Code.from_asset('../../src/lambda/impact_propagator'),
            timeout=Duration.seconds(180),
            memory_size=1024,
            environment={
                'NEPTUNE_GRAPH_ID': neptune_graph_id,
                'NEPTUNE_REGION': neptune_region,
                'CURSOR_TABLE': cursor_table.table_name,
            },
        )

        # Neptune権限
        self.propagator_function.add_to_role_policy(iam.PolicyStatement(
            actions=['neptune-graph:ExecuteQuery', 'neptune-graph:ReadDataViaQuery',
                     'neptune-graph:WriteDataViaQuery', 'neptune-graph:DeleteDataViaQuery',
                     'neptune-graph:GetGraph'],
            resources=['*'],
        ))

        # DynamoDBシーケンステーブル権限
        cursor_table.grant_read_write_data(self.propagator_function)
```

- [ ] **Step 3: Update CDK app entry point**

In `infra/cdk/app.py`, add the new stacks after the existing ones:

```python
from stacks.risk_event_ingester_stack import RiskEventIngesterStack
from stacks.impact_propagator_stack import ImpactPropagatorStack

# 既存スタックの後に追加
risk_ingester_stack = RiskEventIngesterStack(
    app, 'RiskEventIngesterStack',
    s3_bucket=earthquake_stack.bucket,
    neptune_graph_id=neptune_graph_id,
    neptune_region=neptune_region,
    polling_interval_minutes=polling_interval,
    env=env,
)

impact_propagator_stack = ImpactPropagatorStack(
    app, 'ImpactPropagatorStack',
    cursor_table=risk_ingester_stack.cursor_table,
    neptune_graph_id=neptune_graph_id,
    neptune_region=neptune_region,
    env=env,
)
```

- [ ] **Step 4: Verify CDK synth**

Run: `cd infra/cdk && cdk synth --quiet 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add infra/cdk/stacks/risk_event_ingester_stack.py infra/cdk/stacks/impact_propagator_stack.py infra/cdk/app.py
git commit -m "feat: add CDK stacks for risk event ingester and impact propagator"
```

---

### Task 13: Risk Event Ingester Lambda

**Files:**
- Create: `src/lambda/risk_event_ingester/__init__.py`

Refactored from `earthquake_fetcher` with pluggable provider interface.

- [ ] **Step 1: Create ingester Lambda**

Create `src/lambda/risk_event_ingester/__init__.py`:

```python
"""リスクイベント取り込みLambda: プロバイダーをポーリングし、RiskEventServiceで取り込み"""
from __future__ import annotations

import json
import os
from typing import Any

import boto3

from risk_event_service import RiskEventService, RawRiskEvent
from risk_event_service.providers import P2PQuakeProvider, ProviderCursor


BUCKET_NAME = os.environ.get('BUCKET_NAME', '')
NEPTUNE_GRAPH_ID = os.environ.get('NEPTUNE_GRAPH_ID', 'g-844qqbri1a')
NEPTUNE_REGION = os.environ.get('NEPTUNE_REGION', 'us-west-2')
CURSOR_TABLE = os.environ.get('CURSOR_TABLE', 'risk-event-provider-cursors')


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """EventBridgeトリガーのハンドラー"""
    neptune_client = boto3.client('neptune-graph', region_name=NEPTUNE_REGION)
    s3_client = boto3.client('s3')
    dynamodb = boto3.resource('dynamodb', region_name=NEPTUNE_REGION)
    cursor_table = dynamodb.Table(CURSOR_TABLE)

    service = RiskEventService(
        neptune_client=neptune_client,
        graph_id=NEPTUNE_GRAPH_ID,
        s3_client=s3_client,
        s3_bucket=BUCKET_NAME,
    )

    providers = [
        P2PQuakeProvider(),
    ]

    total_created = 0
    total_skipped = 0

    for provider in providers:
        # カーソル読み込み
        cursor = _load_cursor(cursor_table, provider.provider_id)

        # イベント取得
        try:
            fetch_result = provider.fetch_events(cursor)
        except Exception as e:
            print(f'プロバイダー {provider.provider_id} フェッチエラー: {e}')
            continue

        # 取り込み
        for raw_event in fetch_result.events:
            result = service.ingest(raw_event)
            if result.action == 'created':
                total_created += 1
            else:
                total_skipped += 1

        # カーソル更新
        if fetch_result.next_cursor:
            _save_cursor(cursor_table, provider.provider_id, fetch_result.next_cursor)

    return {
        'statusCode': 200,
        'body': {'created': total_created, 'skipped': total_skipped},
    }


def _load_cursor(table: Any, provider_id: str) -> ProviderCursor:
    """DynamoDBからカーソルを読み込み"""
    try:
        response = table.get_item(Key={'providerId': provider_id})
        item = response.get('Item')
        if item:
            return ProviderCursor(
                last_source_event_id=item.get('lastSourceEventId'),
                last_updated_at=item.get('lastUpdatedAt'),
                provider_specific=item.get('providerSpecific', {}),
            )
    except Exception as e:
        print(f'カーソル読み込みエラー: {e}')
    return ProviderCursor()


def _save_cursor(table: Any, provider_id: str, cursor: ProviderCursor) -> None:
    """DynamoDBにカーソルを保存"""
    from datetime import datetime, timezone
    try:
        table.put_item(Item={
            'providerId': provider_id,
            'lastSourceEventId': cursor.last_source_event_id or '',
            'lastUpdatedAt': cursor.last_updated_at or '',
            'providerSpecific': cursor.provider_specific,
            'lastFetchedAt': datetime.now(timezone.utc).isoformat(),
            'version': 1,
        })
    except Exception as e:
        print(f'カーソル保存エラー: {e}')
```

- [ ] **Step 2: Create providers module**

Create `src/lambda/risk_event_service/providers.py`:

```python
"""リスクイベントプロバイダーインターフェースとP2PQuake実装"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol
import urllib.request
import json

from . import RawRiskEvent


@dataclass
class ProviderCursor:
    """プロバイダー状態管理"""
    last_source_event_id: str | None = None
    last_updated_at: str | None = None
    provider_specific: dict = field(default_factory=dict)


@dataclass
class FetchResult:
    events: list[RawRiskEvent]
    next_cursor: ProviderCursor | None = None


class RiskEventProvider(Protocol):
    """リスクイベントプロバイダー契約"""
    provider_id: str

    def fetch_events(self, cursor: ProviderCursor) -> FetchResult: ...


class P2PQuakeProvider:
    """P2PQuake APIプロバイダー"""
    provider_id = 'p2pquake'

    def fetch_events(self, cursor: ProviderCursor) -> FetchResult:
        url = 'https://api.p2pquake.net/v2/jma/quake?limit=10&quake_type=DetailScale'
        try:
            with urllib.request.urlopen(url, timeout=15) as response:
                data = json.loads(response.read().decode())
        except Exception as e:
            print(f'P2PQuake API エラー: {e}')
            return FetchResult(events=[])

        events: list[RawRiskEvent] = []
        latest_id = cursor.last_source_event_id

        for eq in data:
            eq_id = eq.get('id', '')
            if eq_id == cursor.last_source_event_id:
                break

            hypo = eq.get('earthquake', {}).get('hypocenter', {})
            lat = hypo.get('latitude', 0)
            lon = hypo.get('longitude', 0)
            mag = hypo.get('magnitude', 0)
            depth = hypo.get('depth', 0)
            name = hypo.get('name', '不明')
            max_scale = eq.get('earthquake', {}).get('maxScale', 0)

            # 震度3以上のみ
            if max_scale < 30:
                continue

            severity = _magnitude_to_severity(mag)
            radius_km = min(max(10 ** (mag / 3.0), 50), 800)

            events.append(RawRiskEvent(
                source='p2pquake',
                source_event_id=eq_id,
                title=f'{name} M{mag} 地震',
                event_type='earthquake',
                severity=severity,
                lat=lat,
                lon=lon,
                description=f'震源: {name}, マグニチュード: {mag}, 深さ: {depth}km, 最大震度: {max_scale // 10}',
                radius_km=radius_km,
                geo_scope_type='region',
                admin1=name,
                location_name=name,
                affected_country_codes=['JP'],
                start_date=eq.get('time', ''),
                confidence=1.0,
                category_id='RC-natural-earthquake',
                country_code='JP',
                channel='automated',
            ))

            if not latest_id:
                latest_id = eq_id

        next_cursor = ProviderCursor(
            last_source_event_id=latest_id or cursor.last_source_event_id,
            last_updated_at=events[0].start_date if events else cursor.last_updated_at,
        )

        return FetchResult(events=events, next_cursor=next_cursor)


def _magnitude_to_severity(magnitude: float) -> int:
    """マグニチュードを重大度(1-5)に変換"""
    if magnitude >= 7.0:
        return 5
    if magnitude >= 6.0:
        return 4
    if magnitude >= 5.0:
        return 3
    if magnitude >= 4.0:
        return 2
    return 1
```

- [ ] **Step 3: Commit**

```bash
git add src/lambda/risk_event_ingester/ src/lambda/risk_event_service/providers.py
git commit -m "feat: add risk event ingester Lambda with P2PQuake provider"
```

---

## Phase 2: Frontend UI Integration (Tasks 14+)

> **Note:** Tasks 14+ cover map visualization updates, new UI components (risk event panel, risk score dashboard, corridor analysis view, review queue, recovery timeline), simulation store integration with the "Apply current risk scenario" button, and router/navigation changes. These are substantial UI tasks that should be implemented after Phase 1 (Tasks 1-13) is deployed and verified against the live Neptune graph.
>
> The spec defines these in Section 4.6 (Map Visualization), Section 4.7 (New UI Components), and Section 4.8 (Simulation Store Integration). Implementation details depend on the final data shapes returned by the neptune-risk-query handler, which should be validated against live data first.
>
> **Recommended approach:** After completing Tasks 1-13, deploy to Amplify sandbox (`npx ampx sandbox`), verify queries return correct data, then create a follow-up plan for the UI tasks with exact component code based on verified API responses.

---

## Phase 3: Migration (Future Plan)

> Migration tasks (DynamoDB → Neptune data migration, compatibility layer removal, workflow model migration) should be planned after Phase 1 and Phase 2 are validated in production. See spec Sections 3.9, 3.10 for the migration strategy.

---

## Dependency Graph

```
Task 1 (Seed Data) ──────────────────────────────┐
Task 2 (Types) ──────┬───────────────────────────┤
Task 3 (Shared Client)──┬── Task 4 (Risk Queries)─┤
                        └── Task 9 (NL Expansion)──┤
Task 4 ──── Task 5 (AppSync Schema) ──────────────┤
Task 5 ──── Task 6 (API Layer) ───┬── Task 8 (Store Migration)
Task 2 ──── Task 7 (Sim Adapter) ─┘
Task 10 (RiskEventService) ── Task 11 (Propagator) ── Task 12 (CDK)
Task 10 ── Task 13 (Ingester)
```

Tasks 1, 2, 3, 10 can run in parallel.
Tasks 4, 7 can run after their dependencies.
Tasks 5, 6, 8 are sequential.
Tasks 11, 12, 13 follow Task 10.
Task 9 follows Task 3.
