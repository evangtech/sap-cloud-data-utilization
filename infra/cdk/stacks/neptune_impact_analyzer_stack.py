# -*- coding: utf-8 -*-
"""
Neptune影響分析 CDKスタック
"""
from aws_cdk import (
    Duration,
    Stack,
    aws_iam as iam,
    aws_lambda as lambda_,
    aws_s3 as s3,
    aws_s3_notifications as s3n,
)
from constructs import Construct


class NeptuneImpactAnalyzerStack(Stack):
    """
    Neptune影響分析Lambda関数のインフラを定義するスタック
    
    - Lambda関数（Neptune Analyticsクエリ実行、グラフ生成）
    - IAMポリシー（Neptune Analytics、S3アクセス）
    
    Args:
        bucket: 地震データを保存するS3バケット（EarthquakeStackから参照）
        neptune_graph_id: Neptune AnalyticsのグラフID
    """

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        bucket: s3.IBucket,
        neptune_graph_id: str = "g-1my3glnp96",
        neptune_region: str = "us-west-2",
        **kwargs
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # matplotlib/networkx Lambda Layer
        graph_layer = lambda_.LayerVersion.from_layer_version_arn(
            self,
            "GraphVisualizationLayer",
            layer_version_arn="arn:aws:lambda:us-west-2:730335555874:layer:matplotlib-networkx-layer:1"
        )

        # Lambda関数作成
        self.analyzer_function = lambda_.Function(
            self,
            "NeptuneImpactAnalyzerFunction",
            function_name="neptune-impact-analyzer",
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler="__init__.handler",
            code=lambda_.Code.from_asset("../../src/lambda/neptune_impact_analyzer"),
            timeout=Duration.seconds(180),
            memory_size=1024,
            layers=[graph_layer],
            environment={
                "NEPTUNE_GRAPH_ID": neptune_graph_id,
                "NEPTUNE_REGION": neptune_region,
                "OUTPUT_BUCKET": bucket.bucket_name,
                "OUTPUT_PREFIX": "impact-analysis/",
            },
        )

        # S3読み書き権限を付与
        bucket.grant_read_write(self.analyzer_function)

        # Neptune Analytics権限を付与
        neptune_policy = iam.PolicyStatement(
            effect=iam.Effect.ALLOW,
            actions=[
                "neptune-graph:ExecuteQuery",
                "neptune-graph:GetGraph",
                "neptune-graph:ReadDataViaQuery",
                "neptune-graph:WriteDataViaQuery",
                "neptune-graph:DeleteDataViaQuery",
            ],
            resources=[
                f"arn:aws:neptune-graph:{neptune_region}:*:graph/{neptune_graph_id}"
            ],
        )
        self.analyzer_function.add_to_role_policy(neptune_policy)

        # S3イベント通知を設定（earthquakes/プレフィックスのみ）
        bucket.add_event_notification(
            s3.EventType.OBJECT_CREATED,
            s3n.LambdaDestination(self.analyzer_function),
            s3.NotificationKeyFilter(prefix="earthquakes/", suffix=".json"),
        )
