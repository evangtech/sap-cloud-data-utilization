# -*- coding: utf-8 -*-
"""
Neptune Analytics サプライチェーンKG データ投入スクリプト（v2 — World-level）

グローバルサプライチェーンを模擬:
  T2 Supplier (原材料) → T1 Supplier (部品加工) → Plant (組立工場) → Customer
  各ノードは Country に紐づき、Material は HSCode で分類、
  Country ペア間に TARIFF_APPLIES を持つ。

スキーマ:
  Node labels : Country, HSCode, Regulation, Supplier, Material, Product,
                Plant, Warehouse, Customer, RiskCategory, LogisticsHub, RiskEvent
  Edge labels : LOCATED_IN, CLASSIFIED_AS, TARIFF_APPLIES, SUBJECT_TO,
                SUPPLIES, HAS_COMPONENT, PRODUCED_AT, STORED_AT,
                SUPPLIES_TO, ORDERED_BY, ALTERNATIVE_TO,
                ROUTES_THROUGH, CATEGORIZED_AS, OCCURRED_IN,
                IMPACTS, DISRUPTS, RELATED_EVENT
"""
import json
import boto3
from typing import Any

# ── Neptune Analytics 設定 ──────────────────────────────────────────
NEPTUNE_GRAPH_ID = "g-844qqbri1a"
NEPTUNE_REGION = "us-west-2"

neptune_client = boto3.client("neptune-graph", region_name=NEPTUNE_REGION)


def execute_query(query: str) -> dict[str, Any]:
    """Neptune Analytics でクエリを実行"""
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
        print(f"    クエリ: {query[:200]}...")
        return {"error": str(e)}


def clear_existing_data() -> None:
    print("既存データを削除中...")
    execute_query("MATCH (n) DETACH DELETE n")
    print("  完了")


# ════════════════════════════════════════════════════════════════════
# 1. Country（国マスタ）
# ════════════════════════════════════════════════════════════════════
def create_countries() -> None:
    print("Country を作成中...")
    countries = [
        # code, name, region, risk_level(0-100), sanction_regime, exchange_rate_jpy, lat, lon
        ("JP", "日本", "East Asia", 5, "NONE", 1.0, 36.2048, 138.2529),
        ("CN", "中国", "East Asia", 55, "PARTIAL", 0.0493, 35.8617, 104.1954),
        ("US", "アメリカ", "North America", 10, "NONE", 0.0067, 37.0902, -95.7129),
        ("TW", "台湾", "East Asia", 45, "NONE", 0.0046, 23.6978, 120.9605),
        ("KR", "韓国", "East Asia", 15, "NONE", 0.1096, 35.9078, 127.7669),
        ("DE", "ドイツ", "Europe", 8, "NONE", 0.0062, 51.1657, 10.4515),
        ("VN", "ベトナム", "Southeast Asia", 25, "NONE", 0.0059, 14.0583, 108.2772),
        ("TH", "タイ", "Southeast Asia", 20, "NONE", 0.0042, 15.8700, 100.9925),
        ("MY", "マレーシア", "Southeast Asia", 18, "NONE", 0.0322, 4.2105, 101.9758),
        ("IN", "インド", "South Asia", 30, "NONE", 0.0018, 20.5937, 78.9629),
        ("MX", "メキシコ", "North America", 35, "NONE", 0.0086, 23.6345, -102.5528),
        ("AU", "オーストラリア", "Oceania", 7, "NONE", 0.0098, -25.2744, 133.7751),
        ("RU", "ロシア", "Europe/Asia", 90, "FULL", 0.0016, 61.5240, 105.3188),
        ("BR", "ブラジル", "South America", 32, "NONE", 0.0028, -14.2350, -51.9253),
        ("SG", "シンガポール", "Southeast Asia", 5, "NONE", 0.1117, 1.3521, 103.8198),
        ("PH", "フィリピン", "Southeast Asia", 28, "NONE", 0.0026, 12.8797, 121.7740),
        ("ID", "インドネシア", "Southeast Asia", 22, "NONE", 0.000096, -0.7893, 113.9213),
        # v2追加
        ("AE", "アラブ首長国連邦", "Middle East", 20, "NONE", 0.0407, 23.4241, 53.8478),
    ]
    for code, name, region, risk, sanction, fx, lat, lon in countries:
        execute_query(f"""
        CREATE (:Country {{
            code: '{code}', name: '{name}', region: '{region}',
            geopolitical_risk: {risk}, sanction_regime: '{sanction}',
            exchange_rate_jpy: {fx},
            lat: {lat}, lon: {lon}
        }})""")
    print(f"  {len(countries)} 件")


# ════════════════════════════════════════════════════════════════════
# 2. HSCode（関税分類）
# ════════════════════════════════════════════════════════════════════
def create_hscodes() -> None:
    print("HSCode を作成中...")
    hscodes = [
        # hs_code, description, chapter, heading
        ("8542.31", "半導体IC（プロセッサ・コントローラ）", "85", "8542"),
        ("8542.32", "半導体IC（メモリ）", "85", "8542"),
        ("8541.40", "半導体デバイス（LED含む）", "85", "8541"),
        ("8534.00", "プリント基板", "85", "8534"),
        ("9013.80", "液晶デバイス・ディスプレイ", "90", "9013"),
        ("8507.60", "リチウムイオン蓄電池", "85", "8507"),
        ("8503.00", "電動機・発電機部品", "85", "8503"),
        ("7601.10", "アルミニウム地金", "76", "7601"),
        ("2804.61", "シリコン（純度99.99%以上）", "28", "2804"),
        ("3920.62", "ポリカーボネートシート", "39", "3920"),
        ("8708.99", "自動車部品（その他）", "87", "8708"),
        ("2612.10", "レアアース鉱石", "26", "2612"),
        ("7408.11", "精製銅線", "74", "7408"),
        ("8544.49", "電気ケーブル・コネクタ", "85", "8544"),
        # v2追加
        ("2812.90", "その他ハロゲン化物（NF3含む）", "28", "2812"),
    ]
    for code, desc, chapter, heading in hscodes:
        execute_query(f"""
        CREATE (:HSCode {{
            code: '{code}', description: '{desc}',
            chapter: '{chapter}', heading: '{heading}'
        }})""")
    print(f"  {len(hscodes)} 件")


# ════════════════════════════════════════════════════════════════════
# 3. Regulation（規制マスタ）
# ════════════════════════════════════════════════════════════════════
def create_regulations() -> None:
    print("Regulation を作成中...")
    regulations = [
        ("REG001", "CHIPS and Science Act", "EXPORT_CONTROL", "2022-08-09", "US"),
        ("REG002", "EU CBAM（炭素国境調整メカニズム）", "TARIFF", "2026-01-01", "DE"),
        ("REG003", "OFAC SDN List", "SANCTION", "2001-09-24", "US"),
        ("REG004", "輸出貿易管理令 別表第一", "EXPORT_CONTROL", "1949-12-01", "JP"),
        ("REG005", "中国輸出管理法", "EXPORT_CONTROL", "2020-12-01", "CN"),
    ]
    for rid, name, rtype, effective, country in regulations:
        execute_query(f"""
        CREATE (:Regulation {{
            id: '{rid}', name: '{name}', type: '{rtype}',
            effective_date: '{effective}', issuing_country: '{country}'
        }})""")
    print(f"  {len(regulations)} 件")


# ════════════════════════════════════════════════════════════════════
# 4. Supplier（グローバルサプライヤー）
# ════════════════════════════════════════════════════════════════════
def create_suppliers() -> None:
    print("Supplier を作成中...")
    suppliers = [
        # id, name, country_code, region_detail, credit, quality, lead_time, sanction_status, lat, lon, tier
        # ── T1（部品加工・直接供給） ──
        ("SUP001", "TSMC", "TW", "新竹市", 92, 95, 28, "CLEAR", 24.7869, 120.9968, "T1"),
        ("SUP002", "Samsung Semiconductor", "KR", "華城市", 90, 93, 21, "CLEAR", 37.1988, 126.8312, "T1"),
        ("SUP003", "Infineon Technologies", "DE", "ノイビーベルク", 88, 91, 35, "CLEAR", 48.0812, 11.4633, "T1"),
        ("SUP004", "Foxconn (Hon Hai)", "TW", "新北市", 85, 82, 14, "CLEAR", 25.0169, 121.4628, "T1"),
        ("SUP005", "BYD Electronics", "CN", "深圳市", 78, 80, 18, "WATCH", 22.5431, 114.0579, "T1"),
        ("SUP006", "Murata Manufacturing", "JP", "京都府長岡京市", 94, 96, 10, "CLEAR", 34.9265, 135.6959, "T1"),
        ("SUP007", "TDK Corporation", "JP", "東京都中央区", 91, 93, 12, "CLEAR", 35.6762, 139.7696, "T1"),
        ("SUP008", "Texas Instruments", "US", "ダラス", 89, 90, 30, "CLEAR", 32.7767, -96.7970, "T1"),
        ("SUP009", "LG Chem", "KR", "大田広域市", 86, 88, 25, "CLEAR", 36.3504, 127.3845, "T1"),
        ("SUP010", "Flex Ltd", "SG", "シンガポール", 82, 84, 20, "CLEAR", 1.3437, 103.7533, "T1"),
        ("SUP011", "Vingroup (VinFast)", "VN", "ハイフォン", 70, 72, 22, "CLEAR", 20.8449, 106.6881, "T1"),
        ("SUP012", "Thai Summit Group", "TH", "サムットプラカーン", 75, 78, 18, "CLEAR", 13.5990, 100.5968, "T1"),
        ("SUP013", "Nemak (Auto Parts)", "MX", "モンテレイ", 77, 80, 28, "CLEAR", 25.6866, -100.3161, "T1"),
        # ── T2（原材料・上流） ──
        ("SUP101", "Jiangxi Copper", "CN", "鷹潭市", 72, 75, 35, "WATCH", 28.2602, 117.0035, "T2"),
        ("SUP102", "Northern Rare Earth", "CN", "包頭市", 65, 68, 40, "WATCH", 40.6571, 109.8401, "T2"),
        ("SUP103", "Shin-Etsu Chemical", "JP", "東京都千代田区", 96, 97, 14, "CLEAR", 35.6950, 139.7656, "T2"),
        ("SUP104", "Wacker Chemie", "DE", "ミュンヘン", 90, 92, 30, "CLEAR", 48.1351, 11.5820, "T2"),
        ("SUP105", "Alcoa Corporation", "US", "ピッツバーグ", 84, 86, 28, "CLEAR", 40.4406, -79.9959, "T2"),
        ("SUP106", "CATL", "CN", "寧徳市", 80, 83, 25, "CLEAR", 26.6617, 119.5480, "T2"),
        ("SUP107", "Hindalco (Novelis)", "IN", "ムンバイ", 73, 76, 35, "CLEAR", 19.0760, 72.8777, "T2"),
        ("SUP108", "Vale S.A.", "BR", "リオデジャネイロ", 82, 78, 42, "CLEAR", -22.9068, -43.1729, "T2"),
        ("SUP109", "MMC Norilsk Nickel", "RU", "ノリリスク", 60, 70, 50, "LISTED", 69.3558, 88.1893, "T2"),
        ("SUP110", "PT Aneka Tambang", "ID", "ジャカルタ", 68, 71, 38, "CLEAR", -6.2088, 106.8456, "T2"),
        # v2追加
        ("SUP111", "関東電化工業", "JP", "群馬県渋川市", 90, 85, 7, "CLEAR", 36.4900, 139.0000, "T2"),
        ("SUP112", "日本製鉄", "JP", "北海道室蘭市", 88, 90, 14, "CLEAR", 42.3200, 140.9700, "T2"),
        ("SUP113", "Rapidus", "JP", "北海道千歳市", 75, 80, 21, "CLEAR", 43.0700, 141.3500, "T1"),
    ]
    for sid, name, cc, region, credit, quality, lt, sanction, lat, lon, tier in suppliers:
        safe_name = name.replace("'", "\\'")
        execute_query(f"""
        CREATE (:Supplier {{
            id: '{sid}', name: '{safe_name}', country_code: '{cc}',
            region: '{region}', credit_score: {credit}, quality_score: {quality},
            lead_time_days: {lt}, sanction_status: '{sanction}',
            lat: {lat}, lon: {lon}, tier: '{tier}', status: 'active'
        }})""")
    print(f"  {len(suppliers)} 件")


