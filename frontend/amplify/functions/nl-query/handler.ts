import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  NeptuneGraphClient,
  ExecuteQueryCommand,
} from '@aws-sdk/client-neptune-graph';

/**
 * 自然言語クエリハンドラー
 * Bedrock Converse APIで自然言語をフィルタ命令またはCypherクエリに変換し、結果を返す
 * 複数ステップクエリ対応: 名前→ID解決 → 関係クエリの2段階実行
 * JSONパースエラー・Neptuneエラー時は会話履歴を保持してリトライ
 */

const NEPTUNE_GRAPH_ID = process.env.NEPTUNE_GRAPH_ID || 'g-844qqbri1a';
const NEPTUNE_REGION = process.env.NEPTUNE_REGION || 'us-west-2';
const BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-west-2';
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-sonnet-4-5-20250929-v1:0';
const MAX_RETRIES = 2;
const MAX_NEPTUNE_RETRIES = 2;

const neptuneClient = new NeptuneGraphClient({ region: NEPTUNE_REGION });
const bedrockClient = new BedrockRuntimeClient({ region: BEDROCK_REGION });

/** グラフスキーマ定義（Bedrockプロンプト用） */
const GRAPH_SCHEMA = `
## Neptune Graph Schema (openCypher)

### ノード（Node Labels）
- Country (code:STRING, name:STRING, region:STRING, geopolitical_risk:FLOAT, sanction_regime:STRING, exchange_rate_jpy:FLOAT, lat:FLOAT, lon:FLOAT)
- HSCode (code:STRING, description:STRING, chapter:STRING, heading:STRING)
- Regulation (id:STRING, name:STRING, type:STRING, effective_date:STRING, issuing_country:STRING)
- Supplier (id:STRING, name:STRING, country_code:STRING, region:STRING, credit_score:FLOAT, quality_score:FLOAT, lead_time_days:INT, sanction_status:STRING, lat:FLOAT, lon:FLOAT, tier:STRING, status:STRING)
- Material (id:STRING, description:STRING, material_group:STRING, weight:FLOAT, weight_unit:STRING, origin_country:STRING, hs_code:STRING, unit_price:FLOAT, currency:STRING, annual_volume:FLOAT)
- Product (id:STRING, description:STRING, product_group:STRING, cost_estimate_jpy:FLOAT, sales_price_jpy:FLOAT, margin_rate:FLOAT)
- Plant (id:STRING, name:STRING, country_code:STRING, plant_type:STRING, lat:FLOAT, lon:FLOAT, capacity:INT, status:STRING)
- Warehouse (id:STRING, name:STRING, country_code:STRING, lat:FLOAT, lon:FLOAT, capacity:INT, status:STRING)
- Customer (id:STRING, name:STRING, industry:STRING, country_code:STRING, lat:FLOAT, lon:FLOAT)
- RiskEvent (id:STRING, title:STRING, description:STRING, eventType:STRING, severity:INT[1-5], lifecycleStatus:STRING[detected/active/recovering/resolved], reviewStatus:STRING[pending/confirmed/watching/dismissed], lat:FLOAT, lon:FLOAT, radiusKm:FLOAT, locationName:STRING, startDate:DATETIME, endDate:DATETIME, source:STRING, confidence:FLOAT)
- RiskCategory (id:STRING, name:STRING, parentCategory:STRING[natural_disaster/geopolitical/operational/financial], avgRecoveryDays:INT)
- LogisticsHub (id:STRING, name:STRING, type:STRING[port/airport/border_crossing], country_code:STRING, lat:FLOAT, lon:FLOAT, capacity:STRING, status:STRING[operational/disrupted/closed])

### エッジ（Relationship Types）
- LOCATED_IN: (Supplier|Plant|Warehouse|Customer|LogisticsHub)-[:LOCATED_IN]->(Country)
- CLASSIFIED_AS: (Material)-[:CLASSIFIED_AS]->(HSCode)
- TARIFF_APPLIES: (HSCode)-[:TARIFF_APPLIES {importing_country:STRING, tariff_rate_pct:FLOAT, effective_date:STRING, tariff_type:STRING}]->(Country)
- SUBJECT_TO: (HSCode|Material)-[:SUBJECT_TO]->(Regulation)
- SUPPLIES: (Supplier)-[:SUPPLIES {is_primary:BOOLEAN}]->(Material)
- HAS_COMPONENT: (Product)-[:HAS_COMPONENT {quantity:INT, bom_level:INT}]->(Material)
- PRODUCED_AT: (Product)-[:PRODUCED_AT]->(Plant)
- SUPPLIES_TO: (Supplier)-[:SUPPLIES_TO]->(Supplier|Plant), (Plant)-[:SUPPLIES_TO]->(Warehouse|Customer), (Warehouse)-[:SUPPLIES_TO]->(Customer)
- ORDERED_BY: (Product)-[:ORDERED_BY {annual_order_qty:INT, unit_price_jpy:FLOAT}]->(Customer)
- ALTERNATIVE_TO: (Supplier)-[:ALTERNATIVE_TO {quality_score_diff:INT, price_diff_pct:INT, lead_time_diff_days:INT, risk_score_diff:INT}]->(Supplier)
- IMPACTS: (RiskEvent)-[:IMPACTS {severity:INT, impactType:STRING[direct/downstream], status:STRING[active/recovering/resolved], estimatedRecoveryDays:INT, cachedImpactAmount:FLOAT, impactConfidence:FLOAT}]->(Plant|Supplier|Warehouse|Material|LogisticsHub)
- DISRUPTS: (RiskEvent)-[:DISRUPTS {originCountry:STRING, destinationCountry:STRING, tariffIncreasePct:FLOAT, exportRestricted:BOOLEAN}]->(HSCode)
- RELATED_EVENT: (RiskEvent)-[:RELATED_EVENT {relationshipType:STRING[triggers/contributes_to/coincident/supersedes/empirical], delayDays:INT, confidence:FLOAT}]->(RiskEvent)
- CATEGORIZED_AS: (RiskEvent)-[:CATEGORIZED_AS]->(RiskCategory)
- OCCURRED_IN: (RiskEvent)-[:OCCURRED_IN]->(Country)
- ROUTES_THROUGH: (Plant|Supplier|Warehouse)-[:ROUTES_THROUGH {transitDays:INT, isPrimary:BOOLEAN}]->(LogisticsHub)

### リスクスコアリングの注意
- リスクスコアを聞かれた場合は、IMPACTSエッジのseverityとimpactConfidenceからliveEventRiskを算出し、下流の売上エクスポージャーで重み付けしたcombinedOperationalRiskも返すこと
- リスクスコアリングクエリでは必ず re.reviewStatus = 'confirmed' でフィルタすること
- 未確認イベント（pending）はスコアに含めないこと
`;

