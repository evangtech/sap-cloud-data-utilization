# -*- coding: utf-8 -*-
"""
Neptune影響分析Lambda関数
地震データを読み込み、サプライチェーンへの影響を分析し、
影響グラフを生成してS3に保存します

Version: 2.0.0 - v2 KGスキーマ対応（Location→Country, SUPPLIES/PRODUCED_AT/HAS_COMPONENT）
"""
import io
import json
import logging
import os
from typing import Any

import boto3

# グラフ生成ライブラリ（オプショナル）
try:
    import matplotlib
    matplotlib.use('Agg')  # ヘッドレス環境用
    import matplotlib.pyplot as plt
    import networkx as nx
    GRAPH_AVAILABLE = True
except ImportError:
    GRAPH_AVAILABLE = False

# ロガー設定
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# 環境変数
NEPTUNE_GRAPH_ID = os.environ.get("NEPTUNE_GRAPH_ID", "g-844qqbri1a")
NEPTUNE_REGION = os.environ.get("NEPTUNE_REGION", "us-west-2")
OUTPUT_BUCKET = os.environ.get("OUTPUT_BUCKET", "supply-chain-earthquake-data-454953018734")
OUTPUT_PREFIX = os.environ.get("OUTPUT_PREFIX", "impact-analysis/")

# クライアント初期化
s3_client = boto3.client("s3")
neptune_client = boto3.client("neptune-graph", region_name=NEPTUNE_REGION)

