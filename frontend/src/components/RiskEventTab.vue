<script setup lang="ts">
/**
 * Tab 1: リスクイベント
 * フィルタ付きイベントリスト、展開でインパクト+因果チェーン、アナリストアクション
 */
import { ref, computed, watch } from 'vue';
import { useSupplyChainStore } from '@/stores/supplyChain';
import { fetchRiskEvents, fetchImpactsByEvent, fetchRiskEventChain } from '@/services/api';
import { updateEventStatus } from '@/services/notificationApi';
import type { GraphRiskEvent, EventImpact } from '@/types';

const store = useSupplyChainStore();

const props = defineProps<{
  initialReviewFilter?: string;
}>();

const emit = defineEmits<{
  (e: 'focus-event', ev: { latitude: number; longitude: number }): void;
}>();

const eventTypeFilter = ref('');
const reviewFilter = ref(props.initialReviewFilter || '');
const includeResolved = ref(false);

// 外部からレビューフィルタが渡された場合に適用
watch(() => props.initialReviewFilter, (val) => {
  if (val) reviewFilter.value = val;
});
const resolvedEvents = ref<GraphRiskEvent[]>([]);
const expandedEventId = ref<string | null>(null);
const expandedImpacts = ref<EventImpact[]>([]);
const expandedChain = ref<unknown[]>([]);
const expandLoading = ref(false);

const displayedEvents = computed(() => {
  let events = [...store.riskEvents];
  if (includeResolved.value) events = [...events, ...resolvedEvents.value];
  if (eventTypeFilter.value) events = events.filter(e => e.eventType === eventTypeFilter.value);
  if (reviewFilter.value) events = events.filter(e => e.reviewStatus === reviewFilter.value);
  return events;
});

watch(includeResolved, async (val) => {
  if (val && resolvedEvents.value.length === 0) {
    resolvedEvents.value = await fetchRiskEvents({ lifecycleStatus: ['resolved'] });
  }
});

async function toggleExpand(eventId: string) {
  if (expandedEventId.value === eventId) { expandedEventId.value = null; return; }
  expandedEventId.value = eventId;
  expandLoading.value = true;
  try {
    const [impacts, chain] = await Promise.all([
      fetchImpactsByEvent(eventId),
      fetchRiskEventChain(eventId),
    ]);
    expandedImpacts.value = impacts;
    expandedChain.value = chain;
  } finally { expandLoading.value = false; }
}

function getImpactCount(eventId: string): number | null {
  const impacts = store.activeImpactsByEvent.get(eventId);
  return impacts ? impacts.length : null;
}

const severityColors = ['#22c55e', '#eab308', '#f97316', '#ef4444', '#991b1b'];
function severityColor(sev: number) { return severityColors[Math.min(sev - 1, 4)]; }

