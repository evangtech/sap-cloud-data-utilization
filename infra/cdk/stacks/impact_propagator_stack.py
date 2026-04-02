"""影響伝播スタック

リソース:
- impact_propagator Lambda
- Neptune + DynamoDBシーケンステーブル権限
"""
from aws_cdk import (
    Stack, Duration,
    aws_lambda as lambda_,
    aws_iam as iam,
)
from constructs import Construct


class ImpactPropagatorStack(Stack):
    def __init__(
        self, scope: Construct, construct_id: str, *,
        cursor_table,
        neptune_graph_id: str = 'g-844qqbri1a',
        neptune_region: str = 'us-west-2',
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        self.propagator_function = lambda_.Function(
            self, 'ImpactPropagator',
            function_name='impact-propagator',
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler='__init__.handler',
            code=lambda_.Code.from_asset('../../src/lambda/impact_propagator'),
            timeout=Duration.seconds(180),
            memory_size=1024,
            environment={
                'NEPTUNE_GRAPH_ID': neptune_graph_id,
                'NEPTUNE_REGION': neptune_region,
                'CURSOR_TABLE': cursor_table.table_name,
            },
        )

        # Neptune権限
        self.propagator_function.add_to_role_policy(iam.PolicyStatement(
            actions=[
                'neptune-graph:ExecuteQuery',
                'neptune-graph:ReadDataViaQuery',
                'neptune-graph:WriteDataViaQuery',
                'neptune-graph:DeleteDataViaQuery',
                'neptune-graph:GetGraph',
            ],
            resources=['*'],
        ))

        # DynamoDBシーケンステーブル権限
        cursor_table.grant_read_write_data(self.propagator_function)
