<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { amountStep, formatAmount, toMinorUnits, type CurrencyInfo } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { displayIdentity } from '../../utils/identity';
import { ADMIN_SECTIONS, CUSTOMER_ACTIONS, FULL_ACCESS_ROLE_ID, type AdminUser, type PanelRole } from '../../types/admin';
import { useListControls } from '../../composables/useListControls';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import SortableTh from '../../components/admin/SortableTh.vue';
import ListPagination from '../../components/admin/ListPagination.vue';
import { useAuthStore } from '../../stores/auth';

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
}

interface Wallet {
  id: string;
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

const { t } = useI18n();
const auth = useAuthStore();

const users = ref<AdminUser[]>([]);
const error = ref('');
const busy = ref(false);
const promoteUserId = ref('');
const promoteRole = ref<'ADMIN' | 'SUPER_ADMIN'>('ADMIN');

// The "Panel users" table below includes every account (admins and
// customers alike) so a role's access can be managed for USER accounts
// from this same page, not just via the Customers page.
const admins = computed(() => users.value);
const customers = computed(() => users.value.filter((u) => u.role === 'USER'));

const {
  search: adminSearch,
  sortKey: adminSortKey,
  sortDir: adminSortDir,
  pageItems: adminPageItems,
  sorted: adminSorted,
  page: adminPage,
  pageSize: adminPageSize,
  totalPages: adminTotalPages,
  toggleSort: toggleAdminSort,
  goToPage: goToAdminPage,
} = useListControls(admins, {
  searchFields: (u) => [u.email, u.phoneNumber],
  sortAccessors: {
    identity: (u) => displayIdentity(u).toLowerCase(),
    role: (u) => u.role,
    access: (u) => roleLabel(u).toLowerCase(),
    since: (u) => new Date(u.createdAt).getTime(),
  },
  defaultSort: { key: 'since', dir: 'desc' },
  pageSize: 25,
});

// --- Roles: named, reusable bundles of ADMIN_SECTIONS ---
const roles = ref<PanelRole[]>([]);
const roleFormError = ref('');
const roleFormBusy = ref(false);
const newRoleName = ref('');
const newRolePermissions = ref<string[]>([]);
const editingRoleId = ref<string | null>(null);
const editRoleName = ref('');
const editRolePermissions = ref<string[]>([]);

async function loadRoles() {
  try {
    roles.value = await apiRequest<PanelRole[]>('/admin/roles');
  } catch (err) {
    roleFormError.value = err instanceof ApiError ? err.message : t('admin.admins.rolesLoadFailed');
  }
}

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

async function createRole() {
  if (!newRoleName.value.trim()) return;
  roleFormError.value = '';
  roleFormBusy.value = true;
  try {
    await apiRequest('/admin/roles', {
      method: 'POST',
      body: { name: newRoleName.value.trim(), permissions: newRolePermissions.value },
    });
    newRoleName.value = '';
    newRolePermissions.value = [];
    await loadRoles();
  } catch (err) {
    roleFormError.value = err instanceof ApiError ? err.message : t('admin.admins.roleCreateFailed');
  } finally {
    roleFormBusy.value = false;
  }
}

function startEditRole(role: PanelRole) {
  editingRoleId.value = role.id;
  editRoleName.value = role.name;
  editRolePermissions.value = [...role.permissions];
}

function cancelEditRole() {
  editingRoleId.value = null;
}

async function saveRole(role: PanelRole) {
  roleFormError.value = '';
  roleFormBusy.value = true;
  try {
    await apiRequest(`/admin/roles/${role.id}`, {
      method: 'PATCH',
      body: { name: editRoleName.value.trim(), permissions: editRolePermissions.value },
    });
    editingRoleId.value = null;
    await Promise.all([loadRoles(), load()]);
  } catch (err) {
    roleFormError.value = err instanceof ApiError ? err.message : t('admin.admins.roleSaveFailed');
  } finally {
    roleFormBusy.value = false;
  }
}

async function deleteRole(role: PanelRole) {
  roleFormError.value = '';
  roleFormBusy.value = true;
  try {
    await apiRequest(`/admin/roles/${role.id}`, { method: 'DELETE' });
    await Promise.all([loadRoles(), load()]);
  } catch (err) {
    roleFormError.value = err instanceof ApiError ? err.message : t('admin.admins.roleDeleteFailed');
  } finally {
    roleFormBusy.value = false;
  }
}

function roleLabel(user: AdminUser): string {
  if (user.role === 'SUPER_ADMIN') return t('admin.admins.fullAccess');
  return user.panelRole?.name ?? t('admin.admins.noRole');
}

// A permission key is either an admin nav section or a customer-dashboard
// action — the two arrays never overlap, so this picks the right i18n
// namespace for whichever one it belongs to.
function permissionLabel(key: string): string {
  return (ADMIN_SECTIONS as readonly string[]).includes(key)
    ? t(`adminNav.${key}`)
    : t(`customerActions.${key}`);
}

// --- Panel users: expand a row to assign a role + see their wallets ---
const expandedId = ref<string | null>(null);
const detail = ref<UserDetail | null>(null);
const detailError = ref('');
const assignRoleDraft = ref('');
const assignBusy = ref(false);
const assignSuccess = ref('');

const openAdjustId = ref<string | null>(null);
const adjustAmount = ref<Record<string, string>>({});
const adjustReason = ref<Record<string, string>>({});
const walletBusy = ref(false);
const walletError = ref('');

async function load() {
  error.value = '';
  try {
    users.value = await apiRequest<AdminUser[]>('/admin/users');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.admins.loadFailed');
  }
}

async function promote() {
  if (!promoteUserId.value) return;
  error.value = '';
  busy.value = true;
  try {
    await apiRequest(`/admin/users/${promoteUserId.value}/role`, {
      method: 'PATCH',
      body: { role: promoteRole.value },
    });
    promoteUserId.value = '';
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.admins.promoteFailed');
  } finally {
    busy.value = false;
  }
}

async function setRole(user: AdminUser, role: 'USER' | 'ADMIN') {
  error.value = '';
  busy.value = true;
  try {
    await apiRequest(`/admin/users/${user.id}/role`, {
      method: 'PATCH',
      body: { role },
    });
    if (expandedId.value === user.id) expandedId.value = null;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.admins.demoteFailed');
  } finally {
    busy.value = false;
  }
}

async function loadDetail(user: AdminUser) {
  detailError.value = '';
  walletError.value = '';
  assignSuccess.value = '';
  try {
    const found = await apiRequest<UserDetail>(`/admin/users/${user.id}`);
    detail.value = found;
    assignRoleDraft.value = found.panelRole?.id ?? '';
  } catch (err) {
    detailError.value = err instanceof ApiError ? err.message : t('admin.admins.detailFailed');
  }
}

async function toggleExpand(user: AdminUser) {
  if (expandedId.value === user.id) {
    expandedId.value = null;
    detail.value = null;
    return;
  }
  expandedId.value = user.id;
  openAdjustId.value = null;
  await loadDetail(user);
}

async function saveAssignment(user: AdminUser) {
  detailError.value = '';
  assignSuccess.value = '';
  assignBusy.value = true;
  try {
    await apiRequest(`/admin/users/${user.id}/panel-role`, {
      method: 'PATCH',
      body: { panelRoleId: assignRoleDraft.value || null },
    });
    assignSuccess.value = t('admin.admins.assignSaved');
    await Promise.all([load(), loadDetail(user)]);
  } catch (err) {
    detailError.value = err instanceof ApiError ? err.message : t('admin.admins.assignFailed');
  } finally {
    assignBusy.value = false;
  }
}

function toggleAdjust(walletId: string) {
  openAdjustId.value = openAdjustId.value === walletId ? null : walletId;
}

async function adjustWallet(user: AdminUser, wallet: Wallet) {
  walletError.value = '';
  walletBusy.value = true;
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
    await loadDetail(user);
  } catch (err) {
    walletError.value = err instanceof ApiError ? err.message : t('admin.wallets.adjustFailed');
  } finally {
    walletBusy.value = false;
  }
}

