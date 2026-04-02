# -*- coding: utf-8 -*-
"""
DynamoDB → Neptune 一回限りの移行スクリプト

Phase 2（移行戦略）で使用:
- EarthquakeEvent → RiskEvent 頂点
- PlantImpactStatus → IMPACTS エッジ
- event-table ワークフローメタデータ → reviewStatus/reviewedBy

実行前提:
- Neptune Graph に RiskCategory (RC-natural-earthquake) が存在すること
- DynamoDB テーブル名は環境変数またはデフォルト値で指定

実行方法:
  python scripts/migrate_dynamodb_to_graph.py [--dry-run]
"""
import json
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

import boto3

# ── 設定 ──
NEPTUNE_GRAPH_ID = "g-844qqbri1a"
NEPTUNE_REGION = "us-west-2"
EARTHQUAKE_TABLE = "EarthquakeEvent"
PLANT_IMPACT_TABLE = "PlantImpactStatus"

neptune_client = boto3.client("neptune-graph", region_name=NEPTUNE_REGION)
dynamodb = boto3.resource("dynamodb", region_name=NEPTUNE_REGION)

DRY_RUN = "--dry-run" in sys.argv


def execute_query(query: str) -> dict[str, Any]:
    """Neptuneクエリ実行"""
    if DRY_RUN:
        print(f"  [DRY-RUN] {query[:200]}...")
        return {"results": []}
    try:
        response = neptune_client.execute_query(
            graphIdentifier=NEPTUNE_GRAPH_ID,
            queryString=query,
            language="OPEN_CYPHER",
        )
        result = response["payload"].read().decode("utf-8")
        return json.loads(result)
    except Exception as e:
        print(f"  ⚠ クエリエラー: {e}")
        return {"error": str(e)}


def migrate_earthquakes() -> dict[str, str]:
    """EarthquakeEvent → RiskEvent 移行。移行後のearthquakeId→eventIdマッピングを返す"""
    print("\n── EarthquakeEvent → RiskEvent 移行 ──")
    table = dynamodb.Table(EARTHQUAKE_TABLE)

    try:
        response = table.scan()
        items = response.get("Items", [])
    except Exception as e:
        print(f"  ⚠ テーブルスキャンエラー: {e}")
        return {}

    print(f"  {len(items)} 件のEarthquakeEventを処理")
    eq_to_event: dict[str, str] = {}
    migrated = 0

    for eq in items:
        eq_id = eq.get("earthquakeId", "")
        if not eq_id:
            continue

        event_id = str(uuid.uuid4())
        dedupe_key = f"p2pquake:migrated:{eq_id}"
        title = f'{eq.get("location", "不明")} M{eq.get("magnitude", 0)} 地震'
        magnitude = float(eq.get("magnitude", 0))
        severity = (
            5 if magnitude >= 7.0
            else 4 if magnitude >= 6.0
            else 3 if magnitude >= 5.0
            else 2 if magnitude >= 4.0
            else 1
        )
        radius_km = min(max(10 ** (magnitude / 3.0), 50), 800)
        lat = float(eq.get("latitude", 0))
        lon = float(eq.get("longitude", 0))
        timestamp = eq.get("timestamp", datetime.now(timezone.utc).isoformat())
        loc_name = eq.get("location", "不明").replace("'", "\\'")

        query = f"""
        MERGE (re:RiskEvent {{dedupeKey: '{dedupe_key}'}})
        SET re.id = '{event_id}',
            re.sourceEventId = '{eq_id}',
            re.title = '{title.replace("'", "\\'")}',
            re.description = '移行元: EarthquakeEvent DynamoDB',
            re.eventType = 'earthquake',
            re.source = 'p2pquake',
            re.severity = {severity},
            re.lifecycleStatus = 'resolved',
            re.reviewStatus = 'confirmed',
            re.reviewedBy = 'migration-script',
            re.trustLevel = 'trusted_machine',
            re.lat = {lat}, re.lon = {lon},
            re.radiusKm = {radius_km},
            re.geoScopeType = 'region',
            re.locationName = '{loc_name}',
            re.startDate = datetime('{timestamp}'),
            re.updatedAt = datetime('{datetime.now(timezone.utc).isoformat()}'),
            re.confidence = 1.0,
            re.latestPropagationSequence = 0
        RETURN re.id AS id
        """
        result = execute_query(query)
        if result.get("results"):
            eq_to_event[eq_id] = event_id
            migrated += 1

        # CATEGORIZED_AS エッジ
        execute_query(f"""
        MATCH (re:RiskEvent {{dedupeKey: '{dedupe_key}'}}),
              (rc:RiskCategory {{id: 'RC-natural-earthquake'}})
        MERGE (re)-[:CATEGORIZED_AS]->(rc)
        """)

        # OCCURRED_IN エッジ
        execute_query(f"""
        MATCH (re:RiskEvent {{dedupeKey: '{dedupe_key}'}}),
              (c:Country {{code: 'JP'}})
        MERGE (re)-[:OCCURRED_IN]->(c)
        """)

    print(f"  移行完了: {migrated}/{len(items)} 件")
    return eq_to_event


