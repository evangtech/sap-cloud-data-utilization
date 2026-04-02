/**
 * Neptune Analytics リスク分析クエリハンドラー
 * AppSync resolverとして動作し、リスクイベント・スコアリング・ルート分析データを取得
 */
import { executeQuerySafe } from '../shared/neptune-client';

// ── リスクイベント基本クエリ ──────────────────────────────────

async function getRiskEvents(args: {
  lifecycleStatuses?: string[];
  reviewStatuses?: string[];
  eventTypes?: string[];
  minSeverity?: number;
}) {
  let where = 'WHERE 1=1';
  if (args.lifecycleStatuses?.length) {
    const vals = args.lifecycleStatuses.map((s) => `'${s}'`).join(', ');
    where += ` AND re.lifecycleStatus IN [${vals}]`;
  }
  if (args.reviewStatuses?.length) {
    const vals = args.reviewStatuses.map((s) => `'${s}'`).join(', ');
    where += ` AND re.reviewStatus IN [${vals}]`;
  }
  if (args.eventTypes?.length) {
    const vals = args.eventTypes.map((t) => `'${t}'`).join(', ');
    where += ` AND re.eventType IN [${vals}]`;
  }
  if (args.minSeverity != null) {
    where += ` AND re.severity >= ${args.minSeverity}`;
  }

  const query = `
    MATCH (re:RiskEvent)
    ${where}
    OPTIONAL MATCH (re)-[:CATEGORIZED_AS]->(rc:RiskCategory)
    RETURN re.id AS id, re.sourceEventId AS sourceEventId,
           re.dedupeKey AS dedupeKey, re.title AS title,
           re.description AS description, re.eventType AS eventType,
           re.source AS source, re.severity AS severity,
           re.lifecycleStatus AS lifecycleStatus,
           re.reviewStatus AS reviewStatus,
           re.reviewedBy AS reviewedBy,
           toString(re.reviewedAt) AS reviewedAt,
           re.trustLevel AS trustLevel,
           re.lat AS latitude, re.lon AS longitude,
           re.radiusKm AS radiusKm, re.geoScopeType AS geoScopeType,
           re.admin1 AS admin1, re.admin2 AS admin2,
           re.locationName AS locationName,
           toString(re.startDate) AS startDate,
           toString(re.endDate) AS endDate,
           toString(re.updatedAt) AS updatedAt,
           re.sourceUrl AS sourceUrl,
           re.sourceSnippetHash AS sourceSnippetHash,
           re.confidence AS confidence,
           re.affectedCountryCodes AS affectedCountryCodes,
           re.latestPropagationRunId AS latestPropagationRunId,
           re.latestPropagationSequence AS latestPropagationSequence,
           toString(re.propagationStartedAt) AS propagationStartedAt,
           toString(re.propagationCompletedAt) AS propagationCompletedAt,
           rc.name AS categoryName, rc.parentCategory AS parentCategory
    ORDER BY re.startDate DESC
  `;
  return executeQuerySafe(query);
}

// ── インパクトクエリ ──────────────────────────────────────────

async function getActiveImpacts(nodeId?: string, eventId?: string) {
  let where =
    "WHERE i.status IN ['active', 'recovering'] AND re.reviewStatus = 'confirmed'";
  if (nodeId) where += ` AND target.id = '${nodeId}'`;
  if (eventId) where += ` AND re.id = '${eventId}'`;

  const query = `
    MATCH (re:RiskEvent)-[i:IMPACTS]->(target)
    ${where}
    RETURN re.id AS eventId, re.title AS eventTitle,
           target.id AS nodeId, labels(target)[0] AS nodeType,
           target.name AS nodeName,
           i.severity AS severity, i.impactType AS impactType,
           i.status AS status,
           i.estimatedRecoveryDays AS estimatedRecoveryDays,
           i.costImpactPct AS costImpactPct,
           i.cachedImpactAmount AS cachedImpactAmount,
           i.impactConfidence AS impactConfidence,
           i.assessmentMethod AS assessmentMethod,
           toString(i.firstDetectedAt) AS firstDetectedAt,
           toString(i.lastUpdatedAt) AS lastUpdatedAt,
           toString(i.resolvedAt) AS resolvedAt,
           i.propagationRunId AS propagationRunId,
           i.overrideReviewStatus AS overrideReviewStatus
    ORDER BY i.severity DESC
  `;
  return executeQuerySafe(query);
}

