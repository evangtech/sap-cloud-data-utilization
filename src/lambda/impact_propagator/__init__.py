"""イベント単位の冪等影響伝播（バージョンスワップ方式）

中心ルール: イベントの影響セットを再計算する。増分追加しない。
ステージドバージョニング: 新runのエッジを書き→昇格CAS→旧runのエッジを削除。
ゼロインパクトウィンドウなし。順序外完了からの保護あり。
"""
from __future__ import annotations

import json
import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass
class PropagationResult:
    """伝播結果"""
    edge_count: int
    run_id: str
    promoted: bool


class ImpactPropagator:
    """イベント単位で影響を再計算する冪等伝播エンジン"""

    def __init__(
        self,
        neptune_client: Any,
        graph_id: str,
        sequence_table: Any = None,
    ):
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
    def _haversine_km(
        lat1: float, lon1: float, lat2: float, lon2: float,
    ) -> float:
        """2点間の距離をkmで計算（Haversine公式）"""
        R = 6371.0
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1))
            * math.cos(math.radians(lat2))
            * math.sin(dlon / 2) ** 2
        )
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    def _filter_by_radius(
        self,
        nodes: list[dict],
        lat: float,
        lon: float,
        radius_km: float,
    ) -> list[dict]:
        """地理的近接マッチ（コード内で計算、現行analyzerと同方式）"""
        return [
            n for n in nodes
            if n.get('lat') is not None
            and n.get('lon') is not None
            and self._haversine_km(lat, lon, n['lat'], n['lon']) <= radius_km
        ]

    def _get_next_sequence(self) -> int:
        """DynamoDBアトミックカウンターから次のシーケンス番号を取得

        意図的な設計判断: シーケンスカウンターはprovider-cursorsテーブル内の
        専用アイテム（providerId='_propagation-sequence-counter'）として格納する。
        接頭辞 '_' でプロバイダーエントリと明確に区別する。
        """
        if not self.sequence_table:
            return 1
        response = self.sequence_table.update_item(
            Key={'providerId': '_propagation-sequence-counter'},
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
        lat = event.get('lat', 0)
        lon = event.get('lon', 0)
        radius_km = event.get('radiusKm', 50)
        severity = event.get('severity', 1)
        current_sequence = event.get('currentSequence', 0) or 0

        # 1. 全ノードを取得（Plant, Supplier, Warehouse, LogisticsHub）
        all_nodes = self.execute_query("""
        MATCH (n)
        WHERE n:Plant OR n:Supplier OR n:Warehouse OR n:LogisticsHub
        RETURN n.id AS id, n.lat AS lat, n.lon AS lon, labels(n)[0] AS nodeType
        """)

        # 2. 地理的近接による直接影響ノード
        direct_nodes = self._filter_by_radius(all_nodes, lat, lon, radius_km)

        # 3. 直接影響IMPACTSエッジの作成
        edge_count = 0
        direct_ids = [n['id'] for n in direct_nodes]

        for node in direct_nodes:
            self.execute_query(f"""
            MATCH (re:RiskEvent {{id: '{event_id}'}}), (target {{id: '{node["id"]}'}})
            CREATE (re)-[i:IMPACTS]->(target)
            SET i.severity = {severity},
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

        # 4. 下流影響の伝播（SUPPLIES_TO*1..3）
        if direct_ids:
            ids_str = ', '.join(f"'{id}'" for id in direct_ids)
            downstream = self.execute_query(f"""
            MATCH (affected) WHERE affected.id IN [{ids_str}]
            MATCH (affected)-[:SUPPLIES_TO*1..3]->(downstream)
            WHERE NOT downstream.id IN [{ids_str}]
            RETURN DISTINCT downstream.id AS id
            """)

            for node in downstream:
                self.execute_query(f"""
                MATCH (re:RiskEvent {{id: '{event_id}'}}),
                      (target {{id: '{node["id"]}'}})
                CREATE (re)-[i:IMPACTS]->(target)
                SET i.severity = {max(1, severity - 1)},
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

        # 6. 昇格（compare-and-swap: 実際にSETが成功したか検証）
        promoted = False
        if sequence > current_sequence:
            promotion_result = self.execute_query(f"""
            MATCH (re:RiskEvent {{id: '{event_id}'}})
            WHERE re.latestPropagationSequence < {sequence}
            SET re.latestPropagationRunId = '{run_id}',
                re.latestPropagationSequence = {sequence},
                re.propagationCompletedAt = datetime('{now}')
            RETURN re.latestPropagationRunId AS promotedRunId
            """)

            # RETURNが空 = WHERE句が不成立 = 別のrunが先に昇格済み
            promoted = (
                len(promotion_result) > 0
                and promotion_result[0].get('promotedRunId') == run_id
            )

        if promoted:
            # 7. 古い派生実行のエッジを削除（自分のrunが勝った場合のみ）
            self.execute_query(f"""
            MATCH (re:RiskEvent {{id: '{event_id}'}})-[i:IMPACTS]->(target)
            WHERE i.propagationRunId <> '{run_id}'
              AND i.assessmentMethod <> 'manual_override'
            DELETE i
            """)
        else:
            # 昇格スキップ（別runが先行、またはsequence <= current）:
            # 自身のエッジを削除
            self.execute_query(f"""
            MATCH (re:RiskEvent {{id: '{event_id}'}})-[i:IMPACTS {{propagationRunId: '{run_id}'}}]->(target)
            DELETE i
            """)
            edge_count = 0

        return PropagationResult(
            edge_count=edge_count, run_id=run_id, promoted=promoted,
        )


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda ハンドラー"""
    import boto3

    graph_id = event.get('graphId') or 'g-844qqbri1a'
    region = event.get('region') or 'us-west-2'
    risk_event_id = event['riskEventId']

    neptune_client = boto3.client('neptune-graph', region_name=region)

    # DynamoDB シーケンステーブル
    dynamodb = boto3.resource('dynamodb', region_name=region)
    sequence_table = dynamodb.Table(
        event.get('cursorTable') or 'risk-event-provider-cursors',
    )

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
