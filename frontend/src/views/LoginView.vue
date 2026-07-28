<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { apiRequest, ApiError } from '../api/client';

const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

const auth = useAuthStore();
const router = useRouter();

async function onSubmit() {
  error.value = '';
  loading.value = true;
  try {
    const { accessToken } = await apiRequest<{ accessToken: string }>(
      '/auth/login',
      { method: 'POST', body: { email: email.value, password: password.value } },
    );
    auth.setToken(accessToken);
    const me = await apiRequest<{ role: string; email: string }>('/users/me');
    auth.setRole(me.role);
    auth.setEmail(me.email);
    router.push({ name: 'dashboard' });
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Login failed';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <form class="auth-form" @submit.prevent="onSubmit">
      <h1>Log in</h1>
      <label>
        Email
        <input v-model="email" type="email" required />
      </label>
      <label>
        Password
        <input v-model="password" type="password" required />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" :disabled="loading">Log in</button>
      <router-link :to="{ name: 'signup' }">Need an account? Sign up</router-link>
    </form>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 320px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.9rem;
}
input {
  padding: 0.5rem;
  font-size: 1rem;
}
button {
  padding: 0.6rem;
  font-size: 1rem;
  cursor: pointer;
}
.error {
  color: #b00020;
  font-size: 0.85rem;
}
</style>
