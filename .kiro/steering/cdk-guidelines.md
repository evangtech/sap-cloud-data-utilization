---
inclusion: fileMatch
fileMatchPattern: "**/*.py"
---

# AWS CDK 開発ガイドライン

## 基本方針

- CDKはPythonで記述すること
- L2コンストラクトを優先的に使用すること
- セキュリティベストプラクティスに従うこと

## S3バケット設定

```python
# 例: セキュアなS3バケット作成
bucket = s3.Bucket(
    self, "DataBucket",
    bucket_name="supply-chain-earthquake-data",
    encryption=s3.BucketEncryption.S3_MANAGED,
    block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
    versioned=True,
    removal_policy=RemovalPolicy.RETAIN,
)
```

## Lambda関数設定

- ランタイム: Python 3.11
- タイムアウト: 用途に応じて適切に設定（デフォルト30秒）
- メモリ: 最小限から開始し、必要に応じて調整

## 命名規則

- スタック名: `{プロジェクト名}-{環境}-{機能}`
- リソース名: ケバブケース（例: `earthquake-data-bucket`）
