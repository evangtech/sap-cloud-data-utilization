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
    },
    {
      path: '/factories',
      name: 'factories',
      component: () => import('@/views/FactoriesView.vue'),
    },
    {
      path: '/earthquakes',
      name: 'earthquakes',
      component: () => import('@/views/EarthquakesView.vue'),
    },
    {
      path: '/node/:type/:id',
      name: 'node-detail',
      component: () => import('@/views/NodeDetailView.vue'),
    },
    {
      // 通知一覧ページ
      path: '/notifications',
      name: 'notifications',
      component: () => import('@/views/NotificationsView.vue'),
    },
  ],
});

export default router;