# ════════════════════════════════════════════════════════════════════
# 5. Material（品目/部材）
# ════════════════════════════════════════════════════════════════════
def create_materials() -> None:
    print("Material を作成中...")
    materials = [
        # id, description, group, weight, w_unit, origin, hs_code, unit_price, currency, annual_vol
        ("MAT001", "先端ロジック半導体 (5nm)", "半導体", 0.002, "kg", "TW", "8542.31", 45.00, "USD", 2000000),
        ("MAT002", "HBM3e メモリ", "半導体", 0.003, "kg", "KR", "8542.32", 38.00, "USD", 1500000),
        ("MAT003", "パワー半導体 (SiC MOSFET)", "半導体", 0.005, "kg", "DE", "8541.40", 12.50, "EUR", 800000),
        ("MAT004", "多層プリント基板 (HDI)", "基板", 0.08, "kg", "TW", "8534.00", 8.20, "USD", 3000000),
        ("MAT005", "有機ELディスプレイパネル", "ディスプレイ", 0.12, "kg", "KR", "9013.80", 65.00, "USD", 500000),
        ("MAT006", "リチウムイオンバッテリーセル", "電池", 0.85, "kg", "CN", "8507.60", 28.00, "USD", 1200000),
        ("MAT007", "EV駆動モーター部品", "モーター", 3.50, "kg", "JP", "8503.00", 180.00, "JPY", 400000),
        ("MAT008", "アルミニウム合金板", "金属", 2.70, "kg", "AU", "7601.10", 3200.00, "JPY", 600000),
        ("MAT009", "高純度シリコンウェハー", "半導体原料", 0.18, "kg", "JP", "2804.61", 320.00, "USD", 900000),
        ("MAT010", "ポリカーボネート筐体", "樹脂", 0.35, "kg", "TH", "3920.62", 4.50, "USD", 2500000),
        ("MAT011", "アルミダイキャスト (車体部品)", "金属", 8.50, "kg", "MX", "8708.99", 35.00, "USD", 350000),
        ("MAT012", "レアアース磁石 (NdFeB)", "素材", 0.05, "kg", "CN", "2612.10", 85.00, "USD", 200000),
        ("MAT013", "精製銅線ハーネス", "金属", 0.45, "kg", "IN", "7408.11", 12.00, "USD", 1800000),
        ("MAT014", "高速コネクタモジュール", "電子部品", 0.02, "kg", "JP", "8544.49", 6.80, "USD", 5000000),
        ("MAT015", "車載カメラモジュール", "電子部品", 0.08, "kg", "VN", "9013.80", 22.00, "USD", 600000),
        # v2追加
        ("MAT016", "三フッ化窒素 (NF3) 半導体プロセスガス", "プロセスガス", 0.01, "kg", "JP", "2812.90", 850.00, "USD", 500000),
    ]
    for mid, desc, grp, w, wu, origin, hs, price, cur, vol in materials:
        safe_desc = desc.replace("'", "\\'")
        execute_query(f"""
        CREATE (:Material {{
            id: '{mid}', description: '{safe_desc}', material_group: '{grp}',
            weight: {w}, weight_unit: '{wu}', origin_country: '{origin}',
            hs_code: '{hs}', unit_price: {price}, currency: '{cur}',
            annual_volume: {vol}
        }})""")
    print(f"  {len(materials)} 件")


# ════════════════════════════════════════════════════════════════════
# 6. Product（完成品）
# ════════════════════════════════════════════════════════════════════
def create_products() -> None:
    print("Product を作成中...")
    products = [
        # id, description, group, cost_jpy, sales_jpy, margin
        ("PRD001", "5G基地局モジュール", "通信機器", 85000, 120000, 0.29),
        ("PRD002", "EV駆動ユニット", "自動車部品", 320000, 480000, 0.33),
        ("PRD003", "産業用ロボットコントローラ", "FA機器", 150000, 220000, 0.32),
        ("PRD004", "車載インフォテインメントシステム", "自動車部品", 45000, 68000, 0.34),
        ("PRD005", "サーバー用CPUモジュール", "IT機器", 250000, 380000, 0.34),
        ("PRD006", "ポータブルバッテリーパック", "民生品", 18000, 32000, 0.44),
        ("PRD007", "医療用画像診断装置ユニット", "医療機器", 520000, 780000, 0.33),
        ("PRD008", "EV用バッテリーモジュール", "自動車部品", 280000, 420000, 0.33),
    ]
    for pid, desc, grp, cost, sales, margin in products:
        safe_desc = desc.replace("'", "\\'")
        execute_query(f"""
        CREATE (:Product {{
            id: '{pid}', description: '{safe_desc}', product_group: '{grp}',
            cost_estimate_jpy: {cost}, sales_price_jpy: {sales}, margin_rate: {margin}
        }})""")
    print(f"  {len(products)} 件")


# ════════════════════════════════════════════════════════════════════
# 7. Plant（拠点）
# ════════════════════════════════════════════════════════════════════
def create_plants() -> None:
    print("Plant を作成中...")
    plants = [
        # id, name, country, type, lat, lon, capacity
        ("PLT001", "東京本社工場", "JP", "FACTORY", 35.6762, 139.6503, 5000),
        ("PLT002", "大阪製造センター", "JP", "FACTORY", 34.6937, 135.5023, 4000),
        ("PLT003", "名古屋EV工場", "JP", "FACTORY", 35.1815, 136.9066, 3500),
        ("PLT004", "九州半導体工場", "JP", "FACTORY", 33.2490, 131.6127, 2000),
        ("PLT005", "広島精密工場", "JP", "FACTORY", 34.3853, 132.4553, 2500),
        ("PLT006", "仙台通信機器工場", "JP", "FACTORY", 38.2682, 140.8694, 3000),
        ("PLT007", "深圳組立工場", "CN", "FACTORY", 22.5431, 114.0579, 6000),
        ("PLT008", "バンコク組立工場", "TH", "FACTORY", 13.7563, 100.5018, 3500),
        ("PLT009", "グアダラハラ工場", "MX", "FACTORY", 20.6597, -103.3496, 2800),
        ("PLT010", "ハノイ組立工場", "VN", "FACTORY", 21.0278, 105.8342, 2200),
    ]
    for pid, name, cc, ptype, lat, lon, cap in plants:
        safe_name = name.replace("'", "\\'")
        execute_query(f"""
        CREATE (:Plant {{
            id: '{pid}', name: '{safe_name}', country_code: '{cc}',
            plant_type: '{ptype}', lat: {lat}, lon: {lon}, capacity: {cap},
            status: 'active'
        }})""")
    print(f"  {len(plants)} 件")


# ════════════════════════════════════════════════════════════════════
# 8. Warehouse（倉庫）
# ════════════════════════════════════════════════════════════════════
def create_warehouses() -> None:
    print("Warehouse を作成中...")
    warehouses = [
        ("WHS001", "東京中央倉庫", "JP", 35.6729, 139.8171, 10000),
        ("WHS002", "大阪港倉庫", "JP", 34.6500, 135.4300, 8000),
        ("WHS003", "名古屋物流倉庫", "JP", 35.1500, 136.8800, 6000),
        ("WHS004", "福岡配送センター", "JP", 33.6000, 130.4200, 5000),
        ("WHS005", "シンガポール物流ハブ", "SG", 1.2644, 103.8222, 12000),
        ("WHS006", "ロサンゼルス配送センター", "US", 33.9425, -118.2551, 9000),
    ]
    for wid, name, cc, lat, lon, cap in warehouses:
        safe_name = name.replace("'", "\\'")
        execute_query(f"""
        CREATE (:Warehouse {{
            id: '{wid}', name: '{safe_name}', country_code: '{cc}',
            lat: {lat}, lon: {lon}, capacity: {cap}, status: 'active'
        }})""")
    print(f"  {len(warehouses)} 件")


# ════════════════════════════════════════════════════════════════════
# 9. Customer（顧客）
# ════════════════════════════════════════════════════════════════════
def create_customers() -> None:
    print("Customer を作成中...")
    customers = [
        # id, name, industry, country, lat, lon
        ("CUS001", "トヨタ自動車", "自動車", "JP", 35.0844, 137.1531),
        ("CUS002", "ソニーグループ", "電子機器", "JP", 35.6195, 139.7414),
        ("CUS003", "パナソニック", "電子機器", "JP", 34.7872, 135.4382),
        ("CUS004", "デンソー", "自動車部品", "JP", 34.8833, 137.1167),
        ("CUS005", "三菱重工業", "産業機械", "JP", 35.4544, 139.6319),
        ("CUS006", "NTTドコモ", "通信", "JP", 35.6812, 139.7671),
        ("CUS007", "Tesla Inc.", "自動車", "US", 37.3947, -122.1500),
        ("CUS008", "Siemens Healthineers", "医療機器", "DE", 49.4521, 11.0767),
        ("CUS009", "Volkswagen Group", "自動車", "DE", 52.4227, 10.7865),
        ("CUS010", "Samsung Electronics", "電子機器", "KR", 37.2571, 127.0524),
    ]
    for cid, name, industry, cc, lat, lon in customers:
        safe_name = name.replace("'", "\\'")
        execute_query(f"""
        CREATE (:Customer {{
            id: '{cid}', name: '{safe_name}', industry: '{industry}',
            country_code: '{cc}', lat: {lat}, lon: {lon}
        }})""")
    print(f"  {len(customers)} 件")


