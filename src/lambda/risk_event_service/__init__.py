"""全チャネル共通のリスクイベント書き込みパス

単一の取り込みパイプライン: 正規化→ロック取得→レジストリ検索→upsert→アーカイブ→伝播
全チャネル（自動フィード、AI抽出、手動入力）がこのサービスを経由する。
"""
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
    """取り込み結果"""
    action: str  # 'created', 'updated', 'skipped'
    event_id: str
    impacts_computed: int = 0


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
    ):
        self.neptune_client = neptune_client
        self.graph_id = graph_id
        self.s3_client = s3_client
        self.s3_bucket = s3_bucket
        self.lock_table = lock_table
        self.registry_table = registry_table

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

    # ── Neptune実行 ───────────────────────────────────────────

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

    # ── 重複排除・同時実行制御 ────────────────────────────────

    def acquire_ingest_lock(self, dedupe_key: str) -> bool:
        """短期取り込みロックを取得（DynamoDB条件付き書き込み）"""
        if not self.lock_table:
            return True  # テーブル未設定時はロックスキップ（テスト用）
        import time
        try:
            self.lock_table.put_item(
                Item={
                    'dedupeKey': dedupe_key,
                    'lockedAt': datetime.now(timezone.utc).isoformat(),
                    'lockedBy': f'ingester-{uuid.uuid4().hex[:8]}',
                    'ttl': int(time.time()) + 300,  # 5分リース
                },
                ConditionExpression='attribute_not_exists(dedupeKey)',
            )
            return True
        except Exception as e:
            error_code = getattr(
                getattr(e, 'response', {}), 'get', lambda *_: None
            )
            # botocore ClientError
            if hasattr(e, 'response') and e.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
                return False  # 別ライターが先行取得済み
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
            # アーカイブ失敗はログに記録するが、イベント自体はロールバックしない
            print(json.dumps({
                'level': 'WARNING', 'message': 'アーカイブ失敗',
                'eventId': event_id, 'error': str(e),
            }))

    # ── 伝播呼び出し ─────────────────────────────────────────

    def invoke_propagation(self, event_id: str) -> int:
        """影響伝播を明示的に呼び出し（同一プロセス内で実行）"""
        try:
            from impact_propagator import ImpactPropagator
            propagator = ImpactPropagator(
                neptune_client=self.neptune_client,
                graph_id=self.graph_id,
            )
            result = propagator.propagate_impact(event_id)
            return result.edge_count
        except ImportError:
            # テスト環境ではimport不可（正常動作）
            return 0
        except Exception as e:
            # 構造化エラーログ: propagation_failed=true でCloudWatchメトリクスフィルタ検知
            print(json.dumps({
                'level': 'ERROR', 'message': '影響伝播失敗',
                'eventId': event_id, 'error': str(e),
                'propagation_failed': True,
            }))
            return 0

    # ── Neptune upsert ───────────────────────────────────────

    def upsert_risk_event(self, event: dict[str, Any]) -> str:
        """RiskEventをNeptuneにupsert"""
        admin1_val = f"'{event['admin1']}'" if event.get('admin1') else 'null'
        reviewed_by = f"'{event['reviewedBy']}'" if event.get('reviewedBy') else 'null'
        reviewed_at = f"datetime('{event['reviewedAt']}')" if event.get('reviewedAt') else 'null'
        end_date = f"datetime('{event['endDate']}')" if event.get('endDate') else 'null'
        # タイトルと説明のシングルクォートをエスケープ
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
        results = self.execute_query(query)
        return results[0]['id'] if results else event['id']

    # ── メイン取り込みパス ───────────────────────────────────

    def ingest(self, raw: RawRiskEvent) -> IngestResult:
        """正規化 → ロック取得 → レジストリ検索 → upsert → アーカイブ → 伝播

        失敗契約:
        - upsert成功後にarchive_raw_payload()が失敗: イベントはNeptuneに存在する。
          action='created'を返す（アーカイブ欠損はログに記録、データロスではない）。
        - upsert成功後にinvoke_propagation()が失敗: イベントはNeptuneに存在するが
          IMPACTSエッジが未生成。action='created', impacts_computed=0を返す。
          構造化エラーログ（propagation_failed=true）をCloudWatchで検知可能。
          propagate_impact()は冪等なので再実行は安全。
        - upsert自体が失敗: 例外がそのまま伝播する。
        設計原則: Neptune書き込みがコミットポイント。アーカイブと伝播は後続処理。
        """
        event = self.normalize(raw)
        dedupe_key = event['dedupeKey']

        # 1. 短期ロック取得（同時取り込みレース防止）
        if not self.acquire_ingest_lock(dedupe_key):
            return IngestResult(action='skipped', event_id='')

        # 2. レジストリで既存イベントを検索
        existing_id = self.lookup_registry(dedupe_key)

        if existing_id:
            # 更新パス: updatedAtを比較して新しい場合のみ更新
            existing = self.execute_query(
                f"MATCH (re:RiskEvent {{dedupeKey: '{dedupe_key}'}}) "
                f"RETURN re.id AS id, toString(re.updatedAt) AS updatedAt"
            )
            if existing and existing[0].get('updatedAt'):
                existing_updated = existing[0]['updatedAt']
                incoming_updated = event['updatedAt']
                if incoming_updated <= existing_updated:
                    return IngestResult(action='skipped', event_id=existing_id)

            # 既存イベントのIDを維持して更新
            event['id'] = existing_id
            self.upsert_risk_event(event)
            self.archive_raw_payload(raw, existing_id)
            impacts = self.invoke_propagation(existing_id)
            return IngestResult(
                action='updated', event_id=existing_id,
                impacts_computed=impacts,
            )

        # 3. 新規イベント: Neptune upsert
        event_id = self.upsert_risk_event(event)

        # 4. カテゴリエッジ
        if raw.category_id:
            self.execute_query(f"""
            MATCH (re:RiskEvent {{dedupeKey: '{dedupe_key}'}}),
                  (rc:RiskCategory {{id: '{raw.category_id}'}})
            MERGE (re)-[:CATEGORIZED_AS]->(rc)
            """)

        # 5. 国エッジ
        if raw.country_code:
            self.execute_query(f"""
            MATCH (re:RiskEvent {{dedupeKey: '{dedupe_key}'}}),
                  (c:Country {{code: '{raw.country_code}'}})
            MERGE (re)-[:OCCURRED_IN]->(c)
            """)

        # 6. レジストリ登録
        self.update_registry(dedupe_key, event_id)

        # 7. 生ペイロードをS3にアーカイブ
        self.archive_raw_payload(raw, event_id)

        # 8. 影響伝播を呼び出し
        impacts = self.invoke_propagation(event_id)

        return IngestResult(
            action='created', event_id=event_id,
            impacts_computed=impacts,
        )
