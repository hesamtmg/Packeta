<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWalletStore, type Installment, type Wallet } from '../stores/wallet';
import { ApiError } from '../api/client';
import { formatAmount } from '../utils/currency';
import { formatCalendarDate } from '../utils/date';

// Up-front installments summary for a CREDIT wallet: what's owed, what's
// next, and a one-click Pay — shown at the top of the wallet instead of
// hiding the schedule behind a link at the bottom. The full month-by-month
// schedule is still one click away (wallet-installments).
const props = defineProps<{ wallet: Wallet; previewCount?: number }>();

const store = useWalletStore();
const { t } = useI18n();

const installments = ref<Installment[]>([]);
const loading = ref(false);
const loadError = ref('');
const payBusy = ref<string | null>(null);
const payError = ref('');

const currency = computed(() => props.wallet.walletType.currency);
const money = (amount: string) => formatAmount(amount, currency.value);

function isPayable(i: Installment): boolean {
  return i.status === 'PENDING' || i.status === 'OVERDUE';
}

const outstanding = computed(() =>
  installments.value
    .filter(isPayable)
    .sort((a, b) => a.deadlineDate.localeCompare(b.deadlineDate)),
);
const overdue = computed(() => outstanding.value.filter((i) => i.status === 'OVERDUE'));
const outstandingTotal = computed(() =>
  outstanding.value.reduce((sum, i) => sum + BigInt(i.amount), 0n).toString(),
);
const overdueTotal = computed(() =>
  overdue.value.reduce((sum, i) => sum + BigInt(i.amount), 0n).toString(),
);
const paidCount = computed(() => installments.value.filter((i) => i.status === 'PAID').length);
const next = computed(() => outstanding.value[0] ?? null);
const upcoming = computed(() => outstanding.value.slice(0, props.previewCount ?? 3));

function daysUntil(date: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date.slice(0, 10)}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function dueLabel(i: Installment): string {
  const d = daysUntil(i.deadlineDate);
  if (d < 0) return t('dashboard.installments.daysLate', { count: -d });
  if (d === 0) return t('dashboard.installments.dueToday');
  return t('dashboard.installments.dueIn', { count: d });
}

function statusLabel(status: Installment['status']): string {
  if (status === 'OVERDUE') return t('dashboard.installments.statusOverdue');
  if (status === 'PAID') return t('dashboard.installments.statusPaid');
  if (status === 'CANCELED') return t('dashboard.installments.statusCanceled');
  return t('dashboard.installments.statusPending');
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    installments.value = await store.fetchInstallmentsForWallet(props.wallet.id);
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : t('dashboard.actions.error');
  } finally {
    loading.value = false;
  }
}

async function pay(i: Installment) {
  payError.value = '';
  payBusy.value = i.id;
  try {
    const result = await store.payInstallment(i.id);
    window.location.href = result.redirectUrl;
  } catch (err) {
    payError.value = err instanceof ApiError ? err.message : t('dashboard.actions.error');
    payBusy.value = null;
  }
}

watch(() => props.wallet.id, load, { immediate: true });
</script>

