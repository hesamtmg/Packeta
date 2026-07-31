<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { apiRequest, ApiError } from '../api/client';
import LanguageSwitcher from '../components/LanguageSwitcher.vue';
import PhoneAuthForm from '../components/PhoneAuthForm.vue';
import '../styles/admin-theme.css';

const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);
const method = ref<'email' | 'phone'>('email');

const auth = useAuthStore();
const router = useRouter();
const { t } = useI18n();

async function completeAuth(accessToken: string) {
  auth.setToken(accessToken);
  const me = await apiRequest<{ role: string; email: string }>('/users/me');
  auth.setRole(me.role);
  auth.setEmail(me.email);
  router.push({ name: 'dashboard' });
}

async function onSubmit() {
  error.value = '';
  loading.value = true;
  try {
    const { accessToken } = await apiRequest<{ accessToken: string }>(
      '/auth/login',
      { method: 'POST', body: { email: email.value, password: password.value } },
    );
    await completeAuth(accessToken);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('auth.login.error');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="admin-theme auth-theme">
    <LanguageSwitcher class="lang-corner" />
    <div class="auth-page">
      <div class="auth-form admin-card">
        <div class="auth-logo">P</div>
        <h1>{{ t('auth.login.title') }}</h1>
        <p class="auth-sub">{{ t('auth.login.subtitle') }}</p>

        <div class="method-toggle">
          <button
            type="button"
            class="method-btn"
            :class="{ active: method === 'email' }"
            @click="method = 'email'"
          >
            {{ t('auth.methodEmail') }}
          </button>
          <button
            type="button"
            class="method-btn"
            :class="{ active: method === 'phone' }"
            @click="method = 'phone'"
          >
            {{ t('auth.methodPhone') }}
          </button>
        </div>

        <form v-if="method === 'email'" @submit.prevent="onSubmit">
          <label>
            {{ t('auth.login.email') }}
            <input v-model="email" type="email" class="admin-input" required />
          </label>
          <label>
            {{ t('auth.login.password') }}
            <input v-model="password" type="password" class="admin-input" required />
          </label>
          <p v-if="error" class="admin-error">{{ error }}</p>
          <button type="submit" class="admin-btn admin-btn-primary" :disabled="loading">{{ t('auth.login.submit') }}</button>
        </form>
        <PhoneAuthForm v-else @success="completeAuth" />

        <router-link :to="{ name: 'signup' }" class="auth-link">{{ t('auth.login.noAccount') }}</router-link>
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
.method-toggle {
  display: flex;
  gap: 6px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 999px;
  padding: 4px;
}
.method-btn {
  flex: 1;
  width: auto;
  margin-top: 0;
  border: none;
  background: transparent;
  color: var(--text-dim);
  border-radius: 999px;
  padding: 7px 0;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}
.method-btn.active {
  background: var(--text);
  color: var(--shell-bg);
}
.auth-logo {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  background: var(--text);
  color: var(--shell-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  margin-bottom: 4px;
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
button {
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
