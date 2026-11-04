<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { apiRequest, ApiError } from '../api/client';
import type { Installment } from '../stores/wallet';
import { formatAmount, type CurrencyInfo } from '../utils/currency';
import { formatCalendarDate } from '../utils/date';
import '../styles/admin-theme.css';
import '../styles/customer-theme.css';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const status = ref<'working' | 'completed' | 'canceled' | 'failed'>('working');
const message = ref('');
const messageOverride = ref('');
// Set when the purchase was paid on credit: the installment plan it was
// split into the moment it settled (see backend
// InstallmentsService.createForPurchase).
const installments = ref<Installment[]>([]);
const installmentCurrency = ref<CurrencyInfo | null>(null);
const planTotal = computed(() =>
  installments.value.reduce((sum, i) => sum + BigInt(i.amount), 0n).toString(),
);

function money(amount: string): string {
  return installmentCurrency.value ? formatAmount(amount, installmentCurrency.value) : amount;
}

const displayMessage = computed(() => {
  if (messageOverride.value) return messageOverride.value;
  switch (status.value) {
    case 'canceled':
      return t('callback.canceled');
    case 'completed':
      return t('callback.completed');
    case 'failed':
      return message.value || t('callback.verificationFailed');
    default:
      return t('callback.finalizing');
  }
});

onMounted(async () => {
  const transactionId = route.params.id as string;
  const ipgStatus = route.query.status as string | undefined;
  // ZarinPal (used for deposits) redirects back with its own `Status=NOK`
  // query param instead of the in-house sandbox IPG's `status=canceled`.
  const zarinpalStatus = route.query.Status as string | undefined;

  try {
    if (ipgStatus === 'canceled' || zarinpalStatus === 'NOK') {
      await apiRequest(`/transactions/purchase/${transactionId}/cancel`, {
        method: 'POST',
      });
      status.value = 'canceled';
      return;
    }

    const result = await apiRequest<{
      status: string;
      reason?: string;
      installments?: Installment[];
      installmentCurrency?: CurrencyInfo;
    }>(
      `/transactions/purchase/${transactionId}/verify`,
      { method: 'POST' },
    );
    if (result.status === 'COMPLETED') {
      status.value = 'completed';
      installments.value = result.installments ?? [];
      installmentCurrency.value = result.installmentCurrency ?? null;
    } else {
      status.value = 'failed';
      messageOverride.value = result.reason ?? t('callback.couldNotVerify');
    }
  } catch (err) {
    status.value = 'failed';
    messageOverride.value = err instanceof ApiError ? err.message : t('callback.verificationFailed');
  }
});

function goToTransaction() {
  router.push({ name: 'transaction-detail', params: { id: route.params.id as string } });
}
</script>

<template>
  <div class="customer-theme callback-theme">
    <div class="callback-page">
      <div class="admin-card card">
        <span class="icon" :class="status">{{
          status === 'completed' ? '✓' : status === 'working' ? '…' : '✕'
        }}</span>
        <p>{{ displayMessage }}</p>
        <section v-if="installments.length" class="plan">
          <h2>{{ t('callback.planHeading') }}</h2>
          <p class="plan-hint">
            {{ t('callback.planHint', { count: installments.length, total: money(planTotal) }) }}
          </p>
          <ol class="plan-list">
            <li v-for="i in installments" :key="i.id">
              <span class="plan-seq">#{{ i.sequenceNumber }}</span>
              <span class="plan-dates">
                <span>{{ t('callback.planDue', { date: formatCalendarDate(i.dueDate) }) }}</span>
                <span v-if="i.deadlineDate !== i.dueDate" class="plan-deadline">
                  {{ t('callback.planDeadline', { date: formatCalendarDate(i.deadlineDate) }) }}
                </span>
              </span>
              <span class="plan-amount">{{ money(i.amount) }}</span>
            </li>
          </ol>
          <router-link
            :to="{ name: 'wallet-installments', params: { walletId: installments[0].walletId } }"
            class="admin-btn"
          >
            {{ t('callback.viewInstallments') }}
          </router-link>
        </section>
        <button v-if="status !== 'working'" class="admin-btn admin-btn-primary" @click="goToTransaction">
          {{ t('callback.viewTransaction') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.callback-theme {
  padding: 0;
}
.callback-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.card {
  width: 100%;
  max-width: 420px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2.5rem 2rem;
}
.card p {
  color: var(--text-dim);
  margin: 0;
}
.plan {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.6rem;
  text-align: start;
  border-top: 1px solid var(--divider);
  padding-top: 1rem;
}
.plan h2 {
  font-size: 1rem;
  margin: 0;
}
.plan-hint {
  font-size: 0.85rem;
}
.plan-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.plan-list li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--divider);
  border-radius: 8px;
  font-size: 0.9rem;
}
.plan-seq {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.plan-dates {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.plan-deadline {
  font-size: 0.78rem;
  color: var(--text-dim);
}
.plan-amount {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.plan .admin-btn {
  align-self: center;
  text-decoration: none;
}
.icon {
  font-size: 2.5rem;
  font-weight: 700;
}
.icon.completed {
  color: var(--accent-lime);
}
.icon.canceled,
.icon.failed {
  color: var(--accent-red);
}
.icon.working {
  color: var(--text-dim);
}
</style>