# 震源座標（handler が earthquake_data から設定 → analyze/find で使用）
_earthquake_lat: float | None = None
_earthquake_lon: float | None = None
_earthquake_radius_km: float = 200.0  # デフォルト影響半径 200 km


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Lambda関数のエントリーポイント
    
    Args:
        event: イベントデータ
            - 直接呼び出し: {"bucket": "...", "key": "..."}
            - S3トリガー: {"Records": [{"s3": {"bucket": {...}, "object": {...}}}]}
        context: Lambda実行コンテキスト
    
    Returns:
        分析結果
    """
    try:
        logger.info(f"影響分析を開始します: {json.dumps(event, ensure_ascii=False)}")
        
        # S3イベント形式か直接呼び出し形式かを判定
        if "Records" in event:
            # S3トリガーからの呼び出し
            record = event["Records"][0]
            bucket = record["s3"]["bucket"]["name"]
            # S3キーはURLエンコードされているのでデコード
            from urllib.parse import unquote_plus
            key = unquote_plus(record["s3"]["object"]["key"])
            logger.info(f"S3トリガー: bucket={bucket}, key={key}")
        else:
            # 直接呼び出し
            bucket = event.get("bucket", OUTPUT_BUCKET)
            key = event.get("key")
        
        if not key:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "S3キーが指定されていません"}, ensure_ascii=False)
            }
        
        earthquake_data = read_earthquake_from_s3(bucket, key)
        if not earthquake_data:
            return {
                "statusCode": 404,
                "body": json.dumps({"error": "地震データが見つかりません"}, ensure_ascii=False)
            }
        
        # 震源座標をモジュール変数に設定（geo-proximity クエリで使用）
        global _earthquake_lat, _earthquake_lon, _earthquake_radius_km
        eq_hypo = earthquake_data.get("earthquake", {}).get("hypocenter", {})
        _earthquake_lat = eq_hypo.get("latitude")
        _earthquake_lon = eq_hypo.get("longitude")
        eq_magnitude = eq_hypo.get("magnitude", 5.0)
        # 震度に応じて影響半径を調整 (M5=100km, M6=200km, M7=400km, M8=600km)
        _earthquake_radius_km = min(max(50.0, 10 ** (eq_magnitude / 3.0)), 800.0)
        logger.info(f"震源座標: lat={_earthquake_lat}, lon={_earthquake_lon}, radius={_earthquake_radius_km:.0f}km")

        # 影響を受ける地域を抽出
        affected_locations = extract_affected_locations(earthquake_data)
        logger.info(f"影響地域: {affected_locations}")

        if not affected_locations and _earthquake_lat is None:
            return {
                "statusCode": 200,
                "body": json.dumps({"message": "影響地域なし"}, ensure_ascii=False)
            }

        # 各地域について影響分析を実行
        # Note: v2 KG は pref/city ではなく lat/lon で検索する。
        # affected_locations はログ用。実際のクエリは _earthquake_lat/lon を使う。
        all_results = []
        locations_to_analyze = affected_locations if affected_locations else [{"pref": "unknown", "city": "unknown"}]
        for location in locations_to_analyze:
            pref = location.get("pref", "")
            city = location.get("city", "")

            # 1. 影響を受ける工場と下流への影響（3階層まで）
            impact_result = analyze_downstream_impact(pref, city)

            # 2. 代替サプライヤーの検索
            alternatives = find_alternative_suppliers(pref, city)
            
            all_results.append({
                "location": location,
                "impact_analysis": impact_result,
                "alternative_suppliers": alternatives
            })
        
        # 結果をS3に保存
        output_key = save_analysis_result(earthquake_data, all_results)
        
        # 影響を受けた工場のIDを抽出
        directly_affected_ids = set()
        downstream_affected_ids = set()
        
        for result in all_results:
            impact = result.get("impact_analysis", {})
            
            # directly_affectedリストから工場IDを抽出
            directly_affected = impact.get("directly_affected", [])
            for plant in directly_affected:
                plant_id = plant.get("plant_id")
                if plant_id:
                    directly_affected_ids.add(plant_id)
            
            # downstream_impactから下流で影響を受けた工場を抽出
            downstream_impact = impact.get("downstream_impact", [])
            for downstream in downstream_impact:
                path = downstream.get("supply_chain_path", [])
                # パスの最初の工場は直接影響を受けた工場なのでスキップ
                # 2番目以降の工場が下流で影響を受けた工場
                for i, plant_name in enumerate(path):
                    if i > 0:  # 最初の工場はスキップ
                        downstream_affected_ids.add(plant_name)
        
        logger.info(f"直接影響を受けた工場: {len(directly_affected_ids)}件")
        logger.info(f"下流で影響を受けた工場（名前）: {len(downstream_affected_ids)}件")
        
        # 影響グラフを生成してS3に保存（ライブラリが利用可能な場合）
        graph_key = None
        if GRAPH_AVAILABLE:
            graph_key = generate_impact_graph(earthquake_data, all_results)
        else:
            logger.info("グラフ生成ライブラリが利用できないため、グラフ生成をスキップします")
        
        # インタラクティブ地図を生成してS3に保存
        map_key = generate_interactive_map(
            earthquake_data, 
            all_results, 
            directly_affected_ids, 
            downstream_affected_ids
        )
        
        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "分析完了",
                "affected_locations": len(affected_locations),
                "output_key": output_key,
                "graph_key": graph_key,
                "map_key": map_key,
                "results": all_results
            }, ensure_ascii=False, default=str)
        }
        
    except Exception as e:
        logger.error(f"エラーが発生しました: {e}")
        raise


def read_earthquake_from_s3(bucket: str, key: str) -> dict[str, Any] | None:
    """
    S3から地震データを読み込み
    
    Args:
        bucket: S3バケット名
        key: S3オブジェクトキー
    
    Returns:
        地震データ
    """
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        data = json.loads(response["Body"].read().decode("utf-8"))
        logger.info(f"地震データを読み込みました: {key}")
        return data
    except Exception as e:
        logger.error(f"S3読み込みエラー: {e}")
        return None


def extract_affected_locations(earthquake_data: dict[str, Any]) -> list[dict[str, Any]]:
    """
    地震データから影響を受ける地域を抽出
    震度3以上の地域を抽出
    
    Args:
        earthquake_data: 地震データ
    
    Returns:
        影響地域のリスト（都道府県、市区町村）
    """
    affected = []
    seen_cities = set()
    
    # pointsから震度情報を取得
    points = earthquake_data.get("points", [])
    
    for point in points:
        scale = point.get("scale", 0)
        # 震度3以上（scale >= 30）を対象
        if scale >= 30:
            pref = point.get("pref", "")
            addr = point.get("addr", "")
            
            # 市区町村を抽出（最初の部分）
            city = addr.split("市")[0] + "市" if "市" in addr else addr.split("町")[0] + "町" if "町" in addr else addr
            
            key = f"{pref}_{city}"
            if key not in seen_cities:
                seen_cities.add(key)
                affected.append({
                    "pref": pref,
                    "city": city,
                    "max_scale": scale
                })
    
    # 震度の高い順にソート
    affected.sort(key=lambda x: x["max_scale"], reverse=True)
    
    return affected


def execute_neptune_query(query: str) -> dict[str, Any]:
    """
    Neptune Analyticsでクエリを実行
    
    Args:
        query: openCypherクエリ
    
    Returns:
        クエリ結果
    """
    try:
        response = neptune_client.execute_query(
            graphIdentifier=NEPTUNE_GRAPH_ID,
            queryString=query,
            language="OPEN_CYPHER"
        )
        result = response["payload"].read().decode("utf-8")
        return json.loads(result)
    except Exception as e:
        logger.error(f"Neptuneクエリエラー: {e}")
        return {"results": [], "error": str(e)}


def analyze_downstream_impact(pref: str, city: str) -> dict[str, Any]:
    """
    影響を受ける工場と下流への影響を分析（3階層まで）

    v2 KG has no Location/pref/city nodes. Earthquake data provides pref/city
    (e.g. '宮城県', '仙台市') which cannot match Country.code/name.
    Strategy: resolve the earthquake epicentre lat/lon upstream and pass it in,
    OR fall back to geo-proximity matching using Plant.lat/lon.
    We use the latter: find the earthquake epicentre from the caller context
    and match plants within a configurable radius.

    For backward-compat the function still accepts pref/city but they are used
    only for logging. The actual matching uses _earthquake_lat/_earthquake_lon
    module-level vars set by the handler before calling this function.

    Args:
        pref: 都道府県 (used for logging only)
        city: 市区町村 (used for logging only)

    Returns:
        影響分析結果
    """
    logger.info(f"下流影響分析: {pref} {city} (lat={_earthquake_lat}, lon={_earthquake_lon})")

    lat = _earthquake_lat
    lon = _earthquake_lon
    radius_km = _earthquake_radius_km

    if lat is None or lon is None:
        logger.warning("震源座標が未設定 — 空の結果を返します")
        return {"directly_affected": [], "downstream_impact": []}

    # 直接影響を受ける工場を検索（geo-proximity: Haversine近似）
    # Neptune openCypher lacks native geo functions, so we use bounding-box
    # approximation: ±radius_km converted to rough lat/lon degrees.
    lat_delta = radius_km / 111.0
    lon_delta = radius_km / (111.0 * max(abs(__import__('math').cos(__import__('math').radians(lat))), 0.01))

    direct_impact_query = f"""
    MATCH (p:Plant)-[:LOCATED_IN]->(c:Country)
    WHERE p.lat >= {lat - lat_delta} AND p.lat <= {lat + lat_delta}
      AND p.lon >= {lon - lon_delta} AND p.lon <= {lon + lon_delta}
    RETURN p.id as plant_id,
           p.name as plant_name,
           c.name as city,
           p.country_code as pref
    """

    direct_result = execute_neptune_query(direct_impact_query)

    # 下流への影響（3階層まで）
    downstream_query = f"""
    MATCH (affected:Plant)
    WHERE affected.lat >= {lat - lat_delta} AND affected.lat <= {lat + lat_delta}
      AND affected.lon >= {lon - lon_delta} AND affected.lon <= {lon + lon_delta}
    MATCH path = (affected)-[:SUPPLIES_TO*1..3]->(downstream)
    WHERE downstream:Plant OR downstream:Warehouse OR downstream:Customer
    OPTIONAL MATCH (prod:Product)-[:PRODUCED_AT]->(affected)
    OPTIONAL MATCH (prod)-[:HAS_COMPONENT]->(material:Material)
    RETURN affected.name as affected_plant,
           material.description as affected_material,
           [node in nodes(path) | node.name] as supply_chain_path,
           length(path) as depth
    """

    downstream_result = execute_neptune_query(downstream_query)

    return {
        "directly_affected": direct_result.get("results", []),
        "downstream_impact": downstream_result.get("results", [])
    }


def find_alternative_suppliers(pref: str, city: str) -> dict[str, Any]:
    """
    代替サプライヤーを検索
    影響を受けた工場が供給する素材について、他の供給元を検索

    Uses geo-proximity (same as analyze_downstream_impact) to find affected
    plants, then traverses PRODUCED_AT → HAS_COMPONENT → SUPPLIES to find
    alternative suppliers not in the affected zone.

    Args:
        pref: 都道府県 (logging only)
        city: 市区町村 (logging only)

    Returns:
        代替サプライヤー情報
    """
    logger.info(f"代替サプライヤー検索: {pref} {city} (lat={_earthquake_lat}, lon={_earthquake_lon})")

    lat = _earthquake_lat
    lon = _earthquake_lon
    radius_km = _earthquake_radius_km

    if lat is None or lon is None:
        return {"direct_alternatives": [], "customer_aware_alternatives": []}

    lat_delta = radius_km / 111.0
    lon_delta = radius_km / (111.0 * max(abs(__import__('math').cos(__import__('math').radians(lat))), 0.01))

    # 影響を受けた工場の素材と、影響圏外の代替サプライヤー
    query = f"""
    MATCH (affected:Plant)
    WHERE affected.lat >= {lat - lat_delta} AND affected.lat <= {lat + lat_delta}
      AND affected.lon >= {lon - lon_delta} AND affected.lon <= {lon + lon_delta}
    MATCH (prod:Product)-[:PRODUCED_AT]->(affected)
    MATCH (prod)-[:HAS_COMPONENT]->(material:Material)
    MATCH (alt_supplier:Supplier)-[:SUPPLIES]->(material)
    MATCH (alt_supplier)-[:LOCATED_IN]->(alt_country:Country)
    WHERE NOT (alt_supplier.lat >= {lat - lat_delta} AND alt_supplier.lat <= {lat + lat_delta}
          AND alt_supplier.lon >= {lon - lon_delta} AND alt_supplier.lon <= {lon + lon_delta})
    RETURN affected.name as disrupted_supplier,
           affected.country_code as disrupted_pref,
           material.description as material,
           alt_supplier.name as alternative_supplier,
           alt_country.name as alternative_city,
           alt_supplier.country_code as alternative_pref
    """

    result = execute_neptune_query(query)

    # カスタマへの影響を考慮した代替サプライヤー
    customer_aware_query = f"""
    MATCH (affected:Plant)
    WHERE affected.lat >= {lat - lat_delta} AND affected.lat <= {lat + lat_delta}
      AND affected.lon >= {lon - lon_delta} AND affected.lon <= {lon + lon_delta}
    MATCH (prod:Product)-[:PRODUCED_AT]->(affected)
    MATCH (prod)-[:HAS_COMPONENT]->(material:Material)
    MATCH (affected)-[:SUPPLIES_TO*1..2]->(customer)
    WHERE customer:Customer OR customer:Warehouse
    MATCH (alt_supplier:Supplier)-[:SUPPLIES]->(material)
    MATCH (alt_supplier)-[:LOCATED_IN]->(alt_country:Country)
    WHERE NOT (alt_supplier.lat >= {lat - lat_delta} AND alt_supplier.lat <= {lat + lat_delta}
          AND alt_supplier.lon >= {lon - lon_delta} AND alt_supplier.lon <= {lon + lon_delta})
    RETURN affected.name as disrupted_supplier,
           customer.name as affected_customer,
           material.description as material,
           alt_supplier.name as alternative_supplier,
           alt_country.name as alternative_city
    """

    customer_result = execute_neptune_query(customer_aware_query)

    return {
        "direct_alternatives": result.get("results", []),
        "customer_aware_alternatives": customer_result.get("results", [])
    }


def save_analysis_result(earthquake_data: dict[str, Any], results: list[dict[str, Any]]) -> str:
    """
    分析結果をS3に保存
    
    Args:
        earthquake_data: 元の地震データ
        results: 分析結果
    
    Returns:
        保存先S3キー
    """
    from datetime import datetime
    
    eq_id = earthquake_data.get("id", "unknown")
    eq_time = earthquake_data.get("earthquake", {}).get("time", "")
    
    # 出力ファイル名を生成
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_key = f"{OUTPUT_PREFIX}{timestamp}_{eq_id}_analysis.json"
    
    output_data = {
        "earthquake_id": eq_id,
        "earthquake_time": eq_time,
        "analysis_timestamp": timestamp,
        "results": results
    }
    
    s3_client.put_object(
        Bucket=OUTPUT_BUCKET,
        Key=output_key,
        Body=json.dumps(output_data, ensure_ascii=False, indent=2),
        ContentType="application/json"
    )
    
    logger.info(f"分析結果を保存しました: s3://{OUTPUT_BUCKET}/{output_key}")
    return output_key



def generate_impact_graph(
    earthquake_data: dict[str, Any],
    results: list[dict[str, Any]]
) -> str | None:
    """
    サプライチェーン影響グラフを生成してS3に保存
    ツリー構造で影響工場をルートとして配置
    色弱対応の配色を使用
    
    Args:
        earthquake_data: 地震データ
        results: 分析結果
    
    Returns:
        保存先S3キー（画像）
    """
    from datetime import datetime
    
    try:
        # グラフ作成
        G = nx.DiGraph()
        
        # ノード情報を収集
        affected_plants = set()
        downstream_plants = set()
        materials = set()
        alternatives = set()
        
        # エッジ情報
        edges_data = []
        
        for result in results:
            impact = result.get("impact_analysis", {})
            alt_suppliers = result.get("alternative_suppliers", {})
            
            # 直接影響を受ける工場
            for plant in impact.get("directly_affected", []):
                plant_name = plant.get("plant_name", "")
                if plant_name:
                    affected_plants.add(plant_name)
            
            # 下流への影響
            for downstream in impact.get("downstream_impact", []):
                path = downstream.get("supply_chain_path", [])
                material = downstream.get("affected_material", "")
                
                if material:
                    materials.add(material)
                
                # パス上のノードを処理
                for i, node in enumerate(path):
                    if i == 0:
                        # 最初のノードは影響工場
                        if material:
                            edges_data.append((node, material, "supplies"))
                    else:
                        # 下流工場
                        if node not in affected_plants:
                            downstream_plants.add(node)
                        # エッジを追加
                        edges_data.append((path[i-1], node, "supplies_to"))
            
            # 代替サプライヤー
            for alt in alt_suppliers.get("direct_alternatives", []):
                alt_name = alt.get("alternative_supplier", "")
                material = alt.get("material", "")
                if alt_name and alt_name not in affected_plants:
                    alternatives.add(alt_name)
                    if material:
                        edges_data.append((alt_name, material, "alternative_supply"))
        
        # ノードをグラフに追加
        for node in affected_plants:
            G.add_node(node, node_type="affected")
        for node in downstream_plants:
            G.add_node(node, node_type="downstream")
        for node in materials:
            G.add_node(node, node_type="material")
        for node in alternatives:
            G.add_node(node, node_type="alternative")
        
        # エッジを追加
        for src, dst, edge_type in edges_data:
            if src in G.nodes() and dst in G.nodes():
                G.add_edge(src, dst, edge_type=edge_type)
        
        if len(G.nodes()) == 0:
            logger.info("グラフに表示するノードがありません")
            return None
        
        logger.info(f"グラフノード: affected={affected_plants}, downstream={downstream_plants}, materials={materials}, alternatives={alternatives}")
        
        # グラフ描画（余白を確保）
        fig, ax = plt.subplots(figsize=(14, 10))
        
        # ツリー構造のレイアウトを計算
        pos = {}
        
        # 中央に配置するためのオフセット
        center_x = 5
        center_y = 5
        
        # 影響工場（ルート、上部中央）
        affected_list = sorted(affected_plants)
        affected_width = len(affected_list) * 3
        start_x = center_x - affected_width / 2 + 1.5
        for i, node in enumerate(affected_list):
            pos[node] = (start_x + i * 3, center_y + 3)
        
        # 素材（影響工場の下）
        material_list = sorted(materials)
        material_width = len(material_list) * 3
        start_x = center_x - material_width / 2 + 1.5
        for i, node in enumerate(material_list):
            pos[node] = (start_x + i * 3, center_y + 1)
        
        # 下流工場（素材の下）
        downstream_list = sorted(downstream_plants)
        downstream_width = len(downstream_list) * 3
        start_x = center_x - downstream_width / 2 + 1.5
        for i, node in enumerate(downstream_list):
            pos[node] = (start_x + i * 3, center_y - 1.5)
        
        # 代替サプライヤー（右側に配置）
        alt_list = sorted(alternatives)
        for i, node in enumerate(alt_list):
            y_offset = (len(alt_list) - 1) / 2 - i
            pos[node] = (center_x + 5, center_y + 1 + y_offset * 1.5)
        
        # 色弱対応の配色（より区別しやすい組み合わせ）
        # 明度と彩度の差を大きくして区別しやすく
        COLOR_AFFECTED = "#D55E00"    # 濃いオレンジ（影響工場）
        COLOR_DOWNSTREAM = "#F0E442"  # 黄色（下流工場）
        COLOR_MATERIAL = "#0072B2"    # 濃い青（素材）
        COLOR_ALTERNATIVE = "#009E73" # 緑/ティール（代替サプライヤー）
        
        # ノードタイプ別にリストを作成
        affected_nodes = [n for n in G.nodes() if G.nodes[n].get("node_type") == "affected"]
        downstream_nodes = [n for n in G.nodes() if G.nodes[n].get("node_type") == "downstream"]
        material_nodes = [n for n in G.nodes() if G.nodes[n].get("node_type") == "material"]
        alternative_nodes = [n for n in G.nodes() if G.nodes[n].get("node_type") == "alternative"]
        
        # すべて丸で描画
        if affected_nodes:
            nx.draw_networkx_nodes(G, pos, nodelist=affected_nodes, 
                                   node_color=COLOR_AFFECTED, node_size=4000,
                                   node_shape="o", alpha=0.9, ax=ax,
                                   edgecolors="black", linewidths=2)
        
        if downstream_nodes:
            nx.draw_networkx_nodes(G, pos, nodelist=downstream_nodes,
                                   node_color=COLOR_DOWNSTREAM, node_size=3500,
                                   node_shape="o", alpha=0.9, ax=ax,
                                   edgecolors="black", linewidths=2)
        
        if material_nodes:
            nx.draw_networkx_nodes(G, pos, nodelist=material_nodes,
                                   node_color=COLOR_MATERIAL, node_size=3000,
                                   node_shape="o", alpha=0.9, ax=ax,
                                   edgecolors="black", linewidths=2)
        
        if alternative_nodes:
            nx.draw_networkx_nodes(G, pos, nodelist=alternative_nodes,
                                   node_color=COLOR_ALTERNATIVE, node_size=3500,
                                   node_shape="o", alpha=0.9, ax=ax,
                                   edgecolors="black", linewidths=2)
        
        # エッジを種類別に描画
        supplies_to_edges = [(u, v) for u, v, d in G.edges(data=True) 
                             if d.get("edge_type") == "supplies_to"]
        supplies_edges = [(u, v) for u, v, d in G.edges(data=True) 
                          if d.get("edge_type") == "supplies"]
        alt_edges = [(u, v) for u, v, d in G.edges(data=True) 
                     if d.get("edge_type") == "alternative_supply"]
        
        # サプライチェーンエッジ（実線、黒）
        if supplies_to_edges:
            nx.draw_networkx_edges(G, pos, edgelist=supplies_to_edges, 
                                   edge_color="#333333", arrows=True, 
                                   arrowsize=20, alpha=0.8, width=2, ax=ax,
                                   connectionstyle="arc3,rad=0.1")
        
        # 素材供給エッジ（実線、青）
        if supplies_edges:
            nx.draw_networkx_edges(G, pos, edgelist=supplies_edges,
                                   edge_color=COLOR_MATERIAL, arrows=True,
                                   arrowsize=18, alpha=0.7, width=2, ax=ax)
        
        # 代替供給エッジ（点線、緑）
        if alt_edges:
            nx.draw_networkx_edges(G, pos, edgelist=alt_edges,
                                   edge_color=COLOR_ALTERNATIVE, arrows=True,
                                   arrowsize=18, alpha=0.6, width=2, ax=ax,
                                   style="dashed")
        
        # ラベル描画
        nx.draw_networkx_labels(G, pos, font_size=7, font_weight="bold", ax=ax)
        
        # タイトル（英語のみ）
        eq_info = earthquake_data.get("earthquake", {})
        eq_magnitude = eq_info.get("hypocenter", {}).get("magnitude", "?")
        eq_time = eq_info.get("time", "")
        eq_lat = eq_info.get("hypocenter", {}).get("latitude", "")
        eq_lon = eq_info.get("hypocenter", {}).get("longitude", "")
        
        title = f"Supply Chain Impact Analysis\nEarthquake: M{eq_magnitude}"
        if eq_lat and eq_lon:
            title += f" at ({eq_lat}, {eq_lon})"
        if eq_time:
            title += f" - {eq_time}"
        
        ax.set_title(title, fontsize=12, fontweight="bold", pad=20)
        
        # 凡例（英語）
        from matplotlib.patches import Patch, Rectangle
        from matplotlib.lines import Line2D
        
        legend_elements = [
            Line2D([0], [0], marker="o", color="w", markerfacecolor=COLOR_AFFECTED,
                   markersize=12, markeredgecolor="black", label="Affected Plant"),
            Line2D([0], [0], marker="o", color="w", markerfacecolor=COLOR_MATERIAL,
                   markersize=10, markeredgecolor="black", label="Material"),
            Line2D([0], [0], marker="o", color="w", markerfacecolor=COLOR_DOWNSTREAM,
                   markersize=12, markeredgecolor="black", label="Downstream Plant"),
            Line2D([0], [0], marker="o", color="w", markerfacecolor=COLOR_ALTERNATIVE,
                   markersize=12, markeredgecolor="black", label="Alternative Supplier"),
            Line2D([0], [0], color="#333333", linewidth=2, label="Supply Chain"),
            Line2D([0], [0], color=COLOR_ALTERNATIVE, linewidth=2, linestyle="--", 
                   label="Alternative Route"),
        ]
        
        ax.legend(handles=legend_elements, loc="lower right", fontsize=8, 
                  framealpha=0.95, fancybox=True, shadow=True)
        
        # 軸の範囲を設定（中央に余白を確保）
        ax.set_xlim(-1, 12)
        ax.set_ylim(0, 10)
        ax.axis("off")
        
        plt.tight_layout(pad=2.0)
        
        # 画像をバッファに保存
        buf = io.BytesIO()
        plt.savefig(buf, format="png", dpi=150, bbox_inches="tight", 
                    facecolor="white", edgecolor="none")
        buf.seek(0)
        plt.close()
        
        # S3に保存
        eq_id = earthquake_data.get("id", "unknown")
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        image_key = f"{OUTPUT_PREFIX}{timestamp}_{eq_id}_impact_graph.png"
        
        s3_client.put_object(
            Bucket=OUTPUT_BUCKET,
            Key=image_key,
            Body=buf.getvalue(),
            ContentType="image/png"
        )
        
        logger.info(f"影響グラフを保存しました: s3://{OUTPUT_BUCKET}/{image_key}")
        return image_key
        
    except Exception as e:
        logger.error(f"グラフ生成エラー: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None


def generate_interactive_map(
    earthquake_data: dict[str, Any], 
    all_results: list[dict[str, Any]],
    directly_affected_ids: set[str],
    downstream_affected_names: set[str]
) -> str | None:
    """
    インタラクティブなHTML地図を生成してS3に保存
    
    Args:
        earthquake_data: 地震データ
        all_results: 影響分析結果
        directly_affected_ids: 直接影響を受けた工場のIDセット
        downstream_affected_names: 下流で影響を受けた工場の名前セット
    
    Returns:
        S3キー（保存に成功した場合）
    """
    try:
        logger.info("インタラクティブ地図を生成します")
        
        # Neptuneから全データを取得
        locations = _fetch_all_locations()
        plants = _fetch_all_plants()
        supply_relations = _fetch_supply_relations()
        
        logger.info(f"直接影響を受けた工場: {len(directly_affected_ids)}件, IDs: {directly_affected_ids}")
        logger.info(f"下流で影響を受けた工場: {len(downstream_affected_names)}件, Names: {downstream_affected_names}")
        
        # 工場名からIDへのマッピングを作成
        plant_name_to_id = {}
        for plant in plants:
            plant_name_to_id[plant.get("plant_name")] = plant.get("plant_id")
        
        # 下流で影響を受けた工場の名前をIDに変換
        downstream_affected_ids = set()
        for plant_name in downstream_affected_names:
            plant_id = plant_name_to_id.get(plant_name)
            if plant_id and plant_id not in directly_affected_ids:
                downstream_affected_ids.add(plant_id)
        
        logger.info(f"下流で影響を受けた工場（ID解決後）: {len(downstream_affected_ids)}件, IDs: {downstream_affected_ids}")
        
        # 工場の稼働状況を集計
        active_count = sum(1 for p in plants if p.get("is_active"))
        inactive_count = len(plants) - active_count
        
        # 影響を受けた工場の総数
        total_affected_count = len(directly_affected_ids) + len(downstream_affected_ids)
        
        # 地震情報を取得
        eq_info = earthquake_data.get("earthquake", {})
        hypocenter = eq_info.get("hypocenter", {})
        eq_magnitude = hypocenter.get("magnitude", "不明")
        eq_place = hypocenter.get("name", "不明")
        eq_time = eq_info.get("time", "")
        
        # HTML地図を生成
        map_html = _generate_leaflet_map(
            locations=locations,
            plants=plants,
            supply_relations=supply_relations,
            directly_affected_ids=directly_affected_ids,
            downstream_affected_ids=downstream_affected_ids,
            active_count=active_count,
            inactive_count=inactive_count,
            earthquake_info={
                "magnitude": eq_magnitude,
                "place": eq_place,
                "time": eq_time,
                "directly_affected_count": len(directly_affected_ids),
                "downstream_affected_count": len(downstream_affected_ids),
                "total_affected_count": total_affected_count
            }
        )
        
        # S3に保存
        from datetime import datetime
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        eq_id = earthquake_data.get("id", "unknown")
        map_key = f"maps/supply_chain_map_{eq_id}_{timestamp}.html"
        
        s3_client.put_object(
            Bucket=OUTPUT_BUCKET,
            Key=map_key,
            Body=map_html.encode("utf-8"),
            ContentType="text/html",
            CacheControl="no-cache"
        )
        
        map_url = f"https://{OUTPUT_BUCKET}.s3.amazonaws.com/{map_key}"
        logger.info(f"地図を保存しました: {map_url}")
        
        return map_key
        
    except Exception as e:
        logger.error(f"地図生成中にエラーが発生しました: {e}", exc_info=True)
        return None


def _fetch_all_locations() -> list[dict[str, Any]]:
    """Neptuneから全Country（旧Location）情報を取得（v2スキーマ）"""
    query = """
    MATCH (c:Country)
    RETURN
        c.code as id,
        c.region as prefecture,
        c.name as city,
        c.lat as latitude,
        c.lon as longitude
    ORDER BY c.region, c.name
    """
    result = execute_neptune_query(query)
    # execute_neptune_queryは辞書を返す可能性があるため、resultsキーを確認
    if isinstance(result, dict) and "results" in result:
        return result["results"]
    return result if isinstance(result, list) else []


def _fetch_all_plants() -> list[dict[str, Any]]:
    """Neptuneから全工場情報を取得（v2スキーマ）"""
    query = """
    MATCH (p:Plant)-[:LOCATED_IN]->(c:Country)
    OPTIONAL MATCH (prod:Product)-[:PRODUCED_AT]->(p)
    OPTIONAL MATCH (prod)-[:HAS_COMPONENT]->(m:Material)
    RETURN
        p.id as plant_id,
        p.name as plant_name,
        p.capacity as capacity,
        p.plant_type as is_active,
        c.name as city,
        p.country_code as prefecture,
        p.lat as latitude,
        p.lon as longitude,
        collect(DISTINCT m.name) as materials
    """
    result = execute_neptune_query(query)
    # execute_neptune_queryは辞書を返す可能性があるため、resultsキーを確認
    if isinstance(result, dict) and "results" in result:
        plants = result["results"]
    else:
        plants = result if isinstance(result, list) else []
    
    logger.info(f"取得した工場データ: {len(plants)}件")
    return plants


def _fetch_supply_relations() -> list[dict[str, Any]]:
    """Neptuneからサプライチェーン関係を取得（v2スキーマ: Plant has lat/lon directly）"""
    query = """
    MATCH (supplier)-[:SUPPLIES_TO]->(consumer:Plant)
    WHERE supplier:Plant OR supplier:Supplier
    RETURN
        supplier.id as supplier_id,
        supplier.name as supplier_name,
        supplier.lat as supplier_lat,
        supplier.lon as supplier_lon,
        consumer.id as consumer_id,
        consumer.name as consumer_name,
        consumer.lat as consumer_lat,
        consumer.lon as consumer_lon
    """
    result = execute_neptune_query(query)
    # execute_neptune_queryは辞書を返す可能性があるため、resultsキーを確認
    if isinstance(result, dict) and "results" in result:
        return result["results"]
    return result if isinstance(result, list) else []


def _generate_leaflet_map(
    locations: list[dict[str, Any]],
    plants: list[dict[str, Any]],
    supply_relations: list[dict[str, Any]],
    directly_affected_ids: set[str],
    downstream_affected_ids: set[str],
    active_count: int,
    inactive_count: int,
    earthquake_info: dict[str, Any]
) -> str:
    """Leaflet.jsを使用してHTML地図を生成"""
    
    # GeoJSON形式でデータを準備
    plant_features = []
    for plant in plants:
        lat = plant.get("latitude")
        lon = plant.get("longitude")
        
        if lat is None or lon is None:
            continue
        
        # 影響レベルを判定
        plant_id = plant["plant_id"]
        if plant_id in directly_affected_ids:
            impact_level = "direct"
            color = "#ff3333"  # 赤色（直接影響）
        elif plant_id in downstream_affected_ids:
            impact_level = "downstream"
            color = "#ff9933"  # オレンジ色（下流影響）
        else:
            impact_level = "none"
            color = "#3388ff"  # 青色（影響なし）
        
        materials = plant.get("materials", [])
        materials_str = ", ".join([m for m in materials if m]) if materials else "なし"
        
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            },
            "properties": {
                "type": "plant",
                "plant_id": plant["plant_id"],
                "plant_name": plant["plant_name"],
                "prefecture": plant["prefecture"],
                "city": plant["city"],
                "capacity": plant["capacity"],
                "is_active": plant.get("is_active", True),
                "materials": materials_str,
                "impact_level": impact_level
            }
        }
        plant_features.append(feature)
    
    location_features = []
    for loc in locations:
        lat = loc.get("latitude")
        lon = loc.get("longitude")
        
        if lat is None or lon is None:
            continue
        
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            },
            "properties": {
                "type": "location",
                "prefecture": loc["prefecture"],
                "city": loc["city"]
            }
        }
        location_features.append(feature)
    
    # サプライチェーン関係をGeoJSON LineString形式に変換
    supply_line_features = []
    for relation in supply_relations:
        supplier_lat = relation.get("supplier_lat")
        supplier_lon = relation.get("supplier_lon")
        consumer_lat = relation.get("consumer_lat")
        consumer_lon = relation.get("consumer_lon")
        
        if all([supplier_lat, supplier_lon, consumer_lat, consumer_lon]):
            feature = {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [supplier_lon, supplier_lat],
                        [consumer_lon, consumer_lat]
                    ]
                },
                "properties": {
                    "supplier_id": relation["supplier_id"],
                    "supplier_name": relation["supplier_name"],
                    "consumer_id": relation["consumer_id"],
                    "consumer_name": relation["consumer_name"]
                }
            }
            supply_line_features.append(feature)
    
    # HTMLテンプレート
    html_template = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>サプライチェーン地図可視化</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        body {{ margin: 0; padding: 0; font-family: Arial, sans-serif; }}
        #map {{ position: absolute; top: 0; bottom: 0; width: 100%; }}
        .info-panel {{
            position: absolute;
            top: 10px;
            left: 50px;
            z-index: 1000;
            background: white;
            padding: 0;
            border: 2px solid #ccc;
            border-radius: 5px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            width: 350px;
            max-height: 80vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }}
        .panel-header {{
            padding: 15px;
            border-bottom: 1px solid #ddd;
            background: #f8f9fa;
        }}
        .panel-header h3 {{ margin: 0 0 10px 0; font-size: 18px; }}
        .panel-header p {{ margin: 5px 0; font-size: 14px; }}
        .status-grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-top: 10px;
        }}
        .status-item {{
            padding: 8px;
            border-radius: 4px;
            text-align: center;
            font-weight: bold;
            font-size: 13px;
        }}
        .status-active {{ background: #d4edda; color: #155724; }}
        .status-inactive {{ background: #f8d7da; color: #721c24; }}
        .earthquake-info {{
            background: #fff3cd;
            padding: 10px;
            border-radius: 4px;
            margin-top: 10px;
            border-left: 4px solid #ffc107;
            font-size: 13px;
        }}
        .panel-tabs {{
            display: flex;
            border-bottom: 1px solid #ddd;
            background: #f8f9fa;
        }}
        .tab {{
            flex: 1;
            padding: 10px;
            text-align: center;
            cursor: pointer;
            border: none;
            background: none;
            font-size: 14px;
            font-weight: 500;
        }}
        .tab.active {{
            background: white;
            border-bottom: 2px solid #007bff;
            color: #007bff;
        }}
        .tab:hover {{ background: #e9ecef; }}
        .panel-content {{
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        }}
        .plant-list {{
            list-style: none;
            padding: 0;
            margin: 0;
        }}
        .plant-item {{
            padding: 10px;
            margin-bottom: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 13px;
        }}
        .plant-item:hover {{
            background: #f8f9fa;
            border-color: #007bff;
            transform: translateX(2px);
        }}
        .plant-item.active {{ background: #e7f3ff; border-color: #007bff; }}
        .plant-item.affected {{ border-left: 4px solid #dc3545; }}
        .plant-name {{ font-weight: bold; margin-bottom: 4px; }}
        .plant-details {{ font-size: 12px; color: #666; }}
        .pagination {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px;
            border-top: 1px solid #ddd;
            background: #f8f9fa;
            font-size: 13px;
        }}
        .pagination button {{
            padding: 5px 12px;
            border: 1px solid #ddd;
            background: white;
            border-radius: 3px;
            cursor: pointer;
        }}
        .pagination button:disabled {{
            opacity: 0.5;
            cursor: not-allowed;
        }}
        .pagination button:hover:not(:disabled) {{
            background: #e9ecef;
        }}
        .legend {{
            position: absolute;
            bottom: 30px;
            right: 10px;
            z-index: 1000;
            background: white;
            padding: 10px;
            border: 2px solid #ccc;
            border-radius: 5px;
            font-size: 13px;
        }}
        .legend-item {{ margin: 5px 0; }}
        .legend-icon {{ display: inline-block; width: 16px; height: 16px; margin-right: 5px; vertical-align: middle; }}
    </style>
</head>
<body>
    <div class="info-panel">
        <div class="panel-header">
            <h3>サプライチェーン地図</h3>
            <p>工場: {len(plants)}箇所 | 都市: {len(locations)}箇所</p>
            
            <div class="status-grid">
                <div class="status-item status-active">
                    稼働中<br>{active_count}箇所
                </div>
                <div class="status-item status-inactive">
                    停止中<br>{inactive_count}箇所
                </div>
            </div>
            
            {f'''<div class="earthquake-info">
                <strong>地震影響</strong><br>
                震源地: {earthquake_info["place"]}<br>
                マグニチュード: M{earthquake_info["magnitude"]}<br>
                直接影響: {earthquake_info["directly_affected_count"]}箇所<br>
                下流影響: {earthquake_info["downstream_affected_count"]}箇所<br>
                合計: {earthquake_info["total_affected_count"]}箇所
            </div>''' if earthquake_info["total_affected_count"] > 0 else ''}
        </div>
        
        <div class="panel-tabs">
            <button class="tab active" id="tabAll">全工場</button>
            <button class="tab" id="tabAffected">影響工場</button>
        </div>
        
        <div class="panel-content">
            <ul class="plant-list" id="plantList"></ul>
        </div>
        
        <div class="pagination">
            <button id="prevBtn">前へ</button>
            <span id="pageInfo">1 / 1</span>
            <button id="nextBtn">次へ</button>
        </div>
    </div>
    
    <div class="legend">
        <h4 style="margin: 0 0 10px 0;">凡例</h4>
        <div class="legend-item">
            <span class="legend-icon" style="background: #ff3333; border-radius: 50%;"></span>直接影響工場
        </div>
        <div class="legend-item">
            <span class="legend-icon" style="background: #ff9933; border-radius: 50%;"></span>下流影響工場
        </div>
        <div class="legend-item">
            <span class="legend-icon" style="background: #3388ff; border-radius: 50%;"></span>通常工場
        </div>
        <div class="legend-item">
            <span class="legend-icon" style="background: #33cc33; border-radius: 50%;"></span>都市
        </div>
        <div class="legend-item">
            <span style="display: inline-block; width: 20px; height: 2px; background: #666; margin-right: 5px;"></span>供給関係
        </div>
    </div>
    
    <div id="map"></div>
    
    <script>
        // 地図を初期化（日本の中心、日本に限定）
        var map = L.map('map', {{
            center: [36.2048, 138.2529],
            zoom: 6,
            minZoom: 5,
            maxZoom: 18,
            maxBounds: [[24, 122], [46, 154]],  // 日本の範囲に制限
            maxBoundsViscosity: 1.0
        }});
        
        // OpenStreetMapタイルを追加
        L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18
        }}).addTo(map);
        
        // データ
        var plantData = {json.dumps(plant_features, ensure_ascii=False)};
        var locationData = {json.dumps(location_features, ensure_ascii=False)};
        var supplyLines = {json.dumps(supply_line_features, ensure_ascii=False)};
        
        // マーカーを保存するオブジェクト
        var plantMarkers = {{}};
        
        // ページング設定
        var currentPage = 1;
        var itemsPerPage = 10;
        var currentFilter = 'all';
        var filteredPlants = plantData;
        
        // サプライチェーン関係の線を描画
        supplyLines.forEach(function(feature) {{
            var coords = feature.geometry.coordinates;
            var props = feature.properties;
            
            var polyline = L.polyline(
                coords.map(c => [c[1], c[0]]),  // [lon, lat] -> [lat, lon]
                {{
                    color: '#666',
                    weight: 1.5,
                    opacity: 0.5,
                    dashArray: '5, 5'
                }}
            );
            
            polyline.bindTooltip(
                props.supplier_name + ' → ' + props.consumer_name,
                {{ sticky: true }}
            );
            
            polyline.addTo(map);
        }});
        
        // 工場マーカーを追加
        plantData.forEach(function(feature) {{
            var props = feature.properties;
            var coords = feature.geometry.coordinates;
            
            // 影響レベルに応じて色を設定
            var color;
            var impactText = '';
            if (props.impact_level === 'direct') {{
                color = '#ff3333';  // 赤色（直接影響）
                impactText = '<p style="color: #ff3333; font-weight: bold; margin: 10px 0 0 0;">直接影響あり</p>';
            }} else if (props.impact_level === 'downstream') {{
                color = '#ff9933';  // オレンジ色（下流影響）
                impactText = '<p style="color: #ff9933; font-weight: bold; margin: 10px 0 0 0;">下流影響あり</p>';
            }} else {{
                color = '#3388ff';  // 青色（影響なし）
            }}
            
            var icon = L.divIcon({{
                className: 'custom-icon',
                html: '<div style="background-color: ' + color + '; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>',
                iconSize: [18, 18]
            }});
            
            var statusText = props.is_active ? '稼働中' : '停止中';
            var statusColor = props.is_active ? 'green' : 'orange';
            
            var popupContent = '<div style="min-width: 220px;">' +
                '<h4 style="margin: 0 0 10px 0;">' + props.plant_name + '</h4>' +
                '<p style="margin: 5px 0;"><b>ID:</b> ' + props.plant_id + '</p>' +
                '<p style="margin: 5px 0;"><b>所在地:</b> ' + props.prefecture + ' ' + props.city + '</p>' +
                '<p style="margin: 5px 0;"><b>生産能力:</b> ' + props.capacity + '</p>' +
                '<p style="margin: 5px 0;"><b>供給素材:</b> ' + props.materials + '</p>' +
                '<p style="margin: 5px 0; color: ' + statusColor + ';"><b>稼働状況:</b> ' + statusText + '</p>' +
                impactText +
                '</div>';
            
            var marker = L.marker([coords[1], coords[0]], {{ icon: icon }})
                .bindPopup(popupContent)
                .bindTooltip(props.plant_name)
                .addTo(map);
            
            plantMarkers[props.plant_id] = marker;
        }});
        
        // 都市マーカーを追加
        locationData.forEach(function(feature) {{
            var props = feature.properties;
            var coords = feature.geometry.coordinates;
            
            L.circleMarker([coords[1], coords[0]], {{
                radius: 5,
                fillColor: '#33cc33',
                color: '#33cc33',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.6
            }})
            .bindPopup(props.prefecture + ' ' + props.city)
            .bindTooltip(props.city)
            .addTo(map);
        }});
        
        // タブ切り替え
        function switchTab(filter) {{
            currentFilter = filter;
            currentPage = 1;
            
            // タブのアクティブ状態を更新
            document.querySelectorAll('.tab').forEach(function(tab) {{
                tab.classList.remove('active');
            }});
            
            // クリックされたタブをアクティブに
            var tabs = document.querySelectorAll('.tab');
            if (filter === 'all') {{
                tabs[0].classList.add('active');
            }} else {{
                tabs[1].classList.add('active');
            }}
            
            // フィルタリング
            if (filter === 'all') {{
                filteredPlants = plantData;
            }} else if (filter === 'affected') {{
                filteredPlants = plantData.filter(function(p) {{
                    return p.properties.impact_level === 'direct' || p.properties.impact_level === 'downstream';
                }});
            }}
            
            renderPlantList();
        }}
        
        // 工場リストを描画
        function renderPlantList() {{
            var startIdx = (currentPage - 1) * itemsPerPage;
            var endIdx = startIdx + itemsPerPage;
            var pageData = filteredPlants.slice(startIdx, endIdx);
            
            var listHtml = '';
            pageData.forEach(function(feature) {{
                var props = feature.properties;
                var isAffected = props.impact_level === 'direct' || props.impact_level === 'downstream';
                var affectedClass = isAffected ? 'affected' : '';
                var statusText = props.is_active ? '稼働中' : '停止中';
                
                listHtml += '<li class="plant-item ' + affectedClass + '" data-plant-id="' + props.plant_id + '">' +
                    '<div class="plant-name">' + props.plant_name + '</div>' +
                    '<div class="plant-details">' +
                    props.city + ' | ' + statusText + '<br>' +
                    '生産品目: ' + props.materials +
                    '</div>' +
                    '</li>';
            }});
            
            document.getElementById('plantList').innerHTML = listHtml;
            
            // 工場リストアイテムにクリックイベントを追加
            document.querySelectorAll('.plant-item').forEach(function(item) {{
                item.addEventListener('click', function() {{
                    var plantId = this.getAttribute('data-plant-id');
                    focusPlant(plantId, this);
                }});
            }});
            
            // ページング情報を更新
            var totalPages = Math.ceil(filteredPlants.length / itemsPerPage);
            document.getElementById('pageInfo').textContent = currentPage + ' / ' + totalPages;
            document.getElementById('prevBtn').disabled = currentPage === 1;
            document.getElementById('nextBtn').disabled = currentPage >= totalPages;
        }}
        
        // 工場にフォーカス
        function focusPlant(plantId, element) {{
            var marker = plantMarkers[plantId];
            if (marker) {{
                map.setView(marker.getLatLng(), 10);
                marker.openPopup();
                
                // リストアイテムのアクティブ状態を更新
                document.querySelectorAll('.plant-item').forEach(function(item) {{
                    item.classList.remove('active');
                }});
                if (element) {{
                    element.classList.add('active');
                }}
            }}
        }}
        
        // ページング
        function prevPage() {{
            if (currentPage > 1) {{
                currentPage--;
                renderPlantList();
            }}
        }}
        
        function nextPage() {{
            var totalPages = Math.ceil(filteredPlants.length / itemsPerPage);
            if (currentPage < totalPages) {{
                currentPage++;
                renderPlantList();
            }}
        }}
        
        // 初期表示
        renderPlantList();
        
        // イベントリスナーを設定
        document.getElementById('tabAll').addEventListener('click', function() {{
            switchTab('all');
        }});
        
        document.getElementById('tabAffected').addEventListener('click', function() {{
            switchTab('affected');
        }});
        
        document.getElementById('prevBtn').addEventListener('click', function() {{
            prevPage();
        }});
        
        document.getElementById('nextBtn').addEventListener('click', function() {{
            nextPage();
        }});
    </script>
</body>
</html>
    """
    
    return html_template
