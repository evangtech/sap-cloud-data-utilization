"""RiskEventService ユニットテスト

テスト対象: 信頼ポリシー、正規化、重複排除キー、取り込みパス分岐
Neptune/DynamoDB/S3はモックで代替
"""
import sys
import os
import json
from unittest.mock import MagicMock, patch, PropertyMock
from io import BytesIO

# src/lambda/risk_event_ingester をパスに追加
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'lambda', 'risk_event_ingester'))

from service import RiskEventService, RawRiskEvent, IngestResult, NeptuneWriteError


def _make_service(
    lock_table: MagicMock | None = None,
    registry_table: MagicMock | None = None,
    s3_client: MagicMock | None = None,
) -> RiskEventService:
    """テスト用サービスインスタンスを作成（upsertは成功レスポンスを返す）"""
    mock_neptune = MagicMock()

    def mock_execute(**kwargs):
        query = kwargs.get('queryString', '')
        if 'MERGE' in query:
            return {
                'payload': BytesIO(json.dumps(
                    {'results': [{'id': 'mock-event-id'}]},
                ).encode()),
            }
        return {
            'payload': BytesIO(json.dumps({'results': []}).encode()),
        }

    mock_neptune.execute_query.side_effect = mock_execute
    return RiskEventService(
        neptune_client=mock_neptune,
        graph_id='test-graph',
        s3_client=s3_client,
        s3_bucket='test-bucket',
        lock_table=lock_table,
        registry_table=registry_table,
    )


def _make_raw_event(**overrides) -> RawRiskEvent:
    """テスト用RawRiskEventを作成"""
    defaults = dict(
        source='p2pquake', source_event_id='eq123',
        title='テスト地震', event_type='earthquake',
        severity=3, lat=35.0, lon=135.0,
        channel='automated',
    )
    defaults.update(overrides)
    return RawRiskEvent(**defaults)


# ── 信頼ポリシーテスト ───────────────────────────────────────

class TestDetermineReviewStatus:
    def test_trusted_machine_sources_are_auto_confirmed(self):
        service = _make_service()
        assert service.determine_review_status('automated', 'p2pquake') == 'confirmed'
        assert service.determine_review_status('automated', 'usgs') == 'confirmed'
        assert service.determine_review_status('automated', 'gdacs') == 'confirmed'

    def test_ai_extracted_is_pending(self):
        service = _make_service()
        assert service.determine_review_status('ai_extraction', 'ai_extracted') == 'pending'

    def test_manual_is_confirmed(self):
        service = _make_service()
        assert service.determine_review_status('manual', 'manual') == 'confirmed'

    def test_unknown_source_is_pending(self):
        service = _make_service()
        assert service.determine_review_status('automated', 'unknown_feed') == 'pending'


class TestDetermineTrustLevel:
    def test_trusted_machine(self):
        service = _make_service()
        assert service.determine_trust_level('automated', 'p2pquake') == 'trusted_machine'

    def test_analyst(self):
        service = _make_service()
        assert service.determine_trust_level('manual', 'manual') == 'analyst'

    def test_ai_unverified(self):
        service = _make_service()
        assert service.determine_trust_level('ai_extraction', 'ai_extracted') == 'ai_unverified'


# ── 重複排除キーテスト ───────────────────────────────────────

class TestComputeDedupeKey:
    def test_format(self):
        service = _make_service()
        raw = _make_raw_event()
        assert service.compute_dedupe_key(raw) == 'p2pquake:eq123'

    def test_deterministic(self):
        service = _make_service()
        raw = _make_raw_event()
        assert service.compute_dedupe_key(raw) == service.compute_dedupe_key(raw)

    def test_different_sources_produce_different_keys(self):
        service = _make_service()
        raw1 = _make_raw_event(source='p2pquake')
        raw2 = _make_raw_event(source='usgs')
        assert service.compute_dedupe_key(raw1) != service.compute_dedupe_key(raw2)


# ── 正規化テスト ─────────────────────────────────────────────

