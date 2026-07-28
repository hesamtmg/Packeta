<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { apiRequest, ApiError } from '../../api/client';
import { formatAmount } from '../../utils/currency';
import {
  walletLookup,
  transactionCurrency,
  type AdminWallet,
  type AdminTransaction,
} from '../../types/admin';
import AdminLayout from '../../components/admin/AdminLayout.vue';

const wallets = ref<AdminWallet[]>([]);
const transactions = ref<AdminTransaction[]>([]);
const error = ref('');
const typeFilter = ref('');

const walletsById = computed(() => walletLookup(wallets.value));

const filtered = computed(() =>
  typeFilter.value ? transactions.value.filter((t) => t.type === typeFilter.value) : transactions.value,
);

function formatTxAmount(tx: AdminTransaction): string {
  const currency = transactionCurrency(tx, walletsById.value);
  return currency ? formatAmount(tx.amount, currency) : tx.amount;
}

function walletLabel(walletId: string | null): string {
  if (!walletId) return '—';
  const w = walletsById.value.get(walletId);
  return w ? `${w.walletType.name} (${w.walletType.currency.code})` : 'Unknown';
}

function ownerEmail(walletId: string | null): string {
  if (!walletId) return '—';
  return walletsById.value.get(walletId)?.ownerEmail ?? '—';
}

async function load() {
  error.value = '';
  try {
    [wallets.value, transactions.value] = await Promise.all([
      apiRequest<AdminWallet[]>('/admin/wallets'),
      apiRequest<AdminTransaction[]>('/admin/transactions?limit=500'),
    ]);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Failed to load transactions';
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout title="Transactions">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <div class="admin-card">
      <div class="filter-row">
        <h2>All transactions ({{ filtered.length }})</h2>
        <select v-model="typeFilter" class="admin-input">
          <option value="">All types</option>
          <option value="DEPOSIT">Deposit</option>
          <option value="WITHDRAW">Withdraw</option>
          <option value="TRANSFER">Transfer</option>
          <option value="ADJUSTMENT">Adjustment</option>
        </select>
      </div>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Amount</th>
            <th>From</th>
            <th>To</th>
            <th>Note</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tx in filtered" :key="tx.id">
            <td><span class="admin-badge">{{ tx.type }}</span></td>
            <td>{{ formatTxAmount(tx) }}</td>
            <td>
              <span v-if="tx.fromWalletId">{{ walletLabel(tx.fromWalletId) }} · {{ ownerEmail(tx.fromWalletId) }}</span>
              <span v-else>—</span>
            </td>
            <td>
              <span v-if="tx.toWalletId">{{ walletLabel(tx.toWalletId) }} · {{ ownerEmail(tx.toWalletId) }}</span>
              <span v-else>—</span>
            </td>
            <td>{{ tx.note ?? '—' }}</td>
            <td>{{ new Date(tx.createdAt).toLocaleString() }}</td>
          </tr>
          <tr v-if="!filtered.length"><td colspan="6">No transactions found.</td></tr>
        </tbody>
      </table>
    </div>
  </AdminLayout>
</template>

<style scoped>
.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.filter-row h2 {
  margin: 0;
}
</style>
