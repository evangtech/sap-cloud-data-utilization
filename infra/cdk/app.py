#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
サプライチェーン予測システム - CDKアプリケーション
"""
import aws_cdk as cdk

from stacks.earthquake_stack import EarthquakeStack
from stacks.neptune_impact_analyzer_stack import NeptuneImpactAnalyzerStack
from stacks.risk_event_ingester_stack import RiskEventIngesterStack
from stacks.impact_propagator_stack import ImpactPropagatorStack

app = cdk.App()

# ポーリング間隔をコンテキストから取得（デフォルト60分）
polling_interval = app.node.try_get_context("polling_interval_minutes") or 60

# Neptune設定をコンテキストから取得
neptune_graph_id = app.node.try_get_context("neptune_graph_id") or "g-844qqbri1a"
neptune_region = app.node.try_get_context("neptune_region") or "us-west-2"

# S3バケット名をコンテキストから取得
s3_bucket_name = app.node.try_get_context("s3_bucket_name") or "supply-chain-earthquake-data-454953018734"

# 環境設定（S3とNeptuneが同じリージョン）
us_west_2_env = cdk.Environment(region="us-west-2")

# 地震情報取得パイプライン（us-west-2）
earthquake_stack = EarthquakeStack(
    app,
    "EarthquakeStack",
    polling_interval_minutes=int(polling_interval),
    s3_bucket_name=s3_bucket_name,
    env=us_west_2_env,
)

# Neptune影響分析Lambda（us-west-2 - S3トリガーのため同じリージョン）
NeptuneImpactAnalyzerStack(
    app,
    "NeptuneImpactAnalyzerStack",
    bucket=earthquake_stack.bucket,
    neptune_graph_id=neptune_graph_id,
    neptune_region=neptune_region,
    env=us_west_2_env,
)

# リスクイベント取り込みパイプライン（us-west-2）
risk_ingester_stack = RiskEventIngesterStack(
    app,
    "RiskEventIngesterStack",
    s3_bucket=earthquake_stack.bucket,
    neptune_graph_id=neptune_graph_id,
    neptune_region=neptune_region,
    polling_interval_minutes=int(polling_interval),
    env=us_west_2_env,
)

# 影響伝播Lambda（us-west-2）
ImpactPropagatorStack(
    app,
    "ImpactPropagatorStack",
    cursor_table=risk_ingester_stack.cursor_table,
    neptune_graph_id=neptune_graph_id,
    neptune_region=neptune_region,
    env=us_west_2_env,
)

app.synth()