async function reopenWallet(user: AdminUser, wallet: Wallet) {
  walletError.value = '';
  walletBusy.value = true;
  try {
    await apiRequest(`/admin/wallets/${wallet.id}/reopen`, { method: 'POST' });
    await loadDetail(user);
  } catch (err) {
    walletError.value = err instanceof ApiError ? err.message : t('admin.wallets.reopenFailed');
  } finally {
    walletBusy.value = false;
  }
}

async function closeWallet(user: AdminUser, wallet: Wallet) {
  walletError.value = '';
  walletBusy.value = true;
  try {
    await apiRequest(`/admin/wallets/${wallet.id}`, { method: 'DELETE' });
    await loadDetail(user);
  } catch (err) {
    walletError.value = err instanceof ApiError ? err.message : t('admin.wallets.closeFailed');
  } finally {
    walletBusy.value = false;
  }
}

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

load();
loadRoles();
</script>

<template>
  <AdminLayout :title="t('admin.admins.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>
    <p v-if="!auth.isSuperAdmin && !auth.hasSection('roles')" class="hint">{{ t('admin.admins.readOnlyHint') }}</p>

    <div v-if="auth.isSuperAdmin" class="admin-card">
      <h2>{{ t('admin.admins.promoteHeading') }}</h2>
      <div class="promote-row">
        <select v-model="promoteUserId" class="admin-input">
          <option value="" disabled>{{ t('admin.admins.chooseCustomer') }}</option>
          <option v-for="c in customers" :key="c.id" :value="c.id">{{ displayIdentity(c) }}</option>
        </select>
        <select v-model="promoteRole" class="admin-input">
          <option value="ADMIN">{{ t('admin.admins.roleAdmin') }}</option>
          <option value="SUPER_ADMIN">{{ t('admin.admins.roleSuperAdmin') }}</option>
        </select>
        <button class="admin-btn admin-btn-primary" :disabled="busy || !promoteUserId" @click="promote">
          {{ t('admin.admins.promoteButton') }}
        </button>
      </div>
    </div>

    <div v-if="auth.hasSection('roles')" class="admin-card">
      <h2>{{ t('admin.admins.rolesHeading', { count: roles.length }) }}</h2>
      <p class="hint">{{ t('admin.admins.rolesHint') }}</p>
      <p v-if="roleFormError" class="admin-error">{{ roleFormError }}</p>

      <div class="roles-list">
        <article v-for="role in roles" :key="role.id" class="role-card">
          <template v-if="editingRoleId === role.id">
            <input v-model="editRoleName" type="text" class="admin-input" />
            <h4>{{ t('admin.admins.roleSectionsLabel') }}</h4>
            <div class="permissions-grid">
              <label v-for="section in ADMIN_SECTIONS" :key="section" class="permission-checkbox">
                <input
                  type="checkbox"
                  :checked="editRolePermissions.includes(section)"
                  @change="editRolePermissions = toggleInList(editRolePermissions, section)"
                />
                {{ t(`adminNav.${section}`) }}
              </label>
            </div>
            <h4>{{ t('admin.admins.roleCustomerActionsLabel') }}</h4>
            <div class="permissions-grid">
              <label v-for="action in CUSTOMER_ACTIONS" :key="action" class="permission-checkbox">
                <input
                  type="checkbox"
                  :checked="editRolePermissions.includes(action)"
                  @change="editRolePermissions = toggleInList(editRolePermissions, action)"
                />
                {{ t(`customerActions.${action}`) }}
              </label>
            </div>
            <div class="role-card-actions">
              <button class="admin-btn admin-btn-primary" :disabled="roleFormBusy" @click="saveRole(role)">
                {{ t('admin.admins.roleSave') }}
              </button>
              <button class="admin-btn admin-btn-ghost" @click="cancelEditRole">{{ t('admin.admins.roleCancel') }}</button>
            </div>
          </template>
          <template v-else>
            <span class="role-name">{{ role.name }}</span>
            <div class="badges">
              <span v-for="section in role.permissions" :key="section" class="admin-badge">{{ permissionLabel(section) }}</span>
              <span v-if="!role.permissions.length" class="hint">{{ t('admin.admins.roleNoSections') }}</span>
            </div>
            <div class="role-card-actions">
              <button class="admin-btn admin-btn-ghost" @click="startEditRole(role)">{{ t('admin.admins.roleEdit') }}</button>
              <button
                v-if="role.id !== FULL_ACCESS_ROLE_ID"
                class="admin-btn admin-btn-danger"
                :disabled="roleFormBusy"
                @click="deleteRole(role)"
              >
                {{ t('admin.admins.roleDelete') }}
              </button>
            </div>
          </template>
        </article>
      </div>

      <h3>{{ t('admin.admins.roleCreateHeading') }}</h3>
      <form class="role-create-form" @submit.prevent="createRole">
        <input
          v-model="newRoleName"
          type="text"
          class="admin-input"
          :placeholder="t('admin.admins.roleNamePlaceholder')"
          required
        />
        <h4>{{ t('admin.admins.roleSectionsLabel') }}</h4>
        <div class="permissions-grid">
          <label v-for="section in ADMIN_SECTIONS" :key="section" class="permission-checkbox">
            <input
              type="checkbox"
              :checked="newRolePermissions.includes(section)"
              @change="newRolePermissions = toggleInList(newRolePermissions, section)"
            />
            {{ t(`adminNav.${section}`) }}
          </label>
        </div>
        <h4>{{ t('admin.admins.roleCustomerActionsLabel') }}</h4>
        <div class="permissions-grid">
          <label v-for="action in CUSTOMER_ACTIONS" :key="action" class="permission-checkbox">
            <input
              type="checkbox"
              :checked="newRolePermissions.includes(action)"
              @change="newRolePermissions = toggleInList(newRolePermissions, action)"
            />
            {{ t(`customerActions.${action}`) }}
          </label>
        </div>
        <button type="submit" class="admin-btn admin-btn-primary" :disabled="roleFormBusy || !newRoleName.trim()">
          {{ t('admin.admins.roleCreate') }}
        </button>
      </form>
    </div>

    <div class="admin-card">
      <div class="filter-row">
        <h2>{{ t('admin.admins.adminsHeading', { count: adminSorted.length }) }}</h2>
        <input v-model="adminSearch" class="admin-input" :placeholder="t('admin.admins.searchPlaceholder')" />
      </div>
      <table class="admin-table">
        <thead>
          <tr>
            <SortableTh :label="t('admin.admins.tableEmail')" col-key="identity" :active-key="adminSortKey" :dir="adminSortDir" @sort="toggleAdminSort" />
            <SortableTh :label="t('admin.admins.tableRole')" col-key="role" :active-key="adminSortKey" :dir="adminSortDir" @sort="toggleAdminSort" />
            <SortableTh :label="t('admin.admins.tableSections')" col-key="access" :active-key="adminSortKey" :dir="adminSortDir" @sort="toggleAdminSort" />
            <SortableTh :label="t('admin.admins.tableSince')" col-key="since" :active-key="adminSortKey" :dir="adminSortDir" @sort="toggleAdminSort" />
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="a in adminPageItems" :key="a.id">
            <tr class="admin-row" @click="toggleExpand(a)">
              <td>{{ displayIdentity(a) }}</td>
              <td>
                {{
                  a.role === 'SUPER_ADMIN'
                    ? t('admin.admins.roleSuperAdmin')
                    : a.role === 'ADMIN'
                      ? t('admin.admins.roleAdmin')
                      : t('admin.admins.roleUser')
                }}
              </td>
              <td><span class="admin-badge">{{ roleLabel(a) }}</span></td>
              <td>{{ formatDate(a.createdAt) }}</td>
              <td @click.stop>
                <span v-if="a.email === auth.email" class="you-badge">{{ t('admin.admins.you') }}</span>
                <template v-else-if="auth.isSuperAdmin && a.role !== 'USER'">
                  <button
                    v-if="a.role === 'SUPER_ADMIN'"
                    class="admin-btn admin-btn-danger"
                    :disabled="busy"
                    @click="setRole(a, 'ADMIN')"
                  >
                    {{ t('admin.admins.demoteToAdmin') }}
                  </button>
                  <button
                    v-else
                    class="admin-btn admin-btn-danger"
                    :disabled="busy"
                    @click="setRole(a, 'USER')"
                  >
                    {{ t('admin.admins.demote') }}
                  </button>
                </template>
              </td>
            </tr>
            <tr v-if="expandedId === a.id">
              <td colspan="5">
                <div class="detail-panel">
                  <p v-if="detailError" class="admin-error">{{ detailError }}</p>

                  <div v-if="a.role === 'ADMIN' || a.role === 'USER'" class="assign-block">
                    <h3>{{ t('admin.admins.assignHeading') }}</h3>
                    <p v-if="a.role === 'USER'" class="hint">{{ t('admin.customers.assignHint') }}</p>
                    <div class="assign-row">
                      <select v-model="assignRoleDraft" class="admin-input" :disabled="!auth.hasSection('roles')">
                        <option value="">{{ t('admin.admins.noRole') }}</option>
                        <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
                      </select>
                      <button
                        v-if="auth.hasSection('roles')"
                        class="admin-btn admin-btn-primary"
                        :disabled="assignBusy"
                        @click="saveAssignment(a)"
                      >
                        {{ t('admin.admins.assignSave') }}
                      </button>
                    </div>
                    <p v-if="assignSuccess" class="admins-success">{{ assignSuccess }}</p>
                  </div>

                  <h3>{{ t('admin.admins.walletsHeading') }}</h3>
                  <p v-if="walletError" class="admin-error">{{ walletError }}</p>
                  <div v-if="detail" class="wallets">
                    <article v-for="w in detail.wallets" :key="w.id" class="wallet-card">
                      <span class="wallet-type">{{ w.walletType.name }} · {{ w.walletType.currency.code }}</span>
                      <span class="wallet-balance">{{ formatAmount(w.balance, w.walletType.currency) }}</span>
                      <div class="badges">
                        <span v-for="b in badges(w)" :key="b" class="admin-badge">{{ b }}</span>
                      </div>
                      <div v-if="auth.hasSection('wallets')" class="wallet-card-actions">
                        <button
                          type="button"
                          class="admin-btn admin-btn-ghost"
                          :disabled="!!w.closedAt"
                          @click="toggleAdjust(w.id)"
                        >
                          {{ t('admin.wallets.adjust') }}
                        </button>
                        <button
                          v-if="w.closedAt"
                          type="button"
                          class="admin-btn admin-btn-ghost"
                          :disabled="walletBusy"
                          @click="reopenWallet(a, w)"
                        >
                          {{ t('admin.wallets.reopen') }}
                        </button>
                        <button
                          v-else
                          type="button"
                          class="admin-btn admin-btn-danger"
                          :disabled="walletBusy || w.balance !== '0'"
                          :title="w.balance !== '0' ? t('dashboard.wallets.closeRequiresZero') : ''"
                          @click="closeWallet(a, w)"
                        >
                          {{ t('admin.wallets.close') }}
                        </button>
                      </div>
                      <div v-if="openAdjustId === w.id" class="adjust-row">
                        <input
                          v-model="adjustAmount[w.id]"
                          type="number"
                          :step="amountStep(w.walletType.currency)"
                          class="admin-input"
                          :placeholder="t('admin.wallets.amountPlaceholder')"
                        />
                        <input
                          v-model="adjustReason[w.id]"
                          type="text"
                          class="admin-input"
                          :placeholder="t('admin.wallets.reasonPlaceholder')"
                        />
                        <button class="admin-btn admin-btn-primary" :disabled="walletBusy" @click="adjustWallet(a, w)">
                          {{ t('admin.wallets.save') }}
                        </button>
                      </div>
                    </article>
                    <p v-if="!detail.wallets.length" class="hint">{{ t('admin.admins.noWallets') }}</p>
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="!adminPageItems.length"><td colspan="5">{{ t('admin.admins.noAdmins') }}</td></tr>
        </tbody>
      </table>
      <ListPagination
        :page="adminPage"
        :total-pages="adminTotalPages"
        :total="adminSorted.length"
        :page-size="adminPageSize"
        @update:page="goToAdminPage"
        @update:page-size="adminPageSize = $event"
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
.filter-row input {
  min-width: 240px;
}
.promote-row {
  display: flex;
  gap: 10px;
}
.promote-row select {
  flex: 1;
}
.you-badge {
  font-size: 0.75rem;
  color: var(--text-dimmer);
}
.admin-row {
  cursor: pointer;
}
.detail-panel {
  padding: 14px 4px;
}
.assign-block {
  margin-bottom: 18px;
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
.permissions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
  margin: 10px 0;
}
.permission-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
}
.admins-success {
  color: var(--accent-lime);
  font-size: 0.85rem;
}
h3 {
  font-size: 0.85rem;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin: 0 0 10px;
}
h4 {
  font-size: 0.75rem;
  color: var(--text-dimmer);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin: 4px 0 0;
}
.roles-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 10px 0 20px;
}
.role-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
  padding: 14px;
}
.role-name {
  font-weight: 700;
}
.role-card-actions {
  display: flex;
  gap: 8px;
}
.role-create-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.role-create-form .admin-input {
  max-width: 320px;
}
.wallets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
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
  font-size: 0.72rem;
  color: var(--text-dimmer);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.wallet-balance {
  font-size: 1.3rem;
  font-weight: 700;
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.wallet-card-actions {
  display: flex;
  gap: 8px;
}
.adjust-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
