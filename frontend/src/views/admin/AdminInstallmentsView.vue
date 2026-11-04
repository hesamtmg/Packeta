<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError, postMultipart } from '../../api/client';
import { displayIdentity } from '../../utils/identity';
import { formatAmount, type CurrencyInfo } from '../../utils/currency';
import { formatDate, formatCalendarDate } from '../../utils/date';
import { useListControls } from '../../composables/useListControls';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import SortableTh from '../../components/admin/SortableTh.vue';
import ListPagination from '../../components/admin/ListPagination.vue';
import RepositoryAbsorbForm from '../../components/admin/RepositoryAbsorbForm.vue';
import { formatRelative, initials } from '../../utils/adminFormat';

interface AdminInstallment {
  id: string;
  walletId: string;
  sequenceNumber: number;
  amount: string;
  principalAmount: string;
  penaltyApplied: boolean;
  penaltyDaysApplied: number;
  dueDate: string;
  deadlineDate: string;
  status: 'PENDING' | 'OVERDUE' | 'PAID';
  paidAt: string | null;
  ownerEmail: string;
  ownerPhoneNumber: string | null;
  walletTypeName: string;
  currency: CurrencyInfo;
}

interface BlockedWallet {
  walletId: string;
  ownerEmail: string;
  ownerPhoneNumber: string | null;
  walletTypeName: string;
  currency: CurrencyInfo;
  blockedAt: string;
  totalOwed: string;
  repositoryWalletId: string | null;
}

const { t } = useI18n();
const installments = ref<AdminInstallment[]>([]);
const error = ref('');

const blockedWallets = ref<BlockedWallet[]>([]);
const overdueError = ref('');
const busyWalletId = ref<string | null>(null);
const openRepositoryId = ref<string | null>(null);
const repositoryDescription = ref<Record<string, string>>({});
const repositoryDocument = ref<Record<string, File | undefined>>({});
const collectionMessage = ref<Record<string, string>>({});

type InstallmentStatus = AdminInstallment['status'];
const STATUSES: InstallmentStatus[] = ['OVERDUE', 'PENDING', 'PAID'];
const statusFilter = ref<InstallmentStatus | ''>('');
const filteredInstallments = computed(() =>
  statusFilter.value ? installments.value.filter((i) => i.status === statusFilter.value) : installments.value,
);
const statusCounts = computed(() => {
  const counts: Record<string, number> = { PENDING: 0, OVERDUE: 0, PAID: 0 };
  for (const i of installments.value) counts[i.status] += 1;
  return counts;
});

// Unpaid totals per currency (PENDING + OVERDUE), largest first.
function sumByCurrency(rows: { amount: string; currency: CurrencyInfo }[]): string[] {
  const totals = new Map<string, { currency: CurrencyInfo; total: bigint }>();
  for (const r of rows) {
    const e = totals.get(r.currency.code) ?? { currency: r.currency, total: 0n };
    e.total += BigInt(r.amount);
    totals.set(r.currency.code, e);
  }
  return [...totals.values()].sort((a, b) => (b.total > a.total ? 1 : -1)).map((e) => formatAmount(e.total.toString(), e.currency));
}
const outstanding = computed(() => sumByCurrency(installments.value.filter((i) => i.status !== 'PAID')));
const overdueOwed = computed(() => sumByCurrency(blockedWallets.value.map((w) => ({ amount: w.totalOwed, currency: w.currency }))));

const DAY = 86_400_000;
function todayUtc(): number {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}
// Days until (positive) or past (negative) a "YYYY-MM-DD" deadline.
function daysUntil(date: string): number {
  return Math.round((new Date(`${date}T00:00:00Z`).getTime() - todayUtc()) / DAY);
}
function deadlineHint(i: AdminInstallment): { text: string; tone: string } {
  if (i.status === 'PAID') return { text: i.paidAt ? t('admin.installments.paidOn', { date: formatDate(i.paidAt) }) : '', tone: 'ok' };
  const d = daysUntil(i.deadlineDate);
  if (d < 0) return { text: t('admin.installments.daysLate', { count: -d }), tone: 'bad' };
  if (d === 0) return { text: t('admin.installments.dueToday'), tone: 'warn' };
  return { text: t('admin.installments.dueIn', { count: d }), tone: d <= 7 ? 'warn' : '' };
}
function blockedDays(w: BlockedWallet): number {
  return Math.max(0, Math.floor((Date.now() - new Date(w.blockedAt).getTime()) / DAY));
}
function who(row: { ownerEmail: string; ownerPhoneNumber: string | null }): string {
  return displayIdentity({ email: row.ownerEmail, phoneNumber: row.ownerPhoneNumber });
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
} = useListControls(filteredInstallments, {
  searchFields: (i) => [i.ownerEmail, i.ownerPhoneNumber, i.walletTypeName, i.status],
  sortAccessors: {
    owner: (i) => displayIdentity({ email: i.ownerEmail, phoneNumber: i.ownerPhoneNumber }).toLowerCase(),
    walletType: (i) => i.walletTypeName.toLowerCase(),
    amount: (i) => Number(i.amount),
    deadline: (i) => new Date(i.deadlineDate).getTime(),
    status: (i) => i.status,
  },
  defaultSort: { key: 'deadline', dir: 'asc' },
  pageSize: 25,
});

