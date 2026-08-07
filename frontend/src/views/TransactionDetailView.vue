<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { apiRequest, ApiError } from '../api/client';
import { formatAmount, formatAmountWords, type CurrencyInfo } from '../utils/currency';
import { formatDateTime } from '../utils/date';
import { walletDisplayName } from '../utils/wallet-name';
import AppLayout from '../components/AppLayout.vue';

const { t } = useI18n();

interface WalletSummary {
  id: string;
  name: string | null;
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
  settledAt: string | null;
  destinationIban: string | null;
  performedByUserId: string | null;
  ipgAuthority: string | null;
  ipgPaymentUrl: string | null;
  language: string | null;
  installmentId: string | null;
  railSettlementId: string | null;
  completesPurchaseId: string | null;
  relatedPurchaseId: string | null;
  settlesWalletId: string | null;
}

const route = useRoute();
const transaction = ref<TransactionDetail | null>(null);
const error = ref('');
const busy = ref(false);

const currency = computed(
  () => transaction.value?.fromWallet?.walletType.currency ?? transaction.value?.toWallet?.walletType.currency ?? null,
);

const amountWords = computed(() =>
  transaction.value && currency.value ? formatAmountWords(transaction.value.amount, currency.value) : '',
);

const directionLabel = computed(() => {
  if (!transaction.value) return '';
  const d = transaction.value;
  switch (d.type) {
    case 'DEPOSIT':
      return t('transaction.direction.depositTo', { wallet: d.toWallet ? walletDisplayName(d.toWallet) : t('transaction.direction.wallet') });
    case 'WITHDRAW':
      return t('transaction.direction.withdrawFrom', { wallet: d.fromWallet ? walletDisplayName(d.fromWallet) : t('transaction.direction.wallet') });
    case 'ADJUSTMENT':
      return d.direction === 'OUT' ? t('transaction.direction.adminDebit') : t('transaction.direction.adminCredit');
    case 'TRANSFER':
      if (d.direction === 'OUT') return t('transaction.direction.sentFrom', { wallet: d.fromWallet ? walletDisplayName(d.fromWallet) : t('transaction.direction.wallet') });
      if (d.direction === 'IN') return t('transaction.direction.receivedInto', { wallet: d.toWallet ? walletDisplayName(d.toWallet) : t('transaction.direction.wallet') });
      return t('transaction.direction.transfer');
    case 'PURCHASE':
      if (d.direction === 'OUT') return t('transaction.direction.purchasePaidTo', { wallet: d.toWallet ? walletDisplayName(d.toWallet) : t('transaction.direction.merchant') });
      if (d.direction === 'IN') return t('transaction.direction.purchaseReceivedInto', { wallet: d.toWallet ? walletDisplayName(d.toWallet) : t('transaction.direction.wallet') });
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
      <span v-if="amountWords" class="amount-words">{{ amountWords }}</span>
      <span class="summary">{{ directionLabel }}</span>
      <span v-if="transaction.type === 'PURCHASE'" class="status-badge" :class="transaction.status.toLowerCase()">
        {{ transaction.status }}
      </span>

      <dl>
        <template v-if="transaction.fromWallet">
          <dt>{{ t('transaction.fromWallet') }}</dt>
          <dd>
            <router-link :to="{ name: 'wallet-detail', params: { id: transaction.fromWallet.id } }">
              {{ walletDisplayName(transaction.fromWallet) }} ({{ transaction.fromWallet.walletType.currency.code }})
            </router-link>
            <div class="mono-id">{{ transaction.fromWallet.id }}</div>
          </dd>
        </template>
        <template v-if="transaction.toWallet">
          <dt>{{ t('transaction.toWallet') }}</dt>
          <dd>
            <router-link :to="{ name: 'wallet-detail', params: { id: transaction.toWallet.id } }">
              {{ walletDisplayName(transaction.toWallet) }} ({{ transaction.toWallet.walletType.currency.code }})
            </router-link>
            <div class="mono-id">{{ transaction.toWallet.id }}</div>
          </dd>
        </template>
        <template v-if="transaction.status === 'PENDING' && transaction.expiresAt">
          <dt>{{ t('transaction.verifyBy') }}</dt>
          <dd>{{ formatDateTime(transaction.expiresAt) }}</dd>
        </template>
        <template v-if="transaction.settledAt">
          <dt>{{ t('transaction.settledAt') }}</dt>
          <dd>{{ formatDateTime(transaction.settledAt) }}</dd>
        </template>
        <template v-if="transaction.destinationIban">
          <dt>{{ t('transaction.destinationIban') }}</dt>
          <dd class="mono">{{ transaction.destinationIban }}</dd>
        </template>
        <template v-if="transaction.relatedTransactionId">
          <dt>{{ t('transaction.relatedTransaction') }}</dt>
          <dd class="mono">
            <router-link :to="{ name: 'transaction-detail', params: { id: transaction.relatedTransactionId } }">
              {{ transaction.relatedTransactionId }}
            </router-link>
          </dd>
        </template>
        <template v-if="transaction.completesPurchaseId">
          <dt>{{ t('transaction.completesPurchaseId') }}</dt>
          <dd class="mono">
            <router-link :to="{ name: 'transaction-detail', params: { id: transaction.completesPurchaseId } }">
              {{ transaction.completesPurchaseId }}
            </router-link>
          </dd>
        </template>
        <template v-if="transaction.relatedPurchaseId">
          <dt>{{ t('transaction.relatedPurchaseId') }}</dt>
          <dd class="mono">
            <router-link :to="{ name: 'transaction-detail', params: { id: transaction.relatedPurchaseId } }">
              {{ transaction.relatedPurchaseId }}
            </router-link>
          </dd>
        </template>
        <template v-if="transaction.settlesWalletId">
          <dt>{{ t('transaction.settlesWalletId') }}</dt>
          <dd class="mono">
            <router-link :to="{ name: 'wallet-detail', params: { id: transaction.settlesWalletId } }">
              {{ transaction.settlesWalletId }}
            </router-link>
          </dd>
        </template>
        <template v-if="transaction.installmentId">
          <dt>{{ t('transaction.installmentId') }}</dt>
          <dd class="mono">{{ transaction.installmentId }}</dd>
        </template>
        <template v-if="transaction.railSettlementId">
          <dt>{{ t('transaction.railSettlementId') }}</dt>
          <dd class="mono">{{ transaction.railSettlementId }}</dd>
        </template>
        <template v-if="transaction.performedByUserId">
          <dt>{{ t('transaction.performedBy') }}</dt>
          <dd class="mono">{{ transaction.performedByUserId }}</dd>
        </template>
        <template v-if="transaction.ipgAuthority">
          <dt>{{ t('transaction.ipgAuthority') }}</dt>
          <dd class="mono">{{ transaction.ipgAuthority }}</dd>
        </template>
        <template v-if="transaction.ipgPaymentUrl">
          <dt>{{ t('transaction.ipgPaymentUrl') }}</dt>
          <dd class="mono">{{ transaction.ipgPaymentUrl }}</dd>
        </template>
        <template v-if="transaction.language">
          <dt>{{ t('transaction.language') }}</dt>
          <dd>{{ transaction.language }}</dd>
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
        <dd>{{ formatDateTime(transaction.createdAt) }}</dd>
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
  background: var(--badge-tint-lime, rgba(216, 255, 92, 0.15));
  color: var(--accent-lime);
}
.status-badge.completed {
  background: var(--badge-tint-blue, rgba(122, 162, 255, 0.15));
  color: var(--accent-blue);
}
.status-badge.reversed {
  background: var(--badge-tint-red, rgba(255, 107, 107, 0.15));
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
