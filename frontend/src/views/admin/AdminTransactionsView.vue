<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
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
import { groupTransactionClusters, type TransactionCluster } from '../../utils/txCluster';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import SortableTh from '../../components/admin/SortableTh.vue';
import ListPagination from '../../components/admin/ListPagination.vue';

const { t } = useI18n();
const router = useRouter();
const wallets = ref<AdminWallet[]>([]);
const transactions = ref<AdminTransaction[]>([]);
const error = ref('');
const typeFilter = ref('');

// See utils/txCluster.ts — a single customer action (e.g. a credit-wallet
// purchase) can post more than one raw ledger row. Off by default so the
// grid behaves exactly as before; toggling it on collapses each action's
// legs into one row with a "+N" badge, expandable to see the breakdown.
const groupRelated = ref(false);
const expandedClusters = ref(new Set<string>());
function toggleCluster(root: string) {
  const next = new Set(expandedClusters.value);
  if (next.has(root)) next.delete(root);
  else next.add(root);
  expandedClusters.value = next;
}

const walletsById = computed(() => walletLookup(wallets.value));

// Ungrouped: every transaction is its own singleton "cluster" so the table
// renders identically to before. Grouped: cluster over the full, unfiltered
// set first (a purchase and the funding leg it caused can have different
// types) then apply the type filter to each cluster's primary transaction.
const clusters = computed((): TransactionCluster<AdminTransaction>[] => {
  if (!groupRelated.value) {
    const source = typeFilter.value
      ? transactions.value.filter((tx) => tx.type === typeFilter.value)
      : transactions.value;
    return source.map((tx) => ({ root: tx.id, items: [tx], primary: tx }));
  }
  const allClusters = groupTransactionClusters(transactions.value);
  return typeFilter.value
    ? allClusters.filter((c) => c.primary.type === typeFilter.value)
    : allClusters;
});

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
} = useListControls(clusters, {
  searchFields: (c) => searchText(c.primary),
  sortAccessors: {
    type: (c) => c.primary.type,
    status: (c) => c.primary.status,
    amount: (c) => Number(c.primary.amount),
    date: (c) => new Date(c.primary.createdAt).getTime(),
  },
  defaultSort: { key: 'date', dir: 'desc' },
  pageSize: 25,
});

function onRowClick(cluster: TransactionCluster<AdminTransaction>) {
  if (groupRelated.value && cluster.items.length > 1) {
    toggleCluster(cluster.root);
    return;
  }
  router.push({ name: 'admin-transaction-detail', params: { id: cluster.primary.id } });
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
          <button
            type="button"
            class="admin-btn group-toggle-btn"
            :class="{ 'admin-btn-primary': groupRelated }"
            @click="groupRelated = !groupRelated"
          >
            {{ groupRelated ? t('admin.transactions.ungroupRelated') : t('admin.transactions.groupRelated') }}
          </button>
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
          <template v-for="cluster in pageItems" :key="cluster.root">
            <tr class="tx-row-clickable" @click="onRowClick(cluster)">
              <td>
                <span class="admin-badge" :class="transactionTypeClass(cluster.primary.type)">{{ t(`admin.transactions.${cluster.primary.type.toLowerCase()}`) }}</span>
                <span v-if="groupRelated && cluster.items.length > 1" class="tx-cluster-badge">+{{ cluster.items.length - 1 }}</span>
              </td>
              <td><span class="admin-badge" :class="transactionStatusClass(cluster.primary.status)">{{ t(`admin.transactions.status${cluster.primary.status}`) }}</span></td>
              <td>{{ formatTxAmount(cluster.primary) }}</td>
              <td>
                <div v-if="cluster.primary.fromWalletId" class="party-cell">
                  <router-link
                    class="party-label"
                    :to="{ name: 'admin-wallet-detail', params: { id: cluster.primary.fromWalletId } }"
                    @click.stop
                  >
                    {{ partyWalletLabel(cluster.primary.fromWalletId, walletsById) ?? t('common.unknown') }}
                  </router-link>
                  <span class="party-owner">{{ partyOwner(cluster.primary.fromWalletId, walletsById) ? displayIdentity(partyOwner(cluster.primary.fromWalletId, walletsById)!) : t('common.unknown') }}</span>
                  <span class="money-chip money-out">− {{ formatTxAmount(cluster.primary) }}</span>
                </div>
                <span v-else class="party-empty">{{ t('admin.transactions.externalSource') }}</span>
              </td>
              <td>
                <div v-if="cluster.primary.toWalletId" class="party-cell">
                  <router-link
                    class="party-label"
                    :to="{ name: 'admin-wallet-detail', params: { id: cluster.primary.toWalletId } }"
                    @click.stop
                  >
                    {{ partyWalletLabel(cluster.primary.toWalletId, walletsById) ?? t('common.unknown') }}
                  </router-link>
                  <span class="party-owner">{{ partyOwner(cluster.primary.toWalletId, walletsById) ? displayIdentity(partyOwner(cluster.primary.toWalletId, walletsById)!) : t('common.unknown') }}</span>
                  <span class="money-chip money-in">+ {{ formatTxAmount(cluster.primary) }}</span>
                </div>
                <span v-else class="party-empty">{{ t('admin.transactions.externalDestination') }}</span>
              </td>
              <td>{{ cluster.primary.note ?? t('common.none') }}</td>
              <td class="mono-id">{{ cluster.primary.id }}</td>
              <td>{{ formatDateTime(cluster.primary.createdAt) }}</td>
            </tr>
            <template v-if="groupRelated && cluster.items.length > 1 && expandedClusters.has(cluster.root)">
              <tr class="tx-breakdown-header-row">
                <td colspan="8">{{ t('admin.transactions.breakdownTitle') }}</td>
              </tr>
              <tr
                v-for="leg in cluster.items"
                :key="leg.id"
                class="tx-breakdown-row"
                @click="router.push({ name: 'admin-transaction-detail', params: { id: leg.id } })"
              >
                <td><span class="admin-badge" :class="transactionTypeClass(leg.type)">{{ t(`admin.transactions.${leg.type.toLowerCase()}`) }}</span></td>
                <td><span class="admin-badge" :class="transactionStatusClass(leg.status)">{{ t(`admin.transactions.status${leg.status}`) }}</span></td>
                <td>{{ formatTxAmount(leg) }}</td>
                <td>{{ leg.fromWalletId ? (partyWalletLabel(leg.fromWalletId, walletsById) ?? t('common.unknown')) : t('admin.transactions.externalSource') }}</td>
                <td>{{ leg.toWalletId ? (partyWalletLabel(leg.toWalletId, walletsById) ?? t('common.unknown')) : t('admin.transactions.externalDestination') }}</td>
                <td>{{ leg.note ?? t('common.none') }}</td>
                <td class="mono-id">{{ leg.id }}</td>
                <td>{{ formatDateTime(leg.createdAt) }}</td>
              </tr>
            </template>
          </template>
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
.group-toggle-btn {
  white-space: nowrap;
}
.tx-cluster-badge {
  display: inline-block;
  margin-inline-start: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  background: rgba(122, 162, 255, 0.16);
  color: var(--accent-blue);
}
.tx-breakdown-header-row td {
  padding-block: 6px 2px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-dim);
  border-bottom: none;
  background: var(--panel-bg);
}
.tx-breakdown-row {
  background: var(--panel-bg);
  cursor: pointer;
  font-size: 0.9rem;
}
.tx-breakdown-row td {
  border-bottom: none;
  color: var(--text);
}
.tx-breakdown-row td:first-child {
  padding-inline-start: 28px;
}
</style>
