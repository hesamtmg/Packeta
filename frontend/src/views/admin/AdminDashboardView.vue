<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { formatAmount } from '../../utils/currency';
import { displayIdentity } from '../../utils/identity';
import {
  walletLookup,
  transactionCurrency,
  transactionTypeClass,
  type AdminUser,
  type AdminWallet,
  type AdminTransaction,
} from '../../types/admin';
import { walletDisplayName } from '../../utils/wallet-name';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import TrendChart from '../../components/admin/TrendChart.vue';
import { formatRelative, lastDayLabels, perDayBuckets, TX_TYPE_ICONS } from '../../utils/adminFormat';

const { t } = useI18n();
const users = ref<AdminUser[]>([]);
const wallets = ref<AdminWallet[]>([]);
const transactions = ref<AdminTransaction[]>([]);
const error = ref('');

const walletsById = computed(() => walletLookup(wallets.value));

const customerCount = computed(() => users.value.filter((u) => u.role === 'USER').length);
const adminCount = computed(
  () => users.value.filter((u) => u.role === 'ADMIN' || u.role === 'SUPER_ADMIN').length,
);
const walletCount = computed(() => wallets.value.length);
const transactionCount = computed(() => transactions.value.length);

const DAYS = 14;
const dayLabels = computed(() => lastDayLabels(DAYS));
const signupsPerDay = computed(() => perDayBuckets(users.value.map((u) => u.createdAt), DAYS));
const txPerDay = computed(() => perDayBuckets(transactions.value.map((tx) => tx.createdAt), DAYS));
const newSignups = computed(() => signupsPerDay.value.reduce((a, b) => a + b, 0));
const txToday = computed(() => txPerDay.value[DAYS - 1]);
const blockedWallets = computed(() => wallets.value.filter((w) => w.blockedAt && !w.closedAt).length);
const closedWallets = computed(() => wallets.value.filter((w) => w.closedAt).length);
const pendingTx = computed(() => transactions.value.filter((tx) => tx.status === 'PENDING').length);

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 12) return t('admin.dashboard.greetingMorning');
  if (h < 18) return t('admin.dashboard.greetingAfternoon');
  return t('admin.dashboard.greetingEvening');
});

const attention = computed(() =>
  [
    { key: 'pending', count: pendingTx.value, label: t('admin.dashboard.attnPending'), to: { name: 'admin-transactions' }, tone: 'orange' },
    { key: 'blocked', count: blockedWallets.value, label: t('admin.dashboard.attnBlocked'), to: { name: 'admin-wallets' }, tone: 'red' },
    { key: 'closed', count: closedWallets.value, label: t('admin.dashboard.attnClosed'), to: { name: 'admin-wallets' }, tone: 'blue' },
  ],
);

function formatTxAmount(tx: AdminTransaction): string {
  const currency = transactionCurrency(tx, walletsById.value);
  return currency ? formatAmount(tx.amount, currency) : tx.amount;
}

function walletLabel(walletId: string | null): string {
  if (!walletId) return t('admin.transactions.external');
  const w = walletsById.value.get(walletId);
  return w ? walletDisplayName(w) : t('common.unknown');
}

function ownerOf(tx: AdminTransaction): string {
  const w =
    (tx.fromWalletId && walletsById.value.get(tx.fromWalletId)) ||
    (tx.toWalletId && walletsById.value.get(tx.toWalletId));
  return w ? displayIdentity({ email: w.ownerEmail, phoneNumber: w.ownerPhoneNumber }) : '';
}

