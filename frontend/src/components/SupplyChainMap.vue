<script setup lang="ts">
/**
 * サプライチェーン地図コンポーネント
 * エッジの色と線種を改善
 */
import { ref, onMounted, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useSupplyChainStore } from '@/stores/supplyChain';
import type { Plant, Supplier, Customer, MapLine, EarthquakeEvent, GraphRiskEvent } from '@/types';

// Leafletアイコン修正
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

const store = useSupplyChainStore();
const mapContainer = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
const markers = ref<Map<string, L.CircleMarker | L.Marker>>(new Map());
const supplyLines = ref<L.Polyline[]>([]);

const visiblePlants = ref<Set<string>>(new Set());
const visibleSuppliers = ref<Set<string>>(new Set());
const visibleCustomers = ref<Set<string>>(new Set());

// 地震関連レイヤー
const earthquakeMarkers = ref<L.Marker[]>([]);
const earthquakeCircles = ref<L.Circle[]>([]);

// リスクイベント範囲円レイヤー
const riskEventCircles = ref<L.Circle[]>([]);

// カラー定義（色弱対応: 形状＋色で区別）
const COLORS = {
  // ノードカラー
  plantNormal: '#3b82f6',    // 青（円形）
  plantDirect: '#ef4444',    // 赤
  plantDownstream: '#f59e0b', // アンバー
  supplier: '#0891b2',       // シアン（三角形）— 青と明確に区別
  customer: '#22c55e',       // 緑（四角形）
  customerDownstream: '#f59e0b',
  warehouse: '#8b5cf6',        // 紫（五角形）
  logisticsHub: '#d97706',     // アンバー濃（アンカーアイコン）
  logisticsHubDisrupted: '#ef4444',
  riskEventCircle: '#ef4444',  // リスクイベント範囲円
  // エッジカラー
  edgeNormal: '#64748b',
  edgeImpacted: '#ef4444',
  edgeToSupplier: '#0891b2',
  edgeToCustomer: '#22c55e',
};

// ── リスクベース可視化ヘルパー ──────────────────────────────

/**
 * liveEventRiskからマーカー色を算出（初期閾値、v3で自動キャリブレーション可）
 */
function riskColor(liveEventRisk: number, defaultColor: string): string {
  if (liveEventRisk <= 0) return defaultColor;
  if (liveEventRisk < 2.0) return '#eab308';   // yellow-500
  if (liveEventRisk < 4.0) return '#f97316';   // orange-500
  return '#ef4444';                              // red-500
}

/**
 * revenueExposureからマーカー半径を算出（8-16px標準、ハブは12px基準）
 */
function riskRadius(revenueExposure: number, isHub: boolean = false): number {
  const base = isHub ? 12 : 8;
  const max = isHub ? 18 : 16;
  return Math.min(base + Math.sqrt((revenueExposure || 0) / 1e8) * 3, max);
}

/**
 * 複合リスクバッジSVGパーツ（2+アクティブイベント持ちノードに6px赤ドット）
 */
function compoundBadgeSvg(nodeId: string): string {
  const impacts = store.activeImpactsByNode.get(nodeId);
  if (!impacts || impacts.length < 2) return '';
  return '<circle cx="16" cy="4" r="3" fill="#ef4444" stroke="white" stroke-width="1"/>';
}

const POPUP_FONT = "'Noto Sans JP','BIZ UDGothic',sans-serif";
const POPUP_LINK_STYLE = "display:block;margin-top:12px;padding:8px 0;text-align:center;font-size:12px;font-weight:700;color:#1b2838;background:#ffffff;border:1px solid #1b2838;border-radius:3px;text-decoration:none;cursor:pointer;";
const POPUP_LINK_HOVER_IN = "this.style.background='#1b2838';this.style.color='#ffffff'";
const POPUP_LINK_HOVER_OUT = "this.style.background='#ffffff';this.style.color='#1b2838'";

function initMap() {
  if (!mapContainer.value || map) return;

  map = L.map(mapContainer.value, {
    center: [36.2048, 138.2529],
    zoom: 6,
    minZoom: 5,
    maxZoom: 18,
  });

  // OpenStreetMap標準タイル
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    className: 'design-d-tile-layer',
  }).addTo(map);
}

