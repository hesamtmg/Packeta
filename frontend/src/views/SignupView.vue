<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import AuthShell from '../components/AuthShell.vue';
import AuthMethodTabs, { type AuthMethod } from '../components/AuthMethodTabs.vue';
import PhoneAuthForm from '../components/PhoneAuthForm.vue';
import PasswordAuthForm from '../components/PasswordAuthForm.vue';
import { useCompleteAuth } from '../composables/useCompleteAuth';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const completeAuth = useCompleteAuth();

const method = ref<AuthMethod>(route.query.method === 'email' ? 'email' : 'phone');
watch(method, (m) => {
  router.replace({ query: { ...route.query, method: m === 'email' ? 'email' : undefined } });
});

const loginLink = computed(() => ({ name: 'login', query: route.query }));
</script>

<template>
  <AuthShell :title="t('auth.signup.title')" :subtitle="t('auth.signup.subtitle')">
    <AuthMethodTabs v-model="method" />
    <PhoneAuthForm v-if="method === 'phone'" mode="signup" @success="completeAuth" />
    <PasswordAuthForm v-else mode="signup" @success="completeAuth" />

    <p class="signup-perk">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 12l5 5 9-10" />
      </svg>
      {{ t('auth.signup.perk') }}
    </p>

    <template #footer>
      {{ t('auth.signup.haveAccount') }}
      <router-link :to="loginLink" class="auth-switch">{{ t('auth.signup.loginLink') }}</router-link>
    </template>
  </AuthShell>
</template>

<style scoped>
.signup-perk {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: -4px 0 0;
  font-size: 0.8rem;
  color: var(--text-dim);
  text-align: center;
}
.signup-perk svg {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--accent-lime);
}
.auth-switch {
  color: var(--accent-blue);
  font-weight: 600;
  text-decoration: none;
}
.auth-switch:hover {
  text-decoration: underline;
}
</style>
