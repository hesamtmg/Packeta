<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { formatAmount, type CurrencyInfo } from '../../utils/currency';
import { formatDateTime } from '../../utils/date';
import {
  walletLookup,
  transactionCurrency,
  type AdminUser,
  type AdminWallet,
  type AdminTransaction,
} from '../../types/admin';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import MiniLineChart from '../../components/admin/MiniLineChart.vue';

// Local to this view, same shape as AdminInstallmentsView's own local
// interfaces — kept unshared since only the fields this report needs are
// declared here.
interface AdminInstallment {
  status: 'PENDING' | 'OVERDUE' | 'PAID';
  amount: string;
  currency: CurrencyInfo;
}
interface BlockedWallet {
  currency: CurrencyInfo;
  totalOwed: string;
}
interface SchedulerLogEntry {
  _id: string;
  action: string;
  success: boolean;
  createdAt: string;
}

const { t } = useI18n();

const users = ref<AdminUser[]>([]);
const wallets = ref<AdminWallet[]>([]);
const transactions = ref<AdminTransaction[]>([]);
const installments = ref<AdminInstallment[]>([]);
const overdueWallets = ref<BlockedWallet[]>([]);
const schedulerLogs = ref<SchedulerLogEntry[]>([]);
const error = ref('');
// The "installments" and "schedulerLogs" panel sections are independently
// gated (see admin.controller.ts's @RequireSection) — a regular ADMIN
// without one of those may still have "reports" access, so those two
// fetches are best-effort and their cards just disappear rather than
// failing the whole page.
const hasInstallmentsAccess = ref(true);
const hasSchedulerAccess = ref(true);

const walletsById = computed(() => walletLookup(wallets.value));

const customerCount = computed(() => users.value.filter((u) => u.role === 'USER').length);
const adminCount = computed(
  () => users.value.filter((u) => u.role === 'ADMIN' || u.role === 'SUPER_ADMIN').length,
);
const activeWalletCount = computed(() => wallets.value.filter((w) => !w.closedAt).length);
const closedWalletCount = computed(() => wallets.value.filter((w) => !!w.closedAt).length);
const blockedWalletCount = computed(() => wallets.value.filter((w) => !!w.blockedAt).length);

function perDayBuckets(dates: string[], days: number): number[] {
  const buckets = new Array(days).fill(0);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  for (const iso of dates) {
    const diff = Math.floor((now.getTime() - new Date(iso).getTime()) / dayMs);
    const idx = days - 1 - diff;
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
}

const transactionsPerDay = computed(() =>
  perDayBuckets(transactions.value.map((tx) => tx.createdAt), 30),
);
const signupsPerDay = computed(() => perDayBuckets(users.value.map((u) => u.createdAt), 30));

function barList<T>(items: T[], keyOf: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const max = Math.max(1, ...counts.values());
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, pct: Math.round((count / max) * 100) }));
}

const byType = computed(() => barList(transactions.value, (tx) => tx.type));
const byStatus = computed(() => barList(transactions.value, (tx) => tx.status));
const byWalletType = computed(() =>
  barList(wallets.value, (w) => `${w.walletType.name} (${w.walletType.currency.code})`),
);
const installmentsByStatus = computed(() => barList(installments.value, (i) => i.status));

interface CurrencyStat {
  code: string;
  currency: CurrencyInfo;
  walletCount: number;
  totalBalance: bigint;
  volume: bigint;
}

// One row per currency in play: how many wallets hold it, how much of it
// exists across every wallet, and how much of it has actually moved in
// completed transactions — the three questions "by transaction type" and
// "by wallet type" can't answer on their own since they mix currencies.
const currencyStats = computed(() => {
  const map = new Map<string, CurrencyStat>();
  const entry = (currency: CurrencyInfo): CurrencyStat => {
    const existing = map.get(currency.code);
    if (existing) return existing;
    const fresh: CurrencyStat = { code: currency.code, currency, walletCount: 0, totalBalance: 0n, volume: 0n };
    map.set(currency.code, fresh);
    return fresh;
  };
  for (const w of wallets.value) {
    const row = entry(w.walletType.currency);
    row.walletCount += 1;
    row.totalBalance += BigInt(w.balance);
  }
  for (const tx of transactions.value) {
    if (tx.status !== 'COMPLETED') continue;
    const currency = transactionCurrency(tx, walletsById.value);
    if (!currency) continue;
    entry(currency).volume += BigInt(tx.amount);
  }
  return [...map.values()].sort((a, b) => b.walletCount - a.walletCount);
});