watch(statusFilter, () => goToPage(1));

async function load() {
  error.value = '';
  try {
    installments.value = await apiRequest<AdminInstallment[]>('/admin/installments');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.installments.loadFailed');
  }
}

async function loadOverdue() {
  overdueError.value = '';
  try {
    blockedWallets.value = await apiRequest<BlockedWallet[]>('/admin/installments/overdue');
  } catch (err) {
    overdueError.value = err instanceof ApiError ? err.message : t('admin.installments.overdueLoadFailed');
  }
}

function toggleRepositoryForm(walletId: string) {
  openRepositoryId.value = openRepositoryId.value === walletId ? null : walletId;
}

function onRepositoryFileChange(walletId: string, event: Event) {
  const input = event.target as HTMLInputElement;
  repositoryDocument.value[walletId] = input.files?.[0];
}

// Unlike every other admin action, this one intentionally does NOT go
// through apiRequest first — the customer is meant to complete this charge,
// and admins very likely aren't logged into Packeta as that customer, so
// there's nothing useful to show them here first. Redirecting straight to
// the ZarinPal pay page (rather than showing a clickable link) matches how
// the customer's own payInstallment() already behaves.
async function collectZarinpal(wallet: BlockedWallet) {
  overdueError.value = '';
  collectionMessage.value[wallet.walletId] = '';
  busyWalletId.value = wallet.walletId;
  try {
    const result = await apiRequest<{ redirectUrl: string }>(
      `/admin/installments/${wallet.walletId}/collect/zarinpal`,
      { method: 'POST', idempotent: true },
    );
    window.location.href = result.redirectUrl;
  } catch (err) {
    overdueError.value = err instanceof ApiError ? err.message : t('admin.installments.collectFailed');
    busyWalletId.value = null;
  }
}

async function collectRepository(wallet: BlockedWallet) {
  overdueError.value = '';
  collectionMessage.value[wallet.walletId] = '';
  const description = repositoryDescription.value[wallet.walletId]?.trim();
  if (!description) {
    overdueError.value = t('admin.installments.repositoryDescriptionRequired');
    return;
  }
  busyWalletId.value = wallet.walletId;
  try {
    await postMultipart(
      `/admin/installments/${wallet.walletId}/collect/repository`,
      { description, document: repositoryDocument.value[wallet.walletId] },
      { idempotent: true },
    );
    collectionMessage.value[wallet.walletId] = t('admin.installments.collectSuccess');
    repositoryDescription.value[wallet.walletId] = '';
    repositoryDocument.value[wallet.walletId] = undefined;
    openRepositoryId.value = null;
    await loadOverdue();
  } catch (err) {
    overdueError.value = err instanceof ApiError ? err.message : t('admin.installments.collectFailed');
  } finally {
    busyWalletId.value = null;
  }
}

onMounted(() => {
  load();
  loadOverdue();
});
</script>

