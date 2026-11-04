<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { apiRequest, ApiError } from '../../api/client';
import { formatAmount, type CurrencyInfo } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { i18n } from '../../i18n';
import { displayIdentity } from '../../utils/identity';
import { walletDisplayName } from '../../utils/wallet-name';
import {
  walletLookup,
  transactionCurrency,
  transactionTypeClass,
  transactionStatusClass,
  type AdminWallet,
  type AdminTransaction,
  type AdminTransactionType,
  type AdminTransactionStatus,
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
const loaded = ref(false);
const error = ref('');

const TX_LIMIT = 500;
const TYPES: AdminTransactionType[] = ['DEPOSIT', 'WITHDRAW', 'TRANSFER', 'PURCHASE', 'ADJUSTMENT', 'VIRTUAL'];
const STATUSES: AdminTransactionStatus[] = ['COMPLETED', 'PENDING', 'REVERSED'];

const typeFilter = ref<AdminTransactionType | ''>('');
const statusFilter = ref<AdminTransactionStatus | ''>('');

// See utils/txCluster.ts — a single customer action (e.g. a credit-wallet
// purchase) can post more than one raw ledger row. Off by default; when on,
// each action's legs collapse into one row, expandable to see the breakdown.
const groupRelated = ref(false);
const expandedClusters = ref(new Set<string>());
function toggleCluster(root: string) {
  const next = new Set(expandedClusters.value);
  if (next.has(root)) next.delete(root);
  else next.add(root);
  expandedClusters.value = next;
}

const walletsById = computed(() => walletLookup(wallets.value));

const matchesFilters = (tx: AdminTransaction) =>
  (!typeFilter.value || tx.type === typeFilter.value) &&
  (!statusFilter.value || tx.status === statusFilter.value);

// Ungrouped: every transaction is its own singleton cluster. Grouped: cluster
// over the full, unfiltered set first (a purchase and the funding leg it
// caused can have different types), then filter on each cluster's primary.
const clusters = computed((): TransactionCluster<AdminTransaction>[] => {
  if (!groupRelated.value) {
    return transactions.value
      .filter(matchesFilters)
      .map((tx) => ({ root: tx.id, items: [tx], primary: tx }));
  }
  return groupTransactionClusters(transactions.value).filter((c) => matchesFilters(c.primary));
});

const typeCounts = computed(() => {
  const counts: Record<string, number> = {};
  for (const tx of transactions.value) {
    if (statusFilter.value && tx.status !== statusFilter.value) continue;
    counts[tx.type] = (counts[tx.type] ?? 0) + 1;
  }
  return counts;
});

// ---- Summary tiles ----------------------------------------------------------
const pendingCount = computed(() => transactions.value.filter((tx) => tx.status === 'PENDING').length);
const reversedCount = computed(() => transactions.value.filter((tx) => tx.status === 'REVERSED').length);
// Completed volume per currency — VIRTUAL rows only move a credit ceiling, not
// money, so they're left out.
const volumeByCurrency = computed(() => {
  const totals = new Map<string, { currency: CurrencyInfo; total: bigint }>();
  for (const tx of transactions.value) {
    if (tx.status !== 'COMPLETED' || tx.type === 'VIRTUAL') continue;
    const currency = transactionCurrency(tx, walletsById.value);
    if (!currency) continue;
    const entry = totals.get(currency.code) ?? { currency, total: 0n };
    entry.total += BigInt(tx.amount);
    totals.set(currency.code, entry);
  }
  return [...totals.values()].map((e) => formatAmount(e.total.toString(), e.currency));
});

// ---- Row helpers -------------------------------------------------------------
function formatTxAmount(tx: AdminTransaction): string {
  const currency = transactionCurrency(tx, walletsById.value);
  return currency ? formatAmount(tx.amount, currency) : tx.amount;
}

function amountSign(tx: AdminTransaction): '+' | '−' | '' {
  if (tx.type === 'DEPOSIT') return '+';
  if (tx.type === 'WITHDRAW') return '−';
  return '';
}

function party(walletId: string | null) {
  if (!walletId) return null;
  const w = walletsById.value.get(walletId);
  if (!w) return { id: walletId, label: t('common.unknown'), owner: '', currency: '' };
  return {
    id: walletId,
    label: walletDisplayName(w),
    owner: displayIdentity({ email: w.ownerEmail, phoneNumber: w.ownerPhoneNumber }),
    currency: w.walletType.currency.code,
  };
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatTime(value: string): string {
  const locale = (i18n.global.locale as unknown as { value: string }).value === 'fa' ? 'fa-IR' : 'en-US';
  return new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function dayKey(value: string): string {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(value: string): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(value) === dayKey(now.toISOString())) return t('admin.transactions.today');
  if (dayKey(value) === dayKey(yesterday.toISOString())) return t('admin.transactions.yesterday');
  return formatDate(value);
}

const TYPE_ICONS: Record<AdminTransactionType, string> = {
  DEPOSIT: 'M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14',
  WITHDRAW: 'M12 20V9m0 0l-4.5 4.5M12 9l4.5 4.5M5 4h14',
  TRANSFER: 'M4 8h13m0 0l-3.5-3.5M17 8l-3.5 3.5M20 16H7m0 0l3.5-3.5M7 16l3.5 3.5',
  PURCHASE: 'M5.5 8h13l-1 12h-11l-1-12zM9 8V7a3 3 0 016 0v1',
  ADJUSTMENT: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  VIRTUAL: 'M12 3v5M12 16v5M3 12h5M16 12h5M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5',
};

const copiedId = ref<string | null>(null);
async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id);
    copiedId.value = id;
    setTimeout(() => {
      if (copiedId.value === id) copiedId.value = null;
    }, 1400);
  } catch {
    /* clipboard unavailable — the full id is still in the tooltip */
  }
}

