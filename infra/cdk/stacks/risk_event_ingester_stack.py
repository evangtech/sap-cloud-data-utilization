"""リスクイベント取り込みスタック

リソース:
- risk_event_ingester Lambda (EventBridgeトリガー)
- risk-event-registry DynamoDBテーブル (正規的イベントマッピング、TTLなし)
- risk-event-ingest-lock DynamoDBテーブル (短期取り込みロック、TTLあり)
- risk-event-provider-cursors DynamoDBテーブル (プロバイダー状態 + 伝播シーケンスカウンター)
"""
from aws_cdk import (
    Stack, Duration, RemovalPolicy,
    aws_lambda as lambda_,
    aws_events as events,
    aws_events_targets as targets,
    aws_dynamodb as dynamodb,
    aws_iam as iam,
)
from constructs import Construct


class RiskEventIngesterStack(Stack):
    def __init__(
        self, scope: Construct, construct_id: str, *,
        s3_bucket,
        neptune_graph_id: str = 'g-844qqbri1a',
        neptune_region: str = 'us-west-2',
        polling_interval_minutes: int = 60,
        propagator_function_name: str = 'impact-propagator',
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # DynamoDB: 正規的イベントレジストリ（TTLなし）
        self.registry_table = dynamodb.Table(
            self, 'RiskEventRegistry',
            table_name='risk-event-registry',
            partition_key=dynamodb.Attribute(
                name='dedupeKey', type=dynamodb.AttributeType.STRING,
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.RETAIN,
        )

        # DynamoDB: 短期取り込みロック（TTL: 5分リース）
        self.lock_table = dynamodb.Table(
            self, 'RiskEventIngestLock',
            table_name='risk-event-ingest-lock',
            partition_key=dynamodb.Attribute(
                name='dedupeKey', type=dynamodb.AttributeType.STRING,
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
            time_to_live_attribute='ttl',
        )

        # DynamoDB: プロバイダーカーソル + 伝播シーケンスカウンター
        self.cursor_table = dynamodb.Table(
            self, 'RiskEventProviderCursors',
            table_name='risk-event-provider-cursors',
            partition_key=dynamodb.Attribute(
                name='providerId', type=dynamodb.AttributeType.STRING,
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.RETAIN,
        )

        # Lambda: リスクイベント取り込み
        self.ingester_function = lambda_.Function(
            self, 'RiskEventIngester',
            function_name='risk-event-ingester',
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler='__init__.handler',
            code=lambda_.Code.from_asset('../../src/lambda/risk_event_ingester'),
            timeout=Duration.seconds(120),
            memory_size=512,
            environment={
                'NEPTUNE_GRAPH_ID': neptune_graph_id,
                'NEPTUNE_REGION': neptune_region,
                'BUCKET_NAME': s3_bucket.bucket_name,
                'REGISTRY_TABLE': self.registry_table.table_name,
                'LOCK_TABLE': self.lock_table.table_name,
                'CURSOR_TABLE': self.cursor_table.table_name,
                'PROPAGATOR_FUNCTION_NAME': propagator_function_name,
            },
        )

        # S3権限
        s3_bucket.grant_read_write(self.ingester_function)

        # DynamoDB権限
        self.registry_table.grant_read_write_data(self.ingester_function)
        self.lock_table.grant_read_write_data(self.ingester_function)
        self.cursor_table.grant_read_write_data(self.ingester_function)

        # Neptune権限
        self.ingester_function.add_to_role_policy(iam.PolicyStatement(
            actions=[
                'neptune-graph:ExecuteQuery',
                'neptune-graph:ReadDataViaQuery',
                'neptune-graph:WriteDataViaQuery',
                'neptune-graph:GetGraph',
            ],
            resources=['*'],
        ))

        # EventBridgeスケジュール
        rule = events.Rule(
            self, 'IngesterSchedule',
            schedule=events.Schedule.rate(
                Duration.minutes(polling_interval_minutes),
            ),
        )
        rule.add_target(targets.LambdaFunction(self.ingester_function))
