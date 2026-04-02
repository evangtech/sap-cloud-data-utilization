/**
 * リスク→シミュレーション変換アダプター
 *
 * グラフのIMPACTS/DISRUPTSエッジを、simulation.tsが期待する
 * 具体的なオーバーライドキーに変換する。
 *
 * 入力: supplyChainストアの activeImpactsByNode + activeDisrupts
 * 出力: RiskScenarioSnapshot（simulation ストアが直接消費可能）
 */
import type {
  NodeImpact,
  DisruptsEdge,
  RiskScenarioSnapshot,
  SimTariff,
} from '@/types';

/**
 * アクティブなリスクイベントからシミュレーション入力を生成
 *
 * 変換ルール:
 * - IMPACTS (severity >= 4, impactType='direct') のサプライヤー → disabledSuppliers
 * - DISRUPTS → tariffOverrides (キー形式: "hsCode:originCountry:importingCountry")
 */
export function buildScenarioFromActiveRisks(
  activeImpactsByNode: Map<string, NodeImpact[]>,
  nodeTypes: Map<string, string>,
  activeDisrupts: DisruptsEdge[],
  currentTariffs: SimTariff[],
): RiskScenarioSnapshot {
  const disabledSuppliers = new Set<string>();
  const tariffOverrides = new Map<string, number>();

  // IMPACTS → disabledSuppliers
  for (const [nodeId, impacts] of activeImpactsByNode) {
    if (nodeTypes.get(nodeId) !== 'Supplier') continue;
    const maxSeverity = Math.max(...impacts.map((i) => i.severity));
    if (maxSeverity >= 4 && impacts.some((i) => i.impactType === 'direct')) {
      disabledSuppliers.add(nodeId);
    }
  }

  // DISRUPTS → tariffOverrides
  for (const d of activeDisrupts) {
    const key = `${d.hsCode}:${d.originCountry}:${d.destinationCountry}`;
    const currentRate =
      currentTariffs.find(
        (t) =>
          t.hsCode === d.hsCode &&
          t.originCountry === d.originCountry &&
          t.importingCountry === d.destinationCountry,
      )?.tariffRatePct ?? 0;
    tariffOverrides.set(key, currentRate + d.tariffIncreasePct);
  }

  // 関連イベントIDを収集
  const sourceEventIds = [
    ...new Set([
      ...activeDisrupts.map((d) => d.eventId),
      ...[...activeImpactsByNode.values()]
        .flat()
        .map((i) => i.eventId),
    ]),
  ];

  return {
    disabledSuppliers,
    tariffOverrides,
    fxOverrides: new Map(),
    volumeMultipliers: new Map(),
    metadata: {
      sourceEventIds,
      snapshotDate: new Date().toISOString(),
      description: '現在のリスク状況から自動生成',
    },
  };
}
