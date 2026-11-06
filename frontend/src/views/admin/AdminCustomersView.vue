<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { amountStep, formatAmount, toMinorUnits, type CurrencyInfo } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { displayIdentity } from '../../utils/identity';
import {
  walletLookup,
  transactionCurrency,
  transactionTypeClass,
  transactionStatusClass,
  type AdminUser,
  type AdminWallet,
  type AdminTransaction,
  type PanelRole,
} from '../../types/admin';
import { useListControls } from '../../composables/useListControls';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import AdminDrawer from '../../components/admin/AdminDrawer.vue';
import { cardGradient } from '../../utils/cardTheme';
import { formatRelative, initials, TX_TYPE_ICONS } from '../../utils/adminFormat';
import { walletDisplayName } from '../../utils/wallet-name';
import BatchImportCard from '../../components/admin/BatchImportCard.vue';
import SortableTh from '../../components/admin/SortableTh.vue';
import ListPagination from '../../components/admin/ListPagination.vue';
import { useAuthStore } from '../../stores/auth';
import AmountInput from '../../components/AmountInput.vue';
import AdminWalletEditForm from '../../components/admin/AdminWalletEditForm.vue';
import type { Wallet as FullWallet } from '../../stores/wallet';

const { t } = useI18n();
const auth = useAuthStore();

interface WalletType {
  id: string;
  code: string;
  name: string;
  currency: CurrencyInfo;
  allowNegativeBalance: boolean;
  creditLimit: string | null;
  allowWithdraw: boolean;
  allowP2pOut: boolean;
  allowP2pIn: boolean;
  depositable: boolean;
  hasVirtualBalance: boolean;
  cardColor?: string | null;
}

interface Wallet {
  id: string;
  name: string | null;
  balance: string;
  closedAt: string | null;
  blockedAt: string | null;
  restrictedCounterparties: string[] | null;
  virtualAmount: string | null;
  repositoryWalletId: string | null;
  railType: string | null;
  walletType: WalletType;
}

interface UserDetail extends AdminUser {
  wallets: Wallet[];
}

const users = ref<AdminUser[]>([]);
const allWallets = ref<AdminWallet[]>([]);
const selected = ref<UserDetail | null>(null);
const transactions = ref<AdminTransaction[]>([]);
const walletTypes = ref<WalletType[]>([]);
const listError = ref('');
const detailError = ref('');
const addWalletError = ref('');
const addWalletBusy = ref(false);

const walletError = ref('');
const walletBusy = ref(false);
// The wallet currently open in the edit form — loaded in full from
// GET /admin/wallets/:id, since the customer detail only carries a summary.
const editingWallet = ref<FullWallet | null>(null);
const walletNotice = ref('');

const newWalletTypeId = ref('');
const newWalletVirtualAmount = ref('');
const newWalletNationalCode = ref('');

const roles = ref<PanelRole[]>([]);
const assignRoleDraft = ref('');
const assignBusy = ref(false);
const assignError = ref('');
const assignSuccess = ref('');

const newWalletType = computed(() =>
  walletTypes.value.find((t) => t.id === newWalletTypeId.value) ?? null,
);

const walletsById = computed(() => walletLookup(allWallets.value));

// walletId lists per owner, for the wallet-count column.
const walletsByOwner = computed(() => {
  const map = new Map<string, AdminWallet[]>();
  for (const w of allWallets.value) {
    const list = map.get(w.ownerId);
    if (list) list.push(w);
    else map.set(w.ownerId, [w]);
  }
  return map;
});
function walletSummary(userId: string): { count: number; currencies: string } {
  const list = (walletsByOwner.value.get(userId) ?? []).filter((w) => !w.closedAt);
  return { count: list.length, currencies: [...new Set(list.map((w) => w.walletType.currency.code))].join(' · ') };
}
function secondaryIdentity(u: AdminUser): string {
  const primary = displayIdentity(u);
  if (primary !== u.email) return '';
  return u.phoneNumber ?? '';
}
const showImport = ref(false);
const drawerOpen = ref(false);
const loadingDetail = ref(false);
async function openCustomer(id: string) {
  drawerOpen.value = true;
  loadingDetail.value = true;
  selected.value = null;
  editingWallet.value = null;
  walletNotice.value = '';
  await selectUser(id);
  loadingDetail.value = false;
}
function txAmount(tx: AdminTransaction): string {
  const c = txCurrency(tx);
  return c ? formatAmount(tx.amount, c) : tx.amount;
}
function txWallet(id: string | null): string {
  if (!id) return t('admin.transactions.external');
  const w = walletsById.value.get(id);
  return w ? walletDisplayName(w) : t('common.unknown');
}
// Sign relative to this customer: money landing in one of their wallets is +.
function txSign(tx: AdminTransaction): '+' | '−' | '' {
  const own = new Set((selected.value?.wallets ?? []).map((w) => w.id));
  const toOwn = tx.toWalletId && own.has(tx.toWalletId);
  const fromOwn = tx.fromWalletId && own.has(tx.fromWalletId);
  if (toOwn && !fromOwn) return '+';
  if (fromOwn && !toOwn) return '−';
  return '';
}

