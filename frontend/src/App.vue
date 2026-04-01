<script setup lang="ts">
import { RouterView, RouterLink, useRoute } from 'vue-router';
import { computed, ref } from 'vue';

const route = useRoute();
const sidebarCollapsed = ref(false);

const useOwnLayout = computed(() => route.meta?.useOwnLayout === true);
const breadcrumb = computed(() => (route.meta?.breadcrumb as string) || '');

const navItems = [
  {
    to: '/simulation',
    name: 'シミュレーション',
    routeName: 'simulation',
    icon: 'simulation',
  },
  {
    to: '/',
    name: 'サプライチェーンマップ',
    routeName: 'map',
    icon: 'map',
  },
  {
    to: '/notifications',
    name: '通知一覧',
    routeName: 'notifications',
    icon: 'bell',
  },
];

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
            <path d="M12 2L2 7l10 5 10-5-10-5z" fill="#f97316" opacity="0.9"/>
            <path d="M2 17l10 5 10-5" stroke="#f97316" stroke-width="2" fill="none"/>
            <path d="M2 12l10 5 10-5" stroke="#f97316" stroke-width="2" fill="none" opacity="0.6"/>
          </svg>
        </div>
        <span v-if="!sidebarCollapsed" class="brand-text">SCM Suite</span>
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
          <span class="breadcrumb-text" v-if="breadcrumb">{{ breadcrumb }}</span>
        </div>
        <div class="topbar-right">
          <div class="user-avatar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="8" r="4"/>
              <path d="M20 21a8 8 0 0 0-16 0"/>
            </svg>
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
   App Shell Layout
   ======================================== */
.app-shell {
  display: flex;
  min-height: 100vh;
  background: var(--color-background);
}

/* ========================================
   Sidebar
   ======================================== */
.sidebar {
  width: 220px;
  background: var(--color-sidebar-bg);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: width var(--transition-base);
  z-index: 20;
}
.sidebar.collapsed {
  width: 64px;
}

/* Brand */
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 20px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.brand-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
}
.brand-text {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-sidebar-text-active);
  letter-spacing: 0.02em;
  white-space: nowrap;
}

/* Navigation */
.sidebar-nav {
  flex: 1;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  color: var(--color-sidebar-text);
  text-decoration: none;
  font-size: var(--text-sm);
  font-weight: 450;
  transition: all var(--transition-fast);
  position: relative;
  white-space: nowrap;
  overflow: hidden;
}
.nav-item:hover {
  background: var(--color-sidebar-hover);
  color: var(--color-sidebar-text-active);
}
.nav-item.active {
  background: rgba(249, 115, 22, 0.1);
  color: var(--color-sidebar-text-active);
}
.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  background: var(--color-sidebar-accent);
  border-radius: 0 2px 2px 0;
}

.nav-icon {
  flex-shrink: 0;
  opacity: 0.7;
}
.nav-item:hover .nav-icon,
.nav-item.active .nav-icon {
  opacity: 1;
}
.nav-item.active .nav-icon {
  color: var(--color-sidebar-accent);
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
  margin: 8px;
  padding: 8px;
  border-radius: var(--radius-md);
  color: var(--color-sidebar-text);
  transition: all var(--transition-fast);
}
.sidebar-toggle:hover {
  background: var(--color-sidebar-hover);
  color: var(--color-sidebar-text-active);
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
}

/* Top bar */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 24px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.topbar-left {
  display: flex;
  align-items: center;
}
.breadcrumb-text {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.user-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--color-gray-100);
  color: var(--color-gray-500);
}

/* Page content */
.page-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

/* ========================================
   Responsive
   ======================================== */
@media (max-width: 1024px) {
  .sidebar {
    width: 64px;
  }
  .brand-text,
  .nav-label {
    display: none;
  }
  .sidebar-toggle {
    display: none;
  }
  .sidebar-brand {
    justify-content: center;
    padding: 16px 8px 20px;
  }
  .nav-item {
    justify-content: center;
    padding: 10px;
  }
}
</style>