<template>
  <AdminLayout :title="t('admin.installments.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>
    <p v-if="overdueError" class="admin-error">{{ overdueError }}</p>

    <div class="stat-tiles">
      <div class="stat-tile">
        <span class="stat-tile-label"><span class="stat-icon stat-icon-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg></span>{{ t('admin.installments.statOutstanding') }}</span>
        <span class="stat-tile-value">{{ outstanding[0] ?? '—' }}</span>
        <span class="stat-tile-meta">{{ t('admin.installments.statOutstandingMeta', { count: statusCounts.PENDING + statusCounts.OVERDUE }) }}</span>
      </div>
      <button type="button" class="stat-tile stat-btn" :class="{ active: statusFilter === 'OVERDUE' }" @click="statusFilter = statusFilter === 'OVERDUE' ? '' : 'OVERDUE'">
        <span class="stat-tile-label"><span class="stat-icon stat-icon-red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8" /><path d="M12 8v4M12 16h.01" /></svg></span>{{ t('admin.installments.statOverdue') }}</span>
        <span class="stat-tile-value">{{ statusCounts.OVERDUE }}</span>
        <span class="stat-tile-meta">{{ t('admin.installments.statOverdueMeta') }}</span>
      </button>
      <div class="stat-tile">
        <span class="stat-tile-label"><span class="stat-icon stat-icon-orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg></span>{{ t('admin.installments.statBlocked') }}</span>
        <span class="stat-tile-value">{{ blockedWallets.length }}</span>
        <span class="stat-tile-meta">{{ overdueOwed[0] ? t('admin.installments.statBlockedMeta', { amount: overdueOwed[0] }) : t('admin.installments.statNothingOwed') }}</span>
      </div>
      <button type="button" class="stat-tile stat-btn" :class="{ active: statusFilter === 'PAID' }" @click="statusFilter = statusFilter === 'PAID' ? '' : 'PAID'">
        <span class="stat-tile-label"><span class="stat-icon stat-icon-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>{{ t('admin.installments.statPaid') }}</span>
        <span class="stat-tile-value">{{ statusCounts.PAID }}</span>
        <span class="stat-tile-meta">{{ t('admin.installments.statPaidMeta') }}</span>
      </button>
    </div>

    <!-- Overdue collection queue -->
    <section class="admin-card queue" :class="{ 'queue-active': blockedWallets.length }">
      <div class="admin-card-head">
        <div>
          <h2>{{ t('admin.installments.overdueHeading', { count: blockedWallets.length }) }}</h2>
          <p class="admin-card-sub">{{ t('admin.installments.queueHint') }}</p>
        </div>
      </div>
      <ul v-if="blockedWallets.length" class="queue-list">
        <li v-for="w in blockedWallets" :key="w.walletId" class="queue-item">
          <div class="queue-row">
            <div class="person">
              <span class="avatar">{{ initials(who(w)) }}</span>
              <span class="person-text">
                <span class="person-name">{{ who(w) }}</span>
                <router-link class="person-sub wallet-link" :to="{ name: 'admin-wallet-detail', params: { id: w.walletId } }">{{ w.walletTypeName }} · #{{ w.walletId.slice(0, 8) }}</router-link>
              </span>
            </div>
            <div class="queue-blocked">
              <span class="admin-badge admin-badge-danger"><span class="status-dot" />{{ t('admin.installments.blockedDays', { count: blockedDays(w) }) }}</span>
              <span class="queue-since">{{ t('admin.installments.since', { date: formatDate(w.blockedAt) }) }}</span>
            </div>
            <div class="queue-owed">
              <span class="mini-label">{{ t('admin.installments.colTotalOwed') }}</span>
              <span class="owed-value">{{ formatAmount(w.totalOwed, w.currency) }}</span>
            </div>
            <div class="queue-actions">
              <button type="button" class="admin-btn admin-btn-primary admin-btn-sm" :disabled="busyWalletId === w.walletId" @click="collectZarinpal(w)">
                {{ t('admin.installments.actionZarinpal') }}
              </button>
              <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" :class="{ active: openRepositoryId === w.walletId }" :disabled="busyWalletId === w.walletId" @click="toggleRepositoryForm(w.walletId)">
                {{ t('admin.installments.actionRepository') }}
              </button>
            </div>
          </div>
          <p v-if="collectionMessage[w.walletId]" class="admin-success">{{ collectionMessage[w.walletId] }}</p>
          <RepositoryAbsorbForm
            v-if="openRepositoryId === w.walletId"
            v-model:description="repositoryDescription[w.walletId]"
            :placeholder="t('admin.installments.repositoryDescriptionPlaceholder')"
            :submit-label="t('admin.installments.repositorySubmit')"
            :cancel-label="t('admin.installments.cancel')"
            :attach-label="t('admin.installments.attachDocument')"
            :busy="busyWalletId === w.walletId"
            @file="repositoryDocument[w.walletId] = $event"
            @submit="collectRepository(w)"
            @cancel="openRepositoryId = null"
          />
        </li>
      </ul>
      <div v-else class="queue-empty">
        <span class="queue-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
        {{ t('admin.installments.overdueEmpty') }}
      </div>
    </section>

    <!-- All installments -->
    <section class="admin-card">
      <div class="toolbar">
        <h2>{{ t('admin.installments.all', { count: sorted.length }) }}</h2>
        <div class="toolbar-right">
          <div class="segmented">
            <button type="button" :class="{ active: !statusFilter }" @click="statusFilter = ''">{{ t('admin.transactions.allStatuses') }}</button>
            <button v-for="st in STATUSES" :key="st" type="button" :class="{ active: statusFilter === st }" @click="statusFilter = st">
              {{ t(`admin.reports.inst${st}`) }} <span class="count">{{ statusCounts[st] }}</span>
            </button>
          </div>
          <label class="admin-search search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input v-model="search" type="search" class="admin-input" :placeholder="t('admin.installments.searchPlaceholder')" />
          </label>
        </div>
      </div>
      <div class="table-scroll">
        <table class="admin-table">
          <thead>
            <tr>
              <SortableTh :label="t('admin.installments.tableOwner')" col-key="owner" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
              <SortableTh :label="t('admin.installments.tableWalletType')" col-key="walletType" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
              <SortableTh class="th-end" :label="t('admin.installments.tableAmount')" col-key="amount" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
              <SortableTh :label="t('admin.installments.tableDeadline')" col-key="deadline" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
              <SortableTh :label="t('admin.installments.tableStatus')" col-key="status" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in pageItems" :key="i.id">
              <td>
                <div class="person">
                  <span class="avatar avatar-sm">{{ initials(who(i)) }}</span>
                  <span class="person-name">{{ who(i) }}</span>
                </div>
              </td>
              <td>
                <router-link class="wallet-link" :to="{ name: 'admin-wallet-detail', params: { id: i.walletId } }">{{ i.walletTypeName }}</router-link>
                <span class="seq">{{ t('admin.installments.sequence', { n: i.sequenceNumber }) }}</span>
              </td>
              <td class="num amount">
                {{ formatAmount(i.amount, i.currency) }}
                <span v-if="i.penaltyApplied" class="penalty">{{ t('admin.installments.penaltyDays', { count: i.penaltyDaysApplied }) }}</span>
              </td>
              <td>
                <span class="deadline">{{ formatCalendarDate(i.deadlineDate) }}</span>
                <span class="deadline-hint" :class="`hint-${deadlineHint(i).tone}`">{{ deadlineHint(i).text }}</span>
              </td>
              <td>
                <span class="admin-badge" :class="`inst-badge-${i.status.toLowerCase()}`"><span class="status-dot" />{{ t(`admin.reports.inst${i.status}`) }}</span>
              </td>
            </tr>
            <tr v-if="!pageItems.length"><td colspan="5"><div class="empty-state">{{ t('admin.installments.none') }}</div></td></tr>
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
.stat-btn {
  font: inherit;
  color: inherit;
  text-align: start;
  cursor: pointer;
}
.stat-btn:hover {
  border-color: color-mix(in srgb, var(--accent-blue) 40%, var(--card-border));
}
.stat-btn.active {
  border-color: var(--accent-blue);
  box-shadow: var(--focus-ring);
}
.mini-label {
  display: block;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dimmer);
}
.queue-active {
  border-top: 3px solid var(--accent-red);
}
.queue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.queue-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
}
.queue-row {
  display: grid;
  grid-template-columns: minmax(200px, 1.4fr) minmax(150px, 1fr) minmax(140px, 1fr) auto;
  align-items: center;
  gap: 16px;
}
.wallet-link {
  color: var(--accent-blue);
  text-decoration: none;
}
.wallet-link:hover {
  text-decoration: underline;
}
.queue-blocked {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.queue-since {
  font-size: 0.76rem;
  color: var(--text-dimmer);
}
.owed-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--accent-red);
  font-variant-numeric: tabular-nums;
}
.queue-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.queue-empty {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--radius-sm);
  background: var(--badge-tint-lime);
  color: var(--accent-lime);
  font-weight: 600;
  font-size: 0.9rem;
}
.queue-empty-icon {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--accent-lime);
  color: var(--card-bg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.queue-empty-icon svg {
  width: 14px;
  height: 14px;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.toolbar h2 {
  margin: 0;
}
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.search-box {
  width: 260px;
  max-width: 100%;
}
.avatar-sm {
  width: 30px;
  height: 30px;
  font-size: 0.7rem;
}
:deep(.th-end) {
  text-align: end;
}
.seq {
  display: block;
  font-size: 0.76rem;
  color: var(--text-dimmer);
}
.amount {
  font-weight: 650;
}
.penalty {
  display: block;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--accent-red);
}
.deadline {
  display: block;
  white-space: nowrap;
}
.deadline-hint {
  display: block;
  font-size: 0.76rem;
  color: var(--text-dimmer);
}
.hint-bad { color: var(--accent-red); font-weight: 600; }
.hint-warn { color: var(--accent-orange); font-weight: 600; }
.hint-ok { color: var(--accent-lime); }
.inst-badge-paid { background: var(--badge-tint-lime); color: var(--accent-lime); }
.inst-badge-pending { background: var(--badge-tint-orange); color: var(--accent-orange); }
.inst-badge-overdue { background: var(--badge-tint-red); color: var(--accent-red); }
@media (max-width: 900px) {
  .queue-row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .queue-actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }
}
</style>
