# -*- coding: utf-8 -*-
"""
地震情報取得パイプライン CDKスタック
"""
from aws_cdk import (
    Duration,
    Stack,
    aws_events as events,
    aws_events_targets as targets,
    aws_iam as iam,
    aws_lambda as lambda_,
    aws_s3 as s3,
)
from constructs import Construct


class EarthquakeStack(Stack):
    """
    地震情報取得パイプラインのインフラを定義するスタック
    
    - S3バケット（地震データ保存用）
    - Lambda関数（P2PQuake API呼び出し）
    - EventBridge Rule（設定可能な間隔でトリガー）
    
    Args:
        polling_interval_minutes: ポーリング間隔（分）。デフォルト60分
    """

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        polling_interval_minutes: int = 60,
        **kwargs
    ) -> None:
        # polling_interval_minutesを除外してからStackに渡す
        super().__init__(scope, construct_id, **kwargs)
        
        self.polling_interval_minutes = polling_interval_minutes

        # 既存のS3バケットを参照
        self.bucket = s3.Bucket.from_bucket_name(
            self,
            "EarthquakeDataBucket",
            bucket_name="supply-chain-earthquake-data"
        )

        # Lambda関数作成
        self.fetcher_function = lambda_.Function(
            self,
            "EarthquakeFetcherFunction",
            function_name="earthquake-fetcher",
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler="__init__.handler",
            code=lambda_.Code.from_asset("../../src/lambda/earthquake_fetcher"),
            timeout=Duration.seconds(60),
            memory_size=256,
            environment={
                "BUCKET_NAME": self.bucket.bucket_name,
            },
        )

        # LambdaにS3読み書き権限を付与（重複チェックにHeadObjectが必要）
        self.bucket.grant_read_write(self.fetcher_function)

        # EventBridge Rule（ポーリング間隔は変数で設定）
        self.schedule_rule = events.Rule(
            self,
            "EarthquakeFetcherSchedule",
            rule_name="earthquake-fetcher-schedule",
            schedule=events.Schedule.rate(Duration.minutes(self.polling_interval_minutes)),
            description=f"{self.polling_interval_minutes}分間隔で地震情報を取得（重複チェック付き）",
        )

        # LambdaをEventBridgeのターゲットに設定
        self.schedule_rule.add_target(
            targets.LambdaFunction(self.fetcher_function)
        )
