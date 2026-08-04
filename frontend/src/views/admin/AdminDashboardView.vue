<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { formatAmount } from '../../utils/currency';
import { formatDate, formatDateTime } from '../../utils/date';
import { displayIdentity } from '../../utils/identity';
import {
  walletLookup,
  transactionCurrency,
  type AdminUser,
  type AdminWallet,
  type AdminTransaction,
} from '../../types/admin';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import MiniLineChart from '../../components/admin/MiniLineChart.vue';

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

const signupsPerDay = computed(() => {
  const days = 14;
  const buckets = new Array(days).fill(0);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  for (const u of users.value) {
    const diff = Math.floor((now.getTime() - new Date(u.createdAt).getTime()) / dayMs);
    const idx = days - 1 - diff;
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
});

const latestTransaction = computed(() => transactions.value[0] ?? null);

function formatTxAmount(tx: AdminTransaction): string {
  const currency = transactionCurrency(tx, walletsById.value);
  return currency ? formatAmount(tx.amount, currency) : tx.amount;
}

function walletLabel(walletId: string | null): string {
  if (!walletId) return t('common.none');
  const w = walletsById.value.get(walletId);
  return w ? `${w.walletType.name} (${w.walletType.currency.code})` : t('common.unknown');
}

function ownerEmail(tx: AdminTransaction): string {
  const w =
    (tx.fromWalletId && walletsById.value.get(tx.fromWalletId)) ||
    (tx.toWalletId && walletsById.value.get(tx.toWalletId));
  return w ? displayIdentity({ email: w.ownerEmail, phoneNumber: w.ownerPhoneNumber }) : t('common.none');
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

    <div class="admin-grid admin-grid-2">
      <div class="hero-card">
        <div class="hero-copy">
          <span class="hero-eyebrow">{{ t('dashboard.overviewEyebrow') }}</span>
          <h2>{{ t('admin.dashboard.overviewHeading') }}</h2>
          <p>
            {{ t('admin.dashboard.overviewSummary', { customers: customerCount, wallets: walletCount, transactions: transactionCount }) }}
          </p>
          <router-link :to="{ name: 'admin-reports' }" class="admin-btn admin-btn-primary">
            {{ t('admin.dashboard.viewReports') }}
          </router-link>
        </div>

        <div class="hero-pills">
          <div class="pill">
            <span class="pill-value">{{ customerCount }}</span>
            <span class="pill-label"><i class="dot dot-orange" />{{ t('admin.dashboard.customers') }}</span>
          </div>
          <div class="pill">
            <span class="pill-value">{{ walletCount }}</span>
            <span class="pill-label"><i class="dot dot-lime" />{{ t('admin.dashboard.wallets') }}</span>
          </div>
          <div class="pill">
            <span class="pill-value">{{ transactionCount }}</span>
            <span class="pill-label"><i class="dot dot-blue" />{{ t('admin.dashboard.transactions') }}</span>
          </div>
          <div class="pill">
            <span class="pill-value">{{ adminCount }}</span>
            <span class="pill-label"><i class="dot dot-red" />{{ t('admin.dashboard.admins') }}</span>
          </div>
        </div>
      </div>

      <div class="side-stack">
        <div class="admin-card">
          <h2>{{ t('admin.dashboard.signups') }}</h2>
          <MiniLineChart :data="signupsPerDay" color="#d8ff5c" :height="70" />
        </div>
        <div class="admin-card" v-if="latestTransaction">
          <h2>{{ t('admin.dashboard.latestTransaction') }}</h2>
          <div class="latest-amount">{{ formatTxAmount(latestTransaction) }}</div>
          <div class="latest-meta">
            {{ latestTransaction.type }} · {{ walletLabel(latestTransaction.toWalletId ?? latestTransaction.fromWalletId) }}
          </div>
          <div class="latest-meta">{{ formatDateTime(latestTransaction.createdAt) }}</div>
        </div>
      </div>
    </div>

    <div class="admin-card">
      <h2>{{ t('admin.dashboard.recentTransactions') }}</h2>
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t('admin.dashboard.tableType') }}</th>
            <th>{{ t('admin.dashboard.tableAmount') }}</th>
            <th>{{ t('admin.dashboard.tableWallet') }}</th>
            <th>{{ t('admin.dashboard.tableCustomer') }}</th>
            <th>{{ t('admin.dashboard.tableDate') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="tx in transactions.slice(0, 8)"
            :key="tx.id"
            class="tx-row-clickable"
            @click="$router.push({ name: 'admin-transaction-detail', params: { id: tx.id } })"
          >
            <td><span class="admin-badge">{{ tx.type }}</span></td>
            <td>{{ formatTxAmount(tx) }}</td>
            <td>{{ walletLabel(tx.toWalletId ?? tx.fromWalletId) }}</td>
            <td>{{ ownerEmail(tx) }}</td>
            <td>{{ formatDate(tx.createdAt) }}</td>
          </tr>
          <tr v-if="!transactions.length"><td colspan="5">{{ t('admin.dashboard.noTransactions') }}</td></tr>
        </tbody>
      </table>
    </div>
  </AdminLayout>
</template>

<style scoped>
.tx-row-clickable {
  cursor: pointer;
}
.hero-card {
  position: relative;
  border-radius: var(--radius-md);
  padding: 32px 28px 56px;
  background: linear-gradient(135deg, #3a2418 0%, #1e1c25 65%);
  overflow: visible;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 260px;
}

.hero-eyebrow {
  font-size: 0.78rem;
  color: var(--accent-orange-soft);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
}

.hero-copy h2 {
  font-size: 1.9rem;
  line-height: 1.2;
  margin: 10px 0 12px;
  max-width: 420px;
}

.hero-copy p {
  color: var(--text-dim);
  max-width: 440px;
  margin: 0 0 20px;
}

.hero-pills {
  position: absolute;
  left: 28px;
  right: 28px;
  bottom: -22px;
  display: flex;
  background: rgba(15, 13, 18, 0.85);
  backdrop-filter: blur(6px);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  gap: 28px;
}

.pill {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pill-value {
  font-size: 1.4rem;
  font-weight: 700;
}

.pill-label {
  font-size: 0.75rem;
  color: var(--text-dim);
  display: flex;
  align-items: center;
  gap: 6px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.dot-orange { background: var(--accent-orange); }
.dot-lime { background: var(--accent-lime); }
.dot-blue { background: var(--accent-blue); }
.dot-red { background: var(--accent-red); }

.side-stack {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.latest-amount {
  font-size: 1.8rem;
  font-weight: 700;
}

.latest-meta {
  color: var(--text-dim);
  font-size: 0.82rem;
  margin-top: 4px;
}
</style>
