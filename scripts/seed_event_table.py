#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DynamoDB EventTable にサンプルリスクイベントを投入するスクリプト

使い方:
  AWS_PROFILE=AdministratorAccess-454953018734 python3 scripts/seed_event_table.py
"""
import os
import uuid
import boto3
from datetime import datetime, timedelta, timezone

TABLE_NAME = os.environ.get("EVENT_TABLE_NAME", "event-table-dev")
REGION = os.environ.get("AWS_REGION", "ap-northeast-1")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)

JST = timezone(timedelta(hours=9))
NOW = datetime.now(JST)


def ts(days_ago: int = 0, hours_ago: int = 0) -> str:
    """ISO 8601 タイムスタンプ生成"""
    return (NOW - timedelta(days=days_ago, hours=hours_ago)).isoformat()


EVENTS = [
    # ── 地震 ──
    {
        "event_id": "EVT-EQ-001",
        "status": "CONFIRMED",
        "category_id": "earthquake",
        "category_name": "地震",
        "summary": "台湾花蓮沖 M6.8 — TSMCファブ3棟が一時停止。5nmロジック半導体の供給遅延リスク。",
        "risk_level": 5,
        "final_confidence": 95,
        "source_type": "JMA_API",
        "related_nodes": [
            {"id": "SUP001", "name": "TSMC", "node_type": "supplier",
             "impact_summary": "ファブ停止: 5nm 生産ライン 72時間停止見込み", "relevance_score": 98},
            {"id": "PLT001", "name": "東京本社工場", "node_type": "plant",
             "impact_summary": "MAT001 在庫 14日分 → 納入遅延の可能性", "relevance_score": 85},
            {"id": "PLT006", "name": "仙台通信機器工場", "node_type": "plant",
             "impact_summary": "5G基地局モジュール生産に影響", "relevance_score": 80},
        ],
        "fact_sources": [
            {"source": "JMA P2P地震情報", "data_type": "earthquake", "matched_text": "M6.8 花蓮県沖 深さ15km", "score_added": 40},
            {"source": "Reuters", "data_type": "news", "matched_text": "TSMC halts production at 3 fabs", "score_added": 35},
            {"source": "Neptune KG", "data_type": "graph_traversal", "matched_text": "TSMC → MAT001 → PRD001,PRD003,PRD005", "score_added": 20},
        ],
        "created_at": ts(days_ago=2),
        "updated_at": ts(days_ago=1),
    },
    # ── 関税 ──
    {
        "event_id": "EVT-TF-001",
        "status": "CONFIRMED",
        "category_id": "geopolitics",
        "category_name": "地政学",
        "summary": "米国 Section 301 対中追加関税: 半導体 25%→35%、バッテリー 25%→50% に引上げ (2026/7/1 施行)",
        "risk_level": 4,
        "final_confidence": 92,
        "source_type": "RSS",
        "related_nodes": [
            {"id": "SUP005", "name": "BYD Electronics", "node_type": "supplier",
             "impact_summary": "バッテリーセル対米輸出コスト +50%", "relevance_score": 95},
            {"id": "SUP106", "name": "CATL", "node_type": "supplier",
             "impact_summary": "EVバッテリーモジュール原価上昇", "relevance_score": 90},
            {"id": "CUS007", "name": "Tesla Inc.", "node_type": "customer",
             "impact_summary": "PRD008 調達コスト ¥1.2億増/年", "relevance_score": 88},
        ],
        "fact_sources": [
            {"source": "USTR Federal Register", "data_type": "regulation", "matched_text": "Section 301 Tariff Modification", "score_added": 45},
            {"source": "Bloomberg", "data_type": "news", "matched_text": "US to raise China tariffs on semiconductors, batteries", "score_added": 30},
            {"source": "Neptune KG", "data_type": "graph_traversal", "matched_text": "HS:8507.60 TARIFF_APPLIES CN→US 25%→50%", "score_added": 17},
        ],
        "created_at": ts(days_ago=5),
        "updated_at": ts(days_ago=3),
    },
    # ── 制裁 ──
    {
        "event_id": "EVT-SN-001",
        "status": "CONFIRMED",
        "category_id": "geopolitics",
        "category_name": "地政学",
        "summary": "OFAC、ロシア Norilsk Nickel を SDN リストに追加 — ニッケル・銅の調達先見直し必要",
        "risk_level": 5,
        "final_confidence": 99,
        "source_type": "OFAC_API",
        "related_nodes": [
            {"id": "SUP109", "name": "MMC Norilsk Nickel", "node_type": "supplier",
             "impact_summary": "LISTED: 全取引禁止。銅線ハーネス供給停止", "relevance_score": 100},
            {"id": "PLT003", "name": "名古屋EV工場", "node_type": "plant",
             "impact_summary": "PRD002 EV駆動ユニット — 銅線ハーネス代替調達必要", "relevance_score": 92},
        ],
        "fact_sources": [
            {"source": "OFAC SDN List Update", "data_type": "sanction", "matched_text": "NORILSK NICKEL added to SDN", "score_added": 50},
            {"source": "Neptune KG", "data_type": "graph_traversal", "matched_text": "SUP109 SUPPLIES MAT013 → PRD002,PRD008", "score_added": 30},
        ],
        "created_at": ts(days_ago=1),
        "updated_at": ts(hours_ago=6),
    },
    # ── 洪水 ──
    {
        "event_id": "EVT-FL-001",
        "status": "PENDING",
        "category_id": "flood",
        "category_name": "洪水",
        "summary": "タイ中部洪水 — バンコク工業団地が浸水リスク。Thai Summit / Flex / LG Chem 倉庫に影響の可能性",
        "risk_level": 3,
        "final_confidence": 68,
        "source_type": "RSS",
        "related_nodes": [
            {"id": "PLT008", "name": "バンコク組立工場", "node_type": "plant",
             "impact_summary": "工業団地浸水の場合 2-4週間停止", "relevance_score": 75},
            {"id": "SUP012", "name": "Thai Summit Group", "node_type": "supplier",
             "impact_summary": "筐体・ダイキャスト供給遅延リスク", "relevance_score": 70},
        ],
        "fact_sources": [
            {"source": "Thai Meteorological Dept", "data_type": "weather", "matched_text": "Heavy rainfall warning: Central Thailand", "score_added": 25},
            {"source": "Reuters", "data_type": "news", "matched_text": "Bangkok industrial estates on flood alert", "score_added": 25},
        ],
        "created_at": ts(hours_ago=8),
        "updated_at": ts(hours_ago=4),
    },
    # ── 輸出規制 ──
    {
        "event_id": "EVT-EC-001",
        "status": "WATCHING",
        "category_id": "geopolitics",
        "category_name": "地政学",
        "summary": "中国 レアアース輸出管理強化を検討 — NdFeB磁石への輸出許可制導入の可能性",
        "risk_level": 4,
        "final_confidence": 55,
        "source_type": "RSS",
        "related_nodes": [
            {"id": "SUP102", "name": "Northern Rare Earth", "node_type": "supplier",
             "impact_summary": "レアアース磁石 輸出許可待ち発生の可能性", "relevance_score": 88},
            {"id": "PLT003", "name": "名古屋EV工場", "node_type": "plant",
             "impact_summary": "EV駆動モーター用NdFeB磁石の調達リスク", "relevance_score": 78},
        ],
        "fact_sources": [
            {"source": "Global Times", "data_type": "news", "matched_text": "China considers rare earth export controls", "score_added": 20},
            {"source": "Neptune KG", "data_type": "graph_traversal", "matched_text": "SUP102 SUPPLIES MAT012 (NdFeB) → PRD002", "score_added": 15},
        ],
        "created_at": ts(days_ago=3),
        "updated_at": ts(days_ago=2),
    },
    # ── 品質問題 ──
    {
        "event_id": "EVT-QA-001",
        "status": "PENDING",
        "category_id": "labor",
        "category_name": "労働",
        "summary": "Samsung Semiconductor — HBM3e 歩留り低下 (65%→48%)。メモリ供給量 30% 減の見込み",
        "risk_level": 3,
        "final_confidence": 72,
        "source_type": "RSS",
        "related_nodes": [
            {"id": "SUP002", "name": "Samsung Semiconductor", "node_type": "supplier",
             "impact_summary": "HBM3e 出荷量 30% 減、リードタイム +14日", "relevance_score": 92},
            {"id": "PLT001", "name": "東京本社工場", "node_type": "plant",
             "impact_summary": "PRD005 サーバーCPUモジュール生産減速", "relevance_score": 78},
        ],
        "fact_sources": [
            {"source": "DigiTimes", "data_type": "news", "matched_text": "Samsung HBM3e yield drops to 48%", "score_added": 30},
            {"source": "Neptune KG", "data_type": "graph_traversal", "matched_text": "SUP002 SUPPLIES MAT002 → PRD005", "score_added": 20},
        ],
        "created_at": ts(days_ago=4),
        "updated_at": ts(days_ago=2),
    },
    # ── CBAM ──
    {
        "event_id": "EVT-CB-001",
        "status": "WATCHING",
        "category_id": "geopolitics",
        "category_name": "地政学",
        "summary": "EU CBAM 本格適用開始 (2026/1) — アルミ・バッテリー含む製品の炭素コスト増",
        "risk_level": 2,
        "final_confidence": 98,
        "source_type": "RSS",
        "related_nodes": [
            {"id": "CUS009", "name": "Volkswagen Group", "node_type": "customer",
             "impact_summary": "EU向けEVバッテリー輸出に炭素調整金が加算", "relevance_score": 82},
            {"id": "CUS008", "name": "Siemens Healthineers", "node_type": "customer",
             "impact_summary": "医療機器ユニットの対EU輸出コスト微増", "relevance_score": 60},
        ],
        "fact_sources": [
            {"source": "EU Official Journal", "data_type": "regulation", "matched_text": "CBAM Regulation (EU) 2023/956", "score_added": 45},
        ],
        "created_at": ts(days_ago=30),
        "updated_at": ts(days_ago=10),
    },
    # ── 却下済み ──
    {
        "event_id": "EVT-DM-001",
        "status": "DISMISSED",
        "category_id": "earthquake",
        "category_name": "地震",
        "summary": "宮古島沖 M4.2 — 影響範囲外と判定。サプライチェーンへの影響なし",
        "risk_level": 1,
        "final_confidence": 30,
        "source_type": "JMA_API",
        "related_nodes": [],
        "fact_sources": [
            {"source": "JMA P2P地震情報", "data_type": "earthquake", "matched_text": "M4.2 宮古島近海 深さ50km", "score_added": 10},
        ],
        "created_at": ts(days_ago=7),
        "updated_at": ts(days_ago=7),
        "reviewed_by": "n-pan@evangtech.co.jp",
    },
]


def serialize_item(event: dict) -> dict:
    """DynamoDB 書き込み用にネスト構造を JSON 文字列に変換"""
    import json as _json

    item = {}
    for k, v in event.items():
        if isinstance(v, list):
            item[k] = _json.dumps(v, ensure_ascii=False)
        elif v is None:
            continue
        else:
            item[k] = v
    return item


def main():
    print(f"EventTable seed: {TABLE_NAME} @ {REGION}")
    print(f"  {len(EVENTS)} イベントを投入...")

    for evt in EVENTS:
        item = serialize_item(evt)
        table.put_item(Item=item)
        status = evt["status"]
        level = evt["risk_level"]
        print(f"  [{status:10s}] ★{level} {evt['event_id']} — {evt['summary'][:50]}...")

    print(f"\n✅ {len(EVENTS)} 件投入完了")


if __name__ == "__main__":
    main()