# ════════════════════════════════════════════════════════════════════
# 10. エッジ: LOCATED_IN (Supplier/Plant/Warehouse → Country)
# ════════════════════════════════════════════════════════════════════
def create_located_in_edges() -> None:
    print("LOCATED_IN エッジを作成中...")
    # Supplier → Country
    execute_query("""
    MATCH (s:Supplier), (c:Country)
    WHERE s.country_code = c.code
    CREATE (s)-[:LOCATED_IN]->(c)
    """)
    # Plant → Country
    execute_query("""
    MATCH (p:Plant), (c:Country)
    WHERE p.country_code = c.code
    CREATE (p)-[:LOCATED_IN]->(c)
    """)
    # Warehouse → Country
    execute_query("""
    MATCH (w:Warehouse), (c:Country)
    WHERE w.country_code = c.code
    CREATE (w)-[:LOCATED_IN]->(c)
    """)
    # Customer → Country
    execute_query("""
    MATCH (cu:Customer), (c:Country)
    WHERE cu.country_code = c.code
    CREATE (cu)-[:LOCATED_IN]->(c)
    """)
    print("  完了")


# ════════════════════════════════════════════════════════════════════
# 11. エッジ: CLASSIFIED_AS (Material → HSCode)
# ════════════════════════════════════════════════════════════════════
def create_classified_as_edges() -> None:
    print("CLASSIFIED_AS エッジを作成中...")
    execute_query("""
    MATCH (m:Material), (h:HSCode)
    WHERE m.hs_code = h.code
    CREATE (m)-[:CLASSIFIED_AS]->(h)
    """)
    print("  完了")


# ════════════════════════════════════════════════════════════════════
# 12. エッジ: TARIFF_APPLIES (HSCode → Country pair)
#     「この HSCode を origin_country から JP に輸入する際の関税率」
# ════════════════════════════════════════════════════════════════════
def create_tariff_edges() -> None:
    print("TARIFF_APPLIES エッジを作成中...")
    tariffs = [
        # hs_code, origin_country, importing_country, rate_pct, effective_date, tariff_type
        # 半導体 IC — ほとんど無税（ITA協定）だが中国→米国は追加関税
        ("8542.31", "TW", "JP", 0.0, "2024-01-01", "MFN"),
        ("8542.31", "KR", "JP", 0.0, "2024-01-01", "MFN"),
        ("8542.31", "CN", "JP", 0.0, "2024-01-01", "MFN"),
        ("8542.31", "CN", "US", 25.0, "2025-06-01", "SECTION301"),
        ("8542.31", "TW", "US", 0.0, "2024-01-01", "MFN"),
        ("8542.32", "KR", "JP", 0.0, "2024-01-01", "MFN"),
        ("8542.32", "CN", "US", 25.0, "2025-06-01", "SECTION301"),
        # バッテリー
        ("8507.60", "CN", "JP", 3.2, "2024-01-01", "MFN"),
        ("8507.60", "CN", "US", 25.0, "2025-08-01", "SECTION301"),
        ("8507.60", "KR", "JP", 0.0, "2024-01-01", "EPA"),
        # アルミ
        ("7601.10", "AU", "JP", 0.0, "2024-01-01", "EPA"),
        ("7601.10", "IN", "JP", 3.0, "2024-01-01", "MFN"),
        ("7601.10", "RU", "JP", 7.5, "2024-01-01", "RETALIATORY"),
        # 自動車部品
        ("8708.99", "MX", "JP", 0.0, "2024-01-01", "EPA"),
        ("8708.99", "CN", "JP", 3.5, "2024-01-01", "MFN"),
        ("8708.99", "MX", "US", 0.0, "2024-01-01", "USMCA"),
        ("8708.99", "CN", "US", 27.5, "2025-06-01", "SECTION301"),
        # レアアース
        ("2612.10", "CN", "JP", 0.0, "2024-01-01", "MFN"),
        ("2612.10", "CN", "US", 0.0, "2024-01-01", "MFN"),
        # ディスプレイ
        ("9013.80", "KR", "JP", 0.0, "2024-01-01", "EPA"),
        ("9013.80", "CN", "US", 7.5, "2025-06-01", "SECTION301"),
        # シリコン
        ("2804.61", "JP", "US", 0.0, "2024-01-01", "MFN"),
        ("2804.61", "DE", "JP", 0.0, "2024-01-01", "EPA"),
        # 銅線
        ("7408.11", "IN", "JP", 3.0, "2024-01-01", "MFN"),
        ("7408.11", "CN", "JP", 3.0, "2024-01-01", "MFN"),
    ]
    for hs, origin, importer, rate, eff, ttype in tariffs:
        execute_query(f"""
        MATCH (h:HSCode {{code: '{hs}'}}), (c:Country {{code: '{origin}'}})
        CREATE (h)-[:TARIFF_APPLIES {{
            importing_country: '{importer}',
            tariff_rate_pct: {rate}, effective_date: '{eff}',
            tariff_type: '{ttype}'
        }}]->(c)
        """)
    print(f"  {len(tariffs)} 件")


# ════════════════════════════════════════════════════════════════════
# 13. エッジ: SUBJECT_TO (HSCode/Material → Regulation)
# ════════════════════════════════════════════════════════════════════
def create_subject_to_edges() -> None:
    print("SUBJECT_TO エッジを作成中...")
    links = [
        # node_label, node_id, regulation_id
        ("HSCode", "8542.31", "REG001"),  # 先端半導体 → CHIPS Act
        ("HSCode", "8542.32", "REG001"),  # メモリ → CHIPS Act
        ("HSCode", "8541.40", "REG001"),  # 半導体デバイス → CHIPS Act
        ("HSCode", "8542.31", "REG004"),  # 先端半導体 → 輸出管理令
        ("HSCode", "8542.31", "REG005"),  # 先端半導体 → 中国輸出管理法
        ("HSCode", "7601.10", "REG002"),  # アルミ → EU CBAM
        ("HSCode", "8507.60", "REG002"),  # バッテリー → EU CBAM
    ]
    for label, nid, rid in links:
        execute_query(f"""
        MATCH (n:{label} {{{'code' if label == 'HSCode' else 'id'}: '{nid}'}}),
              (r:Regulation {{id: '{rid}'}})
        CREATE (n)-[:SUBJECT_TO]->(r)
        """)
    print(f"  {len(links)} 件")


# ════════════════════════════════════════════════════════════════════
# 14. エッジ: SUPPLIES (Supplier → Material)
# ════════════════════════════════════════════════════════════════════
def create_supplies_edges() -> None:
    print("SUPPLIES エッジを作成中...")
    supplies = [
        # supplier_id, material_id, is_primary
        ("SUP001", "MAT001", True),   # TSMC → 先端ロジック半導体
        ("SUP002", "MAT002", True),   # Samsung → HBM3e
        ("SUP002", "MAT005", True),   # Samsung → 有機ELディスプレイ
        ("SUP003", "MAT003", True),   # Infineon → SiC MOSFET
        ("SUP004", "MAT004", True),   # Foxconn → HDI基板
        ("SUP005", "MAT006", False),  # BYD → バッテリー（代替）
        ("SUP006", "MAT014", True),   # Murata → コネクタ
        ("SUP006", "MAT007", False),  # Murata → モーター部品（副次）
        ("SUP007", "MAT014", False),  # TDK → コネクタ（代替）
        ("SUP008", "MAT003", False),  # TI → SiC MOSFET（代替）
        ("SUP009", "MAT006", True),   # LG Chem → バッテリー
        ("SUP010", "MAT004", False),  # Flex → HDI基板（代替）
        ("SUP010", "MAT010", True),   # Flex → 筐体（委託先経由）
        ("SUP011", "MAT015", True),   # VinFast系 → 車載カメラ
        ("SUP012", "MAT010", False),  # Thai Summit → 筐体（代替）
        ("SUP012", "MAT011", False),  # Thai Summit → ダイキャスト（代替）
        ("SUP013", "MAT011", True),   # Nemak → アルミダイキャスト
        # T2
        ("SUP101", "MAT013", True),   # Jiangxi Copper → 銅線
        ("SUP102", "MAT012", True),   # Northern RE → レアアース
        ("SUP103", "MAT009", True),   # 信越化学 → シリコンウェハー
        ("SUP104", "MAT009", False),  # Wacker → シリコン（代替）
        ("SUP105", "MAT008", True),   # Alcoa → アルミ地金
        ("SUP106", "MAT006", False),  # CATL → バッテリー（代替2）
        ("SUP107", "MAT008", False),  # Hindalco → アルミ地金（代替）
        ("SUP108", "MAT012", False),  # Vale → レアアース（代替）
        ("SUP109", "MAT013", False),  # Norilsk → 銅（制裁リスク）
        ("SUP110", "MAT013", False),  # Aneka Tambang → 銅（代替）
        # v2追加
        ("SUP111", "MAT016", True),   # 関東電化 → NF3
        ("SUP112", "MAT008", False),  # 日本製鉄 → アルミ合金板（鉄鋼代替供給）
    ]
    for sid, mid, primary in supplies:
        execute_query(f"""
        MATCH (s:Supplier {{id: '{sid}'}}), (m:Material {{id: '{mid}'}})
        CREATE (s)-[:SUPPLIES {{is_primary: {str(primary).lower()}}}]->(m)
        """)
    print(f"  {len(supplies)} 件")


# ════════════════════════════════════════════════════════════════════
# 15. エッジ: HAS_COMPONENT (Product → Material) — BOM
# ════════════════════════════════════════════════════════════════════
def create_bom_edges() -> None:
    print("HAS_COMPONENT (BOM) エッジを作成中...")
    bom = [
        # product_id, material_id, quantity, bom_level
        # PRD001 5G基地局: 半導体IC + 基板 + コネクタ
        ("PRD001", "MAT001", 4, 1),
        ("PRD001", "MAT004", 2, 1),
        ("PRD001", "MAT014", 12, 1),
        ("PRD001", "MAT010", 1, 2),
        # PRD002 EV駆動ユニット: モーター + パワー半導体 + レアアース + 銅線
        ("PRD002", "MAT007", 1, 1),
        ("PRD002", "MAT003", 6, 1),
        ("PRD002", "MAT012", 2, 2),
        ("PRD002", "MAT013", 8, 1),
        # PRD003 ロボットコントローラ: 半導体 + 基板 + コネクタ
        ("PRD003", "MAT001", 2, 1),
        ("PRD003", "MAT004", 1, 1),
        ("PRD003", "MAT014", 6, 1),
        ("PRD003", "MAT003", 4, 1),
        # PRD004 車載インフォテインメント: ディスプレイ + 半導体 + コネクタ
        ("PRD004", "MAT005", 1, 1),
        ("PRD004", "MAT001", 2, 1),
        ("PRD004", "MAT014", 8, 1),
        ("PRD004", "MAT010", 1, 2),
        # PRD005 サーバーCPUモジュール: 半導体 + メモリ + 基板 + コネクタ
        ("PRD005", "MAT001", 1, 1),
        ("PRD005", "MAT002", 8, 1),
        ("PRD005", "MAT004", 1, 1),
        ("PRD005", "MAT014", 16, 1),
        # PRD006 ポータブルバッテリー: バッテリーセル + 筐体
        ("PRD006", "MAT006", 6, 1),
        ("PRD006", "MAT010", 1, 1),
        ("PRD006", "MAT014", 2, 2),
        # PRD007 医療画像診断: 半導体 + ディスプレイ + コネクタ + 基板
        ("PRD007", "MAT001", 3, 1),
        ("PRD007", "MAT005", 1, 1),
        ("PRD007", "MAT004", 2, 1),
        ("PRD007", "MAT014", 10, 1),
        # PRD008 EVバッテリーモジュール: バッテリー + アルミ + 銅線
        ("PRD008", "MAT006", 12, 1),
        ("PRD008", "MAT008", 4, 1),
        ("PRD008", "MAT013", 6, 1),
        ("PRD008", "MAT014", 4, 2),
    ]
    for pid, mid, qty, level in bom:
        execute_query(f"""
        MATCH (p:Product {{id: '{pid}'}}), (m:Material {{id: '{mid}'}})
        CREATE (p)-[:HAS_COMPONENT {{quantity: {qty}, bom_level: {level}}}]->(m)
        """)
    print(f"  {len(bom)} 件")


