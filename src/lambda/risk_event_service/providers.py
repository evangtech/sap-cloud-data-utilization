"""リスクイベントプロバイダーインターフェースとP2PQuake実装"""
from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass, field
from typing import Protocol

from . import RawRiskEvent


@dataclass
class ProviderCursor:
    """プロバイダー状態管理（datetimeだけでは不十分 — カーソルベース）"""
    last_source_event_id: str | None = None
    last_updated_at: str | None = None
    provider_specific: dict = field(default_factory=dict)


@dataclass
class FetchResult:
    """プロバイダーフェッチ結果"""
    events: list[RawRiskEvent]
    next_cursor: ProviderCursor | None = None


class RiskEventProvider(Protocol):
    """リスクイベントプロバイダー契約"""
    provider_id: str

    def fetch_events(self, cursor: ProviderCursor) -> FetchResult: ...


class P2PQuakeProvider:
    """P2PQuake APIプロバイダー（日本の地震情報）"""
    provider_id = 'p2pquake'

    def fetch_events(self, cursor: ProviderCursor) -> FetchResult:
        """P2PQuake APIから地震イベントを取得"""
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
            # カーソル位置まで到達したら停止
            if eq_id == cursor.last_source_event_id:
                break

            hypo = eq.get('earthquake', {}).get('hypocenter', {})
            lat = hypo.get('latitude', 0)
            lon = hypo.get('longitude', 0)
            mag = hypo.get('magnitude', 0)
            depth = hypo.get('depth', 0)
            name = hypo.get('name', '不明')
            max_scale = eq.get('earthquake', {}).get('maxScale', 0)

            # 震度3以上のみ取り込み
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
                description=(
                    f'震源: {name}, マグニチュード: {mag}, '
                    f'深さ: {depth}km, 最大震度: {max_scale // 10}'
                ),
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
            last_updated_at=(
                events[0].start_date if events else cursor.last_updated_at
            ),
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