interface CreditLineRow {
  code: string;
  currency: CurrencyInfo;
  outstandingCount: number;
  outstandingAmount: bigint;
  blockedCount: number;
  overdueAmount: bigint;
}

// Unpaid installments (PENDING + OVERDUE) alongside already-blocked wallets
// and what they owe, per currency — the credit-line book's health at a
// glance.
const creditLineHealth = computed(() => {
  const map = new Map<string, CreditLineRow>();
  const entry = (currency: CurrencyInfo): CreditLineRow => {
    const existing = map.get(currency.code);
    if (existing) return existing;
    const fresh: CreditLineRow = {
      code: currency.code,
      currency,
      outstandingCount: 0,
      outstandingAmount: 0n,
      blockedCount: 0,
      overdueAmount: 0n,
    };
    map.set(currency.code, fresh);
    return fresh;
  };
  for (const i of installments.value) {
    if (i.status === 'PAID') continue;
    const row = entry(i.currency);
    row.outstandingCount += 1;
    row.outstandingAmount += BigInt(i.amount);
  }
  for (const w of overdueWallets.value) {
    const row = entry(w.currency);
    row.blockedCount += 1;
    row.overdueAmount += BigInt(w.totalOwed);
  }
  return [...map.values()].sort((a, b) => b.outstandingAmount > a.outstandingAmount ? 1 : -1);
});

const schedulerRecent = computed(() => schedulerLogs.value.slice(0, 12));
const schedulerSuccessRate = computed(() => {
  if (!schedulerLogs.value.length) return null;
  const success = schedulerLogs.value.filter((l) => l.success).length;
  return Math.round((success / schedulerLogs.value.length) * 100);
});
function schedulerActionLabel(action: string): string {
  return t(`admin.schedulerLogs.actions.${action}`, action);
}