/** Bedrockシステムプロンプト */
const SYSTEM_PROMPT = `あなたはサプライチェーングラフデータベースのアシスタントです。
ユーザーの自然言語クエリを解析し、以下の3種類のいずれかのJSON応答を返してください。

${GRAPH_SCHEMA}

## 応答形式

### 1. フロントエンドフィルタ（地図上のノード表示/非表示を制御）
単純なフィルタリング（特定のノードだけ表示、影響ノードだけ表示など）の場合:
{"type":"filter","description":"フィルタの説明","filter":{"showPlants":true,"showSuppliers":true,"showCustomers":true,"showWarehouses":true,"highlightIds":["PLT001"],"impactOnly":false}}

### 2. 単一Cypherクエリ（1つのクエリで完結する場合）
{"type":"cypher","description":"クエリの説明","query":"MATCH (p:Plant) WHERE p.capacity >= 3000 RETURN p.id as id, p.name as name, p.lat as lat, p.lon as lon"}

### 3. 複数ステップCypherクエリ（名前からノードを特定してから関係を探索する場合）
特定のノードの供給先・供給元・関連ノードを探す場合、まず名前でノードを検索し、次にそのノードの関係を探索する:
{"type":"multi_cypher","description":"クエリの説明","queries":[{"step":"resolve","purpose":"宮古島半導体工場のIDを特定","query":"MATCH (p:Plant) WHERE p.name CONTAINS '宮古島' RETURN p.id as id, p.name as name"},{"step":"main","purpose":"特定した工場の供給先を取得","query":"MATCH (p:Plant)-[:SUPPLIES_TO]->(target) WHERE p.name CONTAINS '宮古島' RETURN target.id as id, target.name as name, labels(target)[0] as nodeType, target.lat as lat, target.lon as lon"}]}

### 4. 該当なし（不明・無関係なクエリの場合）
サプライチェーンと無関係な質問、意味不明な入力、またはグラフスキーマで回答できない質問の場合:
{"type":"no_result","description":"このシステムではサプライチェーン（工場・サプライヤー・カスタマ・倉庫・製品・資材・規制・関税）に関する検索のみ対応しています"}

## 重要ルール
- 応答はJSON1行のみ。コードブロックや説明文は禁止。純粋なJSONだけを返すこと
- Cypherクエリも必ず1行で記述すること（改行禁止）
- RETURNには必ずid, name, lat, lonを含めること（地図表示用）。ただしresolveステップはid, nameだけでよい
- RETURNのカラム名（alias）は全て一意にすること。重複禁止
- 読み取り専用クエリのみ（CREATE/DELETE/SET禁止）
- 日本語の質問に対応すること
- ノードのname/descriptionは日本語で格納されている場合がある（例: "東京組立工場", "九州半導体"）
- Productにはlat/lonがないため、地図表示にはPRODUCED_ATで関連するPlantのlat/lonを使うこと

### 名前検索ルール（最重要）
- ノードIDを絶対にハードコードしないこと。IDは事前に知り得ない情報である
- ノード名の検索には必ずCONTAINSを使うこと（例: p.name CONTAINS '宮古島'）
- 特定のノードの供給先・供給元を探す場合は、multi_cypherを使い、resolveステップで名前からノードを特定すること
- resolveステップのクエリ結果が0件の場合、mainステップは実行されない

### 比較表現
- 「以上」= >= 「以下」= <= 「超」= > 「未満」= <

## 参考クエリ例
- トヨタに供給している工場: {"type":"cypher","description":"トヨタに供給している工場","query":"MATCH (p:Plant)-[:SUPPLIES_TO]->(c:Customer) WHERE c.name CONTAINS 'トヨタ' RETURN p.id as id, p.name as name, p.lat as lat, p.lon as lon"}
- 東南アジアのサプライヤーを表示: {"type":"cypher","description":"東南アジアのサプライヤー","query":"MATCH (s:Supplier) WHERE s.region CONTAINS '東南アジア' RETURN s.id as id, s.name as name, s.lat as lat, s.lon as lon"}
- 生産能力3000以上の工場: {"type":"cypher","description":"キャパシティ3000以上の工場","query":"MATCH (p:Plant) WHERE p.capacity >= 3000 RETURN p.id as id, p.name as name, p.lat as lat, p.lon as lon"}
- 宮古島半導体工場の供給先: {"type":"multi_cypher","description":"宮古島半導体工場の供給先","queries":[{"step":"resolve","purpose":"宮古島半導体工場を特定","query":"MATCH (p:Plant) WHERE p.name CONTAINS '宮古島' RETURN p.id as id, p.name as name"},{"step":"main","purpose":"供給先を取得","query":"MATCH (p:Plant)-[:SUPPLIES_TO]->(target) WHERE p.name CONTAINS '宮古島' RETURN target.id as id, target.name as name, target.lat as lat, target.lon as lon"}]}
- 九州半導体の供給先工場: {"type":"multi_cypher","description":"九州半導体が供給している工場","queries":[{"step":"resolve","purpose":"九州半導体を特定","query":"MATCH (s:Supplier) WHERE s.name CONTAINS '九州半導体' RETURN s.id as id, s.name as name"},{"step":"main","purpose":"供給先工場を取得","query":"MATCH (s:Supplier)-[:SUPPLIES_TO]->(p:Plant) WHERE s.name CONTAINS '九州半導体' RETURN p.id as id, p.name as name, p.lat as lat, p.lon as lon"}]}
- 半導体チップBを製造している工場: {"type":"cypher","description":"半導体チップBの製造工場","query":"MATCH (prod:Product)-[:PRODUCED_AT]->(p:Plant) WHERE prod.description CONTAINS '半導体チップB' RETURN p.id as id, p.name as name, p.lat as lat, p.lon as lon"}
- センサーアセンブリの部品（資材）: {"type":"cypher","description":"センサーアセンブリの部品構成","query":"MATCH (prod:Product)-[c:HAS_COMPONENT]->(m:Material) WHERE prod.description CONTAINS 'センサーアセンブリ' RETURN m.id as id, m.description as name, c.quantity as quantity, c.bom_level as bomLevel"}
- 福岡組立工場に資材を供給しているサプライヤー: {"type":"multi_cypher","description":"福岡組立工場への資材供給元サプライヤー","queries":[{"step":"resolve","purpose":"福岡組立工場を特定","query":"MATCH (p:Plant) WHERE p.name CONTAINS '福岡' RETURN p.id as id, p.name as name"},{"step":"main","purpose":"供給元サプライヤーを取得","query":"MATCH (s:Supplier)-[:SUPPLIES_TO]->(p:Plant) WHERE p.name CONTAINS '福岡' RETURN s.id as id, s.name as name, s.lat as lat, s.lon as lon"}]}
- 関税率が10%以上のHSコード: {"type":"cypher","description":"関税率10%以上のHSコードと対象国","query":"MATCH (h:HSCode)-[t:TARIFF_APPLIES]->(c:Country) WHERE t.tariff_rate_pct >= 10.0 RETURN h.code as id, h.description as name, t.tariff_rate_pct as tariffRate, c.name as country, c.lat as lat, c.lon as lon"}
- 制裁対象のサプライヤー: {"type":"cypher","description":"制裁対象のサプライヤー","query":"MATCH (s:Supplier) WHERE s.sanction_status <> 'clear' RETURN s.id as id, s.name as name, s.lat as lat, s.lon as lon, s.sanction_status as sanctionStatus"}
- あるサプライヤーの代替候補: {"type":"multi_cypher","description":"九州半導体の代替サプライヤー","queries":[{"step":"resolve","purpose":"九州半導体を特定","query":"MATCH (s:Supplier) WHERE s.name CONTAINS '九州半導体' RETURN s.id as id, s.name as name"},{"step":"main","purpose":"代替サプライヤーを取得","query":"MATCH (s:Supplier)-[a:ALTERNATIVE_TO]->(alt:Supplier) WHERE s.name CONTAINS '九州半導体' RETURN alt.id as id, alt.name as name, alt.lat as lat, alt.lon as lon, a.price_diff_pct as priceDiff, a.lead_time_diff_days as leadTimeDiff"}]}
- 影響を受けた工場のみ表示: {"type":"filter","description":"影響を受けた工場のみ表示","filter":{"showPlants":true,"showSuppliers":false,"showCustomers":false,"showWarehouses":false,"highlightIds":[],"impactOnly":true}}
- 今日の天気は？: {"type":"no_result","description":"このシステムではサプライチェーン（工場・サプライヤー・カスタマ・倉庫・製品・資材・規制・関税）に関する検索のみ対応しています"}
- あいうえお: {"type":"no_result","description":"入力内容を理解できませんでした。工場やサプライヤーに関する質問をお試しください"}
- 現在のリスクイベント一覧: {"type":"cypher","description":"アクティブなリスクイベント一覧","query":"MATCH (re:RiskEvent) WHERE re.lifecycleStatus IN ['active','recovering'] AND re.reviewStatus = 'confirmed' RETURN re.id as id, re.title as name, re.lat as lat, re.lon as lon, re.severity as severity, re.eventType as eventType"}
- 東京工場に影響しているリスクは: {"type":"multi_cypher","description":"東京工場に影響しているリスクイベント","queries":[{"step":"resolve","purpose":"東京工場を特定","query":"MATCH (p:Plant) WHERE p.name CONTAINS '東京' RETURN p.id as id, p.name as name"},{"step":"main","purpose":"影響リスクイベントを取得","query":"MATCH (re:RiskEvent)-[i:IMPACTS]->(p:Plant) WHERE p.name CONTAINS '東京' AND i.status IN ['active','recovering'] RETURN re.id as id, re.title as name, re.lat as lat, re.lon as lon, re.severity as severity, i.impactType as impactType"}]}
- 港湾の一覧: {"type":"cypher","description":"物流拠点（港湾）の一覧","query":"MATCH (lh:LogisticsHub) WHERE lh.type = 'port' RETURN lh.id as id, lh.name as name, lh.lat as lat, lh.lon as lon, lh.status as status"}
- SUP001の過去のリスク履歴: {"type":"multi_cypher","description":"TSMCのリスク履歴","queries":[{"step":"resolve","purpose":"TSMCを特定","query":"MATCH (s:Supplier) WHERE s.name CONTAINS 'TSMC' RETURN s.id as id, s.name as name"},{"step":"main","purpose":"リスク履歴を取得","query":"MATCH (re:RiskEvent)-[i:IMPACTS]->(s:Supplier) WHERE s.name CONTAINS 'TSMC' AND re.reviewStatus = 'confirmed' RETURN re.id as id, re.title as name, re.lat as lat, re.lon as lon, re.severity as severity, toString(re.startDate) as startDate"}]}
`;

