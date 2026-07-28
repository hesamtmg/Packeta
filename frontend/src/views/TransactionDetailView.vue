<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { apiRequest, ApiError } from '../api/client';
import { formatAmount, type CurrencyInfo } from '../utils/currency';

interface WalletSummary {
  id: string;
  walletType: {
    name: string;
    code: string;
    currency: CurrencyInfo;
  };
}

interface TransactionDetail {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER' | 'ADJUSTMENT';
  amount: string;
  note: string | null;
  idempotencyKey: string;
  createdAt: string;
  fromWallet: WalletSummary | null;
  toWallet: WalletSummary | null;
  direction: 'IN' | 'OUT' | 'BOTH';
}

const route = useRoute();
const transaction = ref<TransactionDetail | null>(null);
const error = ref('');

const currency = computed(
  () => transaction.value?.fromWallet?.walletType.currency ?? transaction.value?.toWallet?.walletType.currency ?? null,
);

const directionLabel = computed(() => {
  if (!transaction.value) return '';
  switch (transaction.value.type) {
    case 'DEPOSIT':
      return `Deposit to ${transaction.value.toWallet?.walletType.name ?? 'wallet'}`;
    case 'WITHDRAW':
      return `Withdraw from ${transaction.value.fromWallet?.walletType.name ?? 'wallet'}`;
    case 'ADJUSTMENT':
      return transaction.value.direction === 'OUT' ? 'Admin debit adjustment' : 'Admin credit adjustment';
    case 'TRANSFER':
      if (transaction.value.direction === 'OUT') return `Sent from ${transaction.value.fromWallet?.walletType.name ?? 'wallet'}`;
      if (transaction.value.direction === 'IN') return `Received into ${transaction.value.toWallet?.walletType.name ?? 'wallet'}`;
      return 'Transfer';
    default:
      return transaction.value.type;
  }
});

async function load() {
  error.value = '';
  try {
    transaction.value = await apiRequest<TransactionDetail>(`/transactions/${route.params.id}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Failed to load transaction';
  }
}

onMounted(load);
</script>

<template>
  <div class="detail-page">
    <header>
      <h1>Transaction</h1>
      <router-link :to="{ name: 'dashboard' }">Back to wallet</router-link>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <section v-if="transaction" class="card">
      <span class="type-badge">{{ transaction.type }}</span>
      <span class="amount">{{ currency ? formatAmount(transaction.amount, currency) : transaction.amount }}</span>
      <span class="summary">{{ directionLabel }}</span>

      <dl>
        <template v-if="transaction.fromWallet">
          <dt>From wallet</dt>
          <dd>{{ transaction.fromWallet.walletType.name }} ({{ transaction.fromWallet.walletType.currency.code }})</dd>
        </template>
        <template v-if="transaction.toWallet">
          <dt>To wallet</dt>
          <dd>{{ transaction.toWallet.walletType.name }} ({{ transaction.toWallet.walletType.currency.code }})</dd>
        </template>
        <template v-if="transaction.note">
          <dt>Note</dt>
          <dd>{{ transaction.note }}</dd>
        </template>
        <dt>Idempotency key</dt>
        <dd class="mono">{{ transaction.idempotencyKey }}</dd>
        <dt>Transaction ID</dt>
        <dd class="mono">{{ transaction.id }}</dd>
        <dt>Date</dt>
        <dd>{{ new Date(transaction.createdAt).toLocaleString() }}</dd>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.detail-page {
  max-width: 560px;
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
.card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 1.5rem;
}
.type-badge {
  align-self: flex-start;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: #f0f0f0;
  border-radius: 4px;
  padding: 0.2rem 0.5rem;
  color: #444;
}
.amount {
  font-size: 2rem;
  font-weight: 600;
}
.summary {
  color: #666;
  margin-bottom: 0.5rem;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.4rem 1rem;
  margin: 0;
}
dt {
  color: #666;
  font-size: 0.85rem;
}
dd {
  margin: 0;
}
.mono {
  font-family: monospace;
  font-size: 0.85rem;
  word-break: break-all;
}
.error {
  color: #b00020;
  font-size: 0.9rem;
}
</style>
