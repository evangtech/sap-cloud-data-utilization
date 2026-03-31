# -*- coding: utf-8 -*-
"""
地震情報取得Lambda関数
P2PQuake APIから地震情報を取得し、S3に保存します
重複チェック機能付き - 同じ地震IDは保存しない
"""
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import boto3
import urllib3
from botocore.exceptions import ClientError

# ロガー設定
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# 環境変数
BUCKET_NAME = os.environ.get("BUCKET_NAME", "supply-chain-earthquake-data-454953018734")
API_URL = "https://api.p2pquake.net/v2/jma/quake"

# クライアント初期化
s3_client = boto3.client("s3")
http = urllib3.PoolManager()


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Lambda関数のエントリーポイント
    
    Args:
        event: イベントデータ
        context: Lambda実行コンテキスト
    
    Returns:
        処理結果
    """
    try:
        logger.info("地震情報の取得を開始します")
        
        # P2PQuake APIから地震情報を取得
        earthquakes = fetch_earthquakes()
        
        if not earthquakes:
            logger.info("APIから地震情報を取得できませんでした")
            return {
                "statusCode": 200,
                "body": json.dumps({"message": "取得データなし", "count": 0}, ensure_ascii=False)
            }
        
        # 各地震情報をS3に保存（重複チェック付き）
        saved_count = 0
        skipped_count = 0
        for eq in earthquakes:
            result = save_earthquake_to_s3(eq)
            if result == "saved":
                saved_count += 1
            elif result == "skipped":
                skipped_count += 1
        
        logger.info(f"新規保存: {saved_count}件, スキップ（既存）: {skipped_count}件")
        
        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "成功",
                "saved": saved_count,
                "skipped": skipped_count
            }, ensure_ascii=False)
        }
        
    except Exception as e:
        logger.error(f"エラーが発生しました: {e}")
        raise


def fetch_earthquakes(limit: int = 10, quake_type: str = "DetailScale") -> list[dict[str, Any]]:
    """
    P2PQuake APIから地震情報を取得
    
    Args:
        limit: 取得件数
        quake_type: 地震情報の種類（DetailScale: 震度速報付き）
    
    Returns:
        地震情報のリスト
    """
    try:
        # クエリパラメータを構築
        url = f"{API_URL}?limit={limit}"
        if quake_type:
            url += f"&quake_type={quake_type}"
        
        response = http.request(
            "GET",
            url,
            timeout=30.0
        )
        
        if response.status != 200:
            logger.error(f"API呼び出しに失敗しました: ステータス {response.status}, URL: {url}")
            return []
        
        data = json.loads(response.data.decode("utf-8"))
        logger.info(f"{len(data)}件の地震情報を取得しました")
        return data
        
    except Exception as e:
        logger.error(f"API呼び出し中にエラーが発生しました: {e}")
        return []


def check_exists_in_s3(s3_key: str) -> bool:
    """
    S3にファイルが存在するかチェック
    
    Args:
        s3_key: S3オブジェクトキー
    
    Returns:
        存在する場合True
    """
    try:
        s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "404":
            return False
        raise


def save_earthquake_to_s3(earthquake: dict[str, Any]) -> str:
    """
    地震情報をS3に保存（重複チェック付き）
    
    Args:
        earthquake: 地震情報
    
    Returns:
        "saved": 新規保存, "skipped": 既存のためスキップ, "error": エラー
    """
    try:
        # 地震発生時刻を取得
        eq_time = earthquake.get("earthquake", {}).get("time", "")
        if not eq_time:
            # 時刻がない場合は現在時刻を使用
            eq_time = datetime.now(timezone.utc).strftime("%Y/%m/%d %H:%M:%S")
        
        # 時刻をパース（形式: "2026/01/22 14:30:00"）
        dt = datetime.strptime(eq_time, "%Y/%m/%d %H:%M:%S")
        
        # 地震ID（P2PQuakeが付与する一意のID）
        eq_id = earthquake.get("id", dt.strftime("%Y%m%d%H%M%S"))
        
        # 震源情報を取得
        hypocenter_data = earthquake.get("earthquake", {}).get("hypocenter", {})
        
        # マグニチュード取得（hypocenter内にある）
        magnitude = hypocenter_data.get("magnitude", "unknown")
        
        # 震源地取得
        hypocenter = hypocenter_data.get("name", "unknown")
        # ファイル名に使えない文字を置換
        hypocenter_safe = hypocenter.replace("/", "-").replace(" ", "_")
        
        # S3パス生成（Hive形式パーティション + 地震IDで一意性を保証）
        s3_key = (
            f"earthquakes/"
            f"year={dt.year}/"
            f"month={dt.month:02d}/"
            f"day={dt.day:02d}/"
            f"{eq_id}_{dt.strftime('%Y-%m-%dT%H-%M-%S')}_M{magnitude}_{hypocenter_safe}.json"
        )
        
        # 重複チェック
        if check_exists_in_s3(s3_key):
            logger.debug(f"既存のためスキップ: {eq_id}")
            return "skipped"
        
        # S3に保存
        s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=json.dumps(earthquake, ensure_ascii=False, indent=2),
            ContentType="application/json"
        )
        
        logger.info(f"保存完了: s3://{BUCKET_NAME}/{s3_key}")
        return "saved"
        
    except Exception as e:
        logger.error(f"S3保存中にエラーが発生しました: {e}")
        return "error"