def migrate_plant_impacts(eq_to_event: dict[str, str]) -> None:
    """PlantImpactStatus → IMPACTS エッジ移行"""
    print("\n── PlantImpactStatus → IMPACTS 移行 ──")
    table = dynamodb.Table(PLANT_IMPACT_TABLE)

    try:
        response = table.scan()
        items = response.get("Items", [])
    except Exception as e:
        print(f"  ⚠ テーブルスキャンエラー: {e}")
        return

    print(f"  {len(items)} 件のPlantImpactStatusを処理")
    migrated = 0

    for impact in items:
        plant_id = impact.get("plantId", "")
        eq_id = impact.get("earthquakeId", "")
        event_id = eq_to_event.get(eq_id)

        if not plant_id or not event_id:
            continue

        impact_level = impact.get("impactLevel", "direct")
        impact_type = "direct" if impact_level == "direct" else "downstream"
        amount = float(impact.get("impactedOrderAmount", 0))

        query = f"""
        MATCH (re:RiskEvent {{id: '{event_id}'}}),
              (p:Plant {{id: '{plant_id}'}})
        MERGE (re)-[i:IMPACTS]->(p)
        SET i.severity = 3,
            i.impactType = '{impact_type}',
            i.status = 'resolved',
            i.cachedImpactAmount = {amount},
            i.assessmentMethod = 'automated',
            i.impactConfidence = 0.8,
            i.firstDetectedAt = datetime('{datetime.now(timezone.utc).isoformat()}'),
            i.lastUpdatedAt = datetime('{datetime.now(timezone.utc).isoformat()}'),
            i.propagationRunId = 'migration'
        """
        result = execute_query(query)
        if not result.get("error"):
            migrated += 1

    print(f"  移行完了: {migrated}/{len(items)} 件")


def verify_migration() -> None:
    """移行結果を検証"""
    print("\n── 移行検証 ──")
    queries = [
        ("移行済みRiskEvent", "MATCH (re:RiskEvent) WHERE re.source = 'p2pquake' AND re.description CONTAINS '移行元' RETURN count(re) as count"),
        ("移行済みIMPACTS", "MATCH ()-[i:IMPACTS]->() WHERE i.propagationRunId = 'migration' RETURN count(i) as count"),
    ]
    for label, query in queries:
        result = execute_query(query)
        count = result.get("results", [{}])[0].get("count", 0)
        print(f"  {label}: {count} 件")


def main() -> None:
    print("=" * 60)
    print("DynamoDB → Neptune 移行スクリプト")
    if DRY_RUN:
        print("🔍 DRY-RUN モード（実際の書き込みは行いません）")
    print(f"Graph: {NEPTUNE_GRAPH_ID} @ {NEPTUNE_REGION}")
    print("=" * 60)

    eq_to_event = migrate_earthquakes()
    migrate_plant_impacts(eq_to_event)

    if not DRY_RUN:
        verify_migration()

    print("\n✅ 移行完了!")


if __name__ == "__main__":
    main()
