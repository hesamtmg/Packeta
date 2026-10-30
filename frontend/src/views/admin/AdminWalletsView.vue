<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { apiRequest, ApiError } from '../../api/client';
import { amountStep, formatAmount, toMinorUnits } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { displayIdentity } from '../../utils/identity';
import type { AdminWallet } from '../../types/admin';
import { walletDisplayName } from '../../utils/wallet-name';
import { cardGradient } from '../../utils/cardTheme';
import type { CurrencyInfo } from '../../utils/currency';
import { useListControls } from '../../composables/useListControls';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import BatchImportCard from '../../components/admin/BatchImportCard.vue';
import SortableTh from '../../components/admin/SortableTh.vue';
import ListPagination from '../../components/admin/ListPagination.vue';
import { useAuthStore } from '../../stores/auth';

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();
const wallets = ref<AdminWallet[]>([]);
const error = ref('');
const busy = ref(false);

const adjustAmount = ref<Record<string, string>>({});
const adjustReason = ref<Record<string, string>>({});
const openAdjustId = ref<string | null>(null);

type StatusFilter = 'all' | 'active' | 'blocked' | 'closed';
const statusFilter = ref<StatusFilter>('all');
const typeFilter = ref('');
const currencyFilter = ref('');

function walletStatus(w: AdminWallet): Exclude<StatusFilter, 'all'> {
  if (w.closedAt) return 'closed';
  if (w.blockedAt) return 'blocked';
  return 'active';
}

const statusCounts = computed(() => {
  const counts = { all: wallets.value.length, active: 0, blocked: 0, closed: 0 };
  for (const w of wallets.value) counts[walletStatus(w)] += 1;
  return counts;
});