# ════════════════════════════════════════════════════════════════════
# 16. エッジ: PRODUCED_AT (Product → Plant)
# ════════════════════════════════════════════════════════════════════
def create_produced_at_edges() -> None:
    print("PRODUCED_AT エッジを作成中...")
    produced = [
        ("PRD001", "PLT006"),  # 5G基地局 → 仙台
        ("PRD001", "PLT007"),  # 5G基地局 → 深圳（ dual source）
        ("PRD002", "PLT003"),  # EV駆動 → 名古屋
        ("PRD003", "PLT001"),  # ロボコン → 東京
        ("PRD003", "PLT005"),  # ロボコン → 広島
        ("PRD004", "PLT002"),  # インフォテ → 大阪
        ("PRD004", "PLT008"),  # インフォテ → バンコク
        ("PRD005", "PLT001"),  # サーバーCPU → 東京
        ("PRD006", "PLT008"),  # ポータブル電池 → バンコク
        ("PRD006", "PLT010"),  # ポータブル電池 → ハノイ
        ("PRD007", "PLT002"),  # 医療画像 → 大阪
        ("PRD008", "PLT003"),  # EVバッテリー → 名古屋
        ("PRD008", "PLT009"),  # EVバッテリー → グアダラハラ
    ]
    for pid, pltid in produced:
        execute_query(f"""
        MATCH (p:Product {{id: '{pid}'}}), (pl:Plant {{id: '{pltid}'}})
        CREATE (p)-[:PRODUCED_AT]->(pl)
        """)
    print(f"  {len(produced)} 件")


# ════════════════════════════════════════════════════════════════════
# 17. エッジ: SUPPLIES_TO (供給チェーンフロー)
# ════════════════════════════════════════════════════════════════════
def create_supply_chain_edges() -> None:
    print("SUPPLIES_TO エッジを作成中...")
    flows = [
        # T2 → T1
        ("Supplier", "SUP103", "Supplier", "SUP001"),  # 信越化学 → TSMC (ウェハー)
        ("Supplier", "SUP104", "Supplier", "SUP001"),  # Wacker → TSMC (ウェハー代替)
        ("Supplier", "SUP101", "Supplier", "SUP006"),  # Jiangxi Copper → Murata
        ("Supplier", "SUP102", "Supplier", "SUP007"),  # Northern RE → TDK
        ("Supplier", "SUP105", "Supplier", "SUP013"),  # Alcoa → Nemak
        ("Supplier", "SUP107", "Supplier", "SUP013"),  # Hindalco → Nemak(代替)
        ("Supplier", "SUP106", "Supplier", "SUP009"),  # CATL → LG Chem(セル供給)
        ("Supplier", "SUP108", "Supplier", "SUP003"),  # Vale → Infineon
        ("Supplier", "SUP110", "Supplier", "SUP004"),  # Aneka → Foxconn
        # T1 → Plant
        ("Supplier", "SUP001", "Plant", "PLT001"),  # TSMC → 東京
        ("Supplier", "SUP001", "Plant", "PLT006"),  # TSMC → 仙台
        ("Supplier", "SUP002", "Plant", "PLT001"),  # Samsung → 東京
        ("Supplier", "SUP002", "Plant", "PLT002"),  # Samsung → 大阪
        ("Supplier", "SUP003", "Plant", "PLT003"),  # Infineon → 名古屋
        ("Supplier", "SUP003", "Plant", "PLT005"),  # Infineon → 広島
        ("Supplier", "SUP004", "Plant", "PLT006"),  # Foxconn → 仙台
        ("Supplier", "SUP004", "Plant", "PLT007"),  # Foxconn → 深圳
        ("Supplier", "SUP005", "Plant", "PLT007"),  # BYD → 深圳
        ("Supplier", "SUP006", "Plant", "PLT001"),  # Murata → 東京
        ("Supplier", "SUP006", "Plant", "PLT002"),  # Murata → 大阪
        ("Supplier", "SUP007", "Plant", "PLT003"),  # TDK → 名古屋
        ("Supplier", "SUP008", "Plant", "PLT001"),  # TI → 東京
        ("Supplier", "SUP009", "Plant", "PLT003"),  # LG Chem → 名古屋
        ("Supplier", "SUP009", "Plant", "PLT008"),  # LG Chem → バンコク
        ("Supplier", "SUP010", "Plant", "PLT008"),  # Flex → バンコク
        ("Supplier", "SUP010", "Plant", "PLT010"),  # Flex → ハノイ
        ("Supplier", "SUP011", "Plant", "PLT010"),  # VinFast → ハノイ
        ("Supplier", "SUP012", "Plant", "PLT008"),  # Thai Summit → バンコク
        ("Supplier", "SUP013", "Plant", "PLT009"),  # Nemak → グアダラハラ
        ("Supplier", "SUP013", "Plant", "PLT003"),  # Nemak → 名古屋
        # Plant → Warehouse
        ("Plant", "PLT001", "Warehouse", "WHS001"),  # 東京工場 → 東京倉庫
        ("Plant", "PLT002", "Warehouse", "WHS002"),  # 大阪工場 → 大阪倉庫
        ("Plant", "PLT003", "Warehouse", "WHS003"),  # 名古屋 → 名古屋倉庫
        ("Plant", "PLT004", "Warehouse", "WHS004"),  # 九州 → 福岡倉庫
        ("Plant", "PLT006", "Warehouse", "WHS001"),  # 仙台 → 東京倉庫
        ("Plant", "PLT008", "Warehouse", "WHS005"),  # バンコク → SG倉庫
        ("Plant", "PLT009", "Warehouse", "WHS006"),  # グアダラハラ → LA倉庫
        ("Plant", "PLT010", "Warehouse", "WHS005"),  # ハノイ → SG倉庫
        # Warehouse/Plant → Customer
        ("Warehouse", "WHS001", "Customer", "CUS002"),  # 東京倉庫 → ソニー
        ("Warehouse", "WHS001", "Customer", "CUS005"),  # 東京倉庫 → 三菱重工
        ("Warehouse", "WHS001", "Customer", "CUS006"),  # 東京倉庫 → NTTドコモ
        ("Warehouse", "WHS002", "Customer", "CUS003"),  # 大阪倉庫 → パナソニック
        ("Warehouse", "WHS003", "Customer", "CUS001"),  # 名古屋倉庫 → トヨタ
        ("Warehouse", "WHS003", "Customer", "CUS004"),  # 名古屋倉庫 → デンソー
        ("Warehouse", "WHS005", "Customer", "CUS010"),  # SG倉庫 → Samsung
        ("Warehouse", "WHS006", "Customer", "CUS007"),  # LA倉庫 → Tesla
        # Plant → Customer（直送）
        ("Plant", "PLT002", "Customer", "CUS008"),  # 大阪 → Siemens(医療)
        ("Plant", "PLT003", "Customer", "CUS009"),  # 名古屋 → VW
        ("Plant", "PLT007", "Customer", "CUS010"),  # 深圳 → Samsung
        # v2追加 — NF3サプライチェーン + 鉄鋼サプライチェーン
        ("Supplier", "SUP111", "Supplier", "SUP001"),  # 関東電化 → TSMC (NF3供給)
        ("Supplier", "SUP111", "Supplier", "SUP002"),  # 関東電化 → Samsung
        ("Supplier", "SUP111", "Supplier", "SUP113"),  # 関東電化 → Rapidus
        ("Supplier", "SUP112", "Plant", "PLT003"),     # 日本製鉄 → 名古屋EV工場
        ("Supplier", "SUP112", "Plant", "PLT001"),     # 日本製鉄 → 東京本社工場
        ("Supplier", "SUP113", "Plant", "PLT001"),     # Rapidus → 東京 (次世代チップ)
    ]
    for from_label, from_id, to_label, to_id in flows:
        execute_query(f"""
        MATCH (a:{from_label} {{id: '{from_id}'}}), (b:{to_label} {{id: '{to_id}'}})
        CREATE (a)-[:SUPPLIES_TO]->(b)
        """)
    print(f"  {len(flows)} 件")


# ════════════════════════════════════════════════════════════════════
# 18. エッジ: ORDERED_BY (Product → Customer)
# ════════════════════════════════════════════════════════════════════
def create_ordered_by_edges() -> None:
    print("ORDERED_BY エッジを作成中...")
    orders = [
        # product_id, customer_id, annual_qty, unit_price_jpy
        ("PRD001", "CUS006", 5000, 120000),   # 5G基地局 → NTTドコモ
        ("PRD001", "CUS010", 3000, 115000),    # 5G基地局 → Samsung
        ("PRD002", "CUS001", 8000, 480000),    # EV駆動 → トヨタ
        ("PRD002", "CUS009", 4000, 475000),    # EV駆動 → VW
        ("PRD003", "CUS005", 2000, 220000),    # ロボコン → 三菱重工
        ("PRD003", "CUS003", 1500, 218000),    # ロボコン → パナソニック
        ("PRD004", "CUS001", 12000, 68000),    # インフォテ → トヨタ
        ("PRD004", "CUS004", 6000, 67000),     # インフォテ → デンソー
        ("PRD005", "CUS002", 3000, 380000),    # サーバーCPU → ソニー
        ("PRD006", "CUS002", 20000, 32000),    # ポータブル電池 → ソニー
        ("PRD006", "CUS003", 15000, 31500),    # ポータブル電池 → パナソニック
        ("PRD007", "CUS008", 500, 780000),     # 医療画像 → Siemens
        ("PRD008", "CUS001", 6000, 420000),    # EVバッテリー → トヨタ
        ("PRD008", "CUS007", 4000, 415000),    # EVバッテリー → Tesla
    ]
    for pid, cid, qty, price in orders:
        execute_query(f"""
        MATCH (p:Product {{id: '{pid}'}}), (c:Customer {{id: '{cid}'}})
        CREATE (p)-[:ORDERED_BY {{annual_order_qty: {qty}, unit_price_jpy: {price}}}]->(c)
        """)
    print(f"  {len(orders)} 件")


