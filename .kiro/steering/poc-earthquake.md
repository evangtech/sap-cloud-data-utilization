---
inclusion: manual
---

# POC: 地震情報・ニュース取得パイプライン

## 目的

地震情報と関連ニュースを取得し、S3に保存する最初のPOCを実装する。

## 処理フロー

1. **地震情報取得** - 気象庁API（P2P地震情報API）から最新の地震データを取得
2. **ニュース取得** - NewsAPIから地震関連ニュースを取得
3. **S3保存** - 取得したデータをJSON形式でS3に保存

## データソース

### 地震情報API
- URL: `https://api.p2pquake.net/v2/jma/quake?quake_type=DetailScale`
- 認証: 不要
- レスポンス: 地震の発生日時、震源地、マグニチュード、各地の震度

### ニュースAPI
- URL: `https://newsapi.org/v2/everything`
- 認証: APIキー必要
- クエリ: `earthquake Japan supply chain`

## S3保存形式

```
s3://supply-chain-earthquake-data/
├── raw/
│   ├── earthquake/{yyyy}/{mm}/{dd}/earthquake_{timestamp}.json
│   └── news/{yyyy}/{mm}/{dd}/news_{timestamp}.json
└── processed/
    └── events/{yyyy}/{mm}/{dd}/events_{timestamp}.json
```

## Step Functions定義

参照: #[[file:src/stepfunctions/earthquake_pipeline.asl.json]]

## 実装タスク

1. [ ] earthquake_fetcher Lambda関数の実装
2. [ ] news_fetcher Lambda関数の実装
3. [ ] s3_writer Lambda関数の実装
4. [ ] Step Functions定義の作成
5. [ ] CDKスタックの作成
6. [ ] EventBridge Schedulerの設定（定期実行）
