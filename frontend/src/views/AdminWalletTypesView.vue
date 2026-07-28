<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { apiRequest, ApiError } from '../api/client';
import { amountStep, toMinorUnits, type CurrencyInfo } from '../utils/currency';

interface WalletType {
  id: string;
  code: string;
  name: string;
  currency: CurrencyInfo;
  allowNegativeBalance: boolean;
  creditLimit: string | null;
  allowWithdraw: boolean;
  allowP2pOut: boolean;
  allowP2pIn: boolean;
}

const types = ref<WalletType[]>([]);
const currencies = ref<CurrencyInfo[]>([]);
const error = ref('');
const busy = ref(false);

const newType = reactive({
  code: '',
  name: '',
  currencyCode: '',
  allowNegativeBalance: false,
  creditLimit: '',
  allowWithdraw: true,
  allowP2pOut: false,
  allowP2pIn: false,
});

const newTypeCurrency = computed(
  () => currencies.value.find((c) => c.code === newType.currencyCode) ?? null,
);

function creditLimitDisplay(type: WalletType): string {
  if (!type.creditLimit) return '';
  return (Number(type.creditLimit) / 10 ** type.currency.decimalPlaces).toFixed(
    type.currency.decimalPlaces,
  );
}

function onCreditLimitInput(type: WalletType, event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  type.creditLimit = String(toMinorUnits(raw, type.currency));
}

async function loadTypes() {
  error.value = '';
  try {
    [types.value, currencies.value] = await Promise.all([
      apiRequest<WalletType[]>('/wallet-types'),
      apiRequest<CurrencyInfo[]>('/currencies'),
    ]);
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
    const currency = newTypeCurrency.value;
    await apiRequest('/wallet-types', {
      method: 'POST',
      body: {
        code: newType.code.toUpperCase(),
        name: newType.name,
        currencyCode: newType.currencyCode,
        allowNegativeBalance: newType.allowNegativeBalance,
        creditLimit:
          newType.allowNegativeBalance && currency
            ? toMinorUnits(newType.creditLimit, currency)
            : undefined,
        allowWithdraw: newType.allowWithdraw,
        allowP2pOut: newType.allowP2pOut,
        allowP2pIn: newType.allowP2pIn,
      },
    });
    newType.code = '';
    newType.name = '';
    newType.currencyCode = '';
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
        <span class="code">{{ t.code }} · {{ t.currency.code }}</span>
        <label>Name <input v-model="t.name" type="text" /></label>
        <label>
          <input v-model="t.allowNegativeBalance" type="checkbox" />
          Allow negative balance (credit line)
        </label>
        <label v-if="t.allowNegativeBalance">
          Credit limit ({{ t.currency.code }})
          <input
            :value="creditLimitDisplay(t)"
            type="number"
            :step="amountStep(t.currency)"
            @input="onCreditLimitInput(t, $event)"
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
        Currency
        <select v-model="newType.currencyCode" required>
          <option value="" disabled>Choose currency</option>
          <option v-for="c in currencies" :key="c.code" :value="c.code">
            {{ c.code }}
          </option>
        </select>
      </label>
      <label>
        <input v-model="newType.allowNegativeBalance" type="checkbox" />
        Allow negative balance (credit line)
      </label>
      <label v-if="newType.allowNegativeBalance">
        Credit limit ({{ newType.currencyCode || '…' }})
        <input
          v-model="newType.creditLimit"
          type="number"
          :step="newTypeCurrency ? amountStep(newTypeCurrency) : '0.01'"
          required
        />
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
.type-card input[type='number'],
.type-card select {
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
