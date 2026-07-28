<script setup lang="ts">
import { reactive, ref } from 'vue';
import { apiRequest, ApiError } from '../api/client';

interface WalletType {
  id: string;
  code: string;
  name: string;
  allowNegativeBalance: boolean;
  creditLimit: string | null;
  allowWithdraw: boolean;
  allowP2pOut: boolean;
  allowP2pIn: boolean;
}

const types = ref<WalletType[]>([]);
const error = ref('');
const busy = ref(false);

const newType = reactive({
  code: '',
  name: '',
  allowNegativeBalance: false,
  creditLimit: '',
  allowWithdraw: true,
  allowP2pOut: false,
  allowP2pIn: false,
});

async function loadTypes() {
  error.value = '';
  try {
    types.value = await apiRequest<WalletType[]>('/wallet-types');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Failed to load wallet types';
  }
}

async function save(type: WalletType) {
  error.value = '';
  busy.value = true;
  try {
    await apiRequest(`/wallet-types/${type.id}`, {
      method: 'PATCH',
      body: {
        name: type.name,
        allowNegativeBalance: type.allowNegativeBalance,
        creditLimit: type.allowNegativeBalance
          ? Number(type.creditLimit ?? 0)
          : undefined,
        allowWithdraw: type.allowWithdraw,
        allowP2pOut: type.allowP2pOut,
        allowP2pIn: type.allowP2pIn,
      },
    });
    await loadTypes();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Save failed';
  } finally {
    busy.value = false;
  }
}

async function createType() {
  error.value = '';
  busy.value = true;
  try {
    await apiRequest('/wallet-types', {
      method: 'POST',
      body: {
        code: newType.code.toUpperCase(),
        name: newType.name,
        allowNegativeBalance: newType.allowNegativeBalance,
        creditLimit: newType.allowNegativeBalance
          ? Math.round(parseFloat(newType.creditLimit || '0') * 100)
          : undefined,
        allowWithdraw: newType.allowWithdraw,
        allowP2pOut: newType.allowP2pOut,
        allowP2pIn: newType.allowP2pIn,
      },
    });
    newType.code = '';
    newType.name = '';
    newType.allowNegativeBalance = false;
    newType.creditLimit = '';
    newType.allowWithdraw = true;
    newType.allowP2pOut = false;
    newType.allowP2pIn = false;
    await loadTypes();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Create failed';
  } finally {
    busy.value = false;
  }
}

loadTypes();
</script>

<template>
  <div class="admin-page">
    <header>
      <h1>Admin: Wallet Types</h1>
      <router-link :to="{ name: 'dashboard' }">Back to wallet</router-link>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="types">
      <article v-for="t in types" :key="t.id" class="type-card">
        <span class="code">{{ t.code }}</span>
        <label>Name <input v-model="t.name" type="text" /></label>
        <label>
          <input v-model="t.allowNegativeBalance" type="checkbox" />
          Allow negative balance (credit line)
        </label>
        <label v-if="t.allowNegativeBalance">
          Credit limit ($)
          <input
            :value="t.creditLimit ? (Number(t.creditLimit) / 100).toFixed(2) : ''"
            type="number"
            step="0.01"
            @input="t.creditLimit = String(Math.round(Number(($event.target as HTMLInputElement).value) * 100))"
          />
        </label>
        <label><input v-model="t.allowWithdraw" type="checkbox" /> Allow withdrawals</label>
        <label><input v-model="t.allowP2pOut" type="checkbox" /> Can send transfers</label>
        <label><input v-model="t.allowP2pIn" type="checkbox" /> Can receive transfers</label>
        <button :disabled="busy" @click="save(t)">Save</button>
      </article>
    </div>

    <form class="type-card new-type" @submit.prevent="createType">
      <h2>Add wallet type</h2>
      <label>Code <input v-model="newType.code" type="text" required placeholder="e.g. REWARDS" /></label>
      <label>Name <input v-model="newType.name" type="text" required /></label>
      <label>
        <input v-model="newType.allowNegativeBalance" type="checkbox" />
        Allow negative balance (credit line)
      </label>
      <label v-if="newType.allowNegativeBalance">
        Credit limit ($)
        <input v-model="newType.creditLimit" type="number" step="0.01" required />
      </label>
      <label><input v-model="newType.allowWithdraw" type="checkbox" /> Allow withdrawals</label>
      <label><input v-model="newType.allowP2pOut" type="checkbox" /> Can send transfers</label>
      <label><input v-model="newType.allowP2pIn" type="checkbox" /> Can receive transfers</label>
      <button type="submit" :disabled="busy">Create</button>
    </form>
  </div>
</template>

<style scoped>
.admin-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.types {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
}
.type-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 1rem;
}
.code {
  font-size: 0.75rem;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.type-card label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.85rem;
}
.type-card label:has(input[type='checkbox']) {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
}
.type-card input[type='text'],
.type-card input[type='number'] {
  padding: 0.4rem;
}
.type-card button {
  padding: 0.5rem;
  cursor: pointer;
}
.new-type {
  max-width: 320px;
}
.error {
  color: #b00020;
  font-size: 0.9rem;
}
</style>
