<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { apiRequest, ApiError } from '../api/client';
import LanguageSwitcher from '../components/LanguageSwitcher.vue';
import PhoneAuthForm from '../components/PhoneAuthForm.vue';
import '../styles/admin-theme.css';
import '../styles/customer-theme.css';

const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);
const method = ref<'email' | 'phone'>('phone');

const auth = useAuthStore();
const router = useRouter();
const { t } = useI18n();

async function completeAuth(accessToken: string) {
  auth.setToken(accessToken);
  const me = await apiRequest<{
    role: string;
    email: string;
    panelRole: { permissions: string[] } | null;
  }>('/users/me');
  auth.setRole(me.role);
  auth.setEmail(me.email);
  auth.setPermissions(me.panelRole?.permissions ?? null);
  router.push({ name: 'dashboard' });
}

async function onSubmit() {
  error.value = '';
  loading.value = true;
  try {
    const { accessToken } = await apiRequest<{ accessToken: string }>(
      '/auth/signup',
      { method: 'POST', body: { email: email.value, password: password.value } },
    );
    await completeAuth(accessToken);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('auth.signup.error');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="customer-theme auth-theme">
    <LanguageSwitcher class="lang-corner" />
    <div class="auth-page">
      <div class="auth-form admin-card">
        <div class="auth-logo">P</div>
        <h1>{{ t('auth.signup.title') }}</h1>
        <p class="auth-sub">{{ t('auth.signup.subtitle') }}</p>

        <template v-if="method === 'phone'">
          <PhoneAuthForm :eyebrow="t('auth.signup.phoneEyebrow')" @success="completeAuth" />
          <button type="button" class="method-link" @click="method = 'email'">
            {{ t('auth.useEmailInstead') }}
          </button>
        </template>
        <template v-else>
          <form @submit.prevent="onSubmit">
            <label>
              {{ t('auth.signup.email') }}
              <input v-model="email" type="text" autocomplete="username" class="admin-input" required />
            </label>
            <label>
              {{ t('auth.signup.password') }}
              <input v-model="password" type="password" class="admin-input" minlength="8" required />
            </label>
            <p v-if="error" class="admin-error">{{ error }}</p>
            <button type="submit" class="admin-btn admin-btn-primary" :disabled="loading">{{ t('auth.signup.submit') }}</button>
          </form>
          <button type="button" class="method-link" @click="method = 'phone'">
            {{ t('auth.usePhoneInstead') }}
          </button>
        </template>

        <router-link :to="{ name: 'login' }" class="auth-link">{{ t('auth.signup.haveAccount') }}</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-theme {
  padding: 0;
  position: relative;
}
.lang-corner {
  position: absolute;
  top: 16px;
  inset-inline-end: 16px;
  z-index: 1;
}
.auth-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 340px;
  padding: 32px 28px;
}
.auth-form form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.auth-form .method-link {
  width: auto;
  align-self: center;
  margin-top: 0;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 0.8rem;
  text-decoration: underline;
  cursor: pointer;
}
.auth-form .method-link:hover {
  color: var(--text);
}
.auth-logo {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--brand-gradient, var(--text));
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  margin-bottom: 4px;
  box-shadow: var(--shadow-btn, none);
}
.auth-form h1 {
  margin: 0;
  font-size: 1.5rem;
}
.auth-sub {
  margin: -6px 0 6px;
  color: var(--text-dim);
  font-size: 0.88rem;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--text-dim);
}
.admin-input {
  width: 100%;
}
.auth-form button {
  margin-top: 6px;
  width: 100%;
}
.auth-link {
  text-align: center;
  color: var(--text-dim);
  font-size: 0.85rem;
  text-decoration: none;
}
.auth-link:hover {
  color: var(--text);
}
</style>