const customers = computed(() => users.value.filter((u) => u.role === 'USER' || u.role === 'ADMIN' ));

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
} = useListControls(customers, {
  searchFields: (u) => [u.email, u.phoneNumber, u.id],
  sortAccessors: {
    identity: (u) => displayIdentity(u).toLowerCase(),
    joined: (u) => new Date(u.createdAt).getTime(),
  },
  defaultSort: { key: 'joined', dir: 'desc' },
  pageSize: 25,
});

function txCurrency(tx: AdminTransaction): CurrencyInfo | null {
  return transactionCurrency(tx, walletsById.value);
}

async function loadUsers() {
  listError.value = '';
  try {
    [users.value, allWallets.value] = await Promise.all([
      apiRequest<AdminUser[]>('/admin/users'),
      apiRequest<AdminWallet[]>('/admin/wallets'),
    ]);
  } catch (err) {
    listError.value = err instanceof ApiError ? err.message : t('admin.customers.loadFailed');
  }
}

async function loadWalletTypes() {
  try {
    walletTypes.value = await apiRequest<WalletType[]>('/wallet-types');
  } catch {
    // Non-critical — the "Add wallet" form just stays empty.
  }
}

async function loadRoles() {
  try {
    roles.value = await apiRequest<PanelRole[]>('/admin/roles');
  } catch {
    // Non-critical — the assignment select just stays empty.
  }
}

async function selectUser(id: string) {
  detailError.value = '';
  walletError.value = '';
  assignError.value = '';
  assignSuccess.value = '';
  try {
    const [detail, txs] = await Promise.all([
      apiRequest<UserDetail>(`/admin/users/${id}`),
      apiRequest<AdminTransaction[]>(`/admin/users/${id}/transactions`),
    ]);
    selected.value = detail;
    transactions.value = txs;
    assignRoleDraft.value = detail.panelRole?.id ?? '';
  } catch (err) {
    detailError.value = err instanceof ApiError ? err.message : t('admin.customers.detailFailed');
  }
}

async function saveAssignment() {
  if (!selected.value) return;
  assignError.value = '';
  assignSuccess.value = '';
  assignBusy.value = true;
  try {
    await apiRequest(`/admin/users/${selected.value.id}/panel-role`, {
      method: 'PATCH',
      body: { panelRoleId: assignRoleDraft.value || null },
    });
    assignSuccess.value = t('admin.customers.assignSaved');
    await selectUser(selected.value.id);
  } catch (err) {
    assignError.value = err instanceof ApiError ? err.message : t('admin.customers.assignFailed');
  } finally {
    assignBusy.value = false;
  }
}

async function reopenWallet(wallet: Wallet) {
  if (!selected.value) return;
  walletError.value = '';
  walletBusy.value = true;
  try {
    await apiRequest(`/admin/wallets/${wallet.id}/reopen`, { method: 'POST' });
    await selectUser(selected.value.id);
  } catch (err) {
    walletError.value = err instanceof ApiError ? err.message : t('admin.wallets.reopenFailed');
  } finally {
    walletBusy.value = false;
  }
}

async function startEditWallet(wallet: Wallet) {
  walletError.value = '';
  walletNotice.value = '';
  walletBusy.value = true;
  try {
    editingWallet.value = await apiRequest<FullWallet>(`/admin/wallets/${wallet.id}`);
  } catch (err) {
    walletError.value = err instanceof ApiError ? err.message : t('admin.walletDetail.loadFailed');
  } finally {
    walletBusy.value = false;
  }
}

async function onWalletEdited() {
  editingWallet.value = null;
  walletNotice.value = t('admin.walletDetail.saved');
  if (selected.value) await selectUser(selected.value.id);
}