const typeOptions = computed(() =>
  [...new Map(wallets.value.map((w) => [w.walletType.id, w.walletType.name])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  ),
);
const currencyOptions = computed(() =>
  [...new Set(wallets.value.map((w) => w.walletType.currency.code))].sort(),
);

const filteredWallets = computed(() =>
  wallets.value.filter(
    (w) =>
      (statusFilter.value === 'all' || walletStatus(w) === statusFilter.value) &&
      (!typeFilter.value || w.walletType.id === typeFilter.value) &&
      (!currencyFilter.value || w.walletType.currency.code === currencyFilter.value),
  ),
);

// Sum of open-wallet balances per currency (minor units, BigInt for exact
// Rial totals) for the summary tiles.
const balanceTotals = computed(() => {
  const map = new Map<string, { currency: CurrencyInfo; total: bigint }>();
  for (const w of wallets.value) {
    if (w.closedAt) continue;
    const entry = map.get(w.walletType.currency.code) ?? { currency: w.walletType.currency, total: 0n };
    try {
      entry.total += BigInt(w.balance);
    } catch {
      entry.total += BigInt(Math.round(Number(w.balance)));
    }
    map.set(w.walletType.currency.code, entry);
  }
  return [...map.values()];
});

function ownerLabel(w: AdminWallet): string {
  return displayIdentity({ email: w.ownerEmail, phoneNumber: w.ownerPhoneNumber });
}
function ownerInitial(w: AdminWallet): string {
  return (ownerLabel(w).replace(/^\+/, '') || '?').slice(0, 1).toUpperCase();
}
function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

function clearFilters() {
  statusFilter.value = 'all';
  typeFilter.value = '';
  currencyFilter.value = '';
  search.value = '';
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
} = useListControls(filteredWallets, {
  searchFields: (w) => [w.ownerEmail, w.ownerPhoneNumber, w.walletType.name, w.name],
  sortAccessors: {
    owner: (w) => displayIdentity({ email: w.ownerEmail, phoneNumber: w.ownerPhoneNumber }).toLowerCase(),
    name: (w) => walletDisplayName(w).toLowerCase(),
    type: (w) => w.walletType.name.toLowerCase(),
    balance: (w) => Number(w.balance),
    created: (w) => new Date(w.createdAt).getTime(),
    status: (w) => (w.closedAt ? 1 : 0),
  },
  defaultSort: { key: 'created', dir: 'desc' },
  pageSize: 25,
});

async function load() {
  error.value = '';
  try {
    wallets.value = await apiRequest<AdminWallet[]>('/admin/wallets');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.wallets.loadFailed');
  }
}

function toggleAdjust(walletId: string) {
  openAdjustId.value = openAdjustId.value === walletId ? null : walletId;
}

async function adjust(wallet: AdminWallet) {
  error.value = '';
  busy.value = true;
  try {
    const amount = toMinorUnits(adjustAmount.value[wallet.id] ?? '0', wallet.walletType.currency);
    const reason = adjustReason.value[wallet.id] ?? '';
    await apiRequest(`/admin/wallets/${wallet.id}/adjust`, {
      method: 'POST',
      body: { amount, reason },
      idempotent: true,
    });
    adjustAmount.value[wallet.id] = '';
    adjustReason.value[wallet.id] = '';
    openAdjustId.value = null;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.wallets.adjustFailed');
  } finally {
    busy.value = false;
  }
}

async function reopen(wallet: AdminWallet) {
  error.value = '';
  busy.value = true;
  try {
    await apiRequest(`/admin/wallets/${wallet.id}/reopen`, { method: 'POST' });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.wallets.reopenFailed');
  } finally {
    busy.value = false;
  }
}

async function close(wallet: AdminWallet) {
  error.value = '';
  busy.value = true;
  try {
    await apiRequest(`/admin/wallets/${wallet.id}`, { method: 'DELETE' });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.wallets.closeFailed');
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.wallets.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <div class="stat-tiles">
      <div class="stat-tile">
        <span class="stat-tile-label">
          <span class="stat-icon stat-icon-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM3 10h18" /></svg></span>
          {{ t('admin.wallets.statTotal') }}
        </span>
        <span class="stat-tile-value">{{ statusCounts.all }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label">
          <span class="stat-icon stat-icon-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7" /></svg></span>
          {{ t('admin.wallets.statusActive') }}
        </span>
        <span class="stat-tile-value">{{ statusCounts.active }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label">
          <span class="stat-icon stat-icon-orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg></span>
          {{ t('admin.wallets.statusBlocked') }}
        </span>
        <span class="stat-tile-value">{{ statusCounts.blocked }}</span>
      </div>
      <div v-for="entry in balanceTotals" :key="entry.currency.code" class="stat-tile">
        <span class="stat-tile-label">
          <span class="stat-icon stat-icon-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M17 7.5C17 5.6 14.8 4.5 12 4.5S7 5.6 7 7.5 9.2 10.5 12 11s5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3" /></svg></span>
          {{ t('admin.wallets.statHeld', { currency: entry.currency.code }) }}
        </span>
        <span class="stat-tile-value">{{ formatAmount(entry.total.toString(), entry.currency) }}</span>
      </div>
    </div>

    <div class="admin-card">
      <div class="toolbar">
        <div class="segmented" role="tablist">
          <button
            v-for="key in (['all', 'active', 'blocked', 'closed'] as const)"
            :key="key"
            type="button"
            role="tab"
            :class="{ active: statusFilter === key }"
            :aria-selected="statusFilter === key"
            @click="statusFilter = key"
          >
            {{ t(`admin.wallets.filter.${key}`) }}
            <span class="count">{{ statusCounts[key] }}</span>
          </button>
        </div>
        <div class="toolbar-end">
          <label class="admin-search toolbar-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input v-model="search" class="admin-input" :placeholder="t('admin.wallets.searchPlaceholder')" />
          </label>
          <select v-model="typeFilter" class="admin-input">
            <option value="">{{ t('admin.wallets.allTypes') }}</option>
            <option v-for="[id, name] in typeOptions" :key="id" :value="id">{{ name }}</option>
          </select>
          <select v-if="currencyOptions.length > 1" v-model="currencyFilter" class="admin-input">
            <option value="">{{ t('admin.wallets.allCurrencies') }}</option>
            <option v-for="code in currencyOptions" :key="code" :value="code">{{ code }}</option>
          </select>
        </div>
      </div>

      <p class="result-count">{{ t('admin.wallets.allWallets', { count: sorted.length }) }}</p>

      <div class="table-scroll">
      <table class="admin-table wallets-table">
        <thead>
          <tr>
            <SortableTh :label="t('admin.wallets.tableName')" col-key="name" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
            <SortableTh :label="t('admin.wallets.tableOwner')" col-key="owner" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
            <SortableTh :label="t('admin.wallets.tableType')" col-key="type" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
            <SortableTh :label="t('admin.wallets.tableBalance')" col-key="balance" :active-key="sortKey" :dir="sortDir" class="th-end" @sort="toggleSort" />
            <SortableTh :label="t('admin.wallets.tableStatus')" col-key="status" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
            <SortableTh :label="t('admin.wallets.tableCreated')" col-key="created" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
            <th class="th-end">{{ t('admin.wallets.tableActions') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="w in pageItems" :key="w.id">
            <tr class="row-clickable" :class="{ 'row-open': openAdjustId === w.id }" @click="router.push({ name: 'admin-wallet-detail', params: { id: w.id } })">
              <td>
                <div class="wallet-cell">
                  <span class="wallet-chip" :style="{ background: cardGradient(w.walletType, !!w.closedAt) }">{{ w.walletType.currency.code.slice(0, 3) }}</span>
                  <div class="cell-stack">
                    <span class="cell-strong">{{ walletDisplayName(w) }}</span>
                    <span class="mono-id" :title="w.id">{{ shortId(w.id) }}</span>
                  </div>
                </div>
              </td>
              <td>
                <div class="owner-cell">
                  <span class="owner-avatar">{{ ownerInitial(w) }}</span>
                  <div class="cell-stack">
                    <span class="cell-strong">{{ ownerLabel(w) }}</span>
                    <span v-if="w.ownerPhoneNumber && w.ownerEmail && ownerLabel(w) !== w.ownerEmail" class="cell-sub">{{ w.ownerEmail }}</span>
                  </div>
                </div>
              </td>
              <td>
                <span class="admin-badge admin-badge-info">{{ w.walletType.name }}</span>
              </td>
              <td class="num">
                <span class="balance" :class="{ negative: w.balance.startsWith('-') }">{{ formatAmount(w.balance, w.walletType.currency) }}</span>
                <span class="cell-sub">{{ w.walletType.currency.code }}</span>
              </td>
              <td>
                <span v-if="w.closedAt" class="admin-badge"><i class="status-dot" />{{ t('admin.wallets.statusClosed') }}</span>
                <span v-else-if="w.blockedAt" class="admin-badge admin-badge-warning"><i class="status-dot" />{{ t('admin.wallets.statusBlocked') }}</span>
                <span v-else class="admin-badge admin-badge-success"><i class="status-dot" />{{ t('admin.wallets.statusActive') }}</span>
              </td>
              <td><span class="cell-sub nowrap">{{ formatDate(w.createdAt) }}</span></td>
              <td>
                <div class="actions-cell">
                  <button
                    class="admin-btn admin-btn-ghost admin-btn-sm"
                    :class="{ active: openAdjustId === w.id }"
                    @click.stop="toggleAdjust(w.id)"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h9m-9 6h16M4 18h9" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="18" r="2" /></svg>
                    {{ t('admin.wallets.adjust') }}
                  </button>
                  <button v-if="w.closedAt" class="admin-btn admin-btn-ghost admin-btn-sm" :disabled="busy" @click.stop="reopen(w)">
                    {{ t('admin.wallets.reopen') }}
                  </button>
                  <button
                    v-else-if="auth.isSuperAdmin"
                    class="admin-btn admin-btn-danger admin-btn-sm"
                    :disabled="busy || w.balance !== '0'"
                    :title="w.balance !== '0' ? t('dashboard.wallets.closeRequiresZero') : ''"
                    @click.stop="close(w)"
                  >
                    {{ t('admin.wallets.close') }}
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="openAdjustId === w.id" class="adjust-tr">
              <td colspan="7">
                <form class="adjust-row" @submit.prevent="adjust(w)">
                  <span class="adjust-title">{{ t('admin.wallets.adjustTitle', { wallet: walletDisplayName(w) }) }}</span>
                  <input
                    v-model="adjustAmount[w.id]"
                    type="number"
                    :step="amountStep(w.walletType.currency)"
                    class="admin-input"
                    :placeholder="t('admin.wallets.amountPlaceholder')"
                    required
                  />
                  <input v-model="adjustReason[w.id]" type="text" class="admin-input adjust-reason" :placeholder="t('admin.wallets.reasonPlaceholder')" />
                  <button type="button" class="admin-btn admin-btn-ghost" @click="openAdjustId = null">{{ t('dashboard.wallets.cancelEdit') }}</button>
                  <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">{{ t('admin.wallets.save') }}</button>
                </form>
              </td>
            </tr>
          </template>
          <tr v-if="!pageItems.length">
            <td colspan="7">
              <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM3 10h18M15 15h4" /></svg>
                {{ t('admin.wallets.noWallets') }}
                <button v-if="statusFilter !== 'all' || typeFilter || currencyFilter || search" type="button" class="admin-btn admin-btn-ghost admin-btn-sm" @click="clearFilters">
                  {{ t('admin.wallets.clearFilters') }}
                </button>
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
    </div>

    <BatchImportCard
      v-if="auth.isSuperAdmin"
      endpoint="/admin/wallets/batch"
      sample-url="/samples/wallets-sample.xlsx"
      :title="t('admin.batchImport.walletsTitle')"
      :hint="t('admin.batchImport.walletsHint')"
      @imported="load"
    />
  </AdminLayout>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.toolbar-end {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.toolbar-search {
  width: 280px;
}
.result-count {
  margin: 16px 0 10px;
  font-size: 0.8rem;
  color: var(--text-dim);
}
.th-end {
  text-align: end;
}
.wallet-cell,
.owner-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.wallet-chip {
  flex: none;
  width: 42px;
  height: 28px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
}
.owner-avatar {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  background: var(--badge-tint-blue);
  color: var(--accent-blue);
}
.cell-stack {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.cell-strong {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
.cell-sub {
  display: block;
  font-size: 0.74rem;
  color: var(--text-dimmer);
}
.nowrap {
  white-space: nowrap;
}
.balance {
  display: block;
  font-weight: 700;
}
.balance.negative {
  color: var(--accent-red);
}
.actions-cell {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.row-clickable {
  cursor: pointer;
}
.row-open td {
  background: var(--active-tint);
  border-bottom-color: transparent;
}
.adjust-tr td {
  background: var(--active-tint);
}
.adjust-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 4px 0;
}
.adjust-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-dim);
  margin-inline-end: auto;
}
.adjust-reason {
  min-width: 240px;
}
@media (max-width: 640px) {
  .toolbar-end,
  .toolbar-search,
  .toolbar-end .admin-input {
    width: 100%;
  }
  .segmented {
    width: 100%;
    overflow-x: auto;
  }
}
</style>