async function load() {
  error.value = '';
  try {
    [users.value, wallets.value, transactions.value] = await Promise.all([
      apiRequest<AdminUser[]>('/admin/users'),
      apiRequest<AdminWallet[]>('/admin/wallets'),
      apiRequest<AdminTransaction[]>('/admin/transactions?limit=300'),
    ]);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.dashboard.loadFailed');
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.dashboard.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <section class="welcome">
      <div class="welcome-copy">
        <span class="welcome-eyebrow">{{ greeting }}</span>
        <h2>{{ t('admin.dashboard.overviewHeading') }}</h2>
        <p>{{ t('admin.dashboard.overviewSummary', { customers: customerCount, wallets: walletCount, transactions: transactionCount }) }}</p>
      </div>
      <div class="welcome-actions">
        <router-link :to="{ name: 'admin-reports' }" class="admin-btn welcome-btn-primary">{{ t('admin.dashboard.viewReports') }}</router-link>
        <router-link :to="{ name: 'admin-live-activity' }" class="admin-btn welcome-btn-ghost">
          <span class="live-dot" />{{ t('admin.dashboard.liveActivity') }}
        </router-link>
      </div>
    </section>

    <div class="stat-tiles">
      <router-link :to="{ name: 'admin-customers' }" class="stat-tile tile-link">
        <span class="stat-tile-label"><span class="stat-icon stat-icon-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" /></svg></span>{{ t('admin.dashboard.customers') }}</span>
        <span class="stat-tile-value">{{ customerCount.toLocaleString() }}</span>
        <span class="stat-tile-meta">{{ t('admin.dashboard.newThisPeriod', { count: newSignups }) }}</span>
      </router-link>
      <router-link :to="{ name: 'admin-wallets' }" class="stat-tile tile-link">
        <span class="stat-tile-label"><span class="stat-icon stat-icon-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM3 10h18M15 15h4" /></svg></span>{{ t('admin.dashboard.wallets') }}</span>
        <span class="stat-tile-value">{{ walletCount.toLocaleString() }}</span>
        <span class="stat-tile-meta">{{ t('admin.dashboard.walletsMeta', { blocked: blockedWallets, closed: closedWallets }) }}</span>
      </router-link>
      <router-link :to="{ name: 'admin-transactions' }" class="stat-tile tile-link">
        <span class="stat-tile-label"><span class="stat-icon stat-icon-orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg></span>{{ t('admin.dashboard.transactions') }}</span>
        <span class="stat-tile-value">{{ transactionCount.toLocaleString() }}</span>
        <span class="stat-tile-meta">{{ t('admin.dashboard.todayCount', { count: txToday }) }}</span>
      </router-link>
      <router-link :to="{ name: 'admin-admins' }" class="stat-tile tile-link">
        <span class="stat-tile-label"><span class="stat-icon stat-icon-red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z" /></svg></span>{{ t('admin.dashboard.admins') }}</span>
        <span class="stat-tile-value">{{ adminCount }}</span>
        <span class="stat-tile-meta">{{ t('admin.dashboard.adminsMeta') }}</span>
      </router-link>
    </div>

    <div class="dash-grid">
      <section class="admin-card">
        <div class="admin-card-head">
          <div>
            <h2>{{ t('admin.dashboard.activityHeading') }}</h2>
            <p class="admin-card-sub">{{ t('admin.dashboard.last14') }}</p>
          </div>
        </div>
        <TrendChart :data="txPerDay" :labels="dayLabels" :unit="t('admin.dashboard.unitTx')" :height="330" />
      </section>

      <div class="side-col">
        <section class="admin-card">
          <h2>{{ t('admin.dashboard.attentionHeading') }}</h2>
          <ul class="attn-list">
            <li v-for="item in attention" :key="item.key">
              <router-link :to="item.to" class="attn-row">
                <span class="attn-count" :class="item.count ? `tone-${item.tone}` : 'tone-none'">{{ item.count }}</span>
                <span class="attn-label">{{ item.label }}</span>
                <svg class="attn-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </router-link>
            </li>
          </ul>
        </section>
        <section class="admin-card">
          <div class="signups-head">
            <h2>{{ t('admin.dashboard.signups') }}</h2>
            <span class="signups-total">{{ newSignups }}</span>
          </div>
          <TrendChart :data="signupsPerDay" :labels="dayLabels" :unit="t('admin.dashboard.unitSignups')" :height="110" />
        </section>
      </div>
    </div>

    <section class="admin-card">
      <div class="admin-card-head">
        <h2>{{ t('admin.dashboard.recentTransactions') }}</h2>
        <router-link :to="{ name: 'admin-transactions' }" class="card-link">{{ t('admin.dashboard.viewAll') }} →</router-link>
      </div>
      <ul v-if="transactions.length" class="recent">
        <li v-for="tx in transactions.slice(0, 8)" :key="tx.id">
          <router-link :to="{ name: 'admin-transaction-detail', params: { id: tx.id } }" class="recent-row">
            <span class="type-icon" :class="transactionTypeClass(tx.type)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="TX_TYPE_ICONS[tx.type]" /></svg>
            </span>
            <span class="recent-main">
              <span class="recent-title">{{ t(`admin.transactions.${tx.type.toLowerCase()}`) }} · {{ walletLabel(tx.fromWalletId) }} → {{ walletLabel(tx.toWalletId) }}</span>
              <span class="recent-sub">{{ ownerOf(tx) }}</span>
            </span>
            <span class="recent-amount" :class="{ 'amt-in': tx.type === 'DEPOSIT', 'amt-out': tx.type === 'WITHDRAW' }">
              {{ tx.type === 'DEPOSIT' ? '+ ' : tx.type === 'WITHDRAW' ? '− ' : '' }}{{ formatTxAmount(tx) }}
            </span>
            <span class="recent-time">{{ formatRelative(tx.createdAt) }}</span>
          </router-link>
        </li>
      </ul>
      <div v-else class="empty-state">{{ t('admin.dashboard.noTransactions') }}</div>
    </section>
  </AdminLayout>
</template>

<style scoped>
.welcome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  padding: 26px 28px;
  border-radius: var(--radius-lg);
  background: var(--hero-gradient);
  color: #fff;
  box-shadow: var(--shadow-card);
  position: relative;
  overflow: hidden;
}
.welcome::after {
  content: '';
  position: absolute;
  inset-inline-end: -60px;
  top: -80px;
  width: 280px;
  height: 280px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.18), transparent 70%);
  pointer-events: none;
}
.welcome-copy {
  max-width: 620px;
  position: relative;
}
.welcome-eyebrow {
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  opacity: 0.85;
}
.welcome h2 {
  margin: 4px 0 6px;
  font-size: 1.45rem;
  letter-spacing: -0.015em;
}
.welcome p {
  margin: 0;
  font-size: 0.9rem;
  opacity: 0.88;
}
.welcome-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  position: relative;
}
.welcome-btn-primary {
  background: #fff;
  color: #1a3fa8;
}
.welcome-btn-primary:hover {
  background: rgba(255, 255, 255, 0.9);
}
.welcome-btn-ghost {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.3);
}
.welcome-btn-ghost:hover {
  background: rgba(255, 255, 255, 0.2);
}
.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.3);
}
.tile-link {
  color: inherit;
  text-decoration: none;
  transition: border-color 0.15s, transform 0.15s;
}
.tile-link:hover {
  border-color: color-mix(in srgb, var(--accent-blue) 40%, var(--card-border));
  transform: translateY(-1px);
}
.dash-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 22px;
}
.side-col {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.attn-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.attn-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  margin: 0 -10px;
  border-radius: var(--radius-sm);
  color: inherit;
  text-decoration: none;
}
.attn-row:hover {
  background: var(--hover-tint);
}
.attn-count {
  min-width: 34px;
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.tone-orange { background: var(--badge-tint-orange); color: var(--accent-orange); }
.tone-red { background: var(--badge-tint-red); color: var(--accent-red); }
.tone-blue { background: var(--badge-tint-blue); color: var(--accent-blue); }
.tone-none { background: var(--panel-bg); color: var(--text-dimmer); }
.attn-label {
  flex: 1;
  font-size: 0.88rem;
  font-weight: 500;
}
.attn-chev {
  width: 16px;
  height: 16px;
  color: var(--text-dimmer);
}
[dir='rtl'] .attn-chev {
  transform: scaleX(-1);
}
.signups-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}
.signups-head h2 {
  margin: 0;
}
.signups-total {
  font-size: 1.3rem;
  font-weight: 700;
}
.recent {
  list-style: none;
  margin: 0;
  padding: 0;
}
.recent li + li {
  border-top: 1px solid var(--divider);
}
.recent-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto 90px;
  align-items: center;
  gap: 14px;
  padding: 11px 8px;
  margin: 0 -8px;
  border-radius: var(--radius-sm);
  color: inherit;
  text-decoration: none;
}
.recent-row:hover {
  background: var(--hover-tint);
}
.recent-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.recent-title {
  font-size: 0.88rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.recent-sub {
  font-size: 0.76rem;
  color: var(--text-dimmer);
}
.recent-amount {
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.amt-in { color: var(--accent-lime); }
.amt-out { color: var(--accent-red); }
.recent-time {
  font-size: 0.78rem;
  color: var(--text-dimmer);
  text-align: end;
  white-space: nowrap;
}
@media (max-width: 1024px) {
  .dash-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 640px) {
  .recent-row {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
  .recent-time {
    display: none;
  }
}
</style>