async function getImpactsByEvent(eventId: string) {
  const query = `
    MATCH (re:RiskEvent {id: '${eventId}'})-[i:IMPACTS]->(target)
    RETURN re.id AS eventId, re.title AS eventTitle,
           target.id AS nodeId, labels(target)[0] AS nodeType,
           target.name AS nodeName,
           i.severity AS severity, i.impactType AS impactType,
           i.status AS status,
           i.estimatedRecoveryDays AS estimatedRecoveryDays,
           i.costImpactPct AS costImpactPct,
           i.cachedImpactAmount AS cachedImpactAmount,
           i.impactConfidence AS impactConfidence,
           i.assessmentMethod AS assessmentMethod
    ORDER BY i.severity DESC
  `;
  return executeQuerySafe(query);
}

// ── DISRUPTSクエリ ───────────────────────────────────────────

async function getActiveDisrupts() {
  const query = `
    MATCH (re:RiskEvent)-[d:DISRUPTS]->(hs:HSCode)
    WHERE re.lifecycleStatus IN ['active', 'recovering']
      AND re.reviewStatus = 'confirmed'
    RETURN re.id AS eventId, re.title AS eventTitle,
           hs.code AS hsCode,
           d.originCountry AS originCountry,
           d.destinationCountry AS destinationCountry,
           d.regulatorBody AS regulatorBody,
           d.effectiveDate AS effectiveDate,
           d.expiryDate AS expiryDate,
           d.tariffIncreasePct AS tariffIncreasePct,
           d.exportRestricted AS exportRestricted
    ORDER BY re.severity DESC
  `;
  return executeQuerySafe(query);
}

async function getDisruptsByEvent(eventId: string) {
  const query = `
    MATCH (re:RiskEvent {id: '${eventId}'})-[d:DISRUPTS]->(hs:HSCode)
    RETURN re.id AS eventId, re.title AS eventTitle,
           hs.code AS hsCode,
           d.originCountry AS originCountry,
           d.destinationCountry AS destinationCountry,
           d.regulatorBody AS regulatorBody,
           d.effectiveDate AS effectiveDate,
           d.expiryDate AS expiryDate,
           d.tariffIncreasePct AS tariffIncreasePct,
           d.exportRestricted AS exportRestricted
  `;
  return executeQuerySafe(query);
}

// ── リスクスコアリング ───────────────────────────────────────

/**
 * ノードリスクスコアを算出（v1: Plantのみ）
 *
 * Neptune Analytics openCypher制約:
 * - クエリ内に // コメント不可（パースエラー）
 * - log() 関数未サポート → 線形近似 (1 + x/1億) で代替
 * - インラインmap {key: val} 未サポート → topEvent省略
 * - UNION ALL 4タイプ版は構文リスクが高いためv1はPlantのみ
 * v2で Supplier/Warehouse/LogisticsHub を個別クエリで追加
 */
