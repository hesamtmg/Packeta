<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import LanguageSwitcher from '../LanguageSwitcher.vue';
import '../../styles/admin-theme.css';

defineProps<{ title: string }>();

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { t } = useI18n();

const navItems = computed(() => [
  {
    name: 'admin-dashboard',
    label: t('adminNav.dashboard'),
    icon: 'M3 3h7v9H3V3zm11 0h7v5h-7V3zM3 15h7v6H3v-6zm11 3h7v3h-7v-3z',
  },
  {
    name: 'admin-transactions',
    label: t('adminNav.transactions'),
    icon: 'M4 6h16M4 12h16M4 18h10',
  },
  {
    name: 'admin-wallets',
    label: t('adminNav.wallets'),
    icon: 'M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM3 10h18M15 15h4',
  },
  {
    name: 'admin-customers',
    label: t('adminNav.customers'),
    icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 20c0-3.3 3.6-6 8-6s8 2.7 8 6',
  },
  {
    name: 'admin-admins',
    label: t('adminNav.admins'),
    icon: 'M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z',
  },
  {
    name: 'admin-wallet-types',
    label: t('adminNav.walletTypes'),
    icon: 'M7 7h.01M3 7l0 4.5c0 .5.2 1 .6 1.4l8 8a2 2 0 002.8 0l4.6-4.6a2 2 0 000-2.8l-8-8A2 2 0 009 5H4a1 1 0 00-1 1v1z',
  },
  {
    name: 'admin-purchase',
    label: t('adminNav.purchase'),
    icon: 'M3 6h18M3 6l1.5 12a2 2 0 002 2h11a2 2 0 002-2L21 6M8 10v4m4-4v4m4-4v4',
  },
  {
    name: 'admin-installments',
    label: t('adminNav.installments'),
    icon: 'M9 7h6M9 11h6M9 15h4M5 3h14a2 2 0 012 2v14l-4-2-3 2-3-2-3 2-3-2V5a2 2 0 012-2z',
  },
  {
    name: 'admin-scheduler-logs',
    label: t('adminNav.schedulerLogs'),
    icon: 'M12 8v4l3 3M12 3a9 9 0 100 18 9 9 0 000-18z',
  },
  {
    name: 'admin-reports',
    label: t('adminNav.reports'),
    icon: 'M4 19V9m6 10V4m6 15v-6',
  },
]);

const initials = computed(() => (auth.email ?? '?').slice(0, 1).toUpperCase());

function logout() {
  auth.logout();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="admin-theme">
    <div class="admin-shell">
      <aside class="admin-sidebar">
        <div class="logo">P</div>
        <router-link
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="admin-nav-icon"
          :class="{ active: route.name === item.name }"
          :title="item.label"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path :d="item.icon" />
          </svg>
        </router-link>
        <div class="admin-nav-spacer" />
        <router-link
          :to="{ name: 'profile' }"
          class="admin-nav-icon"
          :class="{ active: route.name === 'profile' }"
          :title="t('nav.profile')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </router-link>
        <router-link :to="{ name: 'dashboard' }" class="admin-nav-icon" :title="t('nav.backToWallet')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 19l-7-7 7-7M3 12h18" />
          </svg>
        </router-link>
        <button class="admin-nav-icon" style="border: none; cursor: pointer" :title="t('nav.logout')" @click="logout">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
        </button>
      </aside>

      <div class="admin-main">
        <header class="admin-topbar">
          <h1>{{ title }}</h1>
          <div class="admin-topbar-actions">
            <router-link :to="{ name: 'dashboard' }" class="admin-btn admin-btn-ghost">
              {{ t('nav.backToWallet') }}
            </router-link>
            <LanguageSwitcher />
            <router-link :to="{ name: 'profile' }" class="admin-avatar">{{ initials }}</router-link>
          </div>
        </header>

        <slot />
      </div>
    </div>
  </div>
</template>
