<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { apiRequest, ApiError } from '../../api/client';
import { walletLookup, type AdminWallet, type AdminTransaction } from '../../types/admin';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import MiniLineChart from '../../components/admin/MiniLineChart.vue';

const wallets = ref<AdminWallet[]>([]);
const transactions = ref<AdminTransaction[]>([]);
const error = ref('');

const walletsById = computed(() => walletLookup(wallets.value));

const transactionsPerDay = computed(() => {
  const days = 30;
  const buckets = new Array(days).fill(0);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  for (const tx of transactions.value) {
    const diff = Math.floor((now.getTime() - new Date(tx.createdAt).getTime()) / dayMs);
    const idx = days - 1 - diff;
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
});

const byType = computed(() => {
  const counts = new Map<string, number>();
  for (const tx of transactions.value) {
    counts.set(tx.type, (counts.get(tx.type) ?? 0) + 1);
  }
  const max = Math.max(1, ...counts.values());
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count, pct: Math.round((count / max) * 100) }));
});

const byWalletType = computed(() => {
  const counts = new Map<string, number>();
  for (const w of wallets.value) {
    const key = `${w.walletType.name} (${w.walletType.currency.code})`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const max = Math.max(1, ...counts.values());
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, pct: Math.round((count / max) * 100) }));
});

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
    [wallets.value, transactions.value] = await Promise.all([
      apiRequest<AdminWallet[]>('/admin/wallets'),
      apiRequest<AdminTransaction[]>('/admin/transactions?limit=1000'),
    ]);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Failed to load reports';
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout title="Reports">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <div class="admin-card">
      <h2>Transaction activity (30 days)</h2>
      <MiniLineChart :data="transactionsPerDay" color="#ff7a45" :height="120" />
    </div>

    <div class="admin-grid admin-grid-2">
      <div class="admin-card">
        <h2>By transaction type</h2>
        <div class="bar-list">
          <div v-for="row in byType" :key="row.type" class="bar-row">
            <span class="bar-label">{{ row.type }}</span>
            <div class="bar-track"><div class="bar-fill" :style="{ width: row.pct + '%' }" /></div>
            <span class="bar-count">{{ row.count }}</span>
          </div>
          <p v-if="!byType.length" class="empty">No data yet.</p>
        </div>
      </div>

      <div class="admin-card">
        <h2>By wallet type</h2>
        <div class="bar-list">
          <div v-for="row in byWalletType" :key="row.label" class="bar-row">
            <span class="bar-label">{{ row.label }}</span>
            <div class="bar-track"><div class="bar-fill bar-fill-lime" :style="{ width: row.pct + '%' }" /></div>
            <span class="bar-count">{{ row.count }}</span>
          </div>
          <p v-if="!byWalletType.length" class="empty">No data yet.</p>
        </div>
      </div>
    </div>

    <div class="admin-card">
      <h2>Most active customers</h2>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Transactions touched</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in topCustomers" :key="row.email">
            <td>{{ row.email }}</td>
            <td>{{ row.count }}</td>
          </tr>
          <tr v-if="!topCustomers.length"><td colspan="2">No activity yet.</td></tr>
        </tbody>
      </table>
    </div>
  </AdminLayout>
</template>

<style scoped>
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
.bar-count {
  text-align: right;
  color: var(--text-dim);
}
.empty {
  color: var(--text-dimmer);
  font-size: 0.85rem;
}
</style>
