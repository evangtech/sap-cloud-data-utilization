"""リスクイベント取り込みLambda

EventBridgeスケジュールでトリガーされ、プロバイダーをポーリングして
RiskEventServiceで取り込む。
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

import boto3

# 同一デプロイメントパッケージ内のモジュールをインポート
# Lambda環境では /var/task にコードが配置される
import sys
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'risk_event_service'))

from risk_event_service import RiskEventService, RawRiskEvent
from risk_event_service.providers import P2PQuakeProvider, ProviderCursor


BUCKET_NAME = os.environ.get('BUCKET_NAME', '')
NEPTUNE_GRAPH_ID = os.environ.get('NEPTUNE_GRAPH_ID', 'g-844qqbri1a')
NEPTUNE_REGION = os.environ.get('NEPTUNE_REGION', 'us-west-2')
REGISTRY_TABLE = os.environ.get('REGISTRY_TABLE', 'risk-event-registry')
LOCK_TABLE = os.environ.get('LOCK_TABLE', 'risk-event-ingest-lock')
CURSOR_TABLE = os.environ.get('CURSOR_TABLE', 'risk-event-provider-cursors')


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """EventBridgeトリガーのハンドラー"""
    neptune_client = boto3.client('neptune-graph', region_name=NEPTUNE_REGION)
    s3_client = boto3.client('s3')
    dynamodb = boto3.resource('dynamodb', region_name=NEPTUNE_REGION)

    lock_table = dynamodb.Table(LOCK_TABLE)
    registry_table = dynamodb.Table(REGISTRY_TABLE)
    cursor_table = dynamodb.Table(CURSOR_TABLE)

    service = RiskEventService(
        neptune_client=neptune_client,
        graph_id=NEPTUNE_GRAPH_ID,
        s3_client=s3_client,
        s3_bucket=BUCKET_NAME,
        lock_table=lock_table,
        registry_table=registry_table,
    )

    providers = [
        P2PQuakeProvider(),
    ]

    total_created = 0
    total_updated = 0
    total_skipped = 0

    for provider in providers:
        cursor = _load_cursor(cursor_table, provider.provider_id)

        try:
            fetch_result = provider.fetch_events(cursor)
        except Exception as e:
            print(json.dumps({
                'level': 'ERROR',
                'message': f'プロバイダー {provider.provider_id} フェッチエラー',
                'error': str(e),
            }))
            continue

        for raw_event in fetch_result.events:
            try:
                result = service.ingest(raw_event)
                if result.action == 'created':
                    total_created += 1
                elif result.action == 'updated':
                    total_updated += 1
                else:
                    total_skipped += 1
            except Exception as e:
                print(json.dumps({
                    'level': 'ERROR',
                    'message': '取り込みエラー',
                    'sourceEventId': raw_event.source_event_id,
                    'error': str(e),
                }))

        if fetch_result.next_cursor:
            _save_cursor(cursor_table, provider.provider_id, fetch_result.next_cursor)

    return {
        'statusCode': 200,
        'body': {
            'created': total_created,
            'updated': total_updated,
            'skipped': total_skipped,
        },
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
    """DynamoDBにカーソルを保存（楽観的ロック付き）"""
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