async function closeWallet(wallet: Wallet) {
  if (!selected.value) return;
  walletError.value = '';
  walletBusy.value = true;
  try {
    await apiRequest(`/admin/wallets/${wallet.id}`, { method: 'DELETE' });
    await selectUser(selected.value.id);
  } catch (err) {
    walletError.value = err instanceof ApiError ? err.message : t('admin.wallets.closeFailed');
  } finally {
    walletBusy.value = false;
  }
}

// Mirrors DashboardView.vue's own wallet-card badges — kept identical so a
// customer's wallets read the same way whether they're viewing them or an
// admin is looking on their behalf.
function badges(w: Wallet): string[] {
  const list: string[] = [];
  if (w.walletType.allowNegativeBalance) {
    list.push(
      t('dashboard.wallets.creditLimit', {
        amount: formatAmount(w.walletType.creditLimit ?? '0', w.walletType.currency),
      }),
    );
  }
  if (!w.walletType.allowWithdraw) list.push(t('dashboard.wallets.noCashOut'));
  if (!w.walletType.allowP2pOut && !w.walletType.allowP2pIn) {
    list.push(t('dashboard.wallets.noTransfers'));
  }
  if (!w.walletType.depositable) list.push(t('dashboard.wallets.noDeposits'));
  if (w.restrictedCounterparties?.length) list.push(t('dashboard.wallets.marketBadge'));
  if (w.closedAt) list.push(t('dashboard.wallets.closedBadge'));
  if (w.walletType.code === 'REPOSITORY' && w.virtualAmount !== null) {
    list.push(
      t('dashboard.wallets.virtualPoolBadge', {
        amount: formatAmount(w.virtualAmount, w.walletType.currency),
      }),
    );
  }
  if (w.walletType.code === 'CREDIT' && w.virtualAmount !== null) {
    list.push(
      t('dashboard.wallets.creditCeilingBadge', {
        amount: formatAmount(w.virtualAmount, w.walletType.currency),
      }),
    );
  }
  if (w.repositoryWalletId) list.push(t('dashboard.wallets.repositoryBackedBadge'));
  if (w.blockedAt) list.push(t('dashboard.wallets.blockedBadge'));
  return list;
}

async function onAddWallet() {
  if (!selected.value || !newWalletTypeId.value) return;
  addWalletError.value = '';
  addWalletBusy.value = true;
  try {
    await apiRequest(`/admin/customers/${selected.value.id}/wallets`, {
      method: 'POST',
      body: {
        walletTypeId: newWalletTypeId.value,
        virtualAmount:
          newWalletType.value?.hasVirtualBalance && newWalletVirtualAmount.value
            ? toMinorUnits(newWalletVirtualAmount.value, newWalletType.value.currency)
            : undefined,
        nationalCode: newWalletNationalCode.value || undefined,
      },
    });
    newWalletTypeId.value = '';
    newWalletVirtualAmount.value = '';
    newWalletNationalCode.value = '';
    await selectUser(selected.value.id);
  } catch (err) {
    addWalletError.value = err instanceof ApiError ? err.message : t('admin.customers.addWalletFailed');
  } finally {
    addWalletBusy.value = false;
  }
}

loadUsers();
loadWalletTypes();
loadRoles();
</script>