function createPlantPopup(plant: Plant): string {
  const status = plant.impactLevel === 'direct' ? '停止中' : '稼働中';
  const statusBg = plant.impactLevel === 'direct' ? '#fef2f2' : '#ecfdf5';
  const statusColor = plant.impactLevel === 'direct' ? '#dc2626' : '#059669';
  const statusBorder = plant.impactLevel === 'direct' ? '#fecaca' : '#a7f3d0';
  
  let alertHtml = '';
  if (plant.impactLevel === 'direct') {
    alertHtml = `<div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:#fff5f5;border:1px solid #fecaca;border-radius:4px;margin-top:12px;">
      <span style="font-size:14px;">⚠️</span>
      <span style="font-size:11px;font-weight:700;color:#c62828;">直接影響を受けています</span>
    </div>`;
  } else if (plant.impactLevel === 'downstream') {
    alertHtml = `<div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:#fffde7;border:1px solid #f57f17;border-radius:4px;margin-top:12px;">
      <span style="font-size:14px;">⚠️</span>
      <span style="font-size:11px;font-weight:700;color:#b26a00;">下流影響を受けています</span>
    </div>`;
  }

  return `
    <div style="font-family:${POPUP_FONT};width:220px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <div style="width:32px;height:32px;background:#eef1f5;border-radius:4px;display:flex;align-items:center;justify-content:center;">
          <span style="font-size:16px;">🏭</span>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:#1b2838;text-transform:uppercase;letter-spacing:0.05em;">工場</div>
          <div style="font-size:14px;font-weight:700;color:#1a1a1a;">${plant.name}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:#8a8a8a;">所在地</span>
          <span style="font-size:12px;font-weight:500;color:#1a1a1a;">${plant.locationName}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:#8a8a8a;">状態</span>
          <span style="font-size:11px;font-weight:700;padding:3px 8px;background:${statusBg};color:${statusColor};border:1px solid ${statusBorder};border-radius:3px;">${status}</span>
        </div>
      </div>
      ${alertHtml}
      <a href="/node/plant/${plant.id}" style="${POPUP_LINK_STYLE}" onmouseover="${POPUP_LINK_HOVER_IN}" onmouseout="${POPUP_LINK_HOVER_OUT}">詳細を見る →</a>
    </div>
  `;
}

function createSupplierPopup(supplier: Supplier): string {
  let alertHtml = '';
  if (supplier.impactLevel === 'downstream') {
    alertHtml = `<div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:#fffde7;border:1px solid #f57f17;border-radius:4px;margin-top:12px;">
      <span style="font-size:14px;">⚠️</span>
      <span style="font-size:11px;font-weight:700;color:#b26a00;">供給先が影響を受けています</span>
    </div>`;
  }

  return `
    <div style="font-family:${POPUP_FONT};width:220px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <div style="width:32px;height:32px;background:#eef1f5;border-radius:4px;display:flex;align-items:center;justify-content:center;">
          <span style="font-size:16px;">📦</span>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:#1b2838;text-transform:uppercase;letter-spacing:0.05em;">サプライヤー</div>
          <div style="font-size:14px;font-weight:700;color:#1a1a1a;">${supplier.name}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:#8a8a8a;">国</span>
          <span style="font-size:12px;font-weight:500;color:#1a1a1a;">${supplier.country}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:#8a8a8a;">地域</span>
          <span style="font-size:12px;font-weight:500;color:#1a1a1a;">${supplier.region}</span>
        </div>
      </div>
      ${alertHtml}
      <a href="/node/supplier/${supplier.id}" style="${POPUP_LINK_STYLE}" onmouseover="${POPUP_LINK_HOVER_IN}" onmouseout="${POPUP_LINK_HOVER_OUT}">詳細を見る →</a>
    </div>
  `;
}

function createCustomerPopup(customer: Customer): string {
  let alertHtml = '';
  if (customer.impactLevel === 'downstream') {
    alertHtml = `<div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:#fffde7;border:1px solid #f57f17;border-radius:4px;margin-top:12px;">
      <span style="font-size:14px;">⚠️</span>
      <span style="font-size:11px;font-weight:700;color:#b26a00;">影響を受けています</span>
    </div>`;
  }

  return `
    <div style="font-family:${POPUP_FONT};width:220px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <div style="width:32px;height:32px;background:#eef1f5;border-radius:4px;display:flex;align-items:center;justify-content:center;">
          <span style="font-size:16px;">🏢</span>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:#1b2838;text-transform:uppercase;letter-spacing:0.05em;">カスタマ</div>
          <div style="font-size:14px;font-weight:700;color:#1a1a1a;">${customer.name}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:#8a8a8a;">業種</span>
          <span style="font-size:12px;font-weight:500;color:#1a1a1a;">${customer.industry}</span>
        </div>
      </div>
      ${alertHtml}
      <a href="/node/customer/${customer.id}" style="${POPUP_LINK_STYLE}" onmouseover="${POPUP_LINK_HOVER_IN}" onmouseout="${POPUP_LINK_HOVER_OUT}">詳細を見る →</a>
    </div>
  `;
}

/**
 * マグニチュードから影響半径（メートル）を算出
 * 簡易モデル: 10^(0.5 * M - 0.5) km → メートル変換
 * M5.0 → ~56km, M6.0 → ~178km, M6.8 → ~355km, M7.0 → ~562km
 */
function magnitudeToRadius(magnitude: number): number {
  const km = Math.pow(10, 0.5 * magnitude - 0.5)/3;
  return km * 1000;
}