# ════════════════════════════════════════════════════════════════════
# 19. エッジ: ALTERNATIVE_TO (Supplier → Supplier)
# ════════════════════════════════════════════════════════════════════
def create_alternative_edges() -> None:
    print("ALTERNATIVE_TO エッジを作成中...")
    alternatives = [
        # current, alt, quality_diff, price_diff_pct, lead_time_diff_days, risk_score_diff
        ("SUP001", "SUP002", -2, +5, -7, +3),    # TSMC ↔ Samsung (半導体)
        ("SUP003", "SUP008", -1, -8, +5, -5),     # Infineon ↔ TI (パワー半導体)
        ("SUP004", "SUP010", -2, -3, +6, +2),     # Foxconn ↔ Flex (EMS)
        ("SUP009", "SUP005", -8, -15, -3, +20),   # LG Chem ↔ BYD (バッテリー)
        ("SUP009", "SUP106", -5, -12, 0, +15),    # LG Chem ↔ CATL (バッテリー)
        ("SUP006", "SUP007", -3, +2, +2, 0),      # Murata ↔ TDK (受動部品)
        ("SUP013", "SUP012", -2, -5, -10, +5),    # Nemak ↔ Thai Summit (ダイキャスト)
        ("SUP103", "SUP104", -5, +8, +16, -2),    # 信越化学 ↔ Wacker (シリコン)
        ("SUP105", "SUP107", -10, -12, +7, +8),   # Alcoa ↔ Hindalco (アルミ)
        ("SUP101", "SUP110", -4, -8, +3, +5),     # Jiangxi ↔ Aneka (銅)
        ("SUP102", "SUP108", -8, +5, +2, +15),    # Northern RE ↔ Vale (レアアース)
        ("SUP011", "SUP012", +6, +3, -4, -5),     # VinFast ↔ Thai Summit
    ]
    for cur, alt, qd, pd, ld, rd in alternatives:
        execute_query(f"""
        MATCH (c:Supplier {{id: '{cur}'}}), (a:Supplier {{id: '{alt}'}})
        CREATE (c)-[:ALTERNATIVE_TO {{
            quality_score_diff: {qd}, price_diff_pct: {pd},
            lead_time_diff_days: {ld}, risk_score_diff: {rd}
        }}]->(a)
        """)
        # 逆方向も作成
        execute_query(f"""
        MATCH (c:Supplier {{id: '{alt}'}}), (a:Supplier {{id: '{cur}'}})
        CREATE (c)-[:ALTERNATIVE_TO {{
            quality_score_diff: {-qd}, price_diff_pct: {-pd},
            lead_time_diff_days: {-ld}, risk_score_diff: {-rd}
        }}]->(a)
        """)
    print(f"  {len(alternatives)} 件（双方向）")


# ════════════════════════════════════════════════════════════════════
# 12. RiskCategory（リスクカテゴリ）
# ════════════════════════════════════════════════════════════════════
def create_risk_categories() -> None:
    print("RiskCategory を作成中...")
    categories = [
        # id, name, parentCategory, description, avgRecoveryDays
        # 自然災害
        ("RC-natural-earthquake", "地震", "natural_disaster",
         "地震による供給網への影響", 30),
        ("RC-natural-typhoon", "台風", "natural_disaster",
         "台風・暴風雨による供給網への影響", 14),
        ("RC-natural-flood", "洪水", "natural_disaster",
         "洪水・浸水による供給網への影響", 21),
        # 地政学的
        ("RC-geopolitical-sanction", "制裁措置", "geopolitical",
         "経済制裁による貿易制限", 180),
        ("RC-geopolitical-trade_restriction", "貿易規制", "geopolitical",
         "関税引上げ・輸出規制", 365),
        ("RC-geopolitical-conflict", "紛争", "geopolitical",
         "武力紛争・政情不安による供給網への影響", 90),
        # 運用上
        ("RC-operational-port_closure", "港湾閉鎖", "operational",
         "港湾の閉鎖・機能停止", 7),
        ("RC-operational-factory_incident", "工場事故", "operational",
         "工場での事故・火災", 45),
        ("RC-operational-pandemic", "パンデミック", "operational",
         "感染症流行による操業停止", 60),
        # 財務
        ("RC-financial-bankruptcy", "サプライヤー倒産", "financial",
         "サプライヤーの経営破綻", 120),
        ("RC-financial-credit", "信用リスク", "financial",
         "サプライヤーの信用悪化", 90),
        ("RC-financial-fx", "為替変動", "financial",
         "急激な為替レート変動", 30),
    ]
    for cid, name, parent, desc, avg_days in categories:
        safe_desc = desc.replace("'", "\\'")
        execute_query(f"""
        CREATE (:RiskCategory {{
            id: '{cid}', name: '{name}', parentCategory: '{parent}',
            description: '{safe_desc}', avgRecoveryDays: {avg_days}
        }})""")
    print(f"  {len(categories)} 件")


# ════════════════════════════════════════════════════════════════════
# 13. LogisticsHub（物流拠点）
# ════════════════════════════════════════════════════════════════════
def create_logistics_hubs() -> None:
    print("LogisticsHub を作成中...")
    hubs = [
        # id, name, type, country_code, lat, lon, capacity, status
        ("LH-tokyo-port", "東京港", "port", "JP",
         35.6220, 139.7753, "4500000 TEU/年", "operational"),
        ("LH-yokohama-port", "横浜港", "port", "JP",
         35.4437, 139.6500, "2900000 TEU/年", "operational"),
        ("LH-kobe-port", "神戸港", "port", "JP",
         34.6600, 135.2100, "2800000 TEU/年", "operational"),
        ("LH-shanghai-port", "上海港", "port", "CN",
         31.3600, 121.6100, "47000000 TEU/年", "operational"),
        ("LH-kaohsiung-port", "高雄港", "port", "TW",
         22.6100, 120.2800, "9900000 TEU/年", "operational"),
        ("LH-singapore-port", "シンガポール港", "port", "SG",
         1.2600, 103.8400, "37000000 TEU/年", "operational"),
        ("LH-la-port", "ロサンゼルス港", "port", "US",
         33.7400, -118.2700, "9600000 TEU/年", "operational"),
        ("LH-rotterdam-port", "ロッテルダム港", "port", "DE",
         51.9500, 4.1300, "14500000 TEU/年", "operational"),
        ("LH-narita-airport", "成田国際空港", "airport", "JP",
         35.7648, 140.3864, "2500000 t/年", "operational"),
        ("LH-kansai-airport", "関西国際空港", "airport", "JP",
         34.4320, 135.2304, "800000 t/年", "operational"),
        ("LH-laem-chabang-port", "レムチャバン港", "port", "TH",
         13.0700, 100.8800, "8000000 TEU/年", "operational"),
        ("LH-haiphong-port", "ハイフォン港", "port", "VN",
         20.8500, 106.6800, "5000000 TEU/年", "operational"),
        # v2追加
        ("LH-hachinohe-port", "八戸港", "port", "JP",
         40.5300, 141.5300, "500000 TEU/年", "operational"),
        ("LH-hormuz-strait", "ホルムズ海峡", "port", "AE",
         26.5600, 56.2500, "21000000 bbl/日", "disrupted"),
    ]
    for hid, name, htype, cc, lat, lon, cap, status in hubs:
        safe_name = name.replace("'", "\\'")
        execute_query(f"""
        CREATE (:LogisticsHub {{
            id: '{hid}', name: '{safe_name}', type: '{htype}',
            country_code: '{cc}', lat: {lat}, lon: {lon},
            capacity: '{cap}', status: '{status}'
        }})""")
    print(f"  {len(hubs)} 件")


# ════════════════════════════════════════════════════════════════════
# 14. LogisticsHub — LOCATED_IN エッジ
# ════════════════════════════════════════════════════════════════════
def create_logistics_hub_edges() -> None:
    print("LogisticsHub LOCATED_IN エッジを作成中...")
    hub_countries = [
        ("LH-tokyo-port", "JP"), ("LH-yokohama-port", "JP"),
        ("LH-kobe-port", "JP"), ("LH-shanghai-port", "CN"),
        ("LH-kaohsiung-port", "TW"), ("LH-singapore-port", "SG"),
        ("LH-la-port", "US"), ("LH-rotterdam-port", "DE"),
        ("LH-narita-airport", "JP"), ("LH-kansai-airport", "JP"),
        ("LH-laem-chabang-port", "TH"), ("LH-haiphong-port", "VN"),
        # v2追加
        ("LH-hachinohe-port", "JP"), ("LH-hormuz-strait", "AE"),
    ]
    for hid, cc in hub_countries:
        execute_query(f"""
        MATCH (lh:LogisticsHub {{id: '{hid}'}}), (c:Country {{code: '{cc}'}})
        CREATE (lh)-[:LOCATED_IN]->(c)
        """)
    print(f"  {len(hub_countries)} 件")


# ════════════════════════════════════════════════════════════════════
# 15. ROUTES_THROUGH エッジ
# ════════════════════════════════════════════════════════════════════
def create_routes_through_edges() -> None:
    print("ROUTES_THROUGH エッジを作成中...")
    routes = [
        # from_id, to_hub_id, transit_days, is_primary
        # 日本の工場 → 日本の港湾
        ("PLT001", "LH-tokyo-port", 1, True),
        ("PLT002", "LH-kobe-port", 1, True),
        ("PLT003", "LH-yokohama-port", 1, True),
        ("PLT004", "LH-kobe-port", 2, True),
        ("PLT005", "LH-kobe-port", 1, False),
        ("PLT006", "LH-tokyo-port", 2, True),
        # 日本の倉庫 → 日本の港湾
        ("WHS001", "LH-tokyo-port", 1, True),
        ("WHS002", "LH-kobe-port", 1, True),
        ("WHS003", "LH-yokohama-port", 1, True),
        # 海外サプライヤー → 地元港湾
        ("SUP001", "LH-kaohsiung-port", 1, True),   # TSMC → 高雄港
        ("SUP004", "LH-kaohsiung-port", 1, True),   # Foxconn → 高雄港
        ("SUP005", "LH-shanghai-port", 2, True),     # BYD → 上海港
        ("SUP006", "LH-kobe-port", 1, True),         # Murata → 神戸港
        ("SUP007", "LH-tokyo-port", 1, True),        # TDK → 東京港
        # 海外工場 → 地元港湾
        ("PLT007", "LH-shanghai-port", 1, True),     # 深圳工場 → 上海港
        ("PLT008", "LH-laem-chabang-port", 2, True), # バンコク → レムチャバン
        ("PLT009", "LH-la-port", 3, True),           # グアダラハラ → LA港
        ("PLT010", "LH-haiphong-port", 2, True),     # ハノイ → ハイフォン
        # シンガポール倉庫 → シンガポール港
        ("WHS005", "LH-singapore-port", 1, True),
        # ロサンゼルス倉庫 → LA港
        ("WHS006", "LH-la-port", 1, True),
        # v2追加
        ("SUP111", "LH-tokyo-port", 1, True),           # 関東電化 → 東京港
        ("SUP112", "LH-hachinohe-port", 1, True),       # 日本製鉄 → 八戸港
        ("PLT006", "LH-hachinohe-port", 3, False),      # 仙台工場 → 八戸港（代替）
    ]
    for from_id, to_id, days, primary in routes:
        execute_query(f"""
        MATCH (f {{id: '{from_id}'}}), (lh:LogisticsHub {{id: '{to_id}'}})
        CREATE (f)-[:ROUTES_THROUGH {{
            transitDays: {days}, isPrimary: {str(primary).lower()}
        }}]->(lh)
        """)
    print(f"  {len(routes)} 件")