/** Converse APIのメッセージ型 */
interface ConvMessage {
  role: 'user' | 'assistant';
  content: { text: string }[];
}

/** multi_cypherのステップ型 */
interface QueryStep {
  step: 'resolve' | 'main';
  purpose: string;
  query: string;
}

/**
 * Bedrock応答テキストからJSONを抽出してパース
 */
function extractJson(text: string): any {
  // コードブロック内のJSONを抽出
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

  // JSONオブジェクトを抽出（前後の余計なテキストを除去）
  const objMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!objMatch) {
    throw new Error('JSONオブジェクトが見つかりません');
  }

  return JSON.parse(objMatch[0]);
}

/**
 * Neptuneでクエリを実行
 */
async function executeNeptuneQuery(query: string): Promise<any[]> {
  // 安全性チェック: 読み取り専用クエリのみ許可
  const upperQuery = query.toUpperCase();
  if (upperQuery.includes('CREATE') || upperQuery.includes('DELETE') ||
      upperQuery.includes('SET') || upperQuery.includes('MERGE') ||
      upperQuery.includes('DROP') || upperQuery.includes('REMOVE')) {
    throw new Error('データ変更クエリは許可されていません');
  }

  const command = new ExecuteQueryCommand({
    graphIdentifier: NEPTUNE_GRAPH_ID,
    queryString: query,
    language: 'OPEN_CYPHER',
  });

  const response = await neptuneClient.send(command);
  const payload = await response.payload?.transformToString();
  const parsed = JSON.parse(payload || '{"results": []}');
  return parsed.results || [];
}