function searchText(tx: AdminTransaction): (string | null)[] {
  const from = party(tx.fromWalletId);
  const to = party(tx.toWalletId);
  return [tx.id, tx.type, tx.status, tx.note, from?.label ?? null, from?.owner ?? null, to?.label ?? null, to?.owner ?? null];
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
  searchFields: (c) => c.items.flatMap(searchText),
  sortAccessors: {
    type: (c) => c.primary.type,
    status: (c) => c.primary.status,
    amount: (c) => Number(c.primary.amount),
    date: (c) => new Date(c.primary.createdAt).getTime(),
  },
  defaultSort: { key: 'date', dir: 'desc' },
  pageSize: 25,
});

watch([typeFilter, statusFilter, groupRelated], () => goToPage(1));

const hasFilters = computed(() => !!(typeFilter.value || statusFilter.value || search.value));
function clearFilters() {
  typeFilter.value = '';
  statusFilter.value = '';
  search.value = '';
}

// Day separators only make sense while the list is in date order.
function showDayHeader(index: number): boolean {
  if (sortKey.value !== 'date') return false;
  if (index === 0) return true;
  return dayKey(pageItems.value[index].primary.createdAt) !== dayKey(pageItems.value[index - 1].primary.createdAt);
}

function onRowClick(cluster: TransactionCluster<AdminTransaction>) {
  if (groupRelated.value && cluster.items.length > 1) {
    toggleCluster(cluster.root);
    return;
  }
  openTx(cluster.primary.id);
}

function openTx(id: string) {
  router.push({ name: 'admin-transaction-detail', params: { id } });
}

