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
      '/auth/signup',
      { method: 'POST', body: { email: email.value, password: password.value } },
    );
    auth.setToken(accessToken);
    const me = await apiRequest<{ role: string }>('/users/me');
    auth.setRole(me.role);
    router.push({ name: 'dashboard' });
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Signup failed';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <form class="auth-form" @submit.prevent="onSubmit">
      <h1>Sign up</h1>
      <label>
        Email
        <input v-model="email" type="email" required />
      </label>
      <label>
        Password (min 8 characters)
        <input v-model="password" type="password" minlength="8" required />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" :disabled="loading">Create account</button>
      <router-link :to="{ name: 'login' }">Already have an account? Log in</router-link>
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
