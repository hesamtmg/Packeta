<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { amountStep, formatAmount, toMinorUnits, type CurrencyInfo } from '../../utils/currency';
import { formatDate, formatDateTime } from '../../utils/date';
import { displayIdentity } from '../../utils/identity';
import {
  walletLookup,
  transactionCurrency,
  partyWalletLabel,
  partyOwner,
  transactionTypeClass,
  transactionStatusClass,
  type AdminUser,
  type AdminWallet,
  type AdminTransaction,
  type PanelRole,
} from '../../types/admin';
import { useListControls } from '../../composables/useListControls';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import BatchImportCard from '../../components/admin/BatchImportCard.vue';
import SortableTh from '../../components/admin/SortableTh.vue';
import ListPagination from '../../components/admin/ListPagination.vue';
import { useAuthStore } from '../../stores/auth';

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
  hasVirtualBalance: boolean;
}

interface Wallet {
  id: string;
  balance: string;
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
const adjustError = ref('');
const addWalletError = ref('');
const busy = ref(false);
const addWalletBusy = ref(false);

const adjustAmount = ref<Record<string, string>>({});
const adjustReason = ref<Record<string, string>>({});

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
  searchFields: (u) => [u.email, u.phoneNumber],
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
  adjustError.value = '';
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

async function adjust(wallet: Wallet) {
  adjustError.value = '';
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
    if (selected.value) await selectUser(selected.value.id);
  } catch (err) {
    adjustError.value = err instanceof ApiError ? err.message : t('admin.customers.adjustFailed');
  } finally {
    busy.value = false;
  }
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

