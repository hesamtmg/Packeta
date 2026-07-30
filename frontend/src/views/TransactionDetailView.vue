<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { apiRequest, ApiError } from '../api/client';
import { formatAmount, type CurrencyInfo } from '../utils/currency';
import AppLayout from '../components/AppLayout.vue';

const { t } = useI18n();

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
  const d = transaction.value;
  switch (d.type) {
    case 'DEPOSIT':
      return t('transaction.direction.depositTo', { wallet: d.toWallet?.walletType.name ?? t('transaction.direction.wallet') });
    case 'WITHDRAW':
      return t('transaction.direction.withdrawFrom', { wallet: d.fromWallet?.walletType.name ?? t('transaction.direction.wallet') });
    case 'ADJUSTMENT':
      return d.direction === 'OUT' ? t('transaction.direction.adminDebit') : t('transaction.direction.adminCredit');
    case 'TRANSFER':
      if (d.direction === 'OUT') return t('transaction.direction.sentFrom', { wallet: d.fromWallet?.walletType.name ?? t('transaction.direction.wallet') });
      if (d.direction === 'IN') return t('transaction.direction.receivedInto', { wallet: d.toWallet?.walletType.name ?? t('transaction.direction.wallet') });
      return t('transaction.direction.transfer');
    case 'PURCHASE':
      if (d.direction === 'OUT') return t('transaction.direction.purchasePaidTo', { wallet: d.toWallet?.walletType.name ?? t('transaction.direction.merchant') });
      if (d.direction === 'IN') return t('transaction.direction.purchaseReceivedInto', { wallet: d.toWallet?.walletType.name ?? t('transaction.direction.wallet') });
      return t('transaction.direction.purchase');
    default:
      return d.type;
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
    error.value = err instanceof ApiError ? err.message : t('transaction.loadFailed');
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
    error.value = err instanceof ApiError ? err.message : t('transaction.refundFailed');
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AppLayout :title="t('transaction.title')">
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
          <dt>{{ t('transaction.fromWallet') }}</dt>
          <dd>{{ transaction.fromWallet.walletType.name }} ({{ transaction.fromWallet.walletType.currency.code }})</dd>
        </template>
        <template v-if="transaction.toWallet">
          <dt>{{ t('transaction.toWallet') }}</dt>
          <dd>{{ transaction.toWallet.walletType.name }} ({{ transaction.toWallet.walletType.currency.code }})</dd>
        </template>
        <template v-if="transaction.status === 'PENDING' && transaction.expiresAt">
          <dt>{{ t('transaction.verifyBy') }}</dt>
          <dd>{{ new Date(transaction.expiresAt).toLocaleString() }}</dd>
        </template>
        <template v-if="transaction.relatedTransactionId">
          <dt>{{ t('transaction.relatedTransaction') }}</dt>
          <dd class="mono">{{ transaction.relatedTransactionId }}</dd>
        </template>
        <template v-if="transaction.note">
          <dt>{{ t('transaction.note') }}</dt>
          <dd>{{ transaction.note }}</dd>
        </template>
        <dt>{{ t('transaction.idempotencyKey') }}</dt>
        <dd class="mono">{{ transaction.idempotencyKey }}</dd>
        <dt>{{ t('transaction.transactionId') }}</dt>
        <dd class="mono">{{ transaction.id }}</dd>
        <dt>{{ t('transaction.date') }}</dt>
        <dd>{{ new Date(transaction.createdAt).toLocaleString() }}</dd>
      </dl>

      <button v-if="canRefund" class="admin-btn admin-btn-danger" :disabled="busy" @click="onRefund">
        {{ t('transaction.refund') }}
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