/**
 * 複数ステップクエリを実行
 * resolveステップで0件の場合は「該当なし」を返す
 */
async function executeMultiStepQuery(queries: QueryStep[]): Promise<{
  results: any[];
  executedQueries: string[];
}> {
  const executedQueries: string[] = [];

  // resolveステップを先に実行
  const resolveStep = queries.find(q => q.step === 'resolve');
  if (resolveStep) {
    console.log('Resolve実行:', resolveStep.query);
    executedQueries.push(resolveStep.query);
    const resolveResults = await executeNeptuneQuery(resolveStep.query);

    if (resolveResults.length === 0) {
      // 該当ノードが見つからない → 空結果を返す
      console.log('Resolveステップ: 該当ノードなし');
      return { results: [], executedQueries };
    }
    console.log(`Resolveステップ: ${resolveResults.length}件のノードを特定`);
  }

  // mainステップを実行
  const mainStep = queries.find(q => q.step === 'main');
  if (mainStep) {
    console.log('Main実行:', mainStep.query);
    executedQueries.push(mainStep.query);
    const results = await executeNeptuneQuery(mainStep.query);
    return { results, executedQueries };
  }

  return { results: [], executedQueries };
}

/**
 * Bedrock解析 → Neptune実行を一体化したリトライループ
 * cypher / multi_cypher / filter の3タイプに対応
 * Neptuneエラー時はBedrockに会話内でフィードバックして修正させる
 */
