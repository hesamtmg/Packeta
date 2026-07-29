<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { apiRequest, ApiError } from '../api/client';
import { formatAmount, type CurrencyInfo } from '../utils/currency';
import AppLayout from '../components/AppLayout.vue';

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
  type: 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER' | 'ADJUSTMENT' | 'PURCHASE';
  amount: string;
  note: string | null;
  idempotencyKey: string;
  createdAt: string;
  fromWallet: WalletSummary | null;
  toWallet: WalletSummary | null;
  direction: 'IN' | 'OUT' | 'BOTH';
  status: 'PENDING' | 'COMPLETED' | 'REVERSED';
  expiresAt: string | null;
  relatedTransactionId: string | null;
}

const route = useRoute();
const transaction = ref<TransactionDetail | null>(null);
const error = ref('');
const busy = ref(false);

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
    case 'PURCHASE':
      if (transaction.value.direction === 'OUT') return `Purchase paid to ${transaction.value.toWallet?.walletType.name ?? 'merchant'}`;
      if (transaction.value.direction === 'IN') return `Purchase received into ${transaction.value.toWallet?.walletType.name ?? 'wallet'}`;
      return 'Purchase';
    default:
      return transaction.value.type;
  }
});

const canRefund = computed(
  () => transaction.value?.type === 'PURCHASE' && transaction.value?.status === 'COMPLETED',
);

async function load() {
  error.value = '';
  try {
    transaction.value = await apiRequest<TransactionDetail>(`/transactions/${route.params.id}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Failed to load transaction';
  }
}

async function onRefund() {
  error.value = '';
  busy.value = true;
  try {
    await apiRequest(`/transactions/${route.params.id}/reverse`, {
      method: 'POST',
      body: { reason: 'Refunded from transaction detail page' },
      idempotent: true,
    });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Refund failed';
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AppLayout title="Transaction">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <section v-if="transaction" class="admin-card detail-card">
      <span class="admin-badge">{{ transaction.type }}</span>
      <span class="amount">{{ currency ? formatAmount(transaction.amount, currency) : transaction.amount }}</span>
      <span class="summary">{{ directionLabel }}</span>
      <span v-if="transaction.type === 'PURCHASE'" class="status-badge" :class="transaction.status.toLowerCase()">
        {{ transaction.status }}
      </span>

      <dl>
        <template v-if="transaction.fromWallet">
          <dt>From wallet</dt>
          <dd>{{ transaction.fromWallet.walletType.name }} ({{ transaction.fromWallet.walletType.currency.code }})</dd>
        </template>
        <template v-if="transaction.toWallet">
          <dt>To wallet</dt>
          <dd>{{ transaction.toWallet.walletType.name }} ({{ transaction.toWallet.walletType.currency.code }})</dd>
        </template>
        <template v-if="transaction.status === 'PENDING' && transaction.expiresAt">
          <dt>Verify by</dt>
          <dd>{{ new Date(transaction.expiresAt).toLocaleString() }}</dd>
        </template>
        <template v-if="transaction.relatedTransactionId">
          <dt>Related transaction</dt>
          <dd class="mono">{{ transaction.relatedTransactionId }}</dd>
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

      <button v-if="canRefund" class="admin-btn admin-btn-danger" :disabled="busy" @click="onRefund">
        Refund this purchase
      </button>
    </section>
  </AppLayout>
</template>

<style scoped>
.detail-card {
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.amount {
  font-size: 2rem;
  font-weight: 700;
}
.summary {
  color: var(--text-dim);
  margin-bottom: 0.5rem;
}
.status-badge {
  align-self: flex-start;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-radius: 999px;
  padding: 3px 10px;
}
.status-badge.pending {
  background: rgba(216, 255, 92, 0.15);
  color: var(--accent-lime);
}
.status-badge.completed {
  background: rgba(122, 162, 255, 0.15);
  color: var(--accent-blue);
}
.status-badge.reversed {
  background: rgba(255, 107, 107, 0.15);
  color: var(--accent-red);
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.4rem 1rem;
  margin: 4px 0 0;
}
dt {
  color: var(--text-dimmer);
  font-size: 0.82rem;
}
dd {
  margin: 0;
}
.mono {
  font-family: monospace;
  font-size: 0.82rem;
  word-break: break-all;
  color: var(--text-dim);
}
.detail-card button {
  align-self: flex-start;
  margin-top: 10px;
}
</style>
