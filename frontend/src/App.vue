<script setup lang="ts">
import { RouterView, RouterLink, useRoute } from 'vue-router';
import { computed, ref } from 'vue';

const route = useRoute();
const sidebarCollapsed = ref(false);

const useOwnLayout = computed(() => route.meta?.useOwnLayout === true);
const breadcrumb = computed(() => (route.meta?.breadcrumb as string) || '');

type ShellPageMeta = {
  title: string;
  subtitle: string;
};

const navItems = [
  {
    to: '/',
    name: 'サプライチェーンマップ',
    routeName: 'map',
    icon: 'map',
  },
  {
    to: '/risk-events',
    name: 'リスクイベント',
    routeName: 'risk-events',
    icon: 'bell',
  },
  {
    to: '/risk-dashboard',
    name: 'リスクダッシュボード',
    routeName: 'risk-dashboard',
    icon: 'simulation',
  },
  {
    to: '/corridor-analysis',
    name: 'ルート分析',
    routeName: 'corridor-analysis',
    icon: 'map',
  },
  {
    to: '/simulation',
    name: 'シミュレーション',
    routeName: 'simulation',
    icon: 'simulation',
  },
  {
    to: '/notifications',
    name: '通知一覧',
    routeName: 'notifications',
    icon: 'bell',
  },
];

const shellPageMeta: Record<string, ShellPageMeta> = {
  map: {
    title: 'サプライチェーンマップ',
    subtitle: 'Supply Chain Intelligence Map',
  },
  simulation: {
    title: 'What-if コストシミュレーション',
    subtitle: 'Supply Chain Cost Simulator',
  },
  notifications: {
    title: 'リスク通知一覧',
    subtitle: 'Risk Event Monitor',
  },
  factories: {
    title: '工場一覧',
    subtitle: 'Factory Directory',
  },
  earthquakes: {
    title: '地震情報',
    subtitle: 'Seismic Event Feed',
  },
  'node-detail': {
    title: 'ノード詳細',
    subtitle: 'Supply Chain Node Intelligence',
  },
  'risk-events': {
    title: 'リスクイベント管理',
    subtitle: 'Risk Event Management',
  },
  'risk-dashboard': {
    title: 'リスクダッシュボード',
    subtitle: 'Plant Risk Score Rankings',
  },
  'corridor-analysis': {
    title: 'サプライルートリスク分析',
    subtitle: 'Corridor Risk Analysis',
  },
};

const currentPageMeta = computed<ShellPageMeta>(() => {
  const routeName = String(route.name ?? '');
  return shellPageMeta[routeName] || {
    title: breadcrumb.value || 'サプライチェーン分析',
    subtitle: 'Supply Chain Intelligence Workspace',
  };
});

function isActive(routeName: string): boolean {
  return route.name === routeName;
}
</script>

<template>
  <!-- MapView: full-screen, no shell -->
  <RouterView v-if="useOwnLayout" />

  <!-- All other pages: sidebar + top bar shell -->
  <div v-else class="app-shell">
    <!-- Sidebar -->
    <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="sidebar-brand">
        <div class="brand-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5z" fill="#b8860b" opacity="0.92"/>
            <path d="M2 17l10 5 10-5" stroke="#d4a843" stroke-width="2" fill="none"/>
            <path d="M2 12l10 5 10-5" stroke="#d4a843" stroke-width="2" fill="none" opacity="0.65"/>
          </svg>
        </div>
        <div v-if="!sidebarCollapsed" class="brand-copy">
          <span class="brand-eyebrow">NAVIGATION</span>
          <span class="brand-text">業務メニュー</span>
        </div>
      </div>

      <nav class="sidebar-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.routeName"
          :to="item.to"
          class="nav-item"
          :class="{ active: isActive(item.routeName) }"
        >
          <!-- Simulation icon -->
          <svg v-if="item.icon === 'simulation'" class="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke-linejoin="round" stroke-linecap="round"/>
          </svg>
          <!-- Map icon -->
          <svg v-else-if="item.icon === 'map'" class="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" stroke-linejoin="round"/>
            <path d="M8 2v16M16 6v16"/>
          </svg>
          <!-- Bell icon -->
          <svg v-else-if="item.icon === 'bell'" class="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke-linejoin="round" stroke-linecap="round"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span v-if="!sidebarCollapsed" class="nav-label">{{ item.name }}</span>
        </RouterLink>
      </nav>

      <!-- Sidebar footer toggle -->
      <button class="sidebar-toggle" @click="sidebarCollapsed = !sidebarCollapsed">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path v-if="sidebarCollapsed" d="M9 18l6-6-6-6"/>
          <path v-else d="M15 18l-6-6 6-6"/>
        </svg>
      </button>
    </aside>

    <!-- Main area -->
    <div class="main-area">
      <!-- Top bar -->
      <header class="topbar">
        <div class="topbar-left">
          <div class="topbar-copy">
            <span class="breadcrumb-text" v-if="breadcrumb">{{ breadcrumb }}</span>
            <div class="topbar-heading">
              <h1 class="topbar-title">{{ currentPageMeta.title }}</h1>
              <span class="topbar-subtitle">{{ currentPageMeta.subtitle }}</span>
            </div>
          </div>
        </div>
      </header>

      <!-- Page content -->
      <main class="page-content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style>