<template>
  <AdminLayout :title="t('admin.customers.title')">
    <p v-if="listError" class="admin-error">{{ listError }}</p>

    <section class="admin-card">
      <div class="toolbar">
        <div>
          <h2>{{ t('admin.customers.heading', { count: sorted.length }) }}</h2>
          <p class="admin-card-sub">{{ t('admin.customers.subtitle') }}</p>
        </div>
        <div class="toolbar-right">
          <label class="admin-search search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input v-model="search" type="search" class="admin-input" :placeholder="t('admin.customers.searchPlaceholder')" />
          </label>
          <button v-if="auth.isSuperAdmin" type="button" class="admin-btn admin-btn-ghost" :class="{ active: showImport }" @click="showImport = !showImport">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4m0 0L8 8m4-4l4 4M5 15v3a2 2 0 002 2h10a2 2 0 002-2v-3" /></svg>
            {{ t('admin.customers.bulkImport') }}
          </button>
        </div>
      </div>

      <BatchImportCard
        v-if="auth.isSuperAdmin && showImport"
        class="import-card"
        endpoint="/admin/customers/batch"
        sample-url="/samples/customers-sample.xlsx"
        :title="t('admin.batchImport.customersTitle')"
        :hint="t('admin.batchImport.customersHint')"
        @imported="loadUsers"
      />

      <div class="table-scroll">
        <table class="admin-table">
          <thead>
            <tr>
              <SortableTh :label="t('admin.customers.tableCustomer')" col-key="identity" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
              <th>{{ t('admin.customers.tableWallets') }}</th>
              <th>{{ t('admin.customers.tableAccess') }}</th>
              <SortableTh :label="t('admin.customers.tableJoined')" col-key="joined" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
              <th class="chev-col" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in pageItems" :key="u.id" class="clickable-row" data-shot="row" tabindex="0" @click="openCustomer(u.id)" @keydown.enter="openCustomer(u.id)">
              <td>
                <div class="person">
                  <span class="avatar">{{ initials(displayIdentity(u)) }}</span>
                  <span class="person-text">
                    <span class="person-name">{{ displayIdentity(u) }}</span>
                    <span class="person-sub">{{ secondaryIdentity(u) || `#${u.id.slice(0, 8)}` }}</span>
                  </span>
                </div>
              </td>
              <td>
                <span class="wallet-count">{{ walletSummary(u.id).count }}</span>
                <span class="wallet-cur">{{ walletSummary(u.id).currencies }}</span>
              </td>
              <td>
                <span v-if="u.role === 'ADMIN'" class="admin-badge admin-badge-info">{{ t('admin.admins.roleAdmin') }}</span>
                <span v-else-if="u.panelRole" class="admin-badge">{{ u.panelRole.name }}</span>
                <span v-else class="muted">{{ t('admin.customers.fullAccess') }}</span>
              </td>
              <td>
                <span class="joined">{{ formatDate(u.createdAt) }}</span>
                <span class="joined-rel">{{ formatRelative(u.createdAt) }}</span>
              </td>
              <td class="chev-col"><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg></td>
            </tr>
            <tr v-if="!pageItems.length"><td colspan="5"><div class="empty-state">{{ t('admin.customers.noCustomers') }}</div></td></tr>
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

    <AdminDrawer
      :open="drawerOpen"
      :title="selected ? displayIdentity(selected) : t('admin.customers.title')"
      :eyebrow="t('admin.customers.profile')"
      :close-label="t('admin.generalLedger.close')"
      width="720px"
      @close="drawerOpen = false"
    >
      <p v-if="detailError" class="admin-error">{{ detailError }}</p>
      <div v-if="loadingDetail" class="loading"><span v-for="i in 4" :key="i" class="skeleton" /></div>

      <template v-if="selected && !loadingDetail">
        <div class="profile-card">
          <span class="avatar avatar-lg">{{ initials(displayIdentity(selected)) }}</span>
          <div class="profile-meta">
            <span class="profile-name">{{ displayIdentity(selected) }}</span>
            <span class="profile-line">
              <span v-if="selected.phoneNumber && selected.phoneNumber !== displayIdentity(selected)">{{ selected.phoneNumber }}</span>
              <span>{{ t('admin.customers.joinedOn', { date: formatDate(selected.createdAt) }) }}</span>
              <span class="mono">#{{ selected.id.slice(0, 8) }}</span>
            </span>
          </div>
        </div>

        <p v-if="walletError" class="admin-error">{{ walletError }}</p>

        <section class="d-section">
          <span class="group-label">{{ t('admin.customers.walletsHeading', { count: selected.wallets.length }) }}</span>
          <div class="wallets">
            <article v-for="w in selected.wallets" :key="w.id" class="wallet-card" :class="{ closed: w.closedAt }">
              <div class="wallet-top" :style="{ background: cardGradient({ code: w.walletType.code, cardColor: w.walletType.cardColor }, !!w.closedAt) }">
                <span class="wallet-type">{{ w.name || w.walletType.name }}</span>
                <span class="wallet-balance">{{ formatAmount(w.balance, w.walletType.currency) }}</span>
                <span class="wallet-code">{{ w.walletType.code }} · {{ w.walletType.currency.code }}</span>
              </div>
              <div class="wallet-bottom">
                <div v-if="badges(w).length" class="badges">
                  <span v-for="b in badges(w)" :key="b" class="admin-badge">{{ b }}</span>
                </div>
                <div class="wallet-actions">
                  <router-link :to="{ name: 'admin-wallet-detail', params: { id: w.id } }" class="admin-btn admin-btn-ghost admin-btn-sm">{{ t('walletDetail.viewLink') }}</router-link>
                  <router-link v-if="w.walletType.code === 'CREDIT'" :to="{ name: 'wallet-installments', params: { walletId: w.id } }" class="admin-btn admin-btn-ghost admin-btn-sm">{{ t('dashboard.installments.viewLink') }}</router-link>
                  <span class="spacer" />
                  <button v-if="w.closedAt" type="button" class="admin-btn admin-btn-ghost admin-btn-sm" :disabled="walletBusy" @click="reopenWallet(w)">{{ t('admin.wallets.reopen') }}</button>
                  <button v-else type="button" class="admin-btn admin-btn-ghost admin-btn-sm" data-shot="edit-wallet" :disabled="walletBusy" @click="startEditWallet(w)">{{ t('admin.walletDetail.edit') }}</button>
                  <button
                    v-if="!w.closedAt"
                    type="button"
                    class="admin-btn admin-btn-danger admin-btn-sm"
                    :disabled="walletBusy || w.balance !== '0'"
                    :title="w.balance !== '0' ? t('dashboard.wallets.closeRequiresZero') : ''"
                    @click="closeWallet(w)"
                  >{{ t('admin.wallets.close') }}</button>
                </div>
              </div>
            </article>
            <p v-if="!selected.wallets.length" class="muted">{{ t('admin.customers.noWallets') }}</p>
          </div>
          <p v-if="walletNotice" class="admin-success">{{ walletNotice }}</p>
          <AdminWalletEditForm
            v-if="editingWallet"
            :wallet="editingWallet"
            class="wallet-edit-block"
            @saved="onWalletEdited"
            @cancel="editingWallet = null"
          />

          <form v-if="auth.isSuperAdmin" class="add-wallet" @submit.prevent="onAddWallet">
            <span class="add-title">{{ t('admin.customers.addWalletHeading') }}</span>
            <p v-if="addWalletError" class="admin-error">{{ addWalletError }}</p>
            <div class="add-fields">
              <select v-model="newWalletTypeId" class="admin-input" required>
                <option value="" disabled>{{ t('admin.customers.addWalletChooseType') }}</option>
                <option v-for="wt in walletTypes" :key="wt.id" :value="wt.id">{{ wt.name }} ({{ wt.currency.code }})</option>
              </select>
              <AmountInput
                v-if="newWalletType?.hasVirtualBalance"
                v-model="newWalletVirtualAmount"
                :currency="newWalletType.currency"
                min="0"
                :step="amountStep(newWalletType.currency)"
                class="admin-input"
                :placeholder="t('admin.customers.addWalletVirtualAmountPlaceholder')"
              />
              <input v-model="newWalletNationalCode" type="text" class="admin-input" :placeholder="t('admin.customers.addWalletNationalCodePlaceholder')" />
              <button type="submit" class="admin-btn admin-btn-primary" :disabled="addWalletBusy">{{ t('admin.customers.addWallet') }}</button>
            </div>
          </form>
        </section>

        <section v-if="auth.hasSection('roles')" class="d-section">
          <span class="group-label">{{ t('admin.customers.assignHeading') }}</span>
          <p class="hint">{{ t('admin.customers.assignHint') }}</p>
          <p v-if="assignError" class="admin-error">{{ assignError }}</p>
          <div class="assign-row">
            <select v-model="assignRoleDraft" class="admin-input">
              <option value="">{{ t('admin.admins.noRole') }}</option>
              <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
            </select>
            <button class="admin-btn admin-btn-primary" :disabled="assignBusy" @click="saveAssignment">{{ t('admin.admins.assignSave') }}</button>
          </div>
          <p v-if="assignSuccess" class="admin-success">{{ assignSuccess }}</p>
        </section>

        <section class="d-section">
          <span class="group-label">{{ t('admin.customers.historyHeading') }}</span>
          <ul v-if="transactions.length" class="tx-list">
            <li v-for="tx in transactions" :key="tx.id">
              <router-link :to="{ name: 'admin-transaction-detail', params: { id: tx.id } }" class="tx-row">
                <span class="type-icon" :class="transactionTypeClass(tx.type)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="TX_TYPE_ICONS[tx.type]" /></svg>
                </span>
                <span class="tx-main">
                  <span class="tx-title">
                    {{ t(`admin.transactions.${tx.type.toLowerCase()}`) }}
                    <span v-if="tx.status !== 'COMPLETED'" class="admin-badge" :class="transactionStatusClass(tx.status)">{{ t(`admin.transactions.status${tx.status}`) }}</span>
                  </span>
                  <span class="tx-sub">{{ txWallet(tx.fromWalletId) }} → {{ txWallet(tx.toWalletId) }}<template v-if="tx.note"> · {{ tx.note }}</template></span>
                </span>
                <span class="tx-amount" :class="{ pos: txSign(tx) === '+', neg: txSign(tx) === '−' }">{{ txSign(tx) }}{{ txSign(tx) ? ' ' : '' }}{{ txAmount(tx) }}</span>
                <span class="tx-time">{{ formatRelative(tx.createdAt) }}</span>
              </router-link>
            </li>
          </ul>
          <p v-else class="muted">{{ t('admin.customers.noTransactions') }}</p>
        </section>
      </template>
    </AdminDrawer>
  </AdminLayout>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: flex-start;
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
  gap: 10px;
  flex-wrap: wrap;
}
.search-box {
  width: 280px;
  max-width: 100%;
}
.import-card {
  margin-bottom: 16px;
  box-shadow: none;
  background: var(--panel-bg);
}
.wallet-count {
  font-weight: 650;
  margin-inline-end: 6px;
}
.wallet-cur {
  font-size: 0.76rem;
  color: var(--text-dimmer);
}
.muted {
  color: var(--text-dimmer);
  font-size: 0.84rem;
  margin: 0;
}
.joined {
  display: block;
  white-space: nowrap;
}
.joined-rel {
  display: block;
  font-size: 0.76rem;
  color: var(--text-dimmer);
}
.chev-col {
  width: 36px;
}
.chev {
  width: 16px;
  height: 16px;
  color: var(--text-dimmer);
  display: block;
}
[dir='rtl'] .chev {
  transform: scaleX(-1);
}
.clickable-row:hover .chev {
  color: var(--accent-blue);
}
.clickable-row:focus-visible {
  outline: none;
  box-shadow: inset var(--focus-ring);
}