const topCustomers = computed(() => {
  const counts = new Map<string, number>();
  for (const tx of transactions.value) {
    for (const walletId of [tx.fromWalletId, tx.toWalletId]) {
      if (!walletId) continue;
      const w = walletsById.value.get(walletId);
      if (!w) continue;
      counts.set(w.ownerEmail, (counts.get(w.ownerEmail) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([email, count]) => ({ email, count }));
});

async function load() {
  error.value = '';
  try {
    [users.value, wallets.value, transactions.value] = await Promise.all([
      apiRequest<AdminUser[]>('/admin/users'),
      apiRequest<AdminWallet[]>('/admin/wallets'),
      apiRequest<AdminTransaction[]>('/admin/transactions?limit=5000'),
    ]);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.reports.loadFailed');
    return;
  }
  try {
    [installments.value, overdueWallets.value] = await Promise.all([
      apiRequest<AdminInstallment[]>('/admin/installments'),
      apiRequest<BlockedWallet[]>('/admin/installments/overdue'),
    ]);
  } catch {
    hasInstallmentsAccess.value = false;
  }
  try {
    schedulerLogs.value = await apiRequest<SchedulerLogEntry[]>('/admin/scheduler-logs?limit=50');
  } catch {
    hasSchedulerAccess.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.reports.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <div class="kpi-grid">
      <div class="admin-card kpi-card">
        <span class="kpi-value">{{ customerCount }}</span>
        <span class="kpi-label">{{ t('admin.reports.kpiCustomers') }}</span>
      </div>
      <div class="admin-card kpi-card">
        <span class="kpi-value">{{ adminCount }}</span>
        <span class="kpi-label">{{ t('admin.reports.kpiAdmins') }}</span>
      </div>
      <div class="admin-card kpi-card">
        <span class="kpi-value">{{ activeWalletCount }}</span>
        <span class="kpi-label">{{ t('admin.reports.kpiActiveWallets') }}</span>
        <span class="kpi-sub">{{ t('admin.reports.kpiClosedWallets', { count: closedWalletCount }) }}</span>
      </div>
      <div class="admin-card kpi-card">
        <span class="kpi-value">{{ blockedWalletCount }}</span>
        <span class="kpi-label">{{ t('admin.reports.kpiBlockedWallets') }}</span>
      </div>
      <div class="admin-card kpi-card">
        <span class="kpi-value">{{ transactions.length }}</span>
        <span class="kpi-label">{{ t('admin.reports.kpiTransactions') }}</span>
      </div>
      <div v-if="hasInstallmentsAccess" class="admin-card kpi-card">
        <span class="kpi-value">{{ overdueWallets.length }}</span>
        <span class="kpi-label">{{ t('admin.reports.kpiOverdueWallets') }}</span>
      </div>
    </div>

    <div class="admin-grid admin-grid-2">
      <div class="admin-card">
        <h2>{{ t('admin.reports.activityHeading') }}</h2>
        <MiniLineChart :data="transactionsPerDay" color="#ff7a45" :height="120" />
      </div>
      <div class="admin-card">
        <h2>{{ t('admin.reports.signupsHeading') }}</h2>
        <MiniLineChart :data="signupsPerDay" color="#d8ff5c" :height="120" />
      </div>
    </div>

    <div class="admin-grid admin-grid-2">
      <div class="admin-card">
        <h2>{{ t('admin.reports.byTypeHeading') }}</h2>
        <div class="bar-list">
          <div v-for="row in byType" :key="row.label" class="bar-row">
            <span class="bar-label">{{ row.label }}</span>
            <div class="bar-track"><div class="bar-fill" :style="{ width: row.pct + '%' }" /></div>
            <span class="bar-count">{{ row.count }}</span>
          </div>
          <p v-if="!byType.length" class="empty">{{ t('admin.reports.noData') }}</p>
        </div>
      </div>

      <div class="admin-card">
        <h2>{{ t('admin.reports.byStatusHeading') }}</h2>
        <div class="bar-list">
          <div v-for="row in byStatus" :key="row.label" class="bar-row">
            <span class="bar-label">{{ row.label }}</span>
            <div class="bar-track"><div class="bar-fill bar-fill-blue" :style="{ width: row.pct + '%' }" /></div>
            <span class="bar-count">{{ row.count }}</span>
          </div>
          <p v-if="!byStatus.length" class="empty">{{ t('admin.reports.noData') }}</p>
        </div>
      </div>
    </div>

    <div class="admin-grid admin-grid-2">
      <div class="admin-card">
        <h2>{{ t('admin.reports.byWalletTypeHeading') }}</h2>
        <div class="bar-list">
          <div v-for="row in byWalletType" :key="row.label" class="bar-row">
            <span class="bar-label">{{ row.label }}</span>
            <div class="bar-track"><div class="bar-fill bar-fill-lime" :style="{ width: row.pct + '%' }" /></div>
            <span class="bar-count">{{ row.count }}</span>
          </div>
          <p v-if="!byWalletType.length" class="empty">{{ t('admin.reports.noData') }}</p>
        </div>
      </div>

      <div v-if="hasInstallmentsAccess" class="admin-card">
        <h2>{{ t('admin.reports.installmentsByStatusHeading') }}</h2>
        <div class="bar-list">
          <div v-for="row in installmentsByStatus" :key="row.label" class="bar-row">
            <span class="bar-label">{{ row.label }}</span>
            <div class="bar-track"><div class="bar-fill bar-fill-red" :style="{ width: row.pct + '%' }" /></div>
            <span class="bar-count">{{ row.count }}</span>
          </div>
          <p v-if="!installmentsByStatus.length" class="empty">{{ t('admin.reports.noData') }}</p>
        </div>
      </div>
    </div>

    <div class="admin-card">
      <h2>{{ t('admin.reports.byCurrencyHeading') }}</h2>
      <div class="table-scroll">
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t('admin.reports.tableCurrency') }}</th>
            <th>{{ t('admin.reports.tableWalletsCount') }}</th>
            <th>{{ t('admin.reports.tableTotalBalance') }}</th>
            <th>{{ t('admin.reports.tableVolume') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in currencyStats" :key="row.code">
            <td>{{ row.code }}</td>
            <td>{{ row.walletCount }}</td>
            <td>{{ formatAmount(row.totalBalance.toString(), row.currency) }}</td>
            <td>{{ formatAmount(row.volume.toString(), row.currency) }}</td>
          </tr>
          <tr v-if="!currencyStats.length"><td colspan="4">{{ t('admin.reports.noData') }}</td></tr>
        </tbody>
      </table>
      </div>
    </div>

    <div v-if="hasInstallmentsAccess" class="admin-card">
      <h2>{{ t('admin.reports.creditLineHeading') }}</h2>
      <div class="table-scroll">
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t('admin.reports.tableCurrency') }}</th>
            <th>{{ t('admin.reports.tableOutstandingCount') }}</th>
            <th>{{ t('admin.reports.tableOutstandingAmount') }}</th>
            <th>{{ t('admin.reports.tableBlockedWallets') }}</th>
            <th>{{ t('admin.reports.tableOverdueAmount') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in creditLineHealth" :key="row.code">
            <td>{{ row.code }}</td>
            <td>{{ row.outstandingCount }}</td>
            <td>{{ formatAmount(row.outstandingAmount.toString(), row.currency) }}</td>
            <td>{{ row.blockedCount }}</td>
            <td>{{ formatAmount(row.overdueAmount.toString(), row.currency) }}</td>
          </tr>
          <tr v-if="!creditLineHealth.length"><td colspan="5">{{ t('admin.reports.noData') }}</td></tr>
        </tbody>
      </table>
      </div>
    </div>

    <div v-if="hasSchedulerAccess" class="admin-card">
      <h2>
        {{ t('admin.reports.schedulerHeading') }}
        <span v-if="schedulerSuccessRate !== null" class="scheduler-rate">
          {{ t('admin.reports.schedulerSuccessRate', { rate: schedulerSuccessRate, count: schedulerLogs.length }) }}
        </span>
      </h2>
      <div class="table-scroll">
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t('admin.schedulerLogs.tableAction') }}</th>
            <th>{{ t('admin.reports.tableOutcome') }}</th>
            <th>{{ t('admin.schedulerLogs.tableWhen') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in schedulerRecent" :key="log._id">
            <td>{{ schedulerActionLabel(log.action) }}</td>
            <td>
              <span class="admin-badge" :class="log.success ? 'tx-status-completed' : 'tx-status-reversed'">
                {{ log.success ? t('admin.reports.outcomeSuccess') : t('admin.reports.outcomeFailure') }}
              </span>
            </td>
            <td>{{ formatDateTime(log.createdAt) }}</td>
          </tr>
          <tr v-if="!schedulerRecent.length"><td colspan="3">{{ t('admin.reports.noData') }}</td></tr>
        </tbody>
      </table>
      </div>
    </div>

    <div class="admin-card">
      <h2>{{ t('admin.reports.topCustomersHeading') }}</h2>
      <div class="table-scroll">
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t('admin.reports.tableCustomer') }}</th>
            <th>{{ t('admin.reports.tableTransactionsTouched') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in topCustomers" :key="row.email">
            <td>{{ row.email }}</td>
            <td>{{ row.count }}</td>
          </tr>
          <tr v-if="!topCustomers.length"><td colspan="2">{{ t('admin.reports.noActivity') }}</td></tr>
        </tbody>
      </table>
      </div>
    </div>
  </AdminLayout>
</template>

<style scoped>
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}
.kpi-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kpi-value {
  font-size: 1.6rem;
  font-weight: 700;
}
.kpi-label {
  font-size: 0.8rem;
  color: var(--text-dim);
}
.kpi-sub {
  font-size: 0.72rem;
  color: var(--text-dimmer);
}
.scheduler-rate {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-dim);
  margin-inline-start: 10px;
}
.bar-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bar-row {
  display: grid;
  grid-template-columns: 130px 1fr 40px;
  align-items: center;
  gap: 10px;
  font-size: 0.85rem;
}
.bar-label {
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bar-track {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  height: 8px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  background: var(--accent-orange);
  border-radius: 999px;
}
.bar-fill-lime {
  background: var(--accent-lime);
}
.bar-fill-blue {
  background: var(--accent-blue);
}
.bar-fill-red {
  background: var(--accent-red);
}
.bar-count {
  text-align: right;
  color: var(--text-dim);
}
.empty {
  color: var(--text-dimmer);
  font-size: 0.85rem;
}
</style>