# ════════════════════════════════════════════════════════════════════
# 16. RiskEvent（サンプル履歴リスクイベント）
# ════════════════════════════════════════════════════════════════════
def create_sample_risk_events() -> None:
    print("RiskEvent を作成中...")
    events = [
        # dedupeKey, title, description, eventType, source, severity,
        # lifecycleStatus, reviewStatus, reviewedBy, trustLevel,
        # lat, lon, radiusKm, geoScopeType, admin1, locationName,
        # startDate, endDate, confidence, categoryId, countryCode
        (
            "p2pquake:noto:20240101",
            "2024年能登半島地震",
            "石川県能登地方を震源とするM7.6の地震",
            "earthquake", "p2pquake", 5,
            "resolved", "confirmed", "system", "trusted_machine",
            37.5, 137.2, 200, "region", "石川県", "能登半島",
            "2024-01-01T16:10:00Z", "2024-03-31T00:00:00Z",
            1.0, "RC-natural-earthquake", "JP",
        ),
        (
            "manual:suez:20210323",
            "2021年スエズ運河封鎖",
            "コンテナ船エバーギブンの座礁によるスエズ運河の6日間封鎖",
            "port_closure", "manual", 4,
            "resolved", "confirmed", "analyst", "analyst",
            30.0, 32.58, 50, "point", None, "スエズ運河",
            "2021-03-23T00:00:00Z", "2021-03-29T00:00:00Z",
            1.0, "RC-operational-port_closure", "JP",  # 影響は日本にも波及
        ),
        (
            "manual:shanghai:20220328",
            "2022年上海ロックダウン",
            "COVID-19対策による上海市全域の都市封鎖、港湾・工場の操業停止",
            "pandemic", "manual", 4,
            "resolved", "confirmed", "analyst", "analyst",
            31.23, 121.47, 100, "city", "上海市", "上海",
            "2022-03-28T00:00:00Z", "2022-06-01T00:00:00Z",
            1.0, "RC-operational-pandemic", "CN",
        ),
        (
            "manual:chips-act:20220809",
            "米国CHIPS法施行",
            "半導体製造の国内回帰促進と対中輸出規制強化",
            "trade_restriction", "manual", 3,
            "active", "confirmed", "analyst", "analyst",
            38.9, -77.04, 0, "multi_country", None, "米国（グローバル影響）",
            "2022-08-09T00:00:00Z", None,
            1.0, "RC-geopolitical-trade_restriction", "US",
        ),
        (
            "manual:typhoon-tw:20250815",
            "2025年台風15号（台湾直撃）",
            "大型台風が台湾を直撃、TSMCファブ一時操業停止",
            "typhoon", "manual", 3,
            "resolved", "confirmed", "system", "trusted_machine",
            25.03, 121.57, 300, "country", None, "台湾",
            "2025-08-15T00:00:00Z", "2025-08-22T00:00:00Z",
            1.0, "RC-natural-typhoon", "TW",
        ),
        # ════════════════════════════════════════════════════════
        # v2: 2025/07 – 2026/04 日本関連リスクイベント (14件)
        # ════════════════════════════════════════════════════════
        # ── 自然災害 ──
        (
            "v2:kamchatka:20250730",
            "カムチャッカM8.8地震津波 — 太平洋沿岸警報",
            "カムチャッカ半島沖M8.8地震による津波が北海道・東北太平洋沿岸に到達。根室80cm、久慈1.3m。190万人避難指示。港湾一時閉鎖。",
            "earthquake", "manual", 3,
            "resolved", "confirmed", "analyst", "analyst",
            43.33, 145.57, 800, "region", "北海道", "根室市",
            "2025-07-30T06:00:00Z", "2025-08-01T00:00:00Z",
            0.95, "RC-natural-earthquake", "JP",
        ),
        (
            "v2:kyushuflood:20250806",
            "九州南部豪雨 — 鹿児島・宮崎土砂災害",
            "鹿児島・宮崎で記録的豪雨。218棟浸水、6000戸停電。384000人に最高レベル警報。物流・鉄道に影響。",
            "flood", "manual", 3,
            "resolved", "confirmed", "analyst", "analyst",
            31.56, 130.56, 200, "region", "鹿児島県", "鹿児島県",
            "2025-08-06T00:00:00Z", "2025-08-12T00:00:00Z",
            0.90, "RC-natural-flood", "JP",
        ),
        (
            "v2:typhoon15:20250905",
            "台風15号 — 宮崎記録的豪雨・静岡竜巻",
            "宮崎県都農町で24時間465.5mm記録的豪雨。静岡県牧之原市でJEF3竜巻（風速75m/s）発生、74人負傷、1000棟以上損壊。",
            "typhoon", "manual", 4,
            "resolved", "confirmed", "analyst", "analyst",
            31.91, 131.42, 300, "region", "宮崎県", "宮崎県",
            "2025-09-05T00:00:00Z", "2025-09-10T00:00:00Z",
            0.90, "RC-natural-typhoon", "JP",
        ),
        (
            "v2:halong:20251009",
            "台風ハロン — 伊豆諸島直撃",
            "最大風速198km/hの台風が伊豆諸島を直撃。八丈島で349mm記録的降水。2700戸断水、2200戸停電。航路・道路不通。",
            "typhoon", "manual", 3,
            "resolved", "confirmed", "analyst", "analyst",
            33.11, 139.80, 250, "region", "東京都", "伊豆諸島",
            "2025-10-08T00:00:00Z", "2025-10-12T00:00:00Z",
            0.85, "RC-natural-typhoon", "JP",
        ),
        (
            "v2:aomori:20251208",
            "青森県太平洋沖地震 — 八戸港被害",
            "青森県沖でM7.6地震。47人負傷、約4000棟損壊。八戸港で港湾被害。東北新幹線新青森-福島間運休、約17000人に影響。90000人避難。",
            "earthquake", "manual", 4,
            "resolved", "confirmed", "analyst", "analyst",
            40.90, 143.20, 300, "region", "青森県", "青森県",
            "2025-12-08T23:15:00Z", "2025-12-31T00:00:00Z",
            0.90, "RC-natural-earthquake", "JP",
        ),
        (
            "v2:taiwan:20251227",
            "台湾宜蘭沖地震 — TSMC一時避難",
            "台湾東部沖M7.0地震。TSMCが新竹サイエンスパーク施設で避難措置実施。耐震対策奏功し2日以内に生産ほぼ復旧。",
            "earthquake", "manual", 3,
            "resolved", "confirmed", "analyst", "analyst",
            24.79, 121.75, 200, "region", None, "宜蘭県沖",
            "2025-12-27T00:00:00Z", "2025-12-30T00:00:00Z",
            0.85, "RC-natural-earthquake", "TW",
        ),
        # ── 工場・産業事故 ──
        (
            "v2:nf3fire:20250807",
            "関東電化NF3工場火災 — 半導体ガス供給危機",
            "関東電化工業の渋川工場で火災。作業員1名死亡。NF3生産ラインの1基が損傷。同社は日本国内NF3生産の90%を占め、TSMC・Samsung・Rapidus等に供給。経済産業省が韓国からの輸入拡大を調整。",
            "factory_incident", "manual", 5,
            "active", "confirmed", "analyst", "analyst",
            36.49, 139.00, 0, "point", "群馬県", "渋川市",
            "2025-08-07T00:00:00Z", None,
            0.98, "RC-operational-factory_incident", "JP",
        ),
        (
            "v2:nipponsteel:20251201",
            "日本製鉄室蘭 高炉設備事故",
            "日本製鉄北日本製鉄所の熱風炉で爆発・火災が発生。作業員10名は無事避難。高炉は全面停止、付帯設備に大きな被害。復旧に数ヶ月の見込み。",
            "factory_incident", "manual", 4,
            "active", "confirmed", "analyst", "analyst",
            42.32, 140.97, 0, "point", "北海道", "室蘭市",
            "2025-12-01T00:00:00Z", None,
            0.90, "RC-operational-factory_incident", "JP",
        ),
        # ── 貿易・地政学 ──
        (
            "v2:ustariff:20250722",
            "米国対日関税 — 25%→15%枠組合意",
            "トランプ政権が日本に25%相互関税を発動(4/9)。7/22に枠組合意で15%に引下げ。自動車は15%(MFN込)、鉄鋼・アルミ・銅は50%維持。日本は5500億ドルの対米投資を約束。",
            "trade_restriction", "manual", 5,
            "active", "confirmed", "analyst", "analyst",
            38.90, -77.04, 0, "multi_country", None, "Washington DC",
            "2025-04-09T00:00:00Z", None,
            1.0, "RC-geopolitical-trade_restriction", "US",
        ),
        (
            "v2:cnmineral:20250404",
            "中国重要鉱物輸出規制 — レアアース許可制",
            "中国がサマリウム・ガドリニウム・テルビウム・ジスプロシウム等7種のレアアース輸出に許可制を導入。日本は2024年にレアアース輸入の63%を中国に依存、重希土類は99%以上。許可手続きが極めて遅く、事実上のボトルネック化。",
            "trade_restriction", "manual", 4,
            "active", "confirmed", "analyst", "analyst",
            39.90, 116.40, 0, "multi_country", None, "北京",
            "2025-04-04T00:00:00Z", None,
            1.0, "RC-geopolitical-trade_restriction", "CN",
        ),
        (
            "v2:cndualuse:20260106",
            "中国対日デュアルユース輸出禁止",
            "中国商務部が日本の軍事用途向け全デュアルユース品目の輸出を禁止。レアアース・先端電子部品・航空宇宙材料等1000品目以上が対象。高市首相の台湾有事発言を契機に発動。民生用途にも不確実性が波及。",
            "sanction", "manual", 5,
            "active", "confirmed", "analyst", "analyst",
            39.90, 116.40, 0, "multi_country", None, "北京",
            "2026-01-06T00:00:00Z", None,
            0.95, "RC-geopolitical-sanction", "CN",
        ),
        (
            "v2:scotus:20260220",
            "米最高裁IEEPA関税違憲判決 → Section 122移行",
            "米最高裁がIEEPAに基づく関税を違憲と判断(6-3)。2/23に関税徴収停止。直後にトランプ大統領がSection 122に基づくグローバル10%関税を発動(2/24)。",
            "trade_restriction", "manual", 3,
            "active", "confirmed", "analyst", "analyst",
            38.90, -77.04, 0, "multi_country", None, "Washington DC",
            "2026-02-20T00:00:00Z", None,
            0.95, "RC-geopolitical-trade_restriction", "US",
        ),
        # ── 物流 ──
        (
            "v2:hormuz:20260228",
            "ホルムズ海峡危機 — 日本原油輸入73.7%遮断",
            "米・イスラエルのイラン攻撃(2/28)を受け、3/4からホルムズ海峡が事実上閉鎖。タンカー通航70-90%減。原油価格126ドル/バレルに急騰。日本は原油の95.1%を中東から輸入し、73.7%がホルムズ経由。3/16に8000万バレルの石油備蓄放出。",
            "port_closure", "manual", 5,
            "active", "under_review", "analyst", "analyst",
            26.56, 56.25, 500, "region", None, "ホルムズ海峡",
            "2026-02-28T00:00:00Z", None,
            0.90, "RC-geopolitical-conflict", "AE",
        ),
        (
            "v2:redsea:20250701",
            "紅海フーシ派攻撃 — アジア欧州航路迂回継続",
            "フーシ派による商船攻撃が継続し、主要海運各社がスエズ運河回避を維持。喜望峰回りで10日・100万ドル/航海の追加コスト。2025年10月に一時沈静化するも2026年2月のイラン戦争で再燃。",
            "port_closure", "manual", 3,
            "resolved", "confirmed", "analyst", "analyst",
            12.60, 43.30, 2000, "region", None, "バブ・エル・マンデブ海峡",
            "2025-07-01T00:00:00Z", "2025-10-31T00:00:00Z",
            0.90, "RC-operational-port_closure", "AE",
        ),
    ]
    import uuid
    for (dk, title, desc, etype, src, sev,
         lifecycle, review, reviewed_by, trust,
         lat, lon, radius, geo_scope, admin1, loc_name,
         start, end, conf, cat_id, cc) in events:
        eid = str(uuid.uuid4())
        safe_title = title.replace("'", "\\'")
        safe_desc = desc.replace("'", "\\'")
        safe_loc = loc_name.replace("'", "\\'")
        admin1_set = f"re.admin1 = '{admin1}'," if admin1 else ""
        end_set = f"re.endDate = datetime('{end}')," if end else ""

        execute_query(f"""
        CREATE (re:RiskEvent {{
            id: '{eid}', sourceEventId: '{dk}',
            dedupeKey: '{dk}', title: '{safe_title}',
            description: '{safe_desc}', eventType: '{etype}',
            source: '{src}', severity: {sev},
            lifecycleStatus: '{lifecycle}', reviewStatus: '{review}',
            reviewedBy: '{reviewed_by}', trustLevel: '{trust}',
            lat: {lat}, lon: {lon}, radiusKm: {radius},
            geoScopeType: '{geo_scope}',
            locationName: '{safe_loc}',
            startDate: datetime('{start}'),
            updatedAt: datetime('{start}'),
            confidence: {conf},
            latestPropagationSequence: 0
        }})""")
        # admin1 が存在する場合は SET で追加
        if admin1:
            execute_query(f"""
            MATCH (re:RiskEvent {{dedupeKey: '{dk}'}})
            SET re.admin1 = '{admin1}'
            """)
        # endDate が存在する場合は SET で追加
        if end:
            execute_query(f"""
            MATCH (re:RiskEvent {{dedupeKey: '{dk}'}})
            SET re.endDate = datetime('{end}')
            """)
        # CATEGORIZED_AS エッジ
        execute_query(f"""
        MATCH (re:RiskEvent {{dedupeKey: '{dk}'}}),
              (rc:RiskCategory {{id: '{cat_id}'}})
        CREATE (re)-[:CATEGORIZED_AS]->(rc)
        """)
        # OCCURRED_IN エッジ
        execute_query(f"""
        MATCH (re:RiskEvent {{dedupeKey: '{dk}'}}),
              (c:Country {{code: '{cc}'}})
        CREATE (re)-[:OCCURRED_IN]->(c)
        """)
    print(f"  {len(events)} 件")