async function load() {
  error.value = '';
  try {
    [wallets.value, transactions.value] = await Promise.all([
      apiRequest<AdminWallet[]>('/admin/wallets'),
      apiRequest<AdminTransaction[]>(`/admin/transactions?limit=${TX_LIMIT}`),
    ]);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.transactions.loadFailed');
  } finally {
    loaded.value = true;
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.transactions.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <!-- Summary -->
    <div class="stat-tiles">
      <div class="stat-tile">
        <span class="stat-tile-label">
          <span class="stat-icon stat-icon-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg></span>
          {{ t('admin.transactions.statLoaded') }}
        </span>
        <span class="stat-tile-value">{{ transactions.length.toLocaleString() }}</span>
        <span class="stat-tile-meta">{{ t('admin.transactions.statLoadedMeta', { count: TX_LIMIT }) }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label">
          <span class="stat-icon stat-icon-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l5-5 4 4 7-8M14 8h6v6" /></svg></span>
          {{ t('admin.transactions.statVolume') }}
        </span>
        <span class="stat-tile-value">{{ volumeByCurrency[0] ?? '—' }}</span>
        <span class="stat-tile-meta">{{ volumeByCurrency.slice(1).join(' · ') || t('admin.transactions.statVolumeMeta') }}</span>
      </div>
      <button type="button" class="stat-tile stat-tile-btn" :class="{ active: statusFilter === 'PENDING' }" @click="statusFilter = statusFilter === 'PENDING' ? '' : 'PENDING'">
        <span class="stat-tile-label">
          <span class="stat-icon stat-icon-orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></svg></span>
          {{ t('admin.transactions.statPending') }}
        </span>
        <span class="stat-tile-value">{{ pendingCount }}</span>
        <span class="stat-tile-meta">{{ t('admin.transactions.statPendingMeta') }}</span>
      </button>
      <button type="button" class="stat-tile stat-tile-btn" :class="{ active: statusFilter === 'REVERSED' }" @click="statusFilter = statusFilter === 'REVERSED' ? '' : 'REVERSED'">
        <span class="stat-tile-label">
          <span class="stat-icon stat-icon-red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" /></svg></span>
          {{ t('admin.transactions.statReversed') }}
        </span>
        <span class="stat-tile-value">{{ reversedCount }}</span>
        <span class="stat-tile-meta">{{ t('admin.transactions.statReversedMeta') }}</span>
      </button>
    </div>

    <section class="admin-card">
      <!-- Toolbar -->
      <div class="toolbar">
        <div class="toolbar-top">
          <h2>{{ t('admin.transactions.allTransactions', { count: sorted.length }) }}</h2>
          <div class="toolbar-right">
            <label class="admin-search tx-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input v-model="search" class="admin-input" type="search" :placeholder="t('admin.transactions.searchPlaceholder')" />
            </label>
            <div class="segmented">
              <button type="button" :class="{ active: !statusFilter }" @click="statusFilter = ''">{{ t('admin.transactions.allStatuses') }}</button>
              <button v-for="s in STATUSES" :key="s" type="button" :class="{ active: statusFilter === s }" @click="statusFilter = s">
                {{ t(`admin.transactions.status${s}`) }}
              </button>
            </div>
            <label class="group-switch" :title="t('admin.transactions.groupHint')">
              <input v-model="groupRelated" data-shot="group-toggle" type="checkbox" class="switch" />
              {{ t('admin.transactions.groupToggle') }}
            </label>
          </div>
        </div>
        <div class="toolbar-filters">
          <div class="chip-group" role="group">
            <button type="button" class="filter-chip" :class="{ active: !typeFilter }" @click="typeFilter = ''">
              {{ t('admin.transactions.allTypes') }}
            </button>
            <button
              v-for="type in TYPES"
              :key="type"
              type="button"
              class="filter-chip"
              :class="{ active: typeFilter === type }"
              @click="typeFilter = typeFilter === type ? '' : type"
            >
              <span class="chip-dot" :class="transactionTypeClass(type)" />
              {{ t(`admin.transactions.${type.toLowerCase()}`) }}
              <span class="chip-count">{{ typeCounts[type] ?? 0 }}</span>
            </button>
          </div>
          <button v-if="hasFilters" type="button" class="clear-btn" @click="clearFilters">{{ t('admin.transactions.clearFilters') }}</button>
        </div>
      </div>

      <div class="table-scroll">
        <table class="admin-table tx-table">
          <thead>
            <tr>
              <SortableTh :label="t('admin.transactions.tableTransaction')" col-key="type" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
              <th>{{ t('admin.transactions.tableFlow') }}</th>
              <SortableTh class="th-num" :label="t('admin.transactions.tableAmount')" col-key="amount" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
              <SortableTh :label="t('admin.transactions.tableStatus')" col-key="status" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
              <SortableTh :label="t('admin.transactions.tableDate')" col-key="date" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
            </tr>
          </thead>
          <tbody>
            <template v-for="(cluster, index) in pageItems" :key="cluster.root">
              <tr v-if="showDayHeader(index)" class="day-row">
                <td colspan="5">{{ dayLabel(cluster.primary.createdAt) }}</td>
              </tr>
              <tr
                class="tx-row"
                :class="{ expanded: expandedClusters.has(cluster.root) && cluster.items.length > 1 }"
                :data-shot="groupRelated && cluster.items.length > 1 ? 'cluster' : undefined"
                @click="onRowClick(cluster)"
              >
                <td>
                  <div class="tx-id-cell">
                    <span class="type-icon" :class="transactionTypeClass(cluster.primary.type)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="TYPE_ICONS[cluster.primary.type]" /></svg>
                    </span>
                    <span class="tx-id-text">
                      <span class="tx-type-line">
                        {{ t(`admin.transactions.${cluster.primary.type.toLowerCase()}`) }}
                        <span v-if="groupRelated && cluster.items.length > 1" class="legs-badge">
                          {{ t('admin.transactions.legs', { count: cluster.items.length - 1 }) }}
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6" /></svg>
                        </span>
                      </span>
                      <span class="tx-sub">
                        <button type="button" class="id-copy" :title="cluster.primary.id" @click.stop="copyId(cluster.primary.id)">
                          {{ copiedId === cluster.primary.id ? t('admin.transactions.copied') : `#${shortId(cluster.primary.id)}` }}
                        </button>
                        <span v-if="cluster.primary.note" class="tx-note">{{ cluster.primary.note }}</span>
                      </span>
                    </span>
                  </div>
                </td>
                <td>
                  <div class="flow">
                    <template v-for="(side, si) in [party(cluster.primary.fromWalletId), party(cluster.primary.toWalletId)]" :key="si">
                      <svg v-if="si === 1" class="flow-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m0 0l-5-5m5 5l-5 5" /></svg>
                      <router-link
                        v-if="side"
                        class="party"
                        :to="{ name: 'admin-wallet-detail', params: { id: side.id } }"
                        @click.stop
                      >
                        <span class="party-name">{{ side.label }}</span>
                        <span class="party-who">{{ side.owner }}</span>
                      </router-link>
                      <span v-else class="party party-ext">
                        <span class="party-name">{{ t('admin.transactions.external') }}</span>
                        <span class="party-who">{{ si === 0 ? t('admin.transactions.externalIn') : t('admin.transactions.externalOut') }}</span>
                      </span>
                    </template>
                  </div>
                </td>
                <td class="num amount-cell" :class="{ 'amt-in': amountSign(cluster.primary) === '+', 'amt-out': amountSign(cluster.primary) === '−' }">
                  {{ amountSign(cluster.primary) }}{{ amountSign(cluster.primary) ? ' ' : '' }}{{ formatTxAmount(cluster.primary) }}
                </td>
                <td>
                  <span class="admin-badge" :class="transactionStatusClass(cluster.primary.status)">
                    <span class="status-dot" />{{ t(`admin.transactions.status${cluster.primary.status}`) }}
                  </span>
                </td>
                <td class="date-cell">
                  <span class="date-time">{{ formatTime(cluster.primary.createdAt) }}</span>
                  <span v-if="sortKey !== 'date'" class="date-day">{{ formatDate(cluster.primary.createdAt) }}</span>
                </td>
              </tr>

              <template v-if="groupRelated && cluster.items.length > 1 && expandedClusters.has(cluster.root)">
                <tr
                  v-for="(leg, li) in cluster.items"
                  :key="leg.id"
                  class="leg-row"
                  :class="{ last: li === cluster.items.length - 1 }"
                  @click="openTx(leg.id)"
                >
                  <td>
                    <div class="leg-id">
                      <span class="leg-line" />
                      <span class="admin-badge" :class="transactionTypeClass(leg.type)">{{ t(`admin.transactions.${leg.type.toLowerCase()}`) }}</span>
                      <span class="mono-short">#{{ shortId(leg.id) }}</span>
                    </div>
                  </td>
                  <td>
                    <div class="flow flow-compact">
                      <span>{{ party(leg.fromWalletId)?.label ?? t('admin.transactions.external') }}</span>
                      <svg class="flow-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m0 0l-5-5m5 5l-5 5" /></svg>
                      <span>{{ party(leg.toWalletId)?.label ?? t('admin.transactions.external') }}</span>
                    </div>
                  </td>
                  <td class="num">{{ formatTxAmount(leg) }}</td>
                  <td><span class="admin-badge" :class="transactionStatusClass(leg.status)">{{ t(`admin.transactions.status${leg.status}`) }}</span></td>
                  <td class="date-cell"><span class="date-day">{{ formatTime(leg.createdAt) }}</span></td>
                </tr>
              </template>
            </template>
            <tr v-if="loaded && !pageItems.length">
              <td colspan="5">
                <div class="empty-state">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                  {{ t('admin.transactions.noTransactions') }}
                  <button v-if="hasFilters" type="button" class="admin-btn admin-btn-ghost admin-btn-sm" @click="clearFilters">{{ t('admin.transactions.clearFilters') }}</button>
                </div>
              </td>
            </tr>
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
    </section>
  </AdminLayout>
</template>

<style scoped>
/* Summary */
.stat-tile-btn {
  font: inherit;
  color: inherit;
  text-align: start;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.stat-tile-btn:hover {
  border-color: color-mix(in srgb, var(--accent-blue) 40%, var(--card-border));
}
.stat-tile-btn.active {
  border-color: var(--accent-blue);
  box-shadow: var(--focus-ring);
}

/* Toolbar */
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 16px;
}
.toolbar-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.toolbar-top h2 {
  margin: 0;
}
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.tx-search {
  width: 300px;
  max-width: 100%;
}
.group-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--text-dim);
  cursor: pointer;
  white-space: nowrap;
}
.switch {
  appearance: none;
  flex: none;
  width: 34px;
  height: 20px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-dimmer) 45%, transparent);
  position: relative;
  cursor: pointer;
  margin: 0;
  transition: background 0.15s;
}
.switch::after {
  content: '';
  position: absolute;
  top: 3px;
  inset-inline-start: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.3);
  transition: inset-inline-start 0.15s;
}
.switch:checked {
  background: var(--accent-blue);
}
.switch:checked::after {
  inset-inline-start: 17px;
}
.switch:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.toolbar-filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 14px;
  border-top: 1px solid var(--divider);
}
.chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  color: var(--text-dim);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.filter-chip:hover {
  color: var(--text);
  border-color: color-mix(in srgb, var(--text-dimmer) 50%, var(--card-border));
}
.filter-chip.active {
  background: var(--active-tint);
  border-color: var(--accent-blue);
  color: var(--accent-blue);
}
.chip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
.chip-dot.tx-type-deposit { background: var(--accent-lime); }
.chip-dot.tx-type-withdraw { background: var(--accent-red); }
.chip-dot.tx-type-transfer,
.chip-dot.tx-type-purchase { background: var(--accent-blue); }
.chip-dot.tx-type-adjustment { background: var(--accent-orange); }
.chip-dot.tx-type-virtual { background: var(--text-dimmer); }
.chip-count {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-dimmer);
  font-variant-numeric: tabular-nums;
}
.clear-btn {
  border: 0;
  background: none;
  color: var(--accent-blue);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  padding: 4px;
}

