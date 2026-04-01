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
      path: '/factories',
      name: 'factories',
      component: () => import('@/views/FactoriesView.vue'),
      meta: { breadcrumb: '工場一覧' },
    },
    {
      path: '/earthquakes',
      name: 'earthquakes',
      component: () => import('@/views/EarthquakesView.vue'),
      meta: { breadcrumb: '地震情報' },
    },
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