# ════════════════════════════════════════════════════════════════════
# 17. IMPACTS エッジ（サンプル）
# ════════════════════════════════════════════════════════════════════
def create_sample_impacts() -> None:
    print("IMPACTS エッジを作成中...")
    impacts = [
        # eventDedupeKey, targetId, severity, impactType,
        # estimatedRecoveryDays, costImpactPct, status,
        # cachedImpactAmount, assessmentMethod, impactConfidence
        # 能登半島地震 → 名古屋工場(直接)、東京工場(下流)
        ("p2pquake:noto:20240101", "PLT003", 4, "direct",
         30, 15.0, "resolved", 500000000, "automated", 0.95),
        ("p2pquake:noto:20240101", "PLT001", 2, "downstream",
         14, 5.0, "resolved", 200000000, "automated", 0.80),
        # 上海ロックダウン → BYD(直接)、上海港(直接)
        ("manual:shanghai:20220328", "SUP005", 4, "direct",
         60, 25.0, "resolved", 800000000, "automated", 1.0),
        ("manual:shanghai:20220328", "LH-shanghai-port", 5, "direct",
         45, 30.0, "resolved", 1200000000, "automated", 0.9),
        # 台風 → TSMC(直接)、高雄港(直接)
        ("manual:typhoon-tw:20250815", "SUP001", 3, "direct",
         7, 10.0, "resolved", 350000000, "automated", 0.85),
        ("manual:typhoon-tw:20250815", "LH-kaohsiung-port", 3, "direct",
         5, 8.0, "resolved", 250000000, "automated", 0.80),
        # ════════════════════════════════════════════════════════
        # v2: 2025/07 – 2026/04 IMPACTS (44件)
        # ════════════════════════════════════════════════════════
        # ── NF3火災カスケード (7) ──
        ("v2:nf3fire:20250807", "SUP111", 5, "direct",
         120, 50.0, "active", 8000000000, "automated", 0.98),
        ("v2:nf3fire:20250807", "SUP001", 4, "downstream",
         90, 8.0, "active", 15000000000, "automated", 0.90),
        ("v2:nf3fire:20250807", "SUP002", 3, "downstream",
         60, 5.0, "active", 9000000000, "automated", 0.85),
        ("v2:nf3fire:20250807", "SUP113", 5, "downstream",
         120, 30.0, "active", 3000000000, "automated", 0.92),
        ("v2:nf3fire:20250807", "PLT001", 3, "downstream",
         45, 10.0, "active", 2500000000, "automated", 0.80),
        ("v2:nf3fire:20250807", "PLT002", 2, "downstream",
         30, 6.0, "active", 1200000000, "automated", 0.75),
        ("v2:nf3fire:20250807", "CUS002", 2, "downstream",
         45, 4.0, "active", 5000000000, "automated", 0.70),
        # ── 日本製鉄事故 (4) ──
        ("v2:nipponsteel:20251201", "SUP112", 4, "direct",
         180, 25.0, "active", 12000000000, "automated", 0.90),
        ("v2:nipponsteel:20251201", "PLT003", 3, "downstream",
         60, 8.0, "active", 2800000000, "automated", 0.80),
        ("v2:nipponsteel:20251201", "CUS001", 2, "downstream",
         45, 3.0, "active", 8500000000, "automated", 0.75),
        ("v2:nipponsteel:20251201", "CUS004", 2, "downstream",
         45, 5.0, "active", 2000000000, "automated", 0.70),
        # ── 青森地震 (3) ──
        ("v2:aomori:20251208", "LH-hachinohe-port", 4, "direct",
         60, 30.0, "resolved", 1500000000, "automated", 0.90),
        ("v2:aomori:20251208", "PLT006", 2, "downstream",
         14, 5.0, "resolved", 450000000, "automated", 0.80),
        ("v2:aomori:20251208", "LH-tokyo-port", 2, "downstream",
         7, 3.0, "resolved", 800000000, "automated", 0.70),
        # ── カムチャッカ津波 (3) ──
        ("v2:kamchatka:20250730", "LH-tokyo-port", 2, "direct",
         2, 2.0, "resolved", 300000000, "automated", 0.85),
        ("v2:kamchatka:20250730", "LH-yokohama-port", 2, "direct",
         2, 2.0, "resolved", 350000000, "automated", 0.85),
        ("v2:kamchatka:20250730", "PLT006", 2, "direct",
         3, 3.0, "resolved", 270000000, "automated", 0.80),
        # ── 九州豪雨 (2) ──
        ("v2:kyushuflood:20250806", "PLT004", 3, "direct",
         14, 12.0, "resolved", 840000000, "automated", 0.85),
        ("v2:kyushuflood:20250806", "LH-kobe-port", 2, "downstream",
         5, 3.0, "resolved", 200000000, "automated", 0.70),
        # ── 台風15号 (2) ──
        ("v2:typhoon15:20250905", "PLT004", 3, "direct",
         10, 8.0, "resolved", 560000000, "automated", 0.85),
        ("v2:typhoon15:20250905", "PLT005", 2, "downstream",
         5, 3.0, "resolved", 225000000, "automated", 0.75),
        # ── 台風ハロン (2) ──
        ("v2:halong:20251009", "LH-tokyo-port", 2, "direct",
         3, 3.0, "resolved", 450000000, "automated", 0.80),
        ("v2:halong:20251009", "PLT001", 1, "downstream",
         2, 2.0, "resolved", 200000000, "automated", 0.65),
        # ── 台湾地震 (3) ──
        ("v2:taiwan:20251227", "SUP001", 3, "direct",
         3, 2.0, "resolved", 3500000000, "automated", 0.85),
        ("v2:taiwan:20251227", "LH-kaohsiung-port", 2, "direct",
         2, 3.0, "resolved", 400000000, "automated", 0.80),
        ("v2:taiwan:20251227", "PLT001", 2, "downstream",
         7, 3.0, "resolved", 240000000, "automated", 0.70),
        # ── 米国対日関税 (4) ──
        ("v2:ustariff:20250722", "CUS001", 4, "direct",
         365, 12.0, "active", 910000000000, "manual", 1.0),
        ("v2:ustariff:20250722", "PLT003", 3, "direct",
         365, 8.0, "active", 2800000000, "manual", 0.95),
        ("v2:ustariff:20250722", "CUS004", 3, "direct",
         365, 6.0, "active", 2400000000, "manual", 0.90),
        ("v2:ustariff:20250722", "PLT009", 2, "downstream",
         365, 5.0, "active", 1400000000, "manual", 0.80),
        # ── 中国レアアース規制 (3) ──
        ("v2:cnmineral:20250404", "SUP103", 4, "direct",
         365, 20.0, "active", 6000000000, "manual", 0.95),
        ("v2:cnmineral:20250404", "SUP007", 3, "direct",
         180, 12.0, "active", 3200000000, "manual", 0.90),
        ("v2:cnmineral:20250404", "SUP006", 3, "direct",
         180, 10.0, "active", 2800000000, "manual", 0.85),
        # ── 中国デュアルユース禁止 (3) ──
        ("v2:cndualuse:20260106", "CUS005", 5, "direct",
         365, 15.0, "active", 18000000000, "manual", 0.95),
        ("v2:cndualuse:20260106", "SUP006", 3, "direct",
         180, 8.0, "active", 2200000000, "manual", 0.85),
        ("v2:cndualuse:20260106", "SUP103", 3, "downstream",
         180, 5.0, "active", 1500000000, "manual", 0.80),
        # ── ホルムズ海峡危機 (4) ──
        ("v2:hormuz:20260228", "PLT001", 4, "direct",
         90, 20.0, "active", 5000000000, "automated", 0.90),
        ("v2:hormuz:20260228", "PLT002", 4, "direct",
         90, 20.0, "active", 4000000000, "automated", 0.90),
        ("v2:hormuz:20260228", "PLT003", 4, "direct",
         90, 20.0, "active", 3500000000, "automated", 0.90),
        ("v2:hormuz:20260228", "PLT004", 3, "direct",
         90, 15.0, "active", 1050000000, "automated", 0.85),
        # ── SCOTUS関税判決 (2) ──
        ("v2:scotus:20260220", "CUS001", 2, "direct",
         365, 3.0, "active", 230000000000, "manual", 0.90),
        ("v2:scotus:20260220", "PLT003", 2, "downstream",
         365, 2.0, "active", 700000000, "manual", 0.85),
        # ── 紅海攻撃 (2) ──
        ("v2:redsea:20250701", "LH-singapore-port", 3, "direct",
         120, 10.0, "resolved", 2000000000, "automated", 0.85),
        ("v2:redsea:20250701", "LH-rotterdam-port", 3, "direct",
         120, 15.0, "resolved", 3500000000, "automated", 0.85),
    ]
    for (dk, target, sev, itype, days, cost_pct, status,
         amount, method, confidence) in impacts:
        execute_query(f"""
        MATCH (re:RiskEvent {{dedupeKey: '{dk}'}}),
              (t {{id: '{target}'}})
        CREATE (re)-[:IMPACTS {{
            severity: {sev}, impactType: '{itype}',
            estimatedRecoveryDays: {days}, costImpactPct: {cost_pct},
            status: '{status}', cachedImpactAmount: {amount},
            assessmentMethod: '{method}', impactConfidence: {confidence},
            firstDetectedAt: datetime('2026-04-01T00:00:00Z'),
            lastUpdatedAt: datetime('2026-04-01T00:00:00Z'),
            propagationRunId: 'seed-data'
        }}]->(t)
        """)
    print(f"  {len(impacts)} 件")


