<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { formatAmount, type CurrencyInfo } from '../../utils/currency';
import {
  walletLookup,
  transactionCurrency,
  type AdminUser,
  type AdminWallet,
  type AdminTransaction,
} from '../../types/admin';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import { displayIdentity } from '../../utils/identity';
import TrendChart from '../../components/admin/TrendChart.vue';
import BarList from '../../components/admin/BarList.vue';
import { lastDayLabels, perDayBuckets as dayBuckets, formatRelative, initials } from '../../utils/adminFormat';

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

const transactionsPerDay = computed(() =>
  dayBuckets(transactions.value.map((tx) => tx.createdAt), 30),
);
const signupsPerDay = computed(() => dayBuckets(users.value.map((u) => u.createdAt), 30));

const dayLabels = computed(() => lastDayLabels(30));
const txTotal30 = computed(() => transactionsPerDay.value.reduce((a, b) => a + b, 0));
const signupTotal30 = computed(() => signupsPerDay.value.reduce((a, b) => a + b, 0));

function barList<T>(items: T[], keyOf: (item: T) => string, labelOf: (key: string) => string = (k) => k, dotOf?: (key: string) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const max = Math.max(1, ...counts.values());
  const total = Math.max(1, items.length);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({
      label: labelOf(key),
      count,
      pct: Math.round((count / max) * 100),
      share: Math.round((count / total) * 100),
      dot: dotOf?.(key),
    }));
}

const byType = computed(() =>
  barList(transactions.value, (tx) => tx.type, (k) => t(`admin.transactions.${k.toLowerCase()}`), (k) => `tx-type-${k.toLowerCase()}`),
);
const byStatus = computed(() =>
  barList(transactions.value, (tx) => tx.status, (k) => t(`admin.transactions.status${k}`), (k) => `tx-status-${k.toLowerCase()}`),
);
const byWalletType = computed(() =>
  barList(wallets.value, (w) => `${w.walletType.name} (${w.walletType.currency.code})`),
);
const installmentsByStatus = computed(() =>
  barList(installments.value, (i) => i.status, (k) => t(`admin.reports.inst${k}`), (k) => `inst-${k.toLowerCase()}`),
);

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