/**
 * 地震震源ポップアップを生成
 */
function createEarthquakePopup(eq: EarthquakeEvent): string {
  const date = new Date(eq.timestamp);
  const dateStr = date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const radiusKm = (magnitudeToRadius(eq.magnitude) / 1000).toFixed(0);

  // 震度の色
  const scaleColor = eq.maxScale >= 6 ? '#dc2626' : eq.maxScale >= 4 ? '#f59e0b' : '#3b82f6';

  let impactHtml = '';
  if (eq.affectedPlantsCount && eq.affectedPlantsCount > 0) {
    const amount = eq.impactedOrderAmount
      ? `¥${(eq.impactedOrderAmount / 10000).toFixed(0)}万`
      : '—';
    impactHtml = `
      <div style="border-top:1px solid #f1f5f9;margin-top:10px;padding-top:10px;">
        <div style="font-size:10px;font-weight:600;color:#6b7280;margin-bottom:6px;">影響</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:12px;color:#6b7280;">影響工場</span>
          <span style="font-size:12px;font-weight:600;color:#dc2626;">${eq.affectedPlantsCount}件</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:12px;color:#6b7280;">影響顧客</span>
          <span style="font-size:12px;font-weight:600;color:#f59e0b;">${eq.affectedCustomersCount || 0}件</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:#6b7280;">影響金額</span>
          <span style="font-size:12px;font-weight:600;color:#374151;">${amount}</span>
        </div>
      </div>`;
  }

  return `
    <div style="font-family:${POPUP_FONT};width:240px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <div style="width:32px;height:32px;background:#fff5f5;border-radius:4px;display:flex;align-items:center;justify-content:center;">
          <span style="font-size:16px;">🔴</span>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:#c62828;text-transform:uppercase;letter-spacing:0.05em;">地震</div>
          <div style="font-size:14px;font-weight:700;color:#1a1a1a;">${eq.location}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:#8a8a8a;">発生日時</span>
          <span style="font-size:11px;font-weight:500;color:#1a1a1a;">${dateStr}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:#8a8a8a;">マグニチュード</span>
          <span style="font-size:13px;font-weight:700;color:#c62828;">M${eq.magnitude}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:#8a8a8a;">最大震度</span>
          <span style="font-size:12px;font-weight:700;padding:2px 8px;background:#fff5f5;color:${scaleColor};border:1px solid #fecaca;border-radius:3px;">震度${eq.maxScale}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:#8a8a8a;">深さ</span>
          <span style="font-size:12px;font-weight:500;color:#1a1a1a;">${eq.depth}km</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:#8a8a8a;">推定影響半径</span>
          <span style="font-size:12px;font-weight:500;color:#1a1a1a;">約${radiusKm}km</span>
        </div>
      </div>
      ${impactHtml}
    </div>
  `;
}

/**
 * 地震震源マーカーと影響半径を描画
 */
function renderEarthquakes() {
  if (!map) return;

  // 既存の地震レイヤーをクリア
  earthquakeMarkers.value.forEach((m) => m.remove());
  earthquakeCircles.value.forEach((c) => c.remove());
  earthquakeMarkers.value = [];
  earthquakeCircles.value = [];

  console.log('renderEarthquakes:', store.earthquakes.length, '件');

  store.earthquakes.forEach((eq) => {
    if (!eq.latitude || !eq.longitude) return;

    // 影響半径の円（マーカーの下に描画）
    const radius = magnitudeToRadius(eq.magnitude);
    const circle = L.circle([eq.latitude, eq.longitude], {
      radius,
      color: '#ef4444',
      weight: 1.5,
      opacity: 0.5,
      fillColor: '#ef4444',
      fillOpacity: 0.06,
      dashArray: '6, 4',
      interactive: false,
    });
    circle.addTo(map!);
    earthquakeCircles.value.push(circle);

    // 震源マーカー（ダイヤモンド形 — SVG divIcon）
    const svgDiamond = `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <polygon points="14,1 27,14 14,27 1,14" fill="#ef4444" stroke="white" stroke-width="2.5" opacity="0.95"/>
      <text x="14" y="15" text-anchor="middle" dominant-baseline="central" fill="white" font-size="10px" font-weight="700" font-family="system-ui">${eq.magnitude}</text>
    </svg>`;
    const icon = L.divIcon({
      html: svgDiamond,
      className: 'custom-marker-icon',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14],
    });
    const marker = L.marker([eq.latitude, eq.longitude], { icon, zIndexOffset: 1000 });

    marker.bindPopup(createEarthquakePopup(eq), { maxWidth: 300 });
    marker.bindTooltip(`🔴 ${eq.location} M${eq.magnitude}`, { direction: 'top', offset: [0, -14] });
    marker.addTo(map!);
    earthquakeMarkers.value.push(marker);

    console.log(`地震マーカー追加: ${eq.location} M${eq.magnitude} [${eq.latitude}, ${eq.longitude}]`);
  });
}

