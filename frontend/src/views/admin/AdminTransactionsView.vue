<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { formatAmount } from '../../utils/currency';
import { formatDateTime } from '../../utils/date';
import { displayIdentity } from '../../utils/identity';
import {
  walletLookup,
  transactionCurrency,
  partyWalletLabel,
  partyOwner,
  transactionTypeClass,
  transactionStatusClass,
  type AdminWallet,
  type AdminTransaction,
} from '../../types/admin';
import { useListControls } from '../../composables/useListControls';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import SortableTh from '../../components/admin/SortableTh.vue';
import ListPagination from '../../components/admin/ListPagination.vue';

const { t } = useI18n();
const wallets = ref<AdminWallet[]>([]);
const transactions = ref<AdminTransaction[]>([]);
const error = ref('');
const typeFilter = ref('');

const walletsById = computed(() => walletLookup(wallets.value));

const byType = computed(() =>
  typeFilter.value ? transactions.value.filter((tx) => tx.type === typeFilter.value) : transactions.value,
);

function formatTxAmount(tx: AdminTransaction): string {
  const currency = transactionCurrency(tx, walletsById.value);
  return currency ? formatAmount(tx.amount, currency) : tx.amount;
}

function searchText(tx: AdminTransaction): (string | null)[] {
  const from = partyOwner(tx.fromWalletId, walletsById.value);
  const to = partyOwner(tx.toWalletId, walletsById.value);
  return [
    tx.type,
    tx.status,
    tx.note,
    from ? displayIdentity(from) : null,
    to ? displayIdentity(to) : null,
  ];
}

const {
  search,
  sortKey,
  sortDir,
  pageItems,
  sorted,
  page,
  pageSize,
  totalPages,
  toggleSort,
  goToPage,
} = useListControls(byType, {
  searchFields: searchText,
  sortAccessors: {
    type: (tx) => tx.type,
    status: (tx) => tx.status,
    amount: (tx) => Number(tx.amount),
    date: (tx) => new Date(tx.createdAt).getTime(),
  },
  defaultSort: { key: 'date', dir: 'desc' },
  pageSize: 25,
});

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
        <h2>{{ t('admin.transactions.allTransactions', { count: sorted.length }) }}</h2>
        <div class="list-controls-row">
          <input v-model="search" class="admin-input" :placeholder="t('admin.transactions.searchPlaceholder')" />
          <select v-model="typeFilter" class="admin-input">
            <option value="">{{ t('admin.transactions.allTypes') }}</option>
            <option value="DEPOSIT">{{ t('admin.transactions.deposit') }}</option>
            <option value="WITHDRAW">{{ t('admin.transactions.withdraw') }}</option>
            <option value="TRANSFER">{{ t('admin.transactions.transfer') }}</option>
            <option value="PURCHASE">{{ t('admin.transactions.purchase') }}</option>
            <option value="ADJUSTMENT">{{ t('admin.transactions.adjustment') }}</option>
            <option value="VIRTUAL">{{ t('admin.transactions.virtual') }}</option>
          </select>
        </div>
      </div>
      <div class="table-scroll">
      <table class="admin-table">
        <thead>
          <tr>
            <SortableTh :label="t('admin.transactions.tableType')" col-key="type" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
            <SortableTh :label="t('admin.transactions.tableStatus')" col-key="status" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
            <SortableTh :label="t('admin.transactions.tableAmount')" col-key="amount" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
            <th>{{ t('admin.transactions.tableFrom') }}</th>
            <th>{{ t('admin.transactions.tableTo') }}</th>
            <th>{{ t('admin.transactions.tableNote') }}</th>
            <th>{{ t('admin.transactions.tableId') }}</th>
            <SortableTh :label="t('admin.transactions.tableDate')" col-key="date" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="tx in pageItems"
            :key="tx.id"
            class="tx-row-clickable"
            @click="$router.push({ name: 'admin-transaction-detail', params: { id: tx.id } })"
          >
            <td><span class="admin-badge" :class="transactionTypeClass(tx.type)">{{ t(`admin.transactions.${tx.type.toLowerCase()}`) }}</span></td>
            <td><span class="admin-badge" :class="transactionStatusClass(tx.status)">{{ t(`admin.transactions.status${tx.status}`) }}</span></td>
            <td>{{ formatTxAmount(tx) }}</td>
            <td>
              <div v-if="tx.fromWalletId" class="party-cell">
                <router-link
                  class="party-label"
                  :to="{ name: 'admin-wallet-detail', params: { id: tx.fromWalletId } }"
                  @click.stop
                >
                  {{ partyWalletLabel(tx.fromWalletId, walletsById) ?? t('common.unknown') }}
                </router-link>
                <span class="party-owner">{{ partyOwner(tx.fromWalletId, walletsById) ? displayIdentity(partyOwner(tx.fromWalletId, walletsById)!) : t('common.unknown') }}</span>
                <span class="money-chip money-out">− {{ formatTxAmount(tx) }}</span>
              </div>
              <span v-else class="party-empty">{{ t('admin.transactions.externalSource') }}</span>
            </td>
            <td>
              <div v-if="tx.toWalletId" class="party-cell">
                <router-link
                  class="party-label"
                  :to="{ name: 'admin-wallet-detail', params: { id: tx.toWalletId } }"
                  @click.stop
                >
                  {{ partyWalletLabel(tx.toWalletId, walletsById) ?? t('common.unknown') }}
                </router-link>
                <span class="party-owner">{{ partyOwner(tx.toWalletId, walletsById) ? displayIdentity(partyOwner(tx.toWalletId, walletsById)!) : t('common.unknown') }}</span>
                <span class="money-chip money-in">+ {{ formatTxAmount(tx) }}</span>
              </div>
              <span v-else class="party-empty">{{ t('admin.transactions.externalDestination') }}</span>
            </td>
            <td>{{ tx.note ?? t('common.none') }}</td>
            <td class="mono-id">{{ tx.id }}</td>
            <td>{{ formatDateTime(tx.createdAt) }}</td>
          </tr>
          <tr v-if="!pageItems.length"><td colspan="8">{{ t('admin.transactions.noTransactions') }}</td></tr>
        </tbody>
      </table>
      </div>
      <ListPagination
        :page="page"
        :total-pages="totalPages"
        :total="sorted.length"
        :page-size="pageSize"
        @update:page="goToPage"
        @update:page-size="pageSize = $event"
      />
    </div>
  </AdminLayout>
</template>

<style scoped>
.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 12px;
  flex-wrap: wrap;
}
.filter-row h2 {
  margin: 0;
  white-space: nowrap;
}
.tx-row-clickable {
  cursor: pointer;
}
</style>