@media (max-width: 640px) {
  .toolbar-right,
  .tx-search {
    width: 100%;
  }
}

/* Table */
.tx-table :deep(.th-num) {
  text-align: end;
}
.day-row td {
  padding: 14px 14px 6px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dimmer);
  border-bottom: 1px solid var(--divider);
  background: transparent;
}
.tx-table tbody tr.day-row:hover {
  background: transparent;
}
.tx-row {
  cursor: pointer;
}
.tx-row.expanded {
  background: var(--hover-tint);
}
.tx-id-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 220px;
}
.type-icon {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.type-icon svg {
  width: 17px;
  height: 17px;
}
.tx-id-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}
.tx-type-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 650;
}
.legs-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px 1px 8px;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 600;
  background: var(--badge-tint-blue);
  color: var(--accent-blue);
}
.legs-badge svg {
  width: 12px;
  height: 12px;
  transition: transform 0.15s;
}
.tx-row.expanded .legs-badge svg {
  transform: rotate(180deg);
}
.tx-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 0.78rem;
  color: var(--text-dim);
}
.id-copy {
  border: 0;
  background: none;
  padding: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.74rem;
  color: var(--text-dimmer);
  cursor: copy;
  white-space: nowrap;
}
.id-copy:hover {
  color: var(--accent-blue);
}
.tx-note {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
.tx-note::before {
  content: '·';
  margin-inline-end: 8px;
  color: var(--text-dimmer);
}

.flow {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) auto minmax(120px, 1fr);
  align-items: center;
  gap: 10px;
  min-width: 360px;
}
.flow-arrow {
  width: 16px;
  height: 16px;
  color: var(--text-dimmer);
}
[dir='rtl'] .flow-arrow {
  transform: scaleX(-1);
}
.party {
  display: flex;
  flex-direction: column;
  min-width: 0;
  text-decoration: none;
  color: inherit;
}
a.party:hover .party-name {
  color: var(--accent-blue);
  text-decoration: underline;
}
.party-name {
  font-size: 0.86rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.party-who {
  font-size: 0.76rem;
  color: var(--text-dimmer);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.party-ext .party-name {
  color: var(--text-dim);
  font-weight: 500;
  font-style: italic;
}
.amount-cell {
  font-weight: 650;
}
.amt-in {
  color: var(--accent-lime);
}
.amt-out {
  color: var(--accent-red);
}
.date-cell {
  white-space: nowrap;
}
.date-time {
  display: block;
  font-variant-numeric: tabular-nums;
}
.date-day {
  display: block;
  font-size: 0.76rem;
  color: var(--text-dimmer);
}

/* Cluster legs */
.leg-row {
  cursor: pointer;
  background: var(--panel-bg);
  font-size: 0.84rem;
}
.leg-row td {
  padding-block: 8px;
  border-bottom-color: transparent;
}
.leg-row.last td {
  border-bottom-color: var(--divider);
}
.leg-id {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-inline-start: 16px;
  position: relative;
}
.leg-line {
  width: 14px;
  height: 14px;
  border-inline-start: 2px solid var(--card-border);
  border-bottom: 2px solid var(--card-border);
  border-end-start-radius: 6px;
  margin-top: -10px;
}
.mono-short {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.74rem;
  color: var(--text-dimmer);
}
.flow-compact {
  display: flex;
  gap: 8px;
  min-width: 0;
  color: var(--text-dim);
}
</style>