<template>
  <section class="installments-card" :class="{ 'has-overdue': overdue.length }">
    <header class="installments-card-head">
      <h3>{{ t('dashboard.installments.title') }}</h3>
      <router-link
        :to="{ name: 'wallet-installments', params: { walletId: wallet.id } }"
        class="admin-btn admin-btn-ghost admin-btn-sm"
      >
        {{ t('dashboard.installments.viewAll') }}
      </router-link>
    </header>

    <p v-if="loadError" class="admin-error">{{ loadError }}</p>
    <p v-else-if="loading && !installments.length" class="hint">{{ t('dashboard.installments.loading') }}</p>
    <template v-else>
      <div v-if="overdue.length" class="installments-alert" role="alert">
        {{ t('dashboard.installments.overdueAlert', { count: overdue.length, amount: money(overdueTotal) }) }}
        <span v-if="wallet.blockedAt"> {{ t('dashboard.installments.blockedAlert') }}</span>
      </div>

      <div class="installments-stats">
        <div class="stat">
          <span class="stat-label">{{ t('dashboard.installments.outstanding') }}</span>
          <span class="stat-value">{{ money(outstandingTotal) }}</span>
          <span class="stat-sub">{{ t('dashboard.installments.outstandingCount', { count: outstanding.length }) }}</span>
        </div>
        <div v-if="next" class="stat">
          <span class="stat-label">{{ t('dashboard.installments.nextPayment') }}</span>
          <span class="stat-value">{{ money(next.amount) }}</span>
          <span class="stat-sub" :class="{ late: next.status === 'OVERDUE' }">
            {{ formatCalendarDate(next.deadlineDate) }} · {{ dueLabel(next) }}
          </span>
        </div>
        <div class="stat">
          <span class="stat-label">{{ t('dashboard.installments.paidSoFar') }}</span>
          <span class="stat-value">{{ paidCount }} / {{ installments.length }}</span>
        </div>
      </div>

      <ul v-if="upcoming.length" class="installments-list">
        <li v-for="i in upcoming" :key="i.id">
          <span class="admin-badge" :class="`installment-status-${i.status.toLowerCase()}`">{{ statusLabel(i.status) }}</span>
          <span class="when">
            {{ formatCalendarDate(i.deadlineDate) }}
            <small :class="{ late: i.status === 'OVERDUE' }">{{ dueLabel(i) }}</small>
          </span>
          <span class="amount">{{ money(i.amount) }}</span>
          <button
            type="button"
            class="admin-btn admin-btn-primary admin-btn-sm"
            :disabled="payBusy !== null"
            @click="pay(i)"
          >
            {{ payBusy === i.id ? t('dashboard.installments.redirecting') : t('dashboard.installments.pay') }}
          </button>
        </li>
      </ul>
      <p v-else class="hint">
        {{ installments.length ? t('dashboard.installments.allPaid') : t('dashboard.installments.none') }}
      </p>
      <p v-if="payError" class="admin-error">{{ payError }}</p>
    </template>
  </section>
</template>

<style scoped>
.installments-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--card-border, rgba(127, 127, 127, 0.2));
  border-radius: var(--radius-sm, 10px);
  background: var(--input-bg, rgba(127, 127, 127, 0.04));
}
.installments-card.has-overdue {
  border-color: var(--accent-red, #ff6b6b);
}
.installments-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.installments-card-head h3 {
  margin: 0;
  font-size: 0.95rem;
}
.installments-alert {
  padding: 8px 10px;
  border-radius: var(--radius-sm, 8px);
  background: var(--badge-tint-red, rgba(255, 107, 107, 0.15));
  color: var(--accent-red, #ff6b6b);
  font-size: 0.85rem;
  font-weight: 600;
}
.installments-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.stat-label {
  font-size: 0.75rem;
  color: var(--text-dimmer);
}
.stat-value {
  font-size: 1.05rem;
  font-weight: 700;
}
.stat-sub {
  font-size: 0.78rem;
  color: var(--text-dim);
}
.late {
  color: var(--accent-red, #ff6b6b);
}
.installments-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.installments-list li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 6px 0;
  border-top: 1px solid var(--card-border, rgba(127, 127, 127, 0.15));
  font-size: 0.88rem;
}
.installments-list .when {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 110px;
}
.installments-list .when small {
  font-size: 0.75rem;
  color: var(--text-dim);
}
.installments-list .amount {
  font-weight: 600;
}
.hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-dimmer);
}
.installment-status-paid {
  color: var(--accent-green, #3ecf8e);
}
.installment-status-overdue {
  color: var(--accent-red, #ff6b6b);
}
.installment-status-pending {
  color: var(--accent-blue, #7aa2ff);
}
</style>