const typeIcons: Record<string, string> = {
  earthquake: '🌍', typhoon: '🌀', flood: '🌊', port_closure: '⚓',
  sanction: '🚫', trade_restriction: '📋', supplier_bankruptcy: '💰',
  pandemic: '🦠', factory_incident: '🔥',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}日前`;
  return `${Math.floor(d / 30)}ヶ月前`;
}

function formatJpy(amount: number): string {
  if (amount >= 1e8) return `¥${(amount / 1e8).toFixed(1)}億`;
  if (amount >= 1e4) return `¥${(amount / 1e4).toFixed(0)}万`;
  return `¥${amount.toLocaleString()}`;
}

function selectEvent(ev: GraphRiskEvent) {
  store.selectRiskEvent(ev);
  emit('focus-event', { latitude: ev.latitude, longitude: ev.longitude });
}

const dismissReason = ref('');
const actionLoading = ref(false);

async function confirmEvent(eventId: string) {
  actionLoading.value = true;
  try {
    await updateEventStatus(eventId, 'CONFIRMED', 'analyst');
    // ローカル状態を更新
    const ev = store.riskEvents.find(e => e.id === eventId);
    if (ev) (ev as any).reviewStatus = 'confirmed';
  } finally { actionLoading.value = false; }
}

async function dismissEvent(eventId: string) {
  if (!dismissReason.value.trim()) {
    alert('却下理由を入力してください');
    return;
  }
  actionLoading.value = true;
  try {
    await updateEventStatus(eventId, 'DISMISSED', `analyst:${dismissReason.value}`);
    const ev = store.riskEvents.find(e => e.id === eventId);
    if (ev) (ev as any).reviewStatus = 'dismissed';
    dismissReason.value = '';
  } finally { actionLoading.value = false; }
}
</script>

<template>
  <div class="event-tab">
    <div class="filter-bar">
      <select v-model="eventTypeFilter" class="filter-select">
        <option value="">全タイプ</option>
        <option value="earthquake">地震</option>
        <option value="typhoon">台風</option>
        <option value="flood">洪水</option>
        <option value="port_closure">港湾閉鎖</option>
        <option value="trade_restriction">貿易規制</option>
        <option value="pandemic">パンデミック</option>
      </select>
      <select v-model="reviewFilter" class="filter-select">
        <option value="">全ステータス</option>
        <option value="pending">確認待ち</option>
        <option value="confirmed">確認済み</option>
        <option value="watching">監視中</option>
        <option value="dismissed">却下</option>
      </select>
      <label class="filter-check">
        <input type="checkbox" v-model="includeResolved" /> 解決済み
      </label>
    </div>

    <div class="event-list">
      <div v-if="displayedEvents.length === 0" class="empty-state">該当するイベントはありません</div>
      <div
        v-for="ev in displayedEvents" :key="ev.id"
        class="event-card"
        :class="{ expanded: expandedEventId === ev.id, selected: store.selectedRiskEvent?.id === ev.id }"
        @click="selectEvent(ev)"
      >
        <div class="card-head" @click.stop="toggleExpand(ev.id)">
          <span class="sev-badge" :style="{ background: severityColor(ev.severity) }">{{ ev.severity }}</span>
          <div class="card-info">
            <div class="card-title">
              <span>{{ typeIcons[ev.eventType] || '⚠️' }}</span> {{ ev.title }}
            </div>
            <div class="card-meta">
              <span class="lifecycle-tag">{{ ev.lifecycleStatus }}</span>
              <span>{{ ev.locationName }}</span>
              <span>{{ timeAgo(ev.startDate) }}</span>
            </div>
          </div>
          <div class="card-stats">
            <span v-if="getImpactCount(ev.id) !== null">{{ getImpactCount(ev.id) }}ノード</span>
            <span v-else>—</span>
          </div>
        </div>

        <div v-if="expandedEventId === ev.id" class="card-expanded">
          <div v-if="expandLoading" class="loading">読み込み中...</div>
          <template v-else>
            <div v-if="expandedImpacts.length" class="exp-section">
              <div class="exp-label">影響ノード</div>
              <div v-for="imp in expandedImpacts" :key="imp.nodeId" class="impact-row">
                <span class="imp-type" :class="imp.impactType">{{ imp.impactType === 'direct' ? '直接' : '下流' }}</span>
                <span class="imp-name">{{ imp.nodeName }}</span>
                <span class="imp-amount mono">{{ formatJpy(imp.cachedImpactAmount) }}</span>
              </div>
            </div>
            <div v-if="expandedChain.length" class="exp-section">
              <div class="exp-label">関連イベント</div>
              <div v-for="(c, i) in expandedChain" :key="i" class="chain-row">
                {{ (c as any).resultingEvent }}
              </div>
            </div>
            <div v-if="ev.reviewStatus === 'pending'" class="actions">
              <button class="btn btn-ok" @click.stop="confirmEvent(ev.id)" :disabled="actionLoading">確認</button>
              <input
                v-model="dismissReason"
                class="dismiss-input"
                placeholder="却下理由..."
                @click.stop
              />
              <button class="btn btn-ng" @click.stop="dismissEvent(ev.id)" :disabled="actionLoading">却下</button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.event-tab { display: flex; flex-direction: column; height: 100%; }
.filter-bar { display: flex; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--color-gray-200); flex-shrink: 0; }
.filter-select { padding: var(--space-1) var(--space-2); border: 1px solid var(--color-gray-200); border-radius: var(--radius-sm); font-size: var(--text-xs); background: #fff; }
.filter-check { display: flex; align-items: center; gap: 4px; font-size: var(--text-xs); cursor: pointer; }
.event-list { flex: 1; overflow-y: auto; }
.empty-state { padding: var(--space-8); text-align: center; color: var(--color-gray-700); font-size: var(--text-sm); }
.event-card { border-bottom: 1px solid var(--color-gray-200); cursor: pointer; transition: background var(--transition-fast); }
.event-card:hover { background: var(--color-primary-50); }
.event-card.selected { background: rgba(59,130,246,0.08); border-left: 3px solid var(--color-plant); }
.card-head { display: flex; align-items: flex-start; gap: var(--space-2); padding: var(--space-2) var(--space-3); }
.sev-badge { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: var(--radius-sm); color: #fff; font-size: var(--text-xs); font-weight: 700; flex-shrink: 0; }
.card-info { flex: 1; min-width: 0; }
.card-title { font-size: var(--text-sm); font-weight: 600; display: flex; align-items: center; gap: 4px; }
.card-meta { display: flex; gap: var(--space-2); font-size: var(--text-xs); color: var(--color-gray-700); margin-top: 2px; }
.lifecycle-tag { padding: 1px var(--space-1); border-radius: 2px; background: var(--color-gray-200); font-size: 10px; text-transform: uppercase; }
.card-stats { font-size: var(--text-xs); color: var(--color-gray-700); white-space: nowrap; }
.card-expanded { padding: 0 var(--space-3) var(--space-3); }
.exp-section { margin-top: var(--space-2); }
.exp-label { font-size: var(--text-xs); font-weight: 600; color: var(--color-gray-700); margin-bottom: var(--space-1); }
.impact-row { display: flex; gap: var(--space-2); padding: var(--space-1) 0; font-size: var(--text-xs); border-bottom: 1px solid #f0f0f0; }
.imp-type { padding: 1px var(--space-1); border-radius: 2px; font-size: 10px; }
.imp-type.direct { background: #fef2f2; color: #dc2626; }
.imp-type.downstream { background: #fffbeb; color: #d97706; }
.imp-name { flex: 1; }
.imp-amount { white-space: nowrap; }
.mono { font-family: var(--font-mono); }
.chain-row { font-size: var(--text-xs); padding: var(--space-1) 0; }
.loading { padding: var(--space-4); text-align: center; color: var(--color-gray-700); }
.actions { display: flex; gap: var(--space-2); margin-top: var(--space-3); }
.btn { padding: var(--space-1) var(--space-3); border: none; border-radius: var(--radius-sm); font-size: var(--text-xs); font-weight: 700; cursor: pointer; }
.btn-ok { background: var(--color-success-600); color: #fff; }
.btn-ng { background: var(--color-danger-600); color: #fff; }
.dismiss-input { flex: 1; padding: var(--space-1) var(--space-2); border: 1px solid var(--color-gray-200); border-radius: var(--radius-sm); font-size: var(--text-xs); }
</style>