async function getNodeRiskScores() {
  const query = `
    MATCH (n:Plant)
    OPTIONAL MATCH (n)<-[i:IMPACTS]-(re:RiskEvent)
      WHERE i.status IN ['active', 'recovering']
        AND re.reviewStatus = 'confirmed'
    WITH n,
         coalesce(sum(
           i.severity * coalesce(i.impactConfidence, 0.5)
           * (1.0 / (1 + (epochMillis(datetime()) - epochMillis(re.startDate)) / 2592000000.0))
           * CASE i.impactType WHEN 'direct' THEN 1.0 ELSE 0.5 END
         ), 0) AS liveEventRisk,
         count(re) AS activeEventCount
    OPTIONAL MATCH (n)-[:SUPPLIES_TO*1..3]->(c:Customer)<-[o:ORDERED_BY]-(prod:Product)
    WITH n, liveEventRisk, activeEventCount,
         coalesce(sum(o.annual_order_qty * o.unit_price_jpy), 0) AS revenueExposure
    OPTIONAL MATCH (n)-[:LOCATED_IN]->(country:Country)
    RETURN n.id AS nodeId, 'Plant' AS nodeType,
           coalesce(country.geopolitical_risk, 0) AS baselineRisk,
           liveEventRisk, revenueExposure,
           liveEventRisk * (1.0 + revenueExposure / 100000000.0) AS combinedOperationalRisk,
           activeEventCount
    ORDER BY combinedOperationalRisk DESC
  `;
  return executeQuerySafe(query);
}

/* v1で削除: UNION ALL 4タイプ版テンプレート（Neptune構文制約で失敗）
  const riskScoreFragment_DISABLED = (matchClause: string, revenueClause: string) => `
    ${matchClause}
    OPTIONAL MATCH (n)<-[i:IMPACTS]-(re:RiskEvent)
      WHERE i.status IN ['active', 'recovering']
        AND re.reviewStatus = 'confirmed'
    WITH n, labels(n)[0] AS nodeType,
         coalesce(sum(
           i.severity * i.impactConfidence
           * (1.0 / (1 + (epochMillis(datetime()) - epochMillis(re.startDate)) / 2592000000.0))
           * CASE i.impactType WHEN 'direct' THEN 1.0 ELSE 0.5 END
         ), 0) AS liveEventRisk,
         count(re) AS activeEventCount,
         head(collect(CASE WHEN re IS NOT NULL
           THEN {title: re.title, severity: i.severity} END)) AS topEvent
    ${revenueClause}
    WITH n, nodeType, liveEventRisk, activeEventCount, topEvent, revenueExposure
    OPTIONAL MATCH (n)-[:LOCATED_IN]->(country:Country)
    RETURN n.id AS nodeId, nodeType,
           coalesce(country.geopolitical_risk, 0) AS baselineRisk,
           liveEventRisk, revenueExposure,
           liveEventRisk * (1 + log(1 + revenueExposure / 100000000.0)) AS combinedOperationalRisk,
           activeEventCount, topEvent
  `;

  const query = `
    // Plant: 直接SUPPLIES_TO経由
    ${riskScoreFragment(
      'MATCH (n:Plant)',
      `OPTIONAL MATCH (n)-[:SUPPLIES_TO*1..3]->(c:Customer)<-[o:ORDERED_BY]-(prod:Product)
       WITH n, nodeType, liveEventRisk, activeEventCount, topEvent,
            coalesce(sum(o.annual_order_qty * o.unit_price_jpy), 0) AS revenueExposure`,
    )}

    UNION ALL

    // Supplier: SUPPLIES_TO経由でPlant→Customer
    ${riskScoreFragment(
      'MATCH (n:Supplier)',
      `OPTIONAL MATCH (n)-[:SUPPLIES_TO*1..3]->(c:Customer)<-[o:ORDERED_BY]-(prod:Product)
       WITH n, nodeType, liveEventRisk, activeEventCount, topEvent,
            coalesce(sum(o.annual_order_qty * o.unit_price_jpy), 0) AS revenueExposure`,
    )}

    UNION ALL

    // Warehouse: SUPPLIES_TO経由
    ${riskScoreFragment(
      'MATCH (n:Warehouse)',
      `OPTIONAL MATCH (n)-[:SUPPLIES_TO*1..3]->(c:Customer)<-[o:ORDERED_BY]-(prod:Product)
       WITH n, nodeType, liveEventRisk, activeEventCount, topEvent,
            coalesce(sum(o.annual_order_qty * o.unit_price_jpy), 0) AS revenueExposure`,
    )}

    UNION ALL

    // LogisticsHub: ROUTES_THROUGH逆引き→依存ノードのSUPPLIES_TOで集計
    ${riskScoreFragment(
      'MATCH (n:LogisticsHub)',
      `OPTIONAL MATCH (dep)-[:ROUTES_THROUGH]->(n)
       OPTIONAL MATCH (dep)-[:SUPPLIES_TO*1..3]->(c:Customer)<-[o:ORDERED_BY]-(prod:Product)
       WITH n, nodeType, liveEventRisk, activeEventCount, topEvent,
            coalesce(sum(o.annual_order_qty * o.unit_price_jpy), 0) AS revenueExposure`,
    )}
  `;
v1で削除終わり */