/* Global reset — base.css handles most, these are app-level */
#app {
  width: 100%;
  min-height: 100vh;
}
</style>

<style scoped>
/* ========================================
   Design D Shell
   ======================================== */
.app-shell {
  display: flex;
  min-height: 100vh;
  background: #ffffff;
}

/* ========================================
   Sidebar
   ======================================== */
.sidebar {
  width: 300px;
  background: #fafbfc;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: width 0.2s ease;
  z-index: 20;
  border-right: 1px solid #d0d5dd;
}
.sidebar.collapsed {
  width: 72px;
}

/* Brand */
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 48px;
  padding: 0 20px;
  background: #1b2838;
  flex-shrink: 0;
  position: relative;
  border-bottom: 1px solid rgba(212, 168, 67, 0.22);
}
.sidebar-brand::after,
.topbar::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  height: 2px;
  background: linear-gradient(90deg, #b8860b 0%, #d4a843 50%, #b8860b 100%);
}
.brand-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  color: #d4a843;
}
.brand-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.brand-eyebrow {
  font-size: 10px;
  line-height: 1.2;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.48);
}
.brand-text {
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

/* Navigation */
.sidebar-nav {
  flex: 1;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid #d0d5dd;
  color: #4a4a4a;
  text-decoration: none;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  transition: background 0.15s ease, color 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
}
.nav-item:hover {
  background: #f0f2f5;
  color: #1b2838;
}
.nav-item.active {
  background: #eef1f5;
  color: #1b2838;
}

.nav-icon {
  flex-shrink: 0;
  opacity: 0.85;
}
.nav-item:hover .nav-icon,
.nav-item.active .nav-icon {
  opacity: 1;
}
.nav-item.active .nav-icon {
  color: #1b2838;
}

.nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Sidebar toggle */
.sidebar-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 12px;
  color: #4a4a4a;
  transition: background 0.15s ease, color 0.15s ease;
  border-top: 1px solid #d0d5dd;
}
.sidebar-toggle:hover {
  background: #f0f2f5;
  color: #1b2838;
}

/* ========================================
   Main Area
   ======================================== */
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: #ffffff;
}

/* Top bar */
.topbar {
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 24px;
  background: #1b2838;
  border-bottom: 1px solid rgba(212, 168, 67, 0.22);
  flex-shrink: 0;
  position: relative;
}
.topbar-left {
  display: flex;
  align-items: center;
}
.topbar-copy {
  display: flex;
  align-items: baseline;
  gap: 18px;
  min-width: 0;
}
.breadcrumb-text {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.48);
  text-transform: uppercase;
  white-space: nowrap;
}
.topbar-heading {
  display: flex;
  align-items: baseline;
  gap: 14px;
  min-width: 0;
}
.topbar-title {
  font-size: 16px;
  line-height: 1.2;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.topbar-subtitle {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.02em;
  white-space: nowrap;
}

/* Page content */
.page-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  background: #ffffff;
}

/* ========================================
   Responsive
   ======================================== */
@media (max-width: 1024px) {
  .sidebar {
    width: 72px;
  }
  .brand-text,
  .brand-eyebrow,
  .nav-label {
    display: none;
  }
  .sidebar-toggle {
    display: none;
  }
  .sidebar-brand {
    justify-content: center;
    height: 48px;
    padding: 0 10px;
  }
  .nav-item {
    justify-content: center;
    padding: 12px 10px;
  }
  .topbar {
    padding: 0 16px;
  }
  .topbar-subtitle,
  .breadcrumb-text {
    display: none;
  }
  .topbar-title {
    font-size: 14px;
  }
}
</style>