# ════════════════════════════════════════════════════════════════════
# 18. DISRUPTS エッジ（サンプル）
# ════════════════════════════════════════════════════════════════════
def create_sample_disrupts() -> None:
    print("DISRUPTS エッジを作成中...")
    disrupts = [
        # eventDedupeKey, hsCode, originCountry, destinationCountry,
        # regulatorBody, effectiveDate, tariffIncreasePct, exportRestricted
        ("manual:chips-act:20220809", "8542.31", "CN", "US",
         "US Department of Commerce", "2022-10-07", 25.0, True),
        ("manual:chips-act:20220809", "8542.31", "TW", "CN",
         "US Department of Commerce", "2022-10-07", 0.0, True),
        # v2追加
        ("v2:ustariff:20250722", "8708.99", "JP", "US",
         "USTR", "2025-04-09", 15.0, False),
        ("v2:ustariff:20250722", "8542.31", "JP", "US",
         "USTR", "2025-04-09", 15.0, False),
        ("v2:cnmineral:20250404", "2612.10", "CN", "JP",
         "中国商務部", "2025-04-04", 0.0, True),
        ("v2:cndualuse:20260106", "8542.31", "CN", "JP",
         "中国商務部", "2026-01-06", 0.0, True),
        ("v2:cndualuse:20260106", "8544.49", "CN", "JP",
         "中国商務部", "2026-01-06", 0.0, True),
        ("v2:scotus:20260220", "8708.99", "JP", "US",
         "USTR / Section 122", "2026-02-24", 10.0, False),
    ]
    for (dk, hs, origin, dest, regulator, eff_date,
         tariff_pct, restricted) in disrupts:
        restricted_str = str(restricted).lower()
        execute_query(f"""
        MATCH (re:RiskEvent {{dedupeKey: '{dk}'}}),
              (hs:HSCode {{code: '{hs}'}})
        CREATE (re)-[:DISRUPTS {{
            originCountry: '{origin}', destinationCountry: '{dest}',
            regulatorBody: '{regulator}', effectiveDate: '{eff_date}',
            tariffIncreasePct: {tariff_pct}, exportRestricted: {restricted_str}
        }}]->(hs)
        """)
    print(f"  {len(disrupts)} 件")


# ════════════════════════════════════════════════════════════════════
# 19. RELATED_EVENT エッジ（サンプル）
# ════════════════════════════════════════════════════════════════════
def create_sample_related_events() -> None:
    print("RELATED_EVENT エッジを作成中...")
    relations = [
        # fromDedupeKey, toDedupeKey, relationshipType, delayDays, confidence
        # 上海ロックダウン → 上海港の混雑（contributes_to）
        ("manual:shanghai:20220328", "manual:suez:20210323",
         "coincident", 0, 0.3),
        # v2追加
        ("v2:cnmineral:20250404", "v2:cndualuse:20260106",
         "contributes_to", 277, 0.85),
        ("v2:ustariff:20250722", "v2:scotus:20260220",
         "contributes_to", 317, 0.95),
        ("v2:hormuz:20260228", "v2:redsea:20250701",
         "contributes_to", 0, 0.80),
        ("v2:kyushuflood:20250806", "v2:typhoon15:20250905",
         "coincident", 30, 0.20),
        ("v2:nf3fire:20250807", "v2:taiwan:20251227",
         "coincident", 142, 0.10),
    ]
    for from_dk, to_dk, rel_type, delay, conf in relations:
        execute_query(f"""
        MATCH (from:RiskEvent {{dedupeKey: '{from_dk}'}}),
              (to:RiskEvent {{dedupeKey: '{to_dk}'}})
        CREATE (from)-[:RELATED_EVENT {{
            relationshipType: '{rel_type}',
            delayDays: {delay}, confidence: {conf}
        }}]->(to)
        """)
    print(f"  {len(relations)} 件")


# ════════════════════════════════════════════════════════════════════
# 検証
# ════════════════════════════════════════════════════════════════════
def verify_data() -> None:
    print("\n── データ検証 ──")
    node_queries = [
        ("Country", "MATCH (n:Country) RETURN count(n) as count"),
        ("HSCode", "MATCH (n:HSCode) RETURN count(n) as count"),
        ("Regulation", "MATCH (n:Regulation) RETURN count(n) as count"),
        ("Supplier", "MATCH (n:Supplier) RETURN count(n) as count"),
        ("Material", "MATCH (n:Material) RETURN count(n) as count"),
        ("Product", "MATCH (n:Product) RETURN count(n) as count"),
        ("Plant", "MATCH (n:Plant) RETURN count(n) as count"),
        ("Warehouse", "MATCH (n:Warehouse) RETURN count(n) as count"),
        ("Customer", "MATCH (n:Customer) RETURN count(n) as count"),
        ("RiskCategory", "MATCH (n:RiskCategory) RETURN count(n) as count"),
        ("LogisticsHub", "MATCH (n:LogisticsHub) RETURN count(n) as count"),
        ("RiskEvent", "MATCH (n:RiskEvent) RETURN count(n) as count"),
    ]
    edge_queries = [
        ("LOCATED_IN", "MATCH ()-[r:LOCATED_IN]->() RETURN count(r) as count"),
        ("CLASSIFIED_AS", "MATCH ()-[r:CLASSIFIED_AS]->() RETURN count(r) as count"),
        ("TARIFF_APPLIES", "MATCH ()-[r:TARIFF_APPLIES]->() RETURN count(r) as count"),
        ("SUBJECT_TO", "MATCH ()-[r:SUBJECT_TO]->() RETURN count(r) as count"),
        ("SUPPLIES", "MATCH ()-[r:SUPPLIES]->() RETURN count(r) as count"),
        ("HAS_COMPONENT", "MATCH ()-[r:HAS_COMPONENT]->() RETURN count(r) as count"),
        ("PRODUCED_AT", "MATCH ()-[r:PRODUCED_AT]->() RETURN count(r) as count"),
        ("SUPPLIES_TO", "MATCH ()-[r:SUPPLIES_TO]->() RETURN count(r) as count"),
        ("ORDERED_BY", "MATCH ()-[r:ORDERED_BY]->() RETURN count(r) as count"),
        ("ALTERNATIVE_TO", "MATCH ()-[r:ALTERNATIVE_TO]->() RETURN count(r) as count"),
        ("ROUTES_THROUGH", "MATCH ()-[r:ROUTES_THROUGH]->() RETURN count(r) as count"),
        ("CATEGORIZED_AS", "MATCH ()-[r:CATEGORIZED_AS]->() RETURN count(r) as count"),
        ("OCCURRED_IN", "MATCH ()-[r:OCCURRED_IN]->() RETURN count(r) as count"),
        ("IMPACTS", "MATCH ()-[r:IMPACTS]->() RETURN count(r) as count"),
        ("DISRUPTS", "MATCH ()-[r:DISRUPTS]->() RETURN count(r) as count"),
        ("RELATED_EVENT", "MATCH ()-[r:RELATED_EVENT]->() RETURN count(r) as count"),
    ]
    total_nodes = 0
    total_edges = 0
    print("  Nodes:")
    for label, query in node_queries:
        result = execute_query(query)
        count = result.get("results", [{}])[0].get("count", 0)
        total_nodes += count
        print(f"    {label:16s}: {count:>4} 件")

    print("  Edges:")
    for label, query in edge_queries:
        result = execute_query(query)
        count = result.get("results", [{}])[0].get("count", 0)
        total_edges += count
        print(f"    {label:16s}: {count:>4} 件")

    print(f"\n  合計: {total_nodes} ノード, {total_edges} エッジ")


# ════════════════════════════════════════════════════════════════════
# メイン
# ════════════════════════════════════════════════════════════════════
def main() -> None:
    print("=" * 60)
    print("Neptune Analytics — サプライチェーンKG v2 (World-level)")
    print(f"Graph: {NEPTUNE_GRAPH_ID} @ {NEPTUNE_REGION}")
    print("=" * 60)

    clear_existing_data()

    # ── Nodes ──
    create_countries()
    create_hscodes()
    create_regulations()
    create_suppliers()
    create_materials()
    create_products()
    create_plants()
    create_warehouses()
    create_customers()

    # ── Edges ──
    create_located_in_edges()
    create_classified_as_edges()
    create_tariff_edges()
    create_subject_to_edges()
    create_supplies_edges()
    create_bom_edges()
    create_produced_at_edges()
    create_supply_chain_edges()
    create_ordered_by_edges()
    create_alternative_edges()

    # ── リスクイベント関連 ──
    create_risk_categories()
    create_logistics_hubs()
    create_logistics_hub_edges()
    create_routes_through_edges()
    create_sample_risk_events()
    create_sample_impacts()
    create_sample_disrupts()
    create_sample_related_events()

    verify_data()
    print("\n✅ 投入完了!")


if __name__ == "__main__":
    main()