// ── ルート分析 ───────────────────────────────────────────────

async function getCorridorRisks() {
  const query = `
    MATCH path = (s:Supplier)-[:SUPPLIES_TO*1..4]->(c:Customer)
    WITH path, nodes(path) AS pathNodes, s, c
    UNWIND pathNodes AS node
    OPTIONAL MATCH (node)<-[i:IMPACTS]-(re:RiskEvent)
      WHERE i.status IN ['active', 'recovering']
        AND re.reviewStatus = 'confirmed'
    WITH path, s, c, node,
         coalesce(sum(i.severity * i.impactConfidence), 0) AS nodeRisk,
         coalesce(max(i.cachedImpactAmount), 0) AS nodeExposure
    WITH path, s, c,
         max(nodeRisk) AS chokePointScore,
         avg(nodeRisk) AS avgRouteRisk,
         [n IN collect({name: node.name, risk: nodeRisk, exposure: nodeExposure})
           WHERE n.risk > 0] AS riskyNodes,
         length(path) AS hops
    RETURN s.id AS originId, s.name AS originName, 'Supplier' AS originType,
           c.id AS destId, c.name AS destName, 'Customer' AS destType,
           chokePointScore, avgRouteRisk, hops, riskyNodes
    ORDER BY chokePointScore DESC, avgRouteRisk DESC
    LIMIT 50
  `;
  return executeQuerySafe(query);
}

// ── 復旧ダッシュボード ──────────────────────────────────────

async function getRecoveryDashboard() {
  const query = `
    MATCH (re:RiskEvent)-[i:IMPACTS]->(target)
    WHERE re.lifecycleStatus <> 'resolved'
      AND re.reviewStatus = 'confirmed'
    WITH re,
         count(CASE WHEN i.status = 'active' THEN 1 END) AS activeImpacts,
         count(CASE WHEN i.status = 'recovering' THEN 1 END) AS recoveringImpacts,
         count(CASE WHEN i.status = 'resolved' THEN 1 END) AS resolvedImpacts,
         sum(CASE WHEN i.status <> 'resolved'
             THEN i.cachedImpactAmount ELSE 0 END) AS outstandingExposureJpy,
         avg(CASE WHEN i.status <> 'resolved'
             THEN i.estimatedRecoveryDays END) AS avgRemainingRecoveryDays
    RETURN re.id AS id, re.title AS title, re.severity AS severity,
           re.lifecycleStatus AS lifecycleStatus,
           activeImpacts, recoveringImpacts, resolvedImpacts,
           outstandingExposureJpy, avgRemainingRecoveryDays
    ORDER BY outstandingExposureJpy DESC
  `;
  return executeQuerySafe(query);
}

// ── リスク履歴 ───────────────────────────────────────────────

async function getRiskEventHistory(nodeId: string) {
  const query = `
    MATCH (re:RiskEvent)-[i:IMPACTS]->(target {id: '${nodeId}'})
    WHERE re.reviewStatus = 'confirmed'
    RETURN re.id AS id, re.title AS title, re.eventType AS eventType,
           re.severity AS severity,
           toString(re.startDate) AS startDate,
           toString(re.endDate) AS endDate,
           re.lifecycleStatus AS lifecycleStatus,
           i.estimatedRecoveryDays AS estimatedRecoveryDays,
           i.costImpactPct AS costImpactPct,
           i.assessmentMethod AS assessmentMethod
    ORDER BY re.startDate DESC
  `;
  return executeQuerySafe(query);
}