function renderMarkers() {
  if (!map) return;

  markers.value.forEach((m) => m.remove());
  markers.value.clear();

  // 工場（リスクスコアベース色・サイズ + 複合リスクバッジ）
  if (store.showPlants) {
    store.plants.forEach((plant) => {
      if (!visiblePlants.value.has(plant.id)) return;

      const score = store.riskScores.get(plant.id);
      const baseColor = plant.impactLevel === 'direct' ? COLORS.plantDirect
        : plant.impactLevel === 'downstream' ? COLORS.plantDownstream
        : COLORS.plantNormal;
      const color = score ? riskColor(score.liveEventRisk, baseColor) : baseColor;
      const radius = score ? riskRadius(score.revenueExposure) : 10;

      const marker = L.circleMarker([plant.latitude, plant.longitude], {
        radius,
        fillColor: color,
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9,
      });

      marker.bindPopup(createPlantPopup(plant), { maxWidth: 280 });
      marker.bindTooltip(plant.name, { direction: 'top', offset: [0, -8] });
      marker.addTo(map!);
      marker.on('click', () => store.selectPlant(plant));
      markers.value.set(plant.id, marker);
    });
  }

  // サプライヤー（三角マーカー）
  if (store.showSuppliers) {
    store.suppliers.forEach((supplier) => {
      if (!visibleSuppliers.value.has(supplier.id)) return;
      
      // 間接影響サプライヤーはアンバー色
      const fillColor = supplier.impactLevel === 'downstream' ? COLORS.plantDownstream : COLORS.supplier;
      const svgTriangle = `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
        <polygon points="10,2 18,18 2,18" fill="${fillColor}" stroke="white" stroke-width="2"/>
      </svg>`;
      const icon = L.divIcon({
        html: svgTriangle,
        className: 'custom-marker-icon',
        iconSize: [20, 20],
        iconAnchor: [10, 18],
        popupAnchor: [0, -16],
      });
      const marker = L.marker([supplier.latitude, supplier.longitude], { icon });

      marker.bindPopup(createSupplierPopup(supplier), { maxWidth: 280 });
      marker.bindTooltip(supplier.name, { direction: 'top', offset: [0, -16] });
      marker.addTo(map!);
      markers.value.set(supplier.id, marker);
    });
  }

  // カスタマ（四角マーカー）
  if (store.showCustomers) {
    store.customers.forEach((customer) => {
      if (!visibleCustomers.value.has(customer.id)) return;
      
      const fillColor = customer.impactLevel === 'downstream' ? COLORS.customerDownstream : COLORS.customer;
      const svgSquare = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="2" width="14" height="14" rx="2" fill="${fillColor}" stroke="white" stroke-width="2"/>
      </svg>`;
      const icon = L.divIcon({
        html: svgSquare,
        className: 'custom-marker-icon',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -10],
      });
      const marker = L.marker([customer.latitude, customer.longitude], { icon });

      marker.bindPopup(createCustomerPopup(customer), { maxWidth: 280 });
      marker.bindTooltip(customer.name, { direction: 'top', offset: [0, -10] });
      marker.addTo(map!);
      markers.value.set(customer.id, marker);
    });
  }

  // 倉庫（五角形マーカー — riskScoresでリスク色を反映）
  if (store.showWarehouses) {
    store.warehouses.forEach((wh) => {
      const score = store.riskScores.get(wh.id);
      const whColor = score && score.liveEventRisk > 0
        ? (score.liveEventRisk > 3 ? COLORS.plantDirect : COLORS.plantDownstream)
        : COLORS.warehouse;
      const svgPentagon = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
        <polygon points="9,1 17,7 14,17 4,17 1,7" fill="${whColor}" stroke="white" stroke-width="1.5"/>
      </svg>`;
      const icon = L.divIcon({
        html: svgPentagon,
        className: 'custom-marker-icon',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -10],
      });
      const marker = L.marker([wh.latitude, wh.longitude], { icon });
      marker.bindTooltip(wh.name, { direction: 'top', offset: [0, -10] });
      marker.addTo(map!);
      markers.value.set(wh.id, marker);
    });
  }

  // 物流拠点（アンカー型マーカー — statusとriskScoresの両方を反映）
  if (store.showLogisticsHubs) {
    store.logisticsHubs.forEach((hub) => {
      const score = store.riskScores.get(hub.id);
      const hubColor = hub.status === 'disrupted' || hub.status === 'closed'
        ? COLORS.logisticsHubDisrupted
        : score && score.liveEventRisk > 0
          ? (score.liveEventRisk > 3 ? COLORS.logisticsHubDisrupted : COLORS.plantDownstream)
          : COLORS.logisticsHub;
      const typeLabel = hub.type === 'port' ? '⚓' : hub.type === 'airport' ? '✈' : '🚧';
      const svgHub = `<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
        <circle cx="11" cy="11" r="9" fill="${hubColor}" stroke="white" stroke-width="2"/>
        <text x="11" y="15" text-anchor="middle" font-size="10">${typeLabel}</text>
      </svg>`;
      const icon = L.divIcon({
        html: svgHub,
        className: 'custom-marker-icon',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -12],
      });
      const marker = L.marker([hub.latitude, hub.longitude], { icon });
      const statusLabel = hub.status === 'operational' ? '稼働中' : hub.status === 'disrupted' ? '混乱中' : '閉鎖';
      marker.bindTooltip(`${hub.name} (${statusLabel})`, { direction: 'top', offset: [0, -12] });
      marker.addTo(map!);
      markers.value.set(hub.id, marker);
    });
  }
}