async function executeWithNeptuneRetry(userQuery: string): Promise<{
  type: string;
  description: string;
  query?: string;
  filter?: any;
  results: any[];
}> {
  // 会話履歴を保持
  const messages: ConvMessage[] = [
    { role: 'user', content: [{ text: userQuery }] },
  ];

  /** Bedrockを呼び出してJSONをパースする内部関数 */
  async function callAndParse(): Promise<any> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const command = new ConverseCommand({
        modelId: BEDROCK_MODEL_ID,
        system: [{ text: SYSTEM_PROMPT }],
        messages,
        inferenceConfig: { maxTokens: 1024 },
      });

      const response = await bedrockClient.send(command);
      const assistantText = response.output?.message?.content?.[0]?.text || '';
      console.log(`Bedrock応答 (JSON試行${attempt + 1}):`, assistantText.substring(0, 500));

      // アシスタント応答を会話履歴に追加
      messages.push({ role: 'assistant', content: [{ text: assistantText }] });

      try {
        const parsed = extractJson(assistantText);
        const validTypes = ['filter', 'cypher', 'multi_cypher', 'no_result'];
        if (!parsed.type || !validTypes.includes(parsed.type)) {
          throw new Error(`不正なtype: ${parsed.type}。有効: ${validTypes.join(', ')}`);
        }
        if (parsed.type === 'cypher' && !parsed.query) {
          throw new Error('cypherタイプにqueryフィールドがありません');
        }
        if (parsed.type === 'multi_cypher' && (!parsed.queries || !Array.isArray(parsed.queries))) {
          throw new Error('multi_cypherタイプにqueriesフィールドがありません');
        }
        return parsed;
      } catch (parseError) {
        const errMsg = parseError instanceof Error ? parseError.message : String(parseError);
        console.warn(`JSON解析エラー (試行${attempt + 1}/${MAX_RETRIES + 1}):`, errMsg);

        if (attempt >= MAX_RETRIES) {
          throw new Error(`${MAX_RETRIES + 1}回試行してもJSON解析に失敗: ${errMsg}`);
        }

        messages.push({
          role: 'user',
          content: [{
            text: `あなたの応答をJSONとしてパースできませんでした。エラー: ${errMsg}\n\n純粋なJSONだけを1行で返してください。コードブロックや説明文は不要です。`,
          }],
        });
      }
    }
    throw new Error('リトライ上限に達しました');
  }

  // メインループ: Bedrock解析 → Neptune実行 → エラー時はBedrockにフィードバック
  for (let neptuneAttempt = 0; neptuneAttempt <= MAX_NEPTUNE_RETRIES; neptuneAttempt++) {
    const parsed = await callAndParse();

    // フィルタ型: Neptune実行不要
    if (parsed.type === 'filter') {
      return {
        type: 'filter',
        description: parsed.description || '',
        query: JSON.stringify(parsed.filter),
        filter: parsed.filter || {},
        results: [],
      };
    }

    // 該当なし: Bedrockが不明・無関係と判断
    if (parsed.type === 'no_result') {
      return {
        type: 'no_result',
        description: parsed.description || 'サプライチェーンに関連する検索のみ対応しています',
        results: [],
      };
    }

    // 単一Cypherクエリ
    if (parsed.type === 'cypher') {
      try {
        console.log(`Neptune実行 (試行${neptuneAttempt + 1}):`, parsed.query);
        const results = await executeNeptuneQuery(parsed.query);

        // 空結果の場合は明示的なメッセージ付きで返す
        if (results.length === 0) {
          return {
            type: 'no_result',
            description: `${parsed.description || userQuery} — 該当するデータが見つかりませんでした`,
            query: parsed.query,
            results: [],
          };
        }

        return {
          type: 'cypher',
          description: parsed.description || '',
          query: parsed.query,
          results,
        };
      } catch (neptuneError) {
        const errMsg = neptuneError instanceof Error ? neptuneError.message : String(neptuneError);
        console.warn(`Neptuneクエリエラー (試行${neptuneAttempt + 1}/${MAX_NEPTUNE_RETRIES + 1}):`, errMsg);

        if (neptuneAttempt >= MAX_NEPTUNE_RETRIES) {
          return {
            type: 'error',
            description: `Neptuneクエリエラー: ${errMsg}`,
            query: parsed.query,
            results: [],
          };
        }

        // Neptuneエラーをフィードバック
        messages.push({
          role: 'user',
          content: [{
            text: `生成したCypherクエリをNeptuneで実行したところエラーが発生しました。\nクエリ: ${parsed.query}\nエラー: ${errMsg}\n\nエラーを修正した新しいCypherクエリをJSON形式で返してください。純粋なJSONだけを1行で返すこと。`,
          }],
        });
        continue;
      }
    }

    // 複数ステップCypherクエリ
    if (parsed.type === 'multi_cypher') {
      try {
        const { results, executedQueries } = await executeMultiStepQuery(parsed.queries);
        const queryStr = executedQueries.join(' → ');

        // 空結果の場合
        if (results.length === 0) {
          return {
            type: 'no_result',
            description: `${parsed.description || userQuery} — 該当するデータが見つかりませんでした`,
            query: queryStr,
            results: [],
          };
        }

        return {
          type: 'cypher',
          description: parsed.description || '',
          query: queryStr,
          results,
        };
      } catch (neptuneError) {
        const errMsg = neptuneError instanceof Error ? neptuneError.message : String(neptuneError);
        console.warn(`Multi-stepクエリエラー (試行${neptuneAttempt + 1}/${MAX_NEPTUNE_RETRIES + 1}):`, errMsg);

        if (neptuneAttempt >= MAX_NEPTUNE_RETRIES) {
          return {
            type: 'error',
            description: `Neptuneクエリエラー: ${errMsg}`,
            query: JSON.stringify(parsed.queries),
            results: [],
          };
        }

        messages.push({
          role: 'user',
          content: [{
            text: `生成したCypherクエリをNeptuneで実行したところエラーが発生しました。\nクエリ: ${JSON.stringify(parsed.queries)}\nエラー: ${errMsg}\n\nエラーを修正した新しいクエリをJSON形式で返してください。純粋なJSONだけを1行で返すこと。`,
          }],
        });
        continue;
      }
    }
  }

  throw new Error('リトライ上限に達しました');
}

/**
 * Lambda ハンドラー
 */
export const handler = async (event: any) => {
  console.log('NL Query Event:', JSON.stringify(event, null, 2));

  const { arguments: args } = event;
  const userQuery = args?.query;

  if (!userQuery || typeof userQuery !== 'string') {
    return {
      type: 'error',
      description: 'クエリが指定されていません',
      results: [],
    };
  }

  try {
    return await executeWithNeptuneRetry(userQuery);
  } catch (error) {
    console.error('NL Query error:', error);
    return {
      type: 'error',
      description: error instanceof Error ? error.message : 'クエリ処理中にエラーが発生しました',
      results: [],
    };
  }
};