// ── 因果チェーン ─────────────────────────────────────────────

async function getRiskEventChain(eventId: string) {
  const query = `
    MATCH chain = (origin:RiskEvent {id: '${eventId}'})-[:RELATED_EVENT*1..3]->(downstream:RiskEvent)
    WITH origin, downstream, chain,
         [r IN relationships(chain) |
           {type: r.relationshipType, confidence: r.confidence}] AS links
    RETURN origin.title AS triggerEvent,
           downstream.id AS downstreamId,
           downstream.title AS resultingEvent,
           downstream.severity AS downstreamSeverity,
           links, length(chain) AS depth
    ORDER BY depth DESC, downstream.severity DESC
  `;
  return executeQuerySafe(query);
}

// ── 物流拠点・倉庫 ──────────────────────────────────────────

async function getWarehouses() {
  const query = `
    MATCH (w:Warehouse)
    OPTIONAL MATCH (w)-[:LOCATED_IN]->(c:Country)
    RETURN w.id AS id, w.name AS name,
           w.country_code AS countryCode,
           w.lat AS latitude, w.lon AS longitude,
           w.capacity AS capacity, w.status AS status,
           c.name AS countryName
  `;
  return executeQuerySafe(query);
}

async function getLogisticsHubs() {
  const query = `
    MATCH (lh:LogisticsHub)
    OPTIONAL MATCH (lh)-[:LOCATED_IN]->(c:Country)
    RETURN lh.id AS id, lh.name AS name,
           lh.type AS type, lh.country_code AS countryCode,
           lh.lat AS latitude, lh.lon AS longitude,
           lh.capacity AS capacity, lh.status AS status,
           c.name AS countryName
  `;
  return executeQuerySafe(query);
}

async function getRoutesThrough() {
  const query = `
    MATCH (from)-[r:ROUTES_THROUGH]->(lh:LogisticsHub)
    RETURN from.id AS fromId, labels(from)[0] AS fromType,
           from.name AS fromName,
           lh.id AS toId, lh.name AS toName,
           r.transitDays AS transitDays, r.isPrimary AS isPrimary
  `;
  return executeQuerySafe(query);
}

// ── ハンドラー ───────────────────────────────────────────────

export const handler = async (event: {
  fieldName: string;
  arguments?: Record<string, unknown>;
}) => {
  const { fieldName, arguments: args } = event;

  switch (fieldName) {
    case 'getRiskEvents':
      return getRiskEvents({
        lifecycleStatuses: args?.lifecycleStatuses as string[] | undefined,
        reviewStatuses: args?.reviewStatuses as string[] | undefined,
        eventTypes: args?.eventTypes as string[] | undefined,
        minSeverity: args?.minSeverity as number | undefined,
      });
    case 'getActiveImpacts':
      return getActiveImpacts(
        args?.nodeId as string | undefined,
        args?.eventId as string | undefined,
      );
    case 'getImpactsByEvent':
      return getImpactsByEvent(args?.eventId as string);
    case 'getActiveDisrupts':
      return getActiveDisrupts();
    case 'getDisruptsByEvent':
      return getDisruptsByEvent(args?.eventId as string);
    case 'getNodeRiskScores':
      return getNodeRiskScores();
    case 'getCorridorRisks':
      return getCorridorRisks();
    case 'getRecoveryDashboard':
      return getRecoveryDashboard();
    case 'getRiskEventHistory':
      return getRiskEventHistory(args?.nodeId as string);
    case 'getRiskEventChain':
      return getRiskEventChain(args?.eventId as string);
    case 'getWarehouses':
      return getWarehouses();
    case 'getLogisticsHubs':
      return getLogisticsHubs();
    case 'getRoutesThrough':
      return getRoutesThrough();
    default:
      throw new Error(`不明なフィールド名: ${fieldName}`);
  }
};