/* Drawer */
.profile-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  border-radius: var(--radius-md);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  margin-bottom: 14px;
}
.profile-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.profile-name {
  font-size: 1.05rem;
  font-weight: 700;
}
.profile-line {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 0.8rem;
  color: var(--text-dim);
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--text-dimmer);
}
.d-section {
  padding: 16px;
  border-radius: var(--radius-md);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  margin-bottom: 14px;
}
.hint {
  margin: -4px 0 10px;
  font-size: 0.8rem;
  color: var(--text-dim);
}
.wallets {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.wallet-card {
  border-radius: var(--radius-sm);
  border: 1px solid var(--card-border);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.wallet-top {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 16px;
  color: #fff;
}
.wallet-type {
  font-size: 0.8rem;
  font-weight: 600;
  opacity: 0.9;
}
.wallet-balance {
  font-size: 1.25rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.wallet-code {
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  opacity: 0.8;
}
.wallet-bottom {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  flex: 1;
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.badges .admin-badge {
  font-size: 0.68rem;
  padding: 2px 8px;
}
.wallet-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: auto;
}
.spacer {
  flex: 1;
}
.wallet-edit-block {
  margin-top: 12px;
  padding: 14px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
}
.add-wallet {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--divider);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.add-title {
  font-size: 0.84rem;
  font-weight: 650;
}
.add-fields {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.add-fields .admin-input {
  flex: 1;
  min-width: 160px;
}
.assign-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.assign-row select {
  flex: 1;
}
.tx-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.tx-list li + li {
  border-top: 1px solid var(--divider);
}
.tx-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto 70px;
  align-items: center;
  gap: 12px;
  padding: 9px 6px;
  margin: 0 -6px;
  border-radius: 8px;
  color: inherit;
  text-decoration: none;
}
.tx-row:hover {
  background: var(--hover-tint);
}
.tx-row .type-icon {
  width: 30px;
  height: 30px;
}
.tx-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.tx-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 0.86rem;
}
.tx-sub {
  font-size: 0.76rem;
  color: var(--text-dimmer);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tx-amount {
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  font-size: 0.86rem;
}
.tx-amount.pos { color: var(--accent-lime); }
.tx-amount.neg { color: var(--accent-red); }
.tx-time {
  font-size: 0.74rem;
  color: var(--text-dimmer);
  text-align: end;
  white-space: nowrap;
}
.loading {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.skeleton {
  height: 60px;
  border-radius: 12px;
  background: linear-gradient(90deg, var(--panel-bg) 25%, var(--divider) 50%, var(--panel-bg) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite linear;
}
@keyframes shimmer {
  to { background-position: -200% 0; }
}
</style>