class TestNormalize:
    def test_trusted_source_gets_system_reviewer(self):
        service = _make_service()
        raw = _make_raw_event(source='p2pquake', channel='automated')
        event = service.normalize(raw)
        assert event['reviewStatus'] == 'confirmed'
        assert event['reviewedBy'] == 'system'
        assert event['reviewedAt'] is not None

    def test_ai_extracted_gets_pending_no_reviewer(self):
        service = _make_service()
        raw = _make_raw_event(source='ai_extracted', channel='ai_extraction')
        event = service.normalize(raw)
        assert event['reviewStatus'] == 'pending'
        assert event['reviewedBy'] is None
        assert event['reviewedAt'] is None

    def test_initial_lifecycle_is_detected(self):
        service = _make_service()
        raw = _make_raw_event()
        event = service.normalize(raw)
        assert event['lifecycleStatus'] == 'detected'

    def test_propagation_sequence_starts_at_zero(self):
        service = _make_service()
        raw = _make_raw_event()
        event = service.normalize(raw)
        assert event['latestPropagationSequence'] == 0


# ── 取り込みパステスト ───────────────────────────────────────

class TestIngest:
    def test_new_event_creates_and_returns_created(self):
        """新規イベントの取り込み → action='created'"""
        mock_neptune = MagicMock()

        def mock_execute(**kwargs):
            query = kwargs.get('queryString', '')
            # upsert MERGE → 成功レスポンス
            if 'MERGE' in query:
                return {
                    'payload': BytesIO(json.dumps(
                        {'results': [{'id': 'test-event-id'}]},
                    ).encode()),
                }
            return {
                'payload': BytesIO(json.dumps({'results': []}).encode()),
            }

        mock_neptune.execute_query.side_effect = mock_execute
        service = RiskEventService(
            neptune_client=mock_neptune,
            graph_id='test',
        )

        raw = _make_raw_event()
        result = service.ingest(raw)
        assert result.action == 'created'
        assert result.event_id == 'test-event-id'

    def test_neptune_write_failure_raises(self):
        """Neptune書き込み失敗 → NeptuneWriteError（レジストリ/S3は更新されない）"""
        mock_neptune = MagicMock()
        mock_neptune.execute_query.side_effect = Exception('Neptune接続エラー')

        mock_registry = MagicMock()
        mock_registry.get_item.return_value = {}  # レジストリにも無い

        service = RiskEventService(
            neptune_client=mock_neptune,
            graph_id='test',
            registry_table=mock_registry,
        )

        raw = _make_raw_event()
        import pytest
        with pytest.raises(Exception):
            service.ingest(raw)
        # レジストリが更新されていないことを確認
        mock_registry.put_item.assert_not_called()

    def test_neptune_empty_return_raises_write_error(self):
        """Neptune MERGEが空リスト返却 → NeptuneWriteError"""
        mock_neptune = MagicMock()
        mock_neptune.execute_query.return_value = {
            'payload': BytesIO(json.dumps({'results': []}).encode()),
        }

        service = RiskEventService(
            neptune_client=mock_neptune,
            graph_id='test',
        )

        raw = _make_raw_event()
        import pytest
        with pytest.raises(NeptuneWriteError):
            service.ingest(raw)

    def test_lock_failure_returns_skipped(self):
        """ロック取得失敗 → action='skipped'"""
        mock_lock = MagicMock()
        error_response = {'Error': {'Code': 'ConditionalCheckFailedException'}}
        mock_exception = type('ClientError', (Exception,), {
            'response': error_response,
        })()
        mock_lock.put_item.side_effect = mock_exception

        service = _make_service(lock_table=mock_lock)
        raw = _make_raw_event()
        result = service.ingest(raw)
        assert result.action == 'skipped'

    def test_archive_failure_still_returns_success(self):
        """アーカイブ失敗 → イベントは作成済み、action='created'のまま"""
        mock_neptune = MagicMock()

        def mock_execute(**kwargs):
            query = kwargs.get('queryString', '')
            if 'MERGE' in query:
                return {
                    'payload': BytesIO(json.dumps(
                        {'results': [{'id': 'test-id'}]},
                    ).encode()),
                }
            return {
                'payload': BytesIO(json.dumps({'results': []}).encode()),
            }

        mock_neptune.execute_query.side_effect = mock_execute
        mock_s3 = MagicMock()
        mock_s3.put_object.side_effect = Exception('S3エラー')

        service = RiskEventService(
            neptune_client=mock_neptune,
            graph_id='test',
            s3_client=mock_s3,
            s3_bucket='test-bucket',
        )
        raw = _make_raw_event()
        result = service.ingest(raw)
        assert result.action == 'created'
