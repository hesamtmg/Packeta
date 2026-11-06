<script setup lang="ts">
import BrandMark from '../BrandMark.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import { apiRequest, API_URL } from '../../api/client';
import LanguageSwitcher from '../LanguageSwitcher.vue';
import ThemeToggle from '../ThemeToggle.vue';
import '../../styles/admin-theme.css';

defineProps<{ title: string }>();

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { t } = useI18n();

// section: undefined means always visible (the dashboard landing page);
// an array means any-of (the "Admins" page is reachable with either the
// "admins" section, for viewing panel users, or "roles", for managing
// Roles without necessarily being able to view individual admin detail);
// everything else is a single section, filtered by auth.hasSection() so a
// regular admin's nav only shows the panel sections their assigned Role
// grants — see backend/src/admin/admin-sections.ts.
interface NavItem {
  name: string;
  section: string | string[] | undefined;
  label: string;
  icon: string;
  group: 'overview' | 'operations' | 'people' | 'system';
  // Only SUPER_ADMIN accounts see it, regardless of sections.
  superAdminOnly?: boolean;
}

const allNavItems = computed<NavItem[]>(() => [
  {
    name: 'admin-dashboard',
    group: 'overview',
    section: undefined,
    label: t('adminNav.dashboard'),
    icon: 'M3 3h7v9H3V3zm11 0h7v5h-7V3zM3 15h7v6H3v-6zm11 3h7v3h-7v-3z',
  },
  {
    name: 'admin-transactions',
    group: 'operations',
    section: 'transactions',
    label: t('adminNav.transactions'),
    icon: 'M4 6h16M4 12h16M4 18h10',
  },
  {
    name: 'admin-wallets',
    group: 'operations',
    section: 'wallets',
    label: t('adminNav.wallets'),
    icon: 'M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM3 10h18M15 15h4',
  },
  {
    name: 'admin-customers',
    group: 'people',
    section: 'customers',
    label: t('adminNav.customers'),
    icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 20c0-3.3 3.6-6 8-6s8 2.7 8 6',
  },
  {
    name: 'admin-admins',
    group: 'people',
    section: ['admins', 'roles'],
    label: t('adminNav.admins'),
    icon: 'M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z',
  },
  {
    name: 'admin-wallet-types',
    group: 'system',
    section: 'walletTypes',
    label: t('adminNav.walletTypes'),
    icon: 'M7 7h.01M3 7l0 4.5c0 .5.2 1 .6 1.4l8 8a2 2 0 002.8 0l4.6-4.6a2 2 0 000-2.8l-8-8A2 2 0 009 5H4a1 1 0 00-1 1v1z',
  },
  {
    name: 'admin-purchase',
    group: 'operations',
    section: 'purchase',
    label: t('adminNav.purchase'),
    icon: 'M3 6h18M3 6l1.5 12a2 2 0 002 2h11a2 2 0 002-2L21 6M8 10v4m4-4v4m4-4v4',
  },
  {
    name: 'admin-installments',
    group: 'operations',
    section: 'installments',
    label: t('adminNav.installments'),
    icon: 'M9 7h6M9 11h6M9 15h4M5 3h14a2 2 0 012 2v14l-4-2-3 2-3-2-3 2-3-2V5a2 2 0 012-2z',
  },
  {
    name: 'admin-scheduler-logs',
    group: 'system',
    section: 'schedulerLogs',
    label: t('adminNav.schedulerLogs'),
    icon: 'M12 8v4l3 3M12 3a9 9 0 100 18 9 9 0 000-18z',
  },
  {
    name: 'admin-reports',
    group: 'overview',
    section: 'reports',
    label: t('adminNav.reports'),
    icon: 'M4 19V9m6 10V4m6 15v-6',
  },
  {
    name: 'admin-offboarding',
    group: 'people',
    section: 'offboarding',
    label: t('adminNav.offboarding'),
    icon: 'M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3',
  },
  {
    name: 'admin-general-ledger',
    group: 'system',
    section: 'generalLedger',
    label: t('adminNav.generalLedger'),
    icon: 'M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5zM8 8h8M8 12h8M8 16h5',
  },
  {
    name: 'admin-live-activity',
    group: 'overview',
    section: 'liveActivity',
    label: t('adminNav.liveActivity'),
    icon: 'M3 12h4l3 8 4-16 3 8h4',
  },
  {
    name: 'admin-payment-gateway',
    group: 'system',
    section: undefined,
    superAdminOnly: true,
    label: t('adminNav.paymentGateway'),
    icon: 'M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM3 10h18M7 15h3',
  },
]);

