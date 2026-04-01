"""全チャネル共通のリスクイベント書き込みパス

単一の取り込みパイプライン: 正規化→ロック取得→レジストリ検索→upsert→アーカイブ→伝播
全チャネル（自動フィード、AI抽出、手動入力）がこのサービスを経由する。

このファイルはingester Lambdaのデプロイメントパッケージに含まれる。
v2で他チャネル（AI抽出、手動入力）が追加される際は共有Lambda Layerに抽出する。
"""
from __future__ import annotations

import json
import os
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
    """取り込み結果"""
    action: str  # 'created', 'updated', 'skipped'
    event_id: str
    impacts_computed: int = 0


class NeptuneWriteError(Exception):
    """Neptuneへの書き込みが失敗した場合の例外"""
    pass


TRUSTED_SOURCES = frozenset({'p2pquake', 'usgs', 'gdacs'})


class RiskEventService:
    """全チャネル共通のリスクイベント取り込みサービス"""

    def __init__(
        self,
        neptune_client: Any,
        graph_id: str,
        s3_client: Any = None,
        s3_bucket: str = '',
        lock_table: Any = None,
        registry_table: Any = None,
        propagator_function_name: str = '',
        lambda_client: Any = None,
    ):
        self.neptune_client = neptune_client
        self.graph_id = graph_id
        self.s3_client = s3_client
        self.s3_bucket = s3_bucket
        self.lock_table = lock_table
        self.registry_table = registry_table
        self.propagator_function_name = propagator_function_name or os.environ.get(
            'PROPAGATOR_FUNCTION_NAME', '',
        )
        self.lambda_client = lambda_client

    # ── 信頼・レビューポリシー ────────────────────────────────

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

    # ── 正規化 ────────────────────────────────────────────────

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

    # ── Neptune実行（strict/safe分離） ───────────────────────

    def execute_query(self, query: str) -> list[dict]:
        """Neptuneクエリ実行（書き込み・重要な読み取り用 — エラー時はraise）"""
        response = self.neptune_client.execute_query(
            graphIdentifier=self.graph_id,
            queryString=query,
            language='OPEN_CYPHER',
        )
        payload = json.loads(response['payload'].read())
        return payload.get('results', [])

    def execute_query_safe(self, query: str) -> list[dict]:
        """Neptuneクエリ実行（非重要な読み取り用 — エラー時は空リスト）"""
        try:
            return self.execute_query(query)
        except Exception as e:
            print(f'Neptune クエリエラー（非致命的）: {e}')
            return []

    # ── 重複排除・同時実行制御 ────────────────────────────────

    def acquire_ingest_lock(self, dedupe_key: str) -> bool:
        """短期取り込みロックを取得（DynamoDB条件付き書き込み）"""
        if not self.lock_table:
            return True
        import time
        try:
            self.lock_table.put_item(
                Item={
                    'dedupeKey': dedupe_key,
                    'lockedAt': datetime.now(timezone.utc).isoformat(),
                    'lockedBy': f'ingester-{uuid.uuid4().hex[:8]}',
                    'ttl': int(time.time()) + 300,
                },
                ConditionExpression='attribute_not_exists(dedupeKey)',
            )
            return True
        except Exception as e:
            if hasattr(e, 'response') and e.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
                return False
            raise

    def lookup_registry(self, dedupe_key: str) -> str | None:
        """正規的イベントレジストリから既存eventIdを検索"""
        if not self.registry_table:
            return None
        try:
            response = self.registry_table.get_item(Key={'dedupeKey': dedupe_key})
            item = response.get('Item')
            return item['eventId'] if item else None
        except Exception:
            return None

    def update_registry(self, dedupe_key: str, event_id: str) -> None:
        """正規的イベントレジストリを更新"""
        if not self.registry_table:
            return
        now = datetime.now(timezone.utc).isoformat()
        self.registry_table.put_item(Item={
            'dedupeKey': dedupe_key,
            'eventId': event_id,
            'createdAt': now,
            'updatedAt': now,
        })

    # ── S3アーカイブ ──────────────────────────────────────────

    def archive_raw_payload(self, raw: RawRiskEvent, event_id: str) -> None:
        """生ペイロードをS3にアーカイブ"""
        if not self.s3_client or not self.s3_bucket:
            return
        import dataclasses
        now = datetime.now(timezone.utc)
        key = f'raw_events/{now.year}/{now.month:02d}/{event_id}.json'
        try:
            self.s3_client.put_object(
                Bucket=self.s3_bucket, Key=key,
                Body=json.dumps(
                    dataclasses.asdict(raw), ensure_ascii=False, default=str,
                ),
                ContentType='application/json',
            )
        except Exception as e:
            print(json.dumps({
                'level': 'WARNING', 'message': 'アーカイブ失敗',
                'eventId': event_id, 'error': str(e),
            }))

    # ── 伝播呼び出し（Lambda.invoke） ────────────────────────

    def invoke_propagation(self, event_id: str) -> int:
        """影響伝播をデプロイ済みLambda経由で呼び出し"""
        if not self.propagator_function_name or not self.lambda_client:
            return 0
        try:
            response = self.lambda_client.invoke(
                FunctionName=self.propagator_function_name,
                InvocationType='Event',  # 非同期呼び出し
                Payload=json.dumps({
                    'riskEventId': event_id,
                    'graphId': self.graph_id,
                }),
            )
            status = response.get('StatusCode', 0)
            if status in (200, 202):
                return 1  # 非同期で受理済み
            print(json.dumps({
                'level': 'WARNING', 'message': '伝播呼び出し異常ステータス',
                'eventId': event_id, 'statusCode': status,
            }))
            return 0
        except Exception as e:
            print(json.dumps({
                'level': 'ERROR', 'message': '影響伝播失敗',
                'eventId': event_id, 'error': str(e),
                'propagation_failed': True,
            }))
            return 0

    # ── Neptune upsert（strict — 失敗時はraise） ────────────

    def upsert_risk_event(self, event: dict[str, Any]) -> str:
        """RiskEventをNeptuneにupsert。書き込み失敗時はNeptuneWriteErrorをraise。"""
        admin1_val = f"'{event['admin1']}'" if event.get('admin1') else 'null'
        reviewed_by = f"'{event['reviewedBy']}'" if event.get('reviewedBy') else 'null'
        reviewed_at = f"datetime('{event['reviewedAt']}')" if event.get('reviewedAt') else 'null'
        end_date = f"datetime('{event['endDate']}')" if event.get('endDate') else 'null'
        title = event['title'].replace("'", "\\'")
        desc = event.get('description', '').replace("'", "\\'")
        loc = event.get('locationName', '').replace("'", "\\'")

        query = f"""
        MERGE (re:RiskEvent {{dedupeKey: '{event["dedupeKey"]}'}})
        SET re.id = '{event["id"]}',
            re.sourceEventId = '{event["sourceEventId"]}',
            re.title = '{title}',
            re.description = '{desc}',
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
            re.locationName = '{loc}',
            re.startDate = datetime('{event["startDate"]}'),
            re.endDate = {end_date},
            re.updatedAt = datetime('{event["updatedAt"]}'),
            re.confidence = {event["confidence"]},
            re.latestPropagationSequence = {event["latestPropagationSequence"]}
        RETURN re.id AS id
        """
        # strict: 例外はそのまま伝播、fallbackなし
        results = self.execute_query(query)
        if not results:
            raise NeptuneWriteError(
                f"Neptune MERGE returned no rows for dedupeKey={event['dedupeKey']}"
            )
        return results[0]['id']

    # ── メイン取り込みパス ───────────────────────────────────

    def ingest(self, raw: RawRiskEvent) -> IngestResult:
        """正規化 → ロック取得 → レジストリ検索 → upsert → アーカイブ → 伝播

        失敗契約:
        - upsert失敗: NeptuneWriteErrorがそのまま伝播。レジストリ/S3は更新されない。
        - upsert成功後にarchive失敗: ログに記録、action='created'を返す。
        - upsert成功後にpropagation失敗: 構造化ログ（propagation_failed=true）、
          impacts_computed=0を返す。propagate_impact()は冪等なので後続リトライ可能。
        設計原則: Neptune書き込みがコミットポイント。レジストリ/アーカイブ/伝播は後続処理。
        """
        event = self.normalize(raw)
        dedupe_key = event['dedupeKey']

        # 1. 短期ロック取得
        if not self.acquire_ingest_lock(dedupe_key):
            return IngestResult(action='skipped', event_id='')

        # 2. レジストリで既存イベントを検索
        existing_id = self.lookup_registry(dedupe_key)

        if existing_id:
            # 更新パス: updatedAtを比較して新しい場合のみ更新
            existing = self.execute_query_safe(
                f"MATCH (re:RiskEvent {{dedupeKey: '{dedupe_key}'}}) "
                f"RETURN re.id AS id, toString(re.updatedAt) AS updatedAt"
            )
            if existing and existing[0].get('updatedAt'):
                if event['updatedAt'] <= existing[0]['updatedAt']:
                    return IngestResult(action='skipped', event_id=existing_id)

            event['id'] = existing_id
            self.upsert_risk_event(event)  # strict: 失敗時はraise
            self.archive_raw_payload(raw, existing_id)
            impacts = self.invoke_propagation(existing_id)
            return IngestResult(
                action='updated', event_id=existing_id,
                impacts_computed=impacts,
            )

        # 3. 新規イベント: Neptune upsert (strict)
        event_id = self.upsert_risk_event(event)

        # 4. カテゴリエッジ（非致命的 — 失敗してもイベント自体は存在）
        if raw.category_id:
            self.execute_query_safe(f"""
            MATCH (re:RiskEvent {{dedupeKey: '{dedupe_key}'}}),
                  (rc:RiskCategory {{id: '{raw.category_id}'}})
            MERGE (re)-[:CATEGORIZED_AS]->(rc)
            """)

        # 5. 国エッジ（非致命的）
        if raw.country_code:
            self.execute_query_safe(f"""
            MATCH (re:RiskEvent {{dedupeKey: '{dedupe_key}'}}),
                  (c:Country {{code: '{raw.country_code}'}})
            MERGE (re)-[:OCCURRED_IN]->(c)
            """)

        # 6. レジストリ登録（upsert成功後のみ到達）
        self.update_registry(dedupe_key, event_id)

        # 7. S3アーカイブ（非致命的）
        self.archive_raw_payload(raw, event_id)

        # 8. 影響伝播（非致命的、非同期Lambda呼び出し）
        impacts = self.invoke_propagation(event_id)

        return IngestResult(
            action='created', event_id=event_id,
            impacts_computed=impacts,
        )