    <div class="admin-card">
      <div class="filter-row">
        <h2>{{ t('admin.customers.heading', { count: sorted.length }) }}</h2>
        <input v-model="search" class="admin-input" :placeholder="t('admin.customers.searchPlaceholder')" />
      </div>
      <table class="admin-table">
        <thead>
          <tr>
            <SortableTh :label="t('admin.customers.tableEmail')" col-key="identity" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
            <SortableTh :label="t('admin.customers.tableJoined')" col-key="joined" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
            <th>{{ t('admin.customers.tableId') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in pageItems" :key="u.id">
            <td>{{ displayIdentity(u) }}</td>
            <td>{{ formatDate(u.createdAt) }}</td>
            <td class="mono-id">{{ u.id }}</td>
            <td><button class="admin-btn admin-btn-ghost" @click="selectUser(u.id)">{{ t('admin.customers.view') }}</button></td>
          </tr>
          <tr v-if="!pageItems.length"><td colspan="4">{{ t('admin.customers.noCustomers') }}</td></tr>
        </tbody>
      </table>
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
      endpoint="/admin/customers/batch"
      sample-url="/samples/customers-sample.xlsx"
      :title="t('admin.batchImport.customersTitle')"
      :hint="t('admin.batchImport.customersHint')"
      @imported="loadUsers"
    />

    <div v-if="selected" class="admin-card">
      <h2>{{ displayIdentity(selected) }}</h2>
      <p v-if="detailError" class="admin-error">{{ detailError }}</p>
      <p v-if="adjustError" class="admin-error">{{ adjustError }}</p>

      <div v-if="auth.hasSection('roles')" class="assign-block">
        <h3>{{ t('admin.customers.assignHeading') }}</h3>
        <p class="hint">{{ t('admin.customers.assignHint') }}</p>
        <p v-if="assignError" class="admin-error">{{ assignError }}</p>
        <div class="assign-row">
          <select v-model="assignRoleDraft" class="admin-input">
            <option value="">{{ t('admin.admins.noRole') }}</option>
            <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
          </select>
          <button class="admin-btn admin-btn-primary" :disabled="assignBusy" @click="saveAssignment">
            {{ t('admin.admins.assignSave') }}
          </button>
        </div>
        <p v-if="assignSuccess" class="admins-success">{{ assignSuccess }}</p>
      </div>

      <div class="wallets">
        <article v-for="w in selected.wallets" :key="w.id" class="wallet-card">
          <router-link :to="{ name: 'admin-wallet-detail', params: { id: w.id } }" class="wallet-type">
            {{ w.walletType.name }} · {{ w.walletType.currency.code }}
          </router-link>
          <span class="wallet-balance">{{ formatAmount(w.balance, w.walletType.currency) }}</span>
          <span class="mono-id">{{ w.id }}</span>
          <div class="adjust-form">
            <input
              v-model="adjustAmount[w.id]"
              type="number"
              :step="amountStep(w.walletType.currency)"
              class="admin-input"
              :placeholder="t('admin.customers.amountPlaceholder')"
            />
            <input v-model="adjustReason[w.id]" type="text" class="admin-input" :placeholder="t('admin.customers.reasonPlaceholder')" />
            <button class="admin-btn admin-btn-primary" :disabled="busy" @click="adjust(w)">{{ t('admin.customers.adjust') }}</button>
          </div>
        </article>
      </div>

      <h3>{{ t('admin.customers.addWalletHeading') }}</h3>
      <p v-if="addWalletError" class="admin-error">{{ addWalletError }}</p>
      <form class="add-wallet-form" @submit.prevent="onAddWallet">
        <select v-model="newWalletTypeId" class="admin-input" required>
          <option value="" disabled>{{ t('admin.customers.addWalletChooseType') }}</option>
          <option v-for="wt in walletTypes" :key="wt.id" :value="wt.id">
            {{ wt.name }} ({{ wt.currency.code }})
          </option>
        </select>
        <input
          v-if="newWalletType?.hasVirtualBalance"
          v-model="newWalletVirtualAmount"
          type="number"
          min="0"
          :step="amountStep(newWalletType.currency)"
          class="admin-input"
          :placeholder="t('admin.customers.addWalletVirtualAmountPlaceholder')"
        />
        <input
          v-model="newWalletNationalCode"
          type="text"
          class="admin-input"
          :placeholder="t('admin.customers.addWalletNationalCodePlaceholder')"
        />
        <button type="submit" class="admin-btn admin-btn-primary" :disabled="addWalletBusy">
          {{ t('admin.customers.addWallet') }}
        </button>
      </form>

      <h3>{{ t('admin.customers.historyHeading') }}</h3>
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t('admin.customers.tableType') }}</th>
            <th>{{ t('admin.transactions.tableStatus') }}</th>
            <th>{{ t('admin.customers.tableAmount') }}</th>
            <th>{{ t('admin.transactions.tableFrom') }}</th>
            <th>{{ t('admin.transactions.tableTo') }}</th>
            <th>{{ t('admin.customers.tableNote') }}</th>
            <th>{{ t('admin.transactions.tableId') }}</th>
            <th>{{ t('admin.customers.tableDate') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="tx in transactions"
            :key="tx.id"
            class="tx-row-clickable"
            @click="$router.push({ name: 'admin-transaction-detail', params: { id: tx.id } })"
          >
            <td><span class="admin-badge" :class="transactionTypeClass(tx.type)">{{ t(`admin.transactions.${tx.type.toLowerCase()}`) }}</span></td>
            <td><span class="admin-badge" :class="transactionStatusClass(tx.status)">{{ t(`admin.transactions.status${tx.status}`) }}</span></td>
            <td>{{ txCurrency(tx) ? formatAmount(tx.amount, txCurrency(tx)!) : tx.amount }}</td>
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
                <span class="money-chip money-out">− {{ txCurrency(tx) ? formatAmount(tx.amount, txCurrency(tx)!) : tx.amount }}</span>
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
                <span class="money-chip money-in">+ {{ txCurrency(tx) ? formatAmount(tx.amount, txCurrency(tx)!) : tx.amount }}</span>
              </div>
              <span v-else class="party-empty">{{ t('admin.transactions.externalDestination') }}</span>
            </td>
            <td>{{ tx.note ?? t('common.none') }}</td>
            <td class="mono-id">{{ tx.id }}</td>
            <td>{{ formatDateTime(tx.createdAt) }}</td>
          </tr>
          <tr v-if="!transactions.length"><td colspan="8">{{ t('admin.customers.noTransactions') }}</td></tr>
        </tbody>
      </table>
    </div>
  </AdminLayout>
</template>

<style scoped>
.tx-row-clickable {
  cursor: pointer;
}
.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 12px;
}
.filter-row h2 {
  margin: 0;
  white-space: nowrap;
}
.filter-row input {
  min-width: 260px;
}
h3 {
  font-size: 0.85rem;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin: 20px 0 10px;
}
.assign-block {
  margin-bottom: 10px;
}
.assign-row {
  display: flex;
  gap: 10px;
  margin: 10px 0;
}
.assign-row select {
  flex: 1;
  max-width: 320px;
}
.admins-success {
  color: var(--accent-lime);
  font-size: 0.85rem;
}
.wallets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
  margin-top: 8px;
}
.wallet-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
  padding: 14px;
}
.wallet-type {
  font-size: 0.78rem;
  color: var(--text-dim);
  text-transform: uppercase;
}
.wallet-balance {
  font-size: 1.3rem;
  font-weight: 700;
}
.adjust-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.add-wallet-form {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.add-wallet-form .admin-input {
  flex: 1;
  min-width: 180px;
}
</style>
