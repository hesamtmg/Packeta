<script setup lang="ts">
import BrandMark from './BrandMark.vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { API_URL } from '../api/client';
import LanguageSwitcher from './LanguageSwitcher.vue';
import ThemeToggle from './ThemeToggle.vue';
import './../styles/admin-theme.css';
import './../styles/customer-theme.css';

defineProps<{ title: string }>();

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { t } = useI18n();

const initials = computed(() => (auth.email ?? '?').slice(0, 1).toUpperCase());
const avatarSrc = computed(() => (auth.avatarUrl ? `${API_URL}${auth.avatarUrl}` : null));

// Detail pages highlight the wallet entry in the nav.
const onWalletPages = computed(() =>
  ['dashboard', 'wallet-detail', 'wallet-installments', 'transaction-detail'].includes(String(route.name)),
);

// Off-canvas nav on tablet/phone widths; closes on every navigation.
const navOpen = ref(false);
watch(() => route.fullPath, () => {
  navOpen.value = false;
});

function logout() {
  auth.logout();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="customer-theme app-themable">
    <div class="admin-shell" :class="{ 'nav-open': navOpen }">
      <aside class="admin-sidebar">
        <router-link :to="{ name: 'dashboard' }" class="admin-brand">
          <span class="logo"><BrandMark /></span>
          <span class="admin-brand-name">Packeta</span>
        </router-link>

        <div class="admin-nav-section">{{ t('nav.menu') }}</div>
        <router-link
          :to="{ name: 'dashboard' }"
          class="admin-nav-icon"
          :class="{ active: onWalletPages }"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM3 10h18M15 15h4" />
          </svg>
          <span class="admin-nav-label">{{ t('nav.wallet') }}</span>
        </router-link>
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

        <div class="admin-nav-spacer" />

        <div class="admin-nav-footer">
          <router-link v-if="auth.isAdmin" :to="{ name: 'admin-dashboard' }" class="admin-nav-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z" />
            </svg>
            <span class="admin-nav-label">{{ t('nav.adminPanel') }}</span>
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
            <h1>{{ title }}</h1>
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
