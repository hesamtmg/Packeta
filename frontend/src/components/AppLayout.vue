<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import LanguageSwitcher from './LanguageSwitcher.vue';
import './../styles/admin-theme.css';

defineProps<{ title: string }>();

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { t } = useI18n();

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
          :to="{ name: 'dashboard' }"
          class="admin-nav-icon"
          :class="{ active: route.name === 'dashboard' }"
          :title="t('nav.wallet')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 3h7v9H3V3zm11 0h7v5h-7V3zM3 15h7v6H3v-6zm11 3h7v3h-7v-3z" />
          </svg>
        </router-link>
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

        <div class="admin-nav-spacer" />

        <router-link
          v-if="auth.isAdmin"
          :to="{ name: 'admin-dashboard' }"
          class="admin-nav-icon"
          :title="t('nav.adminPanel')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z" />
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
            <router-link
              v-if="auth.isAdmin"
              :to="{ name: 'admin-dashboard' }"
              class="admin-btn admin-btn-ghost"
            >
              {{ t('nav.adminPanel') }}
            </router-link>
            <LanguageSwitcher />
            {{ auth.email }}
            <router-link :to="{ name: 'profile' }" class="admin-avatar">{{ initials }}</router-link>
          </div>
        </header>

        <slot />
      </div>
    </div>
  </div>
</template>
