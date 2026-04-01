import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  SimBOMItem,
  SimTariff,
  SimOrder,
  SimAlternative,
  SimFXRate,
  ProductSimResult,
  ComponentSimResult,
  PortfolioImpact,
  AlternativeRecommendation,
  SupplyRiskMetrics,
  SwitchTradeoffSummary,
  CostDriverSegment,
} from '@/types';
import { fetchSimulationData, fetchLiveFxRates } from '@/services/api';

/**
 * What-if シミュレーションストア
 * クライアント側でリアクティブにコスト再計算を行う
 *
 * 修正履歴:
 * - ベースラインバイアス修正: baseCost を cost_estimate_jpy ではなく BOM から算出
 * - サプライヤー切替: focusedAlternativeId を計算に反映
 * - リスク指標: 虚偽スコア → HHI/集中度/単一ソース (データ駆動)
 * - 利益帰属: 産地変更に伴う関税差をサプライヤー影響に帰属
 */
export const useSimulationStore = defineStore('simulation', () => {
  // ========================================
  // Neptune Data (loaded once)
  // ========================================
  const bomItems = ref<SimBOMItem[]>([]);
  const tariffs = ref<SimTariff[]>([]);
  const orders = ref<SimOrder[]>([]);
  const alternatives = ref<SimAlternative[]>([]);
  const fxRates = ref<SimFXRate[]>([]);

  // ========================================
  // Slider Inputs (reactive)
  // ========================================

  /** 関税オーバーライド: key = "hsCode:originCountry:importingCountry" → rate % */
  const tariffOverrides = ref<Map<string, number>>(new Map());

  /** 為替オーバーライド: key = currency code ("USD") → exchange_rate_jpy value */
  const fxOverrides = ref<Map<string, number>>(new Map());

  /** 無効化サプライヤー */
  const disabledSuppliers = ref<Set<string>>(new Set());

  /** 発注量倍率 */
  const volumeMultiplier = ref(1.0);

  /** 選択中の製品 */
  const selectedProductId = ref<string | null>(null);

  /** フォーカスされたサプライヤースイッチ */
  const focusedSupplierId = ref<string | null>(null);
  const focusedAlternativeId = ref<string | null>(null);

  // ========================================
  // Loading state
  // ========================================
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const isDataLoaded = ref(false);
  const dataQualityWarnings = ref<string[]>([]);

  // ========================================
  // Derived Data (computed from Neptune data)
  // ========================================

  /** ユニークな製品リスト */
  const products = computed(() => {
    const seen = new Map<string, { id: string; name: string; baseCost: number; salesPrice: number; margin: number }>();
    for (const item of bomItems.value) {
      if (!seen.has(item.productId)) {
        seen.set(item.productId, {
          id: item.productId,
          name: item.productName,
          baseCost: item.baseCostJpy,
          salesPrice: item.salesPriceJpy,
          margin: item.marginRate,
        });
      }
    }
    return Array.from(seen.values());
  });

  /** ユニークなサプライヤーリスト (supplierCountry = サプライヤー所在国) */
  const supplierList = computed(() => {
    const seen = new Map<string, { id: string; name: string; country: string }>();
    for (const item of bomItems.value) {
      if (item.supplierId && !seen.has(item.supplierId)) {
        seen.set(item.supplierId, { id: item.supplierId, name: item.supplierName, country: item.supplierCountry || item.originCountry });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.id.localeCompare(b.id));
  });

  /**
   * ユニークな関税グループ (スライダー用)
   * 修正: BOM に関連する JP 輸入関税のみ表示 (CN→US 等の無関係な関税を除外)
   */
  const tariffGroups = computed(() => {
    // BOM に出現する (hsCode, originCountry) ペアを収集
    const bomHsOrigins = new Set<string>();
    for (const item of bomItems.value) {
      if (item.hsCode && item.originCountry) {
        bomHsOrigins.add(`${item.hsCode}:${item.originCountry}`);
      }
    }

    const groups = new Map<string, { key: string; hsCode: string; origin: string; importer: string; baseRate: number; type: string }>();
    for (const t of tariffs.value) {
      const key = `${t.hsCode}:${t.originCountry}:${t.importingCountry}`;
      if (groups.has(key)) continue;

      // JP 輸入かつ BOM に該当する HS+産地のものだけ表示
      if (t.importingCountry !== 'JP') continue;
      if (!bomHsOrigins.has(`${t.hsCode}:${t.originCountry}`)) continue;

      groups.set(key, {
        key,
        hsCode: t.hsCode,
        origin: t.originCountry,
        importer: t.importingCountry,
        baseRate: t.tariffRatePct,
        type: t.tariffType,
      });
    }
    return Array.from(groups.values())
      .filter(g => g.baseRate > 0 || g.type === 'SECTION301' || g.type === 'CBAM' || g.type === 'RETALIATORY')
      .sort((a, b) => b.baseRate - a.baseRate);
  });

  /** 通貨別FXレート (スライダー用) */
  const fxRateList = computed(() => {
    return fxRates.value
      .filter(f => f.currencyCode !== 'JPY')
      .map(f => ({
        currency: f.currencyCode,
        countryCode: f.countryCode,
        baseRate: f.exchangeRateJpy,
        // 表示用: 1外貨 = X JPY
        displayRate: f.exchangeRateJpy > 0 ? Math.round(1 / f.exchangeRateJpy) : 0,
      }));
  });

  // ========================================
  // Core Calculation Engine
  // ========================================

  /** FXレート取得 (オーバーライド優先、不明通貨はエラー) */
  function getEffectiveFxRate(currency: string): number {
    if (currency === 'JPY') return 1.0;
    const override = fxOverrides.value.get(currency);
    if (override !== undefined) return override;
    const base = fxRates.value.find(f => f.currencyCode === currency);
    if (!base) {
      // 為替データ不足を dataQualityWarnings に記録 (シミュレーション中断はしない)
      if (!_fxMissingWarned.has(currency)) {
        _fxMissingWarned.add(currency);
        console.error(`[FX] 為替レート未定義: ${currency} — 計算結果が不正確になる可能性があります`);
      }
      return NaN; // 0 や 1.0 ではなく NaN → 下流で NaN が伝播し問題箇所が可視化される
    }
    return base.exchangeRateJpy;
  }
  const _fxMissingWarned = new Set<string>();

  /** 基準FXレート (オーバーライドなし、不明通貨はエラー) */
  function getBaseFxRate(currency: string): number {
    if (currency === 'JPY') return 1.0;
    const base = fxRates.value.find(f => f.currencyCode === currency);
    if (!base) return NaN;
    return base.exchangeRateJpy;
  }

  /** 関税率取得 (オーバーライド優先) */
  function getEffectiveTariffRate(hsCode: string, originCountry: string, importingCountry: string): number {
    const key = `${hsCode}:${originCountry}:${importingCountry}`;
    const override = tariffOverrides.value.get(key);
    if (override !== undefined) return override;
    const base = tariffs.value.find(
      t => t.hsCode === hsCode && t.originCountry === originCountry && t.importingCountry === importingCountry
    );
    return base?.tariffRatePct || 0;
  }

  /** 基準関税率 (オーバーライドなし) */
  function getBaseTariffRate(hsCode: string, originCountry: string, importingCountry: string): number {
    const base = tariffs.value.find(
      t => t.hsCode === hsCode && t.originCountry === originCountry && t.importingCountry === importingCountry
    );
    return base?.tariffRatePct || 0;
  }

  /**
   * その素材を供給可能なサプライヤー集合を返す
   * BOM に SUPPLIES エッジが存在するサプライヤーのみ
   */
  function suppliersForMaterial(materialId: string): Set<string> {
    const ids = new Set<string>();
    for (const b of bomItems.value) {
      if (b.materialId === materialId && b.supplierId) ids.add(b.supplierId);
    }
    return ids;
  }

  /**
   * 素材の有効サプライヤー取得
   *
   * 修正:
   * - focusedAlternativeId を優先的に使用
   * - ALTERNATIVE_TO は対象素材の供給能力を持つ場合のみ有効
   *   (SUPPLIES 関係が BOM に存在するかで判定)
   */
  function getEffectiveSupplier(materialId: string, currentSupplierId: string): {
    supplierId: string; supplierName: string; isAlternative: boolean; originCountry: string;
  } | null {
    // OPTIONAL MATCH で SUPPLIES エッジが無い場合 null→'' になるため、
    // 空文字は「サプライヤー未設定」として途絶扱い
    if (!currentSupplierId) return null;

    // 現サプライヤーが有効ならそのまま返す
    if (!disabledSuppliers.value.has(currentSupplierId)) {
      const item = bomItems.value.find(b => b.materialId === materialId && b.supplierId === currentSupplierId);
      return {
        supplierId: currentSupplierId,
        supplierName: item?.supplierName || currentSupplierId,
        isAlternative: false,
        originCountry: item?.originCountry || '',
      };
    }

    // この素材を供給可能なサプライヤー一覧 (SUPPLIES edge in BOM)
    const capableSuppliers = suppliersForMaterial(materialId);

    // ユーザーが選択した代替候補を優先 — ALTERNATIVE_TO と BOM フォールバック両方をチェック
    if (focusedSupplierId.value === currentSupplierId && focusedAlternativeId.value) {
      const targetId = focusedAlternativeId.value;
      if (!disabledSuppliers.value.has(targetId) && capableSuppliers.has(targetId)) {
        // ALTERNATIVE_TO エッジ経由
        const chosenAlt = alternatives.value.find(
          a => a.supplierId === currentSupplierId && a.altSupplierId === targetId
        );
        if (chosenAlt) {
          const altBomItem = bomItems.value.find(
            b => b.materialId === materialId && b.supplierId === targetId
          );
          return {
            supplierId: targetId,
            supplierName: chosenAlt.altSupplierName,
            isAlternative: true,
            originCountry: altBomItem?.originCountry || '',
          };
        }
        // BOM フォールバック (ALTERNATIVE_TO エッジがないが BOM に SUPPLIES エッジあり)
        const bomFallback = bomItems.value.find(
          b => b.materialId === materialId && b.supplierId === targetId
        );
        if (bomFallback) {
          return {
            supplierId: targetId,
            supplierName: bomFallback.supplierName,
            isAlternative: true,
            originCountry: bomFallback.originCountry,
          };
        }
      }
    }

    // ALTERNATIVE_TO エッジから探す — 素材供給能力を検証
    const alt = alternatives.value.find(
      a => a.supplierId === currentSupplierId
        && !disabledSuppliers.value.has(a.altSupplierId)
        && capableSuppliers.has(a.altSupplierId)
    );
    if (alt) {
      const altBomItem = bomItems.value.find(
        b => b.materialId === materialId && b.supplierId === alt.altSupplierId
      );
      return {
        supplierId: alt.altSupplierId,
        supplierName: alt.altSupplierName,
        isAlternative: true,
        originCountry: altBomItem?.originCountry || '',
      };
    }

    // 同じ素材を供給できる別のサプライヤーを探す (BOM直接参照)
    const otherSupplier = bomItems.value.find(
      b => b.materialId === materialId && b.supplierId !== currentSupplierId && !disabledSuppliers.value.has(b.supplierId)
    );
    if (otherSupplier) {
      return {
        supplierId: otherSupplier.supplierId,
        supplierName: otherSupplier.supplierName,
        isAlternative: true,
        originCountry: otherSupplier.originCountry,
      };
    }

    return null; // 供給途絶
  }

  /** 素材の単価調整 (代替サプライヤーの場合 price_diff_pct を適用) */
  function getAdjustedUnitPrice(
    basePrice: number,
    originalSupplierId: string,
    effectiveSupplierId: string,
    isAlternative: boolean
  ): number {
    if (!isAlternative) return basePrice;
    const alt = alternatives.value.find(
      a => a.supplierId === originalSupplierId && a.altSupplierId === effectiveSupplierId
    );
    if (alt) {
      return basePrice * (1 + alt.priceDiffPct / 100);
    }
    return basePrice;
  }

  // ========================================
  // Simulation Results
  // 修正: baseCost を BOM から計算 (cost_estimate_jpy ではない)
  // ========================================

  /** 製品別シミュレーション結果 */
  const simulationResults = computed<ProductSimResult[]>(() => {
    if (bomItems.value.length === 0) return [];

    const productMap = new Map<string, ProductSimResult>();

    for (const product of products.value) {
      const prodBomItems = bomItems.value.filter(b => b.productId === product.id);

      // 各素材のプライマリサプライヤーを特定
      const materialSuppliers = new Map<string, SimBOMItem>();
      for (const item of prodBomItems) {
        const existing = materialSuppliers.get(item.materialId);
        if (!existing || (item.isPrimary && !existing.isPrimary)) {
          materialSuppliers.set(item.materialId, item);
        }
      }

      let baselineCost = 0;
      let newCost = 0;
      let isDisrupted = false;
      const components: ComponentSimResult[] = [];

      for (const [, item] of materialSuppliers) {
        // ── Baseline cost (original supplier, base FX, base tariff) ──
        const baseFxRate = getBaseFxRate(item.materialCurrency);
        const basePriceJpy = item.materialCurrency === 'JPY'
          ? item.materialUnitPrice
          : item.materialUnitPrice / baseFxRate;
        const baseTariffRate = getBaseTariffRate(item.hsCode, item.originCountry, 'JP');
        const baseComponentCost = basePriceJpy * (1 + baseTariffRate / 100) * item.bomQuantity;
        baselineCost += baseComponentCost;

        // ── Scenario cost (overridden params) ──
        const effectiveSupplier = getEffectiveSupplier(item.materialId, item.supplierId);

        if (!effectiveSupplier) {
          // 供給途絶: コストを 0 にせず baseline を維持
          // → 製品が作れないことを「安くなった」と誤認させない
          isDisrupted = true;
          newCost += baseComponentCost; // baseline コストを維持
          components.push({
            materialId: item.materialId,
            materialName: item.materialName,
            supplierId: item.supplierId,
            supplierName: item.supplierName + ' (途絶)',
            isAlternative: false,
            unitPriceJpy: basePriceJpy,
            tariffRate: baseTariffRate,
            costWithTariff: basePriceJpy * (1 + baseTariffRate / 100),
            bomQuantity: item.bomQuantity,
            totalCost: baseComponentCost, // baseline を維持 (not 0)
            baselineTotalCost: baseComponentCost,
          });
          continue;
        }

        const adjustedUnitPrice = getAdjustedUnitPrice(
          item.materialUnitPrice,
          item.supplierId,
          effectiveSupplier.supplierId,
          effectiveSupplier.isAlternative
        );

        const fxRate = getEffectiveFxRate(item.materialCurrency);
        const unitPriceJpy = item.materialCurrency === 'JPY'
          ? adjustedUnitPrice
          : adjustedUnitPrice / fxRate;

        const tariffRate = getEffectiveTariffRate(
          item.hsCode,
          effectiveSupplier.originCountry || item.originCountry,
          'JP'
        );

        const costWithTariff = unitPriceJpy * (1 + tariffRate / 100);
        const totalCost = costWithTariff * item.bomQuantity;
        newCost += totalCost;

        components.push({
          materialId: item.materialId,
          materialName: item.materialName,
          supplierId: effectiveSupplier.supplierId,
          supplierName: effectiveSupplier.supplierName,
          isAlternative: effectiveSupplier.isAlternative,
          unitPriceJpy,
          tariffRate,
          costWithTariff,
          bomQuantity: item.bomQuantity,
          totalCost,
          baselineTotalCost: baseComponentCost,
        });
      }

      // Both costs computed from BOM → zero delta when no overrides
      const delta = newCost - baselineCost;
      const deltaPct = baselineCost > 0 ? (delta / baselineCost) * 100 : 0;
      const baseMargin = product.salesPrice > 0
        ? (product.salesPrice - baselineCost) / product.salesPrice
        : 0;
      const newMargin = product.salesPrice > 0
        ? (product.salesPrice - newCost) / product.salesPrice
        : 0;

      productMap.set(product.id, {
        productId: product.id,
        productName: product.name,
        baseCost: baselineCost,
        newCost,
        delta,
        deltaPct,
        baseMargin,
        newMargin,
        isDisrupted,
        components,
      });
    }

    return Array.from(productMap.values()).sort((a, b) => a.productId.localeCompare(b.productId));
  });

  /**
   * ポートフォリオ影響サマリー
   * 修正: 途絶製品はコスト改善計算から除外し、逸失売上を別表示
   */
  const portfolioImpact = computed<PortfolioImpact & { lostRevenue: number }>(() => {
    let totalBase = 0;
    let totalNew = 0;
    let affected = 0;
    let disrupted = 0;
    let lostRevenue = 0;

    for (const result of simulationResults.value) {
      const prodOrders = orders.value.filter(o => o.productId === result.productId);
      const orderQty = prodOrders.reduce((sum, o) => sum + o.annualOrderQty, 0) * volumeMultiplier.value;
      const orderRevenue = prodOrders.reduce((sum, o) => sum + o.annualOrderQty * o.unitPriceJpy, 0) * volumeMultiplier.value;

      if (result.isDisrupted) {
        // 途絶製品: コスト比較に含めず逸失売上として計上
        disrupted++;
        lostRevenue += orderRevenue;
      } else {
        totalBase += result.baseCost * orderQty;
        totalNew += result.newCost * orderQty;
        if (Math.abs(result.deltaPct) > 0.01) affected++;
      }
    }

    const totalDelta = totalNew - totalBase;
    const totalDeltaPct = totalBase > 0 ? (totalDelta / totalBase) * 100 : 0;

    return {
      totalDelta,
      totalDeltaPct,
      affectedProducts: affected,
      disruptedProducts: disrupted,
      totalBaseAmount: totalBase,
      totalNewAmount: totalNew,
      lostRevenue,
    };
  });

  /** 選択製品のコスト内訳 */
  const selectedProductBreakdown = computed<ComponentSimResult[]>(() => {
    if (!selectedProductId.value) return [];
    const result = simulationResults.value.find(r => r.productId === selectedProductId.value);
    return result?.components || [];
  });

  /**
   * 利益内訳: 各要因のコスト変動への寄与 (逐次分解)
   *
   * 各要因の影響を前ステップからの差分として計算:
   *   baseline → (+FX) → (+関税) → (+サプライヤー切替) = final
   * こうすることで交互作用項が失われず、合計が常に実際のデルタと一致する。
   * 途絶製品は portfolioImpact と整合させるため除外。
   */
  const profitBreakdown = computed(() => {
    if (simulationResults.value.length === 0) {
      return { tariffImpact: 0, fxImpact: 0, supplierImpact: 0, netDelta: 0 };
    }

    let tariffImpact = 0;
    let fxImpact = 0;
    let supplierImpact = 0;

    for (const result of simulationResults.value) {
      // Exclude disrupted products (consistent with portfolioImpact)
      if (result.isDisrupted) continue;

      const product = products.value.find(p => p.id === result.productId);
      if (!product) continue;

      const prodBomItems = bomItems.value.filter(b => b.productId === product.id);
      const materialSuppliers = new Map<string, SimBOMItem>();
      for (const item of prodBomItems) {
        const existing = materialSuppliers.get(item.materialId);
        if (!existing || (item.isPrimary && !existing.isPrimary)) {
          materialSuppliers.set(item.materialId, item);
        }
      }

      const prodOrders = orders.value.filter(o => o.productId === product.id);
      const orderQty = prodOrders.reduce((sum, o) => sum + o.annualOrderQty, 0) * volumeMultiplier.value;

      for (const [, item] of materialSuppliers) {
        const effectiveSupplier = getEffectiveSupplier(item.materialId, item.supplierId);
        if (!effectiveSupplier) continue;

        // ── Step 0: Baseline (base FX, base price, base tariff, original origin) ──
        const baseFxRate = getBaseFxRate(item.materialCurrency);
        const basePriceJpy = item.materialCurrency === 'JPY'
          ? item.materialUnitPrice
          : item.materialUnitPrice / baseFxRate;
        const baseTariff = getBaseTariffRate(item.hsCode, item.originCountry, 'JP');
        const baseline = basePriceJpy * (1 + baseTariff / 100) * item.bomQuantity;

        // ── Step 1: Apply FX change (new FX, original price, base tariff) ──
        const newFxRate = getEffectiveFxRate(item.materialCurrency);
        const fxPriceJpy = item.materialCurrency === 'JPY'
          ? item.materialUnitPrice
          : item.materialUnitPrice / newFxRate;
        const afterFx = fxPriceJpy * (1 + baseTariff / 100) * item.bomQuantity;
        fxImpact += (afterFx - baseline) * orderQty;

        // ── Step 2: Apply tariff change on same origin (new FX price, new tariff same origin) ──
        const newTariffSameOrigin = getEffectiveTariffRate(item.hsCode, item.originCountry, 'JP');
        const afterTariff = fxPriceJpy * (1 + newTariffSameOrigin / 100) * item.bomQuantity;
        tariffImpact += (afterTariff - afterFx) * orderQty;

        // ── Step 3: Apply supplier switch (adjusted price, new FX, effective tariff w/ new origin) ──
        // Captures: price diff, origin-change tariff diff, and all interaction terms
        const adjustedPrice = getAdjustedUnitPrice(
          item.materialUnitPrice, item.supplierId,
          effectiveSupplier.supplierId, effectiveSupplier.isAlternative
        );
        const adjustedPriceJpy = item.materialCurrency === 'JPY'
          ? adjustedPrice
          : adjustedPrice / newFxRate;
        const effectiveTariff = getEffectiveTariffRate(
          item.hsCode,
          effectiveSupplier.originCountry || item.originCountry,
          'JP'
        );
        const finalCost = adjustedPriceJpy * (1 + effectiveTariff / 100) * item.bomQuantity;
        supplierImpact += (finalCost - afterTariff) * orderQty;
      }
    }

    return {
      tariffImpact,
      fxImpact,
      supplierImpact,
      netDelta: tariffImpact + fxImpact + supplierImpact,
    };
  });

  /** コスト変動要因 (ウォーターフォール用) */
  const costDriverWaterfall = computed<CostDriverSegment[]>(() => {
    const pb = profitBreakdown.value;
    const segments: CostDriverSegment[] = [];
    if (pb.tariffImpact !== 0) segments.push({ label: '関税変動', value: pb.tariffImpact, type: 'tariff' });
    if (pb.fxImpact !== 0) segments.push({ label: '為替変動', value: pb.fxImpact, type: 'fx' });
    if (pb.supplierImpact !== 0) segments.push({ label: 'サプライヤー切替', value: pb.supplierImpact, type: 'supplier' });
    segments.push({ label: '合計影響額', value: pb.netDelta, type: 'net' });
    return segments;
  });

  /**
   * 供給リスク指標 (データ駆動)
   * HHI: 0 = 完全分散, 10000 = 独占
   */
  const supplyRiskMetrics = computed<SupplyRiskMetrics>(() => {
    // Build material → available suppliers mapping (skip empty supplier IDs from OPTIONAL MATCH)
    const materialSuppliersMap = new Map<string, Set<string>>();
    for (const item of bomItems.value) {
      if (!item.supplierId) continue;
      if (!materialSuppliersMap.has(item.materialId)) {
        materialSuppliersMap.set(item.materialId, new Set());
      }
      materialSuppliersMap.get(item.materialId)!.add(item.supplierId);
    }

    // Count alternatives per material — only those with verified supply capability
    const materialAltsMap = new Map<string, Set<string>>();
    for (const [matId, directSuppliers] of materialSuppliersMap) {
      const capable = suppliersForMaterial(matId); // all suppliers who can supply this material
      for (const suppId of directSuppliers) {
        const alts = alternatives.value.filter(a => a.supplierId === suppId);
        for (const alt of alts) {
          // Only count as a viable alternative if the alt supplier can actually supply this material
          if (!capable.has(alt.altSupplierId)) continue;
          if (!materialAltsMap.has(matId)) {
            materialAltsMap.set(matId, new Set());
          }
          materialAltsMap.get(matId)!.add(alt.altSupplierId);
        }
      }
    }

    // Build deduplicated union of all viable suppliers per material
    // (direct BOM entries + capable alternatives must be merged, not summed)
    const materialAllSuppliers = new Map<string, Set<string>>();
    for (const [matId, directSuppliers] of materialSuppliersMap) {
      const all = new Set(directSuppliers);
      const alts = materialAltsMap.get(matId);
      if (alts) { for (const a of alts) all.add(a); }
      materialAllSuppliers.set(matId, all);
    }

    // Single-source count (using deduplicated union)
    let singleSourceBefore = 0;
    let singleSourceAfter = 0;

    for (const [matId] of materialSuppliersMap) {
      const all = materialAllSuppliers.get(matId)!;
      // Before: all suppliers active
      if (all.size <= 1) singleSourceBefore++;
      // After: exclude disabled suppliers
      const activeCount = Array.from(all).filter(s => !disabledSuppliers.value.has(s)).length;
      if (activeCount <= 1) singleSourceAfter++;
    }

    // HHI computation helper
    function computeHHI(countFn: (matId: string) => number): number {
      if (materialSuppliersMap.size === 0) return 0;
      let totalHHI = 0;
      for (const [matId] of materialSuppliersMap) {
        const n = countFn(matId);
        if (n <= 0) { totalHHI += 10000; continue; }
        // Equal-weight HHI for N suppliers = N * (1/N)^2 * 10000 = 10000/N
        totalHHI += Math.round(10000 / n);
      }
      return Math.round(totalHHI / materialSuppliersMap.size);
    }

    const hhiBefore = computeHHI((matId) => materialAllSuppliers.get(matId)?.size || 0);
    const hhiAfter = computeHHI((matId) => {
      const all = materialAllSuppliers.get(matId);
      if (!all) return 0;
      return Array.from(all).filter(s => !disabledSuppliers.value.has(s)).length;
    });

    // Geographic concentration: based on effective supplier per material after switches
    // "Before" uses primary BOM entries directly.
    // "After" resolves the effective supplier for disabled primaries via getEffectiveSupplier,
    // so replacement supplier countries are correctly included instead of being dropped.
    function computeGeoConcentration(resolveEffective: boolean): number {
      const countryCount = new Map<string, number>();
      let total = 0;

      for (const item of bomItems.value) {
        if (!item.isPrimary) continue;

        let country: string;
        if (!resolveEffective || !disabledSuppliers.value.has(item.supplierId)) {
          // "Before", or primary still active in "after"
          country = item.supplierCountry || item.originCountry || 'Unknown';
        } else {
          // "After": primary disabled → resolve effective replacement supplier's country
          const effective = getEffectiveSupplier(item.materialId, item.supplierId);
          if (!effective) continue; // disrupted — captured by disruptedMaterials count
          const effBom = bomItems.value.find(
            b => b.materialId === item.materialId && b.supplierId === effective.supplierId
          );
          country = effBom?.supplierCountry || effBom?.originCountry || 'Unknown';
        }

        countryCount.set(country, (countryCount.get(country) || 0) + 1);
        total++;
      }

      if (total === 0) return 10000;
      let hhi = 0;
      for (const [, count] of countryCount) {
        const share = count / total;
        hhi += share * share * 10000;
      }
      return Math.round(hhi);
    }

    const geoBefore = computeGeoConcentration(false);
    const geoAfter = computeGeoConcentration(true);

    // Disrupted materials — deduplicated by materialId
    // (one material appearing in multiple products should count once)
    const disruptedMaterialIds = new Set<string>();
    for (const r of simulationResults.value) {
      for (const c of r.components) {
        if (c.supplierName.includes('途絶')) {
          disruptedMaterialIds.add(c.materialId);
        }
      }
    }
    const disruptedMaterials = disruptedMaterialIds.size;

    // Cautions (from alternative recommendations)
    const cautions: string[] = [];
    for (const rec of alternativeRecommendations.value) {
      if (rec.leadTimeDiff > 0) cautions.push(`${rec.altSupplierName}: リードタイム +${rec.leadTimeDiff}日`);
      if (rec.qualityDiff < 0) cautions.push(`${rec.altSupplierName}: 品質スコア ${rec.qualityDiff}`);
    }
    if (disabledSuppliers.value.size > 0 && cautions.length === 0) {
      cautions.push('切替先の認定・品質検証期間が必要です');
    }

    return {
      singleSource: { before: singleSourceBefore, after: singleSourceAfter },
      supplierHHI: { before: hhiBefore, after: hhiAfter },
      geoConcentration: { before: geoBefore, after: geoAfter },
      disruptedMaterials,
      cautions,
    };
  });

  /**
   * フォーカスサプライヤーの代替候補リスト
   *
   * 2 つのソースを統合:
   * 1. ALTERNATIVE_TO エッジ (価格差・品質差・LT差あり)
   * 2. BOM 直接参照 (同じ素材を供給できる別サプライヤー — エンジンの BOM フォールバックと同じ)
   *
   * これにより getEffectiveSupplier が使える全候補を UI に表示し、
   * "代替候補なし" で切替がブロックされる偽陰性を防ぐ。
   */
  const focusedAlternatives = computed(() => {
    if (!focusedSupplierId.value) return [];

    const materialsForSupplier = [
      ...new Set(
        bomItems.value
          .filter(b => b.supplierId === focusedSupplierId.value)
          .map(b => b.materialId)
      ),
    ];

    // 1. ALTERNATIVE_TO based alternatives
    const altToResults = alternatives.value
      .filter(a => a.supplierId === focusedSupplierId.value)
      .map(a => {
        const capableCount = materialsForSupplier.filter(matId =>
          suppliersForMaterial(matId).has(a.altSupplierId)
        ).length;
        return {
          id: a.altSupplierId,
          name: a.altSupplierName,
          priceDiff: a.priceDiffPct,
          qualityDiff: a.qualityDiff,
          ltDiff: a.leadTimeDiff,
          capableMaterialCount: capableCount,
          totalMaterialCount: materialsForSupplier.length,
          source: 'alternative' as const,
        };
      })
      .filter(a => a.capableMaterialCount > 0);

    // 2. BOM-backed fallback suppliers (not already listed via ALTERNATIVE_TO)
    const altToIds = new Set(altToResults.map(a => a.id));
    const candidateMap = new Map<string, { name: string; capable: number }>();

    for (const matId of materialsForSupplier) {
      for (const b of bomItems.value) {
        if (
          b.materialId === matId
          && b.supplierId
          && b.supplierId !== focusedSupplierId.value
          && !altToIds.has(b.supplierId)
        ) {
          const entry = candidateMap.get(b.supplierId);
          if (entry) {
            entry.capable++;
          } else {
            candidateMap.set(b.supplierId, { name: b.supplierName, capable: 1 });
          }
        }
      }
    }

    const bomFallbacks = Array.from(candidateMap.entries()).map(([suppId, info]) => ({
      id: suppId,
      name: info.name,
      priceDiff: 0,     // BOM フォールバック: 単価差データなし
      qualityDiff: 0,
      ltDiff: 0,
      capableMaterialCount: info.capable,
      totalMaterialCount: materialsForSupplier.length,
      source: 'bom' as const,
    }));

    return [...altToResults, ...bomFallbacks];
  });

  /**
   * 代替サプライヤー推奨リスト
   * 修正: 素材供給能力のある代替のみ推奨 (getEffectiveSupplier と同じ基準)
   */
  const alternativeRecommendations = computed<AlternativeRecommendation[]>(() => {
    const recs: AlternativeRecommendation[] = [];

    for (const supplierId of disabledSuppliers.value) {
      const affectedMaterials = bomItems.value
        .filter(b => b.supplierId === supplierId && b.isPrimary)
        .map(b => b.materialId);

      if (affectedMaterials.length === 0) continue;

      // Find an alternative that can supply at least one of the affected materials
      const altCandidates = alternatives.value.filter(
        a => a.supplierId === supplierId && !disabledSuppliers.value.has(a.altSupplierId)
      );

      for (const alt of altCandidates) {
        // Check which affected materials this alt can actually supply
        const capableMaterials = affectedMaterials.filter(matId =>
          suppliersForMaterial(matId).has(alt.altSupplierId)
        );
        if (capableMaterials.length === 0) continue;

        recs.push({
          disabledSupplierId: supplierId,
          disabledSupplierName: alt.supplierName,
          altSupplierId: alt.altSupplierId,
          altSupplierName: alt.altSupplierName,
          priceDiffPct: alt.priceDiffPct,
          qualityDiff: alt.qualityDiff,
          leadTimeDiff: alt.leadTimeDiff,
          materialIds: Array.from(new Set(capableMaterials)),
        });
        break; // One recommendation per disabled supplier
      }
    }

    return recs;
  });

  /** 切替トレードオフサマリー (ALTERNATIVE_TO + BOM フォールバック両対応) */
  const switchTradeoffSummary = computed<SwitchTradeoffSummary | null>(() => {
    if (!focusedSupplierId.value || !focusedAlternativeId.value) return null;

    const altEdge = alternatives.value.find(
      a => a.supplierId === focusedSupplierId.value && a.altSupplierId === focusedAlternativeId.value
    );

    // BOM フォールバック: ALTERNATIVE_TO がなくても BOM にサプライヤーが存在すれば有効
    if (!altEdge) {
      const isBomFallback = bomItems.value.some(b => b.supplierId === focusedAlternativeId.value);
      if (!isBomFallback) return null;
    }

    const altId = focusedAlternativeId.value;
    const origBom = bomItems.value.find(b => b.supplierId === focusedSupplierId.value);
    const altBom = bomItems.value.find(b => b.supplierId === altId);

    const affectedMaterials = bomItems.value
      .filter(b => b.supplierId === focusedSupplierId.value && b.isPrimary)
      .map(b => b.materialId);
    const uniqueAffected = new Set(affectedMaterials);

    // Count materials that go from single-source to multi-source thanks to this switch
    let singleSourceReduction = 0;
    for (const matId of uniqueAffected) {
      const directSuppliers = bomItems.value
        .filter(b => b.materialId === matId)
        .map(b => b.supplierId);
      const activeWithout = new Set(
        directSuppliers.filter(s => !disabledSuppliers.value.has(s))
      );
      const activeWith = new Set(activeWithout);
      if (suppliersForMaterial(matId).has(altId)) {
        activeWith.add(altId);
      }
      if (activeWithout.size <= 1 && activeWith.size > 1) {
        singleSourceReduction++;
      }
    }

    return {
      originalSupplier: altEdge?.supplierName || origBom?.supplierName || focusedSupplierId.value,
      alternativeSupplier: altEdge?.altSupplierName || altBom?.supplierName || altId,
      priceDiffPct: altEdge?.priceDiffPct ?? 0,
      leadTimeDiff: altEdge?.leadTimeDiff ?? 0,
      qualityDiff: altEdge?.qualityDiff ?? 0,
      affectedMaterialCount: uniqueAffected.size,
      singleSourceReduction,
    };
  });

  // ========================================
  // Actions
  // ========================================

  /** Neptune からデータ読み込み + ライブ為替レート取得 */
  async function loadData() {
    if (isDataLoaded.value) return;
    isLoading.value = true;
    error.value = null;

    try {
      const data = await fetchSimulationData();

      bomItems.value = data.bomItems;
      tariffs.value = data.tariffs;
      orders.value = data.orders;
      alternatives.value = data.alternatives;

      // ライブ為替レートを取得 (失敗時は Neptune データにフォールバック)
      const bomCurrencies = Array.from(
        new Set(data.bomItems.map(b => b.materialCurrency).filter(c => c && c !== 'JPY'))
      );
      const liveRates = await fetchLiveFxRates(bomCurrencies);
      if (liveRates.length > 0) {
        // ライブで取得できた通貨はライブ値を使用、取得できなかった通貨は Neptune フォールバック
        const liveMap = new Map(liveRates.map(r => [r.currencyCode, r]));
        const mergedRates = bomCurrencies.map(cur => {
          const live = liveMap.get(cur);
          if (live) return live;
          // Neptune フォールバック
          const neptune = data.fxRates.find(f => f.currencyCode === cur);
          return neptune || { currencyCode: cur, countryCode: '', exchangeRateJpy: NaN };
        });
        fxRates.value = mergedRates;
        const fallbackCurrencies = bomCurrencies.filter(c => !liveMap.has(c));
        if (fallbackCurrencies.length > 0) {
          console.warn(`[FX] Neptune フォールバック: ${fallbackCurrencies.join(', ')}`);
        }
      } else {
        fxRates.value = data.fxRates;
      }

      // FX データ品質検証
      const fxCurrencies = new Set(fxRates.value.map(f => f.currencyCode));
      const missingFx = bomCurrencies.filter(c => !fxCurrencies.has(c));
      if (missingFx.length > 0) {
        console.error(`[FX検証] 為替レート未定義の通貨: ${missingFx.join(', ')}`);
        dataQualityWarnings.value.push(`為替レート未定義: ${missingFx.join(', ')}。該当素材のコスト計算が不正確です。`);
      }

      isDataLoaded.value = true;

      if (products.value.length > 0 && !selectedProductId.value) {
        selectedProductId.value = products.value[0].id;
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'データの読み込みに失敗しました';
      console.error('シミュレーションデータ読み込みエラー:', e);
    } finally {
      isLoading.value = false;
    }
  }

  function setTariffOverride(key: string, rate: number) {
    const newMap = new Map(tariffOverrides.value);
    newMap.set(key, rate);
    tariffOverrides.value = newMap;
  }

  function setFxOverride(currency: string, rate: number) {
    const newMap = new Map(fxOverrides.value);
    newMap.set(currency, rate);
    fxOverrides.value = newMap;
  }

  function toggleSupplier(supplierId: string) {
    const newSet = new Set(disabledSuppliers.value);
    if (newSet.has(supplierId)) {
      newSet.delete(supplierId);
    } else {
      newSet.add(supplierId);
    }
    disabledSuppliers.value = newSet;
  }

  function setVolumeMultiplier(mult: number) {
    volumeMultiplier.value = mult;
  }

  function selectProduct(productId: string) {
    selectedProductId.value = productId;
  }

  function setFocusedSupplier(supplierId: string | null) {
    focusedSupplierId.value = supplierId;
    focusedAlternativeId.value = null;
  }

  /** フォーカスサプライヤー切替実行 (代替候補なしなら何もしない) */
  function executeFocusedSwitch() {
    if (!focusedSupplierId.value) return;
    // Block: 代替候補がなければ切替不可 (意図しない供給途絶を防止)
    if (focusedAlternatives.value.length === 0) return;
    if (!focusedAlternativeId.value) {
      focusedAlternativeId.value = focusedAlternatives.value[0].id;
    }
    if (!disabledSuppliers.value.has(focusedSupplierId.value)) {
      toggleSupplier(focusedSupplierId.value);
    }
  }

  function revertFocusedSwitch() {
    if (!focusedSupplierId.value) return;
    if (disabledSuppliers.value.has(focusedSupplierId.value)) {
      toggleSupplier(focusedSupplierId.value);
    }
  }

  function resetAll() {
    tariffOverrides.value = new Map();
    fxOverrides.value = new Map();
    disabledSuppliers.value = new Set();
    volumeMultiplier.value = 1.0;
    focusedSupplierId.value = null;
    focusedAlternativeId.value = null;
  }

  return {
    // State
    bomItems,
    tariffs,
    orders,
    alternatives,
    fxRates,
    tariffOverrides,
    fxOverrides,
    disabledSuppliers,
    volumeMultiplier,
    selectedProductId,
    focusedSupplierId,
    focusedAlternativeId,
    isLoading,
    error,
    isDataLoaded,
    dataQualityWarnings,

    // Derived data
    products,
    supplierList,
    tariffGroups,
    fxRateList,

    // Simulation results
    simulationResults,
    portfolioImpact,
    selectedProductBreakdown,
    alternativeRecommendations,
    profitBreakdown,
    costDriverWaterfall,
    supplyRiskMetrics,
    focusedAlternatives,
    switchTradeoffSummary,

    // Actions
    loadData,
    setTariffOverride,
    setFxOverride,
    toggleSupplier,
    setVolumeMultiplier,
    selectProduct,
    setFocusedSupplier,
    executeFocusedSwitch,
    revertFocusedSwitch,
    resetAll,
  };
});