const navItems = computed(() =>
  allNavItems.value.filter((item) => {
    if (item.superAdminOnly) return auth.isSuperAdmin;
    if (!item.section) return true;
    const required = Array.isArray(item.section) ? item.section : [item.section];
    return required.some((section) => auth.hasSection(section));
  }),
);

const GROUP_ORDER: NavItem['group'][] = ['overview', 'operations', 'people', 'system'];
const navGroups = computed(() =>
  GROUP_ORDER.map((group) => ({
    group,
    label: t(`adminNav.group.${group}`),
    items: navItems.value.filter((item) => item.group === group),
  })).filter((g) => g.items.length),
);

// Detail pages highlight their parent list in the nav.
const activeNavName = computed(() => {
  const name = String(route.name ?? '');
  if (name === 'admin-wallet-detail') return 'admin-wallets';
  if (name === 'admin-transaction-detail') return 'admin-transactions';
  return name;
});

// Off-canvas nav on tablet/phone widths; closes on every navigation.
const navOpen = ref(false);
watch(() => route.fullPath, () => {
  navOpen.value = false;
});

const initials = computed(() => (auth.email ?? '?').slice(0, 1).toUpperCase());
const avatarSrc = computed(() => (auth.avatarUrl ? `${API_URL}${auth.avatarUrl}` : null));

function logout() {
  auth.logout();
  router.push({ name: 'login' });
}

// Keeps the nav (and every route guard downstream) in sync with the
// account's current permissions without requiring a fresh login — a
// super-admin editing this admin's sections takes effect on their next
// panel navigation instead of being stuck until they log out.
onMounted(async () => {
  try {
    const me = await apiRequest<{
      role: string;
      avatarUrl: string | null;
      panelRole: { permissions: string[] } | null;
    }>('/users/me');
    auth.setRole(me.role);
    auth.setPermissions(me.panelRole?.permissions ?? null);
    auth.setAvatarUrl(me.avatarUrl ?? null);
  } catch {
    // Non-critical — the nav just keeps whatever it had cached.
  }
});
</script>

<template>
  <div class="admin-theme">
    <div class="admin-shell" :class="{ 'nav-open': navOpen }">
      <aside class="admin-sidebar">
        <router-link :to="{ name: 'admin-dashboard' }" class="admin-brand">
          <span class="logo"><BrandMark /></span>
          <span class="admin-brand-name">Packeta</span>
          <span class="admin-brand-tag">{{ t('adminNav.panelTag') }}</span>
        </router-link>

        <template v-for="g in navGroups" :key="g.group">
          <div class="admin-nav-section">{{ g.label }}</div>
          <router-link
            v-for="item in g.items"
            :key="item.name"
            :to="{ name: item.name }"
            class="admin-nav-icon"
            :class="{ active: activeNavName === item.name }"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path :d="item.icon" />
            </svg>
            <span class="admin-nav-label">{{ item.label }}</span>
          </router-link>
        </template>

        <div class="admin-nav-spacer" />
        <div class="admin-nav-footer">
          <router-link
            :to="{ name: 'profile' }"
            class="admin-nav-icon"
            :class="{ active: route.name === 'profile' }"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span class="admin-nav-label">{{ t('nav.profile') }}</span>
          </router-link>
          <router-link :to="{ name: 'dashboard' }" class="admin-nav-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM3 10h18M15 15h4" />
            </svg>
            <span class="admin-nav-label">{{ t('nav.backToWallet') }}</span>
          </router-link>
          <button type="button" class="admin-nav-icon" @click="logout">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            <span class="admin-nav-label">{{ t('nav.logout') }}</span>
          </button>
        </div>
      </aside>
      <div class="admin-scrim" @click="navOpen = false" />

      <div class="admin-main">
        <header class="admin-topbar">
          <div class="admin-topbar-title">
            <button type="button" class="admin-icon-btn admin-menu-btn" :aria-label="t('common.openMenu')" @click="navOpen = true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div style="min-width: 0">
              <span class="admin-topbar-eyebrow">{{ t('nav.adminPanel') }}</span>
              <h1>{{ title }}</h1>
            </div>
          </div>
          <div class="admin-topbar-actions">
            <span class="admin-topbar-user">{{ auth.email }}</span>
            <ThemeToggle />
            <LanguageSwitcher />
            <router-link :to="{ name: 'profile' }" class="admin-avatar">
              <img v-if="avatarSrc" :src="avatarSrc" :alt="t('nav.profile')" />
              <template v-else>{{ initials }}</template>
            </router-link>
          </div>
        </header>

        <slot />
      </div>
    </div>
  </div>
</template>
