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
// Reflect the chosen tab in the URL so a reload (or the link to signup)
// keeps the same method.
watch(method, (m) => {
  router.replace({ query: { ...route.query, method: m === 'email' ? 'email' : undefined } });
});

// Set by the router when a stored session lapsed (see handleSessionExpired).
const sessionExpired = computed(() => route.query.expired === '1');

const signupLink = computed(() => {
  const { expired: _expired, ...query } = route.query;
  return { name: 'signup', query };
});
</script>

<template>
  <AuthShell :title="t('auth.login.title')" :subtitle="t('auth.login.subtitle')">
    <p v-if="sessionExpired" class="session-expired" role="status">{{ t('auth.login.sessionExpired') }}</p>
    <AuthMethodTabs v-model="method" />
    <PhoneAuthForm v-if="method === 'phone'" mode="login" @success="completeAuth" />
    <PasswordAuthForm v-else mode="login" @success="completeAuth" />

    <template #footer>
      {{ t('auth.login.noAccount') }}
      <router-link :to="signupLink" class="auth-switch">{{ t('auth.login.signupLink') }}</router-link>
    </template>
  </AuthShell>
</template>

<style scoped>
.session-expired {
  margin: 0 0 16px;
  padding: 10px 14px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent-blue) 12%, transparent);
  color: var(--text);
  font-size: 0.9rem;
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