const schedulerRecent = computed(() => schedulerLogs.value.slice(0, 8));
const schedulerFailures = computed(() => schedulerLogs.value.filter((l) => !l.success).length);
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
  const labels = new Map<string, string>();
  for (const tx of transactions.value) {
    for (const walletId of [tx.fromWalletId, tx.toWalletId]) {
      if (!walletId) continue;
      const w = walletsById.value.get(walletId);
      if (!w) continue;
      counts.set(w.ownerId, (counts.get(w.ownerId) ?? 0) + 1);
      labels.set(w.ownerId, displayIdentity({ email: w.ownerEmail, phoneNumber: w.ownerPhoneNumber }));
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const top = Math.max(1, ranked[0]?.[1] ?? 1);
  return ranked.map(([id, count]) => ({ id, email: labels.get(id) ?? id, count, pct: Math.round((count / top) * 100) }));
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

    <div class="stat-tiles">
      <div class="stat-tile">
        <span class="stat-tile-label"><span class="stat-icon stat-icon-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" /></svg></span>{{ t('admin.reports.kpiCustomers') }}</span>
        <span class="stat-tile-value">{{ customerCount.toLocaleString() }}</span>
        <span class="stat-tile-meta">{{ t('admin.reports.kpiAdminsMeta', { count: adminCount }) }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label"><span class="stat-icon stat-icon-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM3 10h18" /></svg></span>{{ t('admin.reports.kpiActiveWallets') }}</span>
        <span class="stat-tile-value">{{ activeWalletCount.toLocaleString() }}</span>
        <span class="stat-tile-meta">{{ t('admin.reports.kpiClosedWallets', { count: closedWalletCount }) }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label"><span class="stat-icon stat-icon-orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg></span>{{ t('admin.reports.kpiTransactions') }}</span>
        <span class="stat-tile-value">{{ transactions.length.toLocaleString() }}</span>
        <span class="stat-tile-meta">{{ t('admin.reports.kpiLast30', { count: txTotal30 }) }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label"><span class="stat-icon stat-icon-red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg></span>{{ t('admin.reports.kpiBlockedWallets') }}</span>
        <span class="stat-tile-value">{{ blockedWalletCount }}</span>
        <span v-if="hasInstallmentsAccess" class="stat-tile-meta">{{ t('admin.reports.kpiOverdueMeta', { count: overdueWallets.length }) }}</span>
      </div>
    </div>

    <div class="report-grid">
      <section class="admin-card">
        <div class="chart-head">
          <div>
            <h2>{{ t('admin.reports.activityHeading') }}</h2>
            <p class="admin-card-sub">{{ t('admin.reports.last30') }}</p>
          </div>
          <span class="chart-total">{{ txTotal30.toLocaleString() }}</span>
        </div>
        <TrendChart :data="transactionsPerDay" :labels="dayLabels" :unit="t('admin.dashboard.unitTx')" />
      </section>
      <section class="admin-card">
        <div class="chart-head">
          <div>
            <h2>{{ t('admin.reports.signupsHeading') }}</h2>
            <p class="admin-card-sub">{{ t('admin.reports.last30') }}</p>
          </div>
          <span class="chart-total">{{ signupTotal30.toLocaleString() }}</span>
        </div>
        <TrendChart :data="signupsPerDay" :labels="dayLabels" :unit="t('admin.dashboard.unitSignups')" />
      </section>
    </div>

    <section class="admin-card">
      <h2>{{ t('admin.reports.byCurrencyHeading') }}</h2>
      <div v-if="currencyStats.length" class="currency-cards">
        <div v-for="row in currencyStats" :key="row.code" class="currency-card">
          <div class="currency-top">
            <span class="currency-code">{{ row.code }}</span>
            <span class="currency-wallets">{{ t('admin.reports.walletsCount', { count: row.walletCount }) }}</span>
          </div>
          <span class="mini-label">{{ t('admin.reports.tableTotalBalance') }}</span>
          <span class="currency-main">{{ formatAmount(row.totalBalance.toString(), row.currency) }}</span>
          <span class="mini-label">{{ t('admin.reports.tableVolume') }}</span>
          <span class="currency-sub">{{ formatAmount(row.volume.toString(), row.currency) }}</span>
        </div>
      </div>
      <p v-else class="muted">{{ t('admin.reports.noData') }}</p>
    </section>

    <div class="report-grid">
      <section class="admin-card">
        <h2>{{ t('admin.reports.byTypeHeading') }}</h2>
        <BarList :rows="byType" :empty-label="t('admin.reports.noData')" />
      </section>
      <section class="admin-card">
        <h2>{{ t('admin.reports.byStatusHeading') }}</h2>
        <BarList :rows="byStatus" :empty-label="t('admin.reports.noData')" />
      </section>
      <section class="admin-card">
        <h2>{{ t('admin.reports.byWalletTypeHeading') }}</h2>
        <BarList :rows="byWalletType" :empty-label="t('admin.reports.noData')" />
      </section>
      <section v-if="hasInstallmentsAccess" class="admin-card">
        <h2>{{ t('admin.reports.installmentsByStatusHeading') }}</h2>
        <BarList :rows="installmentsByStatus" :empty-label="t('admin.reports.noData')" />
      </section>
    </div>

    <div class="report-grid">
      <section v-if="hasInstallmentsAccess" class="admin-card">
        <div class="admin-card-head">
          <h2>{{ t('admin.reports.creditLineHeading') }}</h2>
          <router-link :to="{ name: 'admin-installments' }" class="card-link">{{ t('admin.dashboard.viewAll') }} →</router-link>
        </div>
        <div v-for="row in creditLineHealth" :key="row.code" class="credit-row">
          <span class="currency-code">{{ row.code }}</span>
          <div class="credit-cells">
            <div>
              <span class="mini-label">{{ t('admin.reports.tableOutstandingAmount') }}</span>
              <span class="credit-value">{{ formatAmount(row.outstandingAmount.toString(), row.currency) }}</span>
              <span class="credit-sub">{{ t('admin.reports.installmentsCount', { count: row.outstandingCount }) }}</span>
            </div>
            <div>
              <span class="mini-label">{{ t('admin.reports.tableOverdueAmount') }}</span>
              <span class="credit-value" :class="{ danger: row.overdueAmount > 0n }">{{ formatAmount(row.overdueAmount.toString(), row.currency) }}</span>
              <span class="credit-sub">{{ t('admin.reports.blockedCount', { count: row.blockedCount }) }}</span>
            </div>
          </div>
        </div>
        <p v-if="!creditLineHealth.length" class="muted">{{ t('admin.reports.noData') }}</p>
      </section>

      <section v-if="hasSchedulerAccess" class="admin-card">
        <div class="admin-card-head">
          <h2>{{ t('admin.reports.schedulerHeading') }}</h2>
          <router-link :to="{ name: 'admin-scheduler-logs' }" class="card-link">{{ t('admin.dashboard.viewAll') }} →</router-link>
        </div>
        <div v-if="schedulerSuccessRate !== null" class="sched-summary">
          <span class="sched-rate">{{ schedulerSuccessRate }}%</span>
          <span class="sched-text">
            {{ t('admin.reports.schedulerSuccessRate', { rate: schedulerSuccessRate, count: schedulerLogs.length }) }}
            <span v-if="schedulerFailures" class="sched-fail">{{ t('admin.reports.failedRuns', { count: schedulerFailures }) }}</span>
          </span>
        </div>
        <ul class="sched-list">
          <li v-for="log in schedulerRecent" :key="log._id">
            <span class="outcome" :class="log.success ? 'ok' : 'bad'" :title="log.success ? t('admin.reports.outcomeSuccess') : t('admin.reports.outcomeFailure')">
              <svg v-if="log.success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17" /></svg>
            </span>
            <span class="sched-action">{{ schedulerActionLabel(log.action) }}</span>
            <span class="sched-time">{{ formatRelative(log.createdAt) }}</span>
          </li>
        </ul>
        <p v-if="!schedulerRecent.length" class="muted">{{ t('admin.reports.noData') }}</p>
      </section>
    </div>

    <section class="admin-card">
      <h2>{{ t('admin.reports.topCustomersHeading') }}</h2>
      <ol v-if="topCustomers.length" class="top-list">
        <li v-for="(row, i) in topCustomers" :key="row.id" class="top-row">
          <span class="rank">{{ i + 1 }}</span>
          <span class="avatar">{{ initials(row.email) }}</span>
          <span class="top-email">{{ row.email }}</span>
          <span class="top-bar"><span :style="{ width: `${row.pct}%` }" /></span>
          <span class="top-count">{{ t('admin.reports.touched', { count: row.count }) }}</span>
        </li>
      </ol>
      <p v-else class="muted">{{ t('admin.reports.noActivity') }}</p>
    </section>
  </AdminLayout>
</template>

<style scoped>
.report-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px;
}
.chart-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.chart-head h2 {
  margin: 0;
}
.chart-total {
  font-size: 1.5rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.muted {
  margin: 0;
  color: var(--text-dimmer);
  font-size: 0.86rem;
}
.mini-label {
  display: block;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dimmer);
}
.currency-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
}
.currency-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 16px 18px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--card-border);
  background: var(--panel-bg);
}
.currency-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.currency-code {
  font-weight: 700;
  font-size: 0.8rem;
  letter-spacing: 0.05em;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
}
.currency-wallets {
  font-size: 0.78rem;
  color: var(--text-dim);
}
.currency-main {
  font-size: 1.4rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-bottom: 8px;
}
.currency-sub {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
:deep(.inst-paid) { background: var(--accent-lime); }
:deep(.inst-pending) { background: var(--accent-orange); }
:deep(.inst-overdue) { background: var(--accent-red); }
:deep(.bar-dot.tx-type-deposit), :deep(.bar-dot.tx-status-completed) { background: var(--accent-lime); }
:deep(.bar-dot.tx-type-withdraw), :deep(.bar-dot.tx-status-reversed) { background: var(--accent-red); }
:deep(.bar-dot.tx-type-transfer), :deep(.bar-dot.tx-type-purchase) { background: var(--accent-blue); }
:deep(.bar-dot.tx-type-adjustment), :deep(.bar-dot.tx-status-pending) { background: var(--accent-orange); }
.credit-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--divider);
}
.credit-row:first-of-type {
  border-top: 0;
  padding-top: 0;
}
.credit-cells {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.credit-value {
  display: block;
  font-size: 1.1rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.credit-value.danger {
  color: var(--accent-red);
}
.credit-sub {
  font-size: 0.78rem;
  color: var(--text-dim);
}
.sched-summary {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  margin-bottom: 12px;
}
.sched-rate {
  font-size: 1.6rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.sched-text {
  display: flex;
  flex-direction: column;
  font-size: 0.82rem;
  color: var(--text-dim);
}
.sched-fail {
  color: var(--accent-red);
  font-weight: 600;
}
.sched-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.sched-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--divider);
  font-size: 0.86rem;
}
.sched-list li:first-child {
  border-top: 0;
}
.outcome {
  width: 20px;
  height: 20px;
  flex: none;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.outcome svg {
  width: 11px;
  height: 11px;
}
.outcome.ok { background: var(--badge-tint-lime); color: var(--accent-lime); }
.outcome.bad { background: var(--badge-tint-red); color: var(--accent-red); }
.sched-action {
  flex: 1;
}
.sched-time {
  color: var(--text-dimmer);
  font-size: 0.78rem;
  white-space: nowrap;
}
.top-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 28px;
}
.top-row {
  display: grid;
  grid-template-columns: 18px auto minmax(0, 1fr) 80px auto;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--divider);
  font-size: 0.86rem;
}
.rank {
  color: var(--text-dimmer);
  font-weight: 700;
  font-size: 0.78rem;
}
.top-row .avatar {
  width: 30px;
  height: 30px;
  font-size: 0.7rem;
}
.top-email {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}
.top-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--panel-bg);
  overflow: hidden;
}
.top-bar span {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--chart-1);
}
.top-count {
  font-size: 0.78rem;
  color: var(--text-dim);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 1024px) {
  .report-grid,
  .top-list {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