/**
 * リスクイベント範囲円を描画
 */
function renderRiskEventCircles() {
  if (!map) return;

  // 既存の範囲円を削除
  riskEventCircles.value.forEach((c) => c.remove());
  riskEventCircles.value = [];

  // アクティブ/復旧中の確認済みイベントのみ表示
  const activeEvents = store.riskEvents.filter(
    (e) => ['active', 'recovering'].includes(e.lifecycleStatus)
      && e.reviewStatus === 'confirmed'
      && e.radiusKm > 0,
  );

  for (const ev of activeEvents) {
    const opacity = ev.lifecycleStatus === 'active' ? 0.25 : 0.12;
    const severityColors = ['#fbbf24', '#f59e0b', '#ef4444', '#dc2626', '#991b1b'];
    const color = severityColors[Math.min(ev.severity - 1, 4)];

    const circle = L.circle([ev.latitude, ev.longitude], {
      radius: ev.radiusKm * 1000,
      color,
      fillColor: color,
      fillOpacity: opacity,
      weight: 1,
      opacity: 0.5,
    });

    circle.bindTooltip(
      `${ev.title} (重大度: ${ev.severity})`,
      { direction: 'top' },
    );
    circle.on('click', () => store.selectRiskEvent(ev));
    circle.addTo(map!);
    riskEventCircles.value.push(circle);
  }

  // radiusKm=0 または multi_country/country イベント → ピンマーカー
  const pinEvents = store.riskEvents.filter(
    (e) => ['active', 'recovering'].includes(e.lifecycleStatus)
      && e.reviewStatus === 'confirmed'
      && (e.radiusKm <= 0 || ['multi_country', 'country'].includes(e.geoScopeType)),
  );
  const severityColors = ['#fbbf24', '#f59e0b', '#ef4444', '#dc2626', '#991b1b'];
  for (const ev of pinEvents) {
    const color = severityColors[Math.min(ev.severity - 1, 4)];
    const svgPin = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2" opacity="0.85"/>
      <text x="12" y="16" text-anchor="middle" fill="white" font-size="12" font-weight="bold">${ev.severity}</text>
    </svg>`;
    const icon = L.divIcon({
      html: svgPin,
      className: 'custom-marker-icon',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    const marker = L.marker([ev.latitude, ev.longitude], { icon });
    marker.bindTooltip(`${ev.title} (重大度: ${ev.severity})`, { direction: 'top' });
    marker.on('click', () => store.selectRiskEvent(ev));
    marker.addTo(map!);
    riskEventCircles.value.push(marker as unknown as L.Circle);
  }
}

/**
 * サプライチェーン線を描画
 * - 影響経路: 赤色、太い実線
 * - サプライヤーへの線: 紫色、点線
 * - カスタマへの線: 緑色、点線
 * - 通常の工場間: グレー、細い点線
 * - 非表示ノードに接続するエッジは描画しない
 */
function renderSupplyLines() {
  if (!map) return;

  // 既存の線を削除
  supplyLines.value.forEach((line) => line.remove());
  supplyLines.value = [];

  console.log('renderSupplyLines called:', {
    mapLinesCount: store.mapLines.length,
    visiblePlantsCount: visiblePlants.value.size,
    visibleSuppliersCount: visibleSuppliers.value.size,
    visibleCustomersCount: visibleCustomers.value.size,
  });

  let drawnCount = 0;
  let skippedCount = 0;

  store.mapLines.forEach((line: MapLine) => {
    // 接続元の可視性チェック（fromId と fromType を使用）
    let fromVisible = false;
    if (line.fromType === 'plant') {
      fromVisible = store.showPlants && visiblePlants.value.has(line.fromId);
    } else if (line.fromType === 'supplier') {
      fromVisible = store.showSuppliers && visibleSuppliers.value.has(line.fromId);
    }

    // 接続先の可視性チェック（toId と toType を使用）
    let toVisible = false;
    if (line.toType === 'plant') {
      toVisible = store.showPlants && visiblePlants.value.has(line.toId);
    } else if (line.toType === 'customer') {
      toVisible = store.showCustomers && visibleCustomers.value.has(line.toId);
    } else if (line.toType === 'supplier') {
      toVisible = store.showSuppliers && visibleSuppliers.value.has(line.toId);
    }

    // 両端が表示されていない場合はエッジを描画しない
    if (!fromVisible || !toVisible) {
      skippedCount++;
      return;
    }

    drawnCount++;

    let color: string;
    let weight: number;
    let dashArray: string;
    let opacity: number;

    if (line.isImpacted) {
      // 影響経路の色分け: 下流影響ノード間はアンバー、直接影響は赤
      const fromIsDownstream = store.plants.some(p => p.id === line.fromId && p.impactLevel === 'downstream');
      const toIsDownstreamCustomer = store.customers.some(c => c.id === line.toId && c.impactLevel === 'downstream');
      
      if (fromIsDownstream || toIsDownstreamCustomer) {
        // 下流影響ノード関連の影響線: アンバー
        color = '#f59e0b';
      } else {
        // 直接影響関連の影響線: 赤
        color = COLORS.edgeImpacted;
      }
      weight = 3;
      dashArray = '8, 6';
      opacity = 0.85;
    } else {
      // 通常の経路: 接続先に応じて色分け
      if (line.fromType === 'supplier' || line.toType === 'supplier') {
        // サプライヤー関連: 紫
        color = COLORS.edgeToSupplier;
        weight = 2;
        dashArray = '8, 4';
        opacity = 0.6;
      } else if (line.toType === 'customer') {
        // カスタマへの供給: 緑
        color = COLORS.edgeToCustomer;
        weight = 2;
        dashArray = '8, 4';
        opacity = 0.6;
      } else {
        // 工場間: グレー
        color = COLORS.edgeNormal;
        weight = 1.5;
        dashArray = '6, 4';
        opacity = 0.5;
      }
    }

    const polyline = L.polyline(
      [[line.fromLat, line.fromLon], [line.toLat, line.toLon]],
      {
        color,
        weight,
        opacity,
        dashArray,
      }
    );

    // ツールチップに製品情報を含める
    let tooltipContent = `${line.fromName} → ${line.toName}`;
    if (line.products && line.products.length > 0) {
      const productNames = line.products.map(p => p.name).join(', ');
      tooltipContent += `<br><span style="font-size:11px;color:#6b7280;">製品: ${productNames}</span>`;
    }
    polyline.bindTooltip(tooltipContent, { sticky: true });
    // ルート分析ハイライト用のメタデータを付与
    (polyline as any)._riskLineData = { fromId: line.fromId, toId: line.toId };
    polyline.addTo(map!);
    supplyLines.value.push(polyline);
  });

  console.log('renderSupplyLines result:', { drawnCount, skippedCount });
}

function initVisibility() {
  visiblePlants.value = new Set(store.plants.map(p => p.id));
  visibleSuppliers.value = new Set(store.suppliers.map(s => s.id));
  visibleCustomers.value = new Set(store.customers.map(c => c.id));
}

function togglePlant(id: string) {
  visiblePlants.value.has(id) ? visiblePlants.value.delete(id) : visiblePlants.value.add(id);
  visiblePlants.value = new Set(visiblePlants.value);
  renderMarkers();
  renderSupplyLines();
}

function toggleSupplier(id: string) {
  visibleSuppliers.value.has(id) ? visibleSuppliers.value.delete(id) : visibleSuppliers.value.add(id);
  visibleSuppliers.value = new Set(visibleSuppliers.value);
  renderMarkers();
  renderSupplyLines();
}

function toggleCustomer(id: string) {
  visibleCustomers.value.has(id) ? visibleCustomers.value.delete(id) : visibleCustomers.value.add(id);
  visibleCustomers.value = new Set(visibleCustomers.value);
  renderMarkers();
  renderSupplyLines();
}

function selectAllPlants() {
  visiblePlants.value = new Set(store.plants.map(p => p.id));
  renderMarkers();
  renderSupplyLines();
}

function deselectAllPlants() {
  visiblePlants.value = new Set();
  renderMarkers();
  renderSupplyLines();
}

function selectAllSuppliers() {
  visibleSuppliers.value = new Set(store.suppliers.map(s => s.id));
  renderMarkers();
  renderSupplyLines();
}

function deselectAllSuppliers() {
  visibleSuppliers.value = new Set();
  renderMarkers();
  renderSupplyLines();
}

function selectAllCustomers() {
  visibleCustomers.value = new Set(store.customers.map(c => c.id));
  renderMarkers();
  renderSupplyLines();
}

function deselectAllCustomers() {
  visibleCustomers.value = new Set();
  renderMarkers();
  renderSupplyLines();
}

/**
 * 任意のノード（工場・サプライヤー・カスタマ）にフォーカス
 */
function focusNode(nodeId: string) {
  const marker = markers.value.get(nodeId);
  if (marker && map) {
    map.setView(marker.getLatLng(), 10, { animate: true });
    marker.openPopup();
  }
}

// 後方互換性
function focusPlant(plantId: string) {
  focusNode(plantId);
}

/**
 * 表示する工場IDセットを直接設定（NLクエリ用）
 */
function setVisiblePlants(ids: Set<string>) {
  visiblePlants.value = new Set(ids);
  renderMarkers();
  renderSupplyLines();
}

/**
 * 表示するサプライヤーIDセットを直接設定（NLクエリ用）
 */
function setVisibleSuppliers(ids: Set<string>) {
  visibleSuppliers.value = new Set(ids);
  renderMarkers();
  renderSupplyLines();
}

/**
 * 表示するカスタマIDセットを直接設定（NLクエリ用）
 */
function setVisibleCustomers(ids: Set<string>) {
  visibleCustomers.value = new Set(ids);
  renderMarkers();
  renderSupplyLines();
}

/**
 * 緯度経度にフォーカス（NLクエリでRiskEvent等の結果表示用）
 */
function focusLatLon(lat: number, lon: number) {
  if (!map) return;
  map.setView([lat, lon], 8, { animate: true });
}

// ── ROUTES_THROUGH条件レンダリング ──────────────────────────
const routesThroughLines = ref<L.Polyline[]>([]);

function renderRoutesThrough(filterHubId?: string, filterNodeId?: string) {
  if (!map) return;
  routesThroughLines.value.forEach((l) => l.remove());
  routesThroughLines.value = [];

  for (const route of store.routesThrough) {
    // フィルタ: 特定ハブまたは特定ノードの接続のみ表示
    if (filterHubId && route.toId !== filterHubId) continue;
    if (filterNodeId && route.fromId !== filterNodeId) continue;

    const fromNode = [...store.plants, ...store.suppliers, ...store.warehouses]
      .find((n) => n.id === route.fromId);
    const toHub = store.logisticsHubs.find((h) => h.id === route.toId);
    if (!fromNode || !toHub) continue;

    const isDisrupted = toHub.status === 'disrupted' || toHub.status === 'closed';
    const line = L.polyline(
      [[fromNode.latitude, fromNode.longitude], [toHub.latitude, toHub.longitude]],
      {
        color: isDisrupted ? '#f97316' : '#94a3b8',
        weight: 1,
        dashArray: '4 4',
        opacity: 0.6,
      },
    );
    line.addTo(map!);
    routesThroughLines.value.push(line);
  }
}

function clearRoutesThrough() {
  routesThroughLines.value.forEach((l) => l.remove());
  routesThroughLines.value = [];
}

// ── ルート分析ハイライト ─────────────────────────────────────

function highlightCorridorPath(pathNodeIds: string[]) {
  if (!map) return;
  const pathSet = new Set(pathNodeIds);

  // パス上のエッジペアを構築（隣接ノードペア）
  const pathEdges = new Set<string>();
  for (let i = 0; i < pathNodeIds.length - 1; i++) {
    pathEdges.add(`${pathNodeIds[i]}::${pathNodeIds[i + 1]}`);
  }

  // ノード: パス上は通常表示、パス外は薄暗く
  markers.value.forEach((marker, id) => {
    const inPath = pathSet.has(id);
    if (marker instanceof L.CircleMarker) {
      marker.setStyle({ opacity: inPath ? 1 : 0.2, fillOpacity: inPath ? 0.9 : 0.15 });
    } else {
      (marker as L.Marker).setOpacity(inPath ? 1 : 0.2);
    }
  });

  // エッジ: パス上は太い青線で強調、パス外は薄暗く
  supplyLines.value.forEach((line) => {
    const lineData = (line as any)._riskLineData as { fromId: string; toId: string } | undefined;
    if (!lineData) {
      line.setStyle({ opacity: 0.1 });
      return;
    }
    const edgeKey = `${lineData.fromId}::${lineData.toId}`;
    const isOnPath = pathEdges.has(edgeKey);
    if (isOnPath) {
      line.setStyle({ color: '#3b82f6', weight: 4, opacity: 1 });
    } else {
      line.setStyle({ opacity: 0.1 });
    }
  });
}

function clearCorridorHighlight() {
  markers.value.forEach((marker) => {
    if (marker instanceof L.CircleMarker) {
      marker.setStyle({ opacity: 1, fillOpacity: 0.9 });
    } else {
      (marker as L.Marker).setOpacity(1);
    }
  });
  supplyLines.value.forEach((line) => {
    line.setStyle({ opacity: 0.7 });
  });
}

defineExpose({
  focusNode,
  focusPlant,
  focusLatLon,
  togglePlant,
  toggleSupplier,
  toggleCustomer,
  visiblePlants,
  visibleSuppliers,
  visibleCustomers,
  selectAllPlants,
  deselectAllPlants,
  selectAllSuppliers,
  deselectAllSuppliers,
  selectAllCustomers,
  deselectAllCustomers,
  setVisiblePlants,
  setVisibleSuppliers,
  setVisibleCustomers,
  renderRoutesThrough,
  clearRoutesThrough,
  highlightCorridorPath,
  clearCorridorHighlight,
});

watch(
  () => [store.plants, store.suppliers, store.customers],
  () => {
    // データが変更された時のみ可視性を初期化
    initVisibility();
    renderMarkers();
    renderSupplyLines();
    renderEarthquakes();
  },
  { deep: true }
);

// レイヤー表示切替の監視（可視性セットはリセットしない）
watch(
  () => [store.showPlants, store.showSuppliers, store.showCustomers],
  () => {
    renderMarkers();
    renderSupplyLines();
  }
);

// 地震データの監視
watch(() => store.earthquakes, () => renderEarthquakes(), { deep: true });

watch(() => store.mapLines, () => renderSupplyLines(), { deep: true });

// リスクイベントの監視
watch(() => store.riskEvents, () => renderRiskEventCircles(), { deep: true });

// ルート分析ハイライトの監視
watch(() => store.highlightedCorridorPath, (path) => {
  if (path.length > 0) {
    highlightCorridorPath(path);
  } else {
    clearCorridorHighlight();
  }
});

// 倉庫・物流拠点の表示トグル
watch(() => [store.showWarehouses, store.showLogisticsHubs], () => renderMarkers());

onMounted(() => {
  initMap();
  if (store.plants.length > 0) {
    initVisibility();
    renderMarkers();
    renderSupplyLines();
  }
  if (store.riskEvents.length > 0) {
    renderRiskEventCircles();
  }
  if (store.earthquakes.length > 0) {
    renderEarthquakes();
  }
});
</script>

<template>
  <div ref="mapContainer" class="map-container"></div>
</template>

<style scoped>
.map-container {
  width: 100%;
  height: 100%;
  min-height: 400px;
  background:
    radial-gradient(circle at top left, rgba(212, 216, 221, 0.55), transparent 28%),
    linear-gradient(180deg, #e9edf1 0%, #dde5ea 100%);
}
</style>

<style>
/* カスタムマーカーアイコン（デフォルトスタイルを除去） */
.custom-marker-icon {
  background: none !important;
  border: none !important;
}

.leaflet-container {
  background:
    radial-gradient(circle at top left, rgba(212, 216, 221, 0.55), transparent 28%),
    linear-gradient(180deg, #e9edf1 0%, #dde5ea 100%);
  font-family: 'BIZ UDGothic', 'Noto Sans JP', sans-serif;
}

.leaflet-tile-pane {
  filter: grayscale(0.18) saturate(0.78) brightness(1.03) contrast(0.95);
}

/* 地震マーカーのパルスアニメーション */
.earthquake-marker {
  animation: earthquake-pulse 2s ease-in-out infinite;
}

@keyframes earthquake-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}

/* Leafletポップアップ - Design D */
.leaflet-popup-content-wrapper {
  border-radius: 4px;
  border-top: 3px solid #1b2838;
  box-shadow: 0 8px 20px rgba(0,0,0,0.12);
  padding: 0;
  overflow: hidden;
}

.leaflet-popup-content {
  margin: 14px 16px;
  line-height: 1.5;
}

.leaflet-popup-tip-container {
  margin-top: -1px;
}

.leaflet-popup-tip {
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.leaflet-popup-close-button {
  color: #8a8a8a !important;
  font-size: 18px !important;
  padding: 8px 10px !important;
  width: auto !important;
  height: auto !important;
  top: 4px !important;
  right: 4px !important;
}

.leaflet-popup-close-button:hover {
  color: #1b2838 !important;
  background: #eef1f5 !important;
  border-radius: 3px;
}

/* ツールチップ */
.leaflet-tooltip {
  background: white;
  border: 1px solid #d0d5dd;
  border-radius: 3px;
  padding: 4px 10px;
  font-family: 'Noto Sans JP', 'BIZ UDGothic', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: #1a1a1a;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.leaflet-tooltip::before {
  border-top-color: white !important;
}

/* ズームコントロール */
.leaflet-control-zoom {
  border: 1px solid #d0d5dd !important;
  border-radius: 3px !important;
  overflow: hidden;
}

.leaflet-control-zoom a {
  background: white !important;
  color: #1b2838 !important;
  border-bottom: 1px solid #d0d5dd !important;
}

.leaflet-control-zoom a:hover {
  background: #eef1f5 !important;
}

.leaflet-control-zoom a:last-child {
  border-bottom: none !important;
}

.leaflet-control-attribution {
  background: rgba(255, 255, 255, 0.92) !important;
  color: #6b7280 !important;
  border-top: 1px solid #d0d5dd;
  border-left: 1px solid #d0d5dd;
  border-radius: 3px 0 0 0;
  padding: 3px 6px !important;
}

.leaflet-control-attribution a {
  color: #1b2838 !important;
}
</style>
