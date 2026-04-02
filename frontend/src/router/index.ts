import { createRouter, createWebHistory } from 'vue-router';
import MapView from '@/views/MapView.vue';

/**
 * Vue Router Configuration
 * Supply Chain Map Application Routes
 */
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'map',
      component: MapView,
      meta: { breadcrumb: 'サプライチェーンマップ' },
    },
    {
      path: '/risk-events',
      name: 'risk-events',
      component: () => import('@/views/RiskEventsView.vue'),
      meta: { breadcrumb: 'リスクイベント' },
    },
    {
      path: '/risk-dashboard',
      name: 'risk-dashboard',
      component: () => import('@/views/RiskDashboardView.vue'),
      meta: { breadcrumb: 'リスクダッシュボード' },
    },
    {
      path: '/corridor-analysis',
      name: 'corridor-analysis',
      component: () => import('@/views/CorridorAnalysisView.vue'),
      meta: { breadcrumb: 'ルート分析' },
    },
    // レガシーリダイレクト
    { path: '/factories', redirect: '/risk-dashboard' },
    { path: '/earthquakes', redirect: '/risk-events' },
    {
      path: '/node/:type/:id',
      name: 'node-detail',
      component: () => import('@/views/NodeDetailView.vue'),
      meta: { breadcrumb: 'ノード詳細' },
    },
    {
      // 通知一覧ページ
      path: '/notifications',
      name: 'notifications',
      component: () => import('@/views/NotificationsView.vue'),
      meta: { breadcrumb: '通知一覧' },
    },
    {
      // What-if シミュレーション
      path: '/simulation',
      name: 'simulation',
      component: () => import('@/views/SimulationView.vue'),
      meta: { breadcrumb: 'シミュレーション' },
    },
    // ── Design Variants (review alternatives) ──
    {
      path: '/design/a',
      name: 'design-a',
      component: () => import('@/views/design/DesignA.vue'),
      meta: { useOwnLayout: true },
    },
    {
      path: '/design/d',
      name: 'design-d',
      component: () => import('@/views/design/DesignD.vue'),
      meta: { useOwnLayout: true },
    },
    {
      path: '/design/e',
      name: 'design-e',
      component: () => import('@/views/design/DesignE.vue'),
      meta: { useOwnLayout: true },
    },
  ],
});

export default router;
