<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { formatAmount } from '../../utils/currency';
import { displayIdentity } from '../../utils/identity';
import {
  walletLookup,
  transactionCurrency,
  type AdminWallet,
  type AdminTransaction,
} from '../../types/admin';
import AdminLayout from '../../components/admin/AdminLayout.vue';

const { t } = useI18n();
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
  if (!walletId) return t('common.none');
  const w = walletsById.value.get(walletId);
  return w ? `${w.walletType.name} (${w.walletType.currency.code})` : t('common.unknown');
}

function ownerEmail(walletId: string | null): string {
  if (!walletId) return t('common.none');
  const w = walletsById.value.get(walletId);
  return w ? displayIdentity({ email: w.ownerEmail, phoneNumber: w.ownerPhoneNumber }) : t('common.none');
}

async function load() {
  error.value = '';
  try {
    [wallets.value, transactions.value] = await Promise.all([
      apiRequest<AdminWallet[]>('/admin/wallets'),
      apiRequest<AdminTransaction[]>('/admin/transactions?limit=500'),
    ]);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.transactions.loadFailed');
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.transactions.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <div class="admin-card">
      <div class="filter-row">
        <h2>{{ t('admin.transactions.allTransactions', { count: filtered.length }) }}</h2>
        <select v-model="typeFilter" class="admin-input">
          <option value="">{{ t('admin.transactions.allTypes') }}</option>
          <option value="DEPOSIT">{{ t('admin.transactions.deposit') }}</option>
          <option value="WITHDRAW">{{ t('admin.transactions.withdraw') }}</option>
          <option value="TRANSFER">{{ t('admin.transactions.transfer') }}</option>
          <option value="ADJUSTMENT">{{ t('admin.transactions.adjustment') }}</option>
        </select>
      </div>
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t('admin.transactions.tableType') }}</th>
            <th>{{ t('admin.transactions.tableAmount') }}</th>
            <th>{{ t('admin.transactions.tableFrom') }}</th>
            <th>{{ t('admin.transactions.tableTo') }}</th>
            <th>{{ t('admin.transactions.tableNote') }}</th>
            <th>{{ t('admin.transactions.tableDate') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="tx in filtered"
            :key="tx.id"
            class="tx-row-clickable"
            @click="$router.push({ name: 'admin-transaction-detail', params: { id: tx.id } })"
          >
            <td><span class="admin-badge">{{ tx.type }}</span></td>
            <td>{{ formatTxAmount(tx) }}</td>
            <td>
              <span v-if="tx.fromWalletId">{{ walletLabel(tx.fromWalletId) }} · {{ ownerEmail(tx.fromWalletId) }}</span>
              <span v-else>{{ t('common.none') }}</span>
            </td>
            <td>
              <span v-if="tx.toWalletId">{{ walletLabel(tx.toWalletId) }} · {{ ownerEmail(tx.toWalletId) }}</span>
              <span v-else>{{ t('common.none') }}</span>
            </td>
            <td>{{ tx.note ?? t('common.none') }}</td>
            <td>{{ new Date(tx.createdAt).toLocaleString() }}</td>
          </tr>
          <tr v-if="!filtered.length"><td colspan="6">{{ t('admin.transactions.noTransactions') }}</td></tr>
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
.tx-row-clickable {
  cursor: pointer;
}
</style>
