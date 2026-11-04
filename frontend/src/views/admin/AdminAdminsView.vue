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
import AdminDrawer from '../../components/admin/AdminDrawer.vue';
import { cardGradient } from '../../utils/cardTheme';
import { initials } from '../../utils/adminFormat';
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
  cardColor?: string | null;
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

// The "Panel users" table below includes every account (admins and
// customers alike) so a role's access can be managed for USER accounts
// from this same page, not just via the Customers page.
const roleFilter = ref<'' | 'staff' | 'USER'>('');
const filteredUsers = computed(() => {
  if (roleFilter.value === 'staff') return users.value.filter((u) => u.role !== 'USER');
  if (roleFilter.value === 'USER') return users.value.filter((u) => u.role === 'USER');
  return users.value;
});
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
} = useListControls(filteredUsers, {
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
const newRoleIsDefaultForSignup = ref(false);
const editingRoleId = ref<string | null>(null);
const editRoleName = ref('');
const editRolePermissions = ref<string[]>([]);
const editRoleIsDefaultForSignup = ref(false);

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
      body: {
        name: newRoleName.value.trim(),
        permissions: newRolePermissions.value,
        isDefaultForSignup: newRoleIsDefaultForSignup.value,
      },
    });
    newRoleName.value = '';
    newRolePermissions.value = [];
    newRoleIsDefaultForSignup.value = false;
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
  editRoleIsDefaultForSignup.value = role.isDefaultForSignup;
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
      body: {
        name: editRoleName.value.trim(),
        permissions: editRolePermissions.value,
        isDefaultForSignup: editRoleIsDefaultForSignup.value,
      },
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
      body: { role: 'ADMIN' },
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

// --- Page layout state (tabs + drawers) ---
const activeTab = ref<'users' | 'roles'>('users');
const staffCount = computed(() => users.value.filter((u) => u.role !== 'USER').length);
const selectedUser = computed(() => users.value.find((u) => u.id === expandedId.value) ?? null);
function closeUserDrawer() {
  expandedId.value = null;
  detail.value = null;
}
function roleName(role: AdminUser['role']): string {
  return role === 'SUPER_ADMIN' ? t('admin.admins.roleSuperAdmin') : role === 'ADMIN' ? t('admin.admins.roleAdmin') : t('admin.admins.roleUser');
}
function roleBadgeClass(role: AdminUser['role']): string {
  return role === 'SUPER_ADMIN' ? 'admin-badge-danger' : role === 'ADMIN' ? 'admin-badge-info' : '';
}
function membersOf(role: PanelRole): number {
  return users.value.filter((u) => u.panelRole?.id === role.id).length;
}
function sectionsOf(role: PanelRole) {
  return role.permissions.filter((p) => (ADMIN_SECTIONS as readonly string[]).includes(p));
}
function actionsOf(role: PanelRole) {
  return role.permissions.filter((p) => (CUSTOMER_ACTIONS as readonly string[]).includes(p));
}

// One drawer edits either a new role or an existing one; these proxies point
// the form at whichever draft (new* / edit*) is active.
const roleDrawer = ref<'create' | 'edit' | null>(null);
const draftName = computed({
  get: () => (roleDrawer.value === 'edit' ? editRoleName.value : newRoleName.value),
  set: (v: string) => (roleDrawer.value === 'edit' ? (editRoleName.value = v) : (newRoleName.value = v)),
});
const draftPermissions = computed({
  get: () => (roleDrawer.value === 'edit' ? editRolePermissions.value : newRolePermissions.value),
  set: (v: string[]) => (roleDrawer.value === 'edit' ? (editRolePermissions.value = v) : (newRolePermissions.value = v)),
});
const draftDefault = computed({
  get: () => (roleDrawer.value === 'edit' ? editRoleIsDefaultForSignup.value : newRoleIsDefaultForSignup.value),
  set: (v: boolean) => (roleDrawer.value === 'edit' ? (editRoleIsDefaultForSignup.value = v) : (newRoleIsDefaultForSignup.value = v)),
});
const editingRole = computed(() => roles.value.find((r) => r.id === editingRoleId.value) ?? null);
function openCreateRole() {
  roleFormError.value = '';
  newRoleName.value = '';
  newRolePermissions.value = [];
  newRoleIsDefaultForSignup.value = false;
  roleDrawer.value = 'create';
}
function openEditRole(role: PanelRole) {
  roleFormError.value = '';
  startEditRole(role);
  roleDrawer.value = 'edit';
}
function closeRoleDrawer() {
  roleDrawer.value = null;
  cancelEditRole();
}
function setAll(keys: readonly string[], on: boolean) {
  const rest = draftPermissions.value.filter((p) => !keys.includes(p));
  draftPermissions.value = on ? [...rest, ...keys] : rest;
}
async function submitRole() {
  if (roleDrawer.value === 'create') {
    await createRole();
    if (!roleFormError.value) roleDrawer.value = null;
  } else if (editingRole.value) {
    await saveRole(editingRole.value);
    if (!roleFormError.value) roleDrawer.value = null;
  }
}
const confirmDeleteRole = ref(false);
async function removeEditingRole() {
  if (!editingRole.value) return;
  if (!confirmDeleteRole.value) {
    confirmDeleteRole.value = true;
    return;
  }
  confirmDeleteRole.value = false;
  await deleteRole(editingRole.value);
  if (!roleFormError.value) closeRoleDrawer();
}

load();
loadRoles();
</script>

<template>
  <AdminLayout :title="t('admin.admins.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>
    <p v-if="!auth.isSuperAdmin && !auth.hasSection('roles')" class="readonly">{{ t('admin.admins.readOnlyHint') }}</p>

    <div class="page-tabs">
      <div class="segmented" role="tablist">
        <button type="button" role="tab" :aria-selected="activeTab === 'users'" :class="{ active: activeTab === 'users' }" @click="activeTab = 'users'">
          {{ t('admin.admins.tabUsers') }} <span class="count">{{ users.length }}</span>
        </button>
        <button v-if="auth.hasSection('roles')" type="button" role="tab" data-shot="roles-tab" :aria-selected="activeTab === 'roles'" :class="{ active: activeTab === 'roles' }" @click="activeTab = 'roles'">
          {{ t('admin.admins.tabRoles') }} <span class="count">{{ roles.length }}</span>
        </button>
      </div>
    </div>

    <!-- Panel users -->
    <template v-if="activeTab === 'users'">
      <section v-if="auth.isSuperAdmin" class="admin-card promote">
        <span class="promote-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z" /><path d="M12 9v6M9 12h6" /></svg></span>
        <div class="promote-text">
          <strong>{{ t('admin.admins.promoteHeading') }}</strong>
          <span>{{ t('admin.admins.promoteHint') }}</span>
        </div>
        <div class="promote-form">
          <select v-model="promoteUserId" class="admin-input">
            <option value="" disabled>{{ t('admin.admins.chooseCustomer') }}</option>
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ displayIdentity(c) }}</option>
          </select>
          <button class="admin-btn admin-btn-primary" :disabled="busy || !promoteUserId" @click="promote">{{ t('admin.admins.promoteButton') }}</button>
        </div>
      </section>

      <section class="admin-card">
        <div class="toolbar">
          <h2>{{ t('admin.admins.adminsHeading', { count: adminSorted.length }) }}</h2>
          <div class="toolbar-right">
            <div class="segmented">
              <button type="button" :class="{ active: !roleFilter }" @click="roleFilter = ''">{{ t('admin.transactions.allStatuses') }}</button>
              <button type="button" :class="{ active: roleFilter === 'staff' }" @click="roleFilter = 'staff'">{{ t('admin.admins.filterStaff') }} <span class="count">{{ staffCount }}</span></button>
              <button type="button" :class="{ active: roleFilter === 'USER' }" @click="roleFilter = 'USER'">{{ t('admin.admins.filterCustomers') }} <span class="count">{{ customers.length }}</span></button>
            </div>
            <label class="admin-search search-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input v-model="adminSearch" type="search" class="admin-input" :placeholder="t('admin.admins.searchPlaceholder')" />
            </label>
          </div>
        </div>
        <div class="table-scroll">
          <table class="admin-table">
            <thead>
              <tr>
                <SortableTh :label="t('admin.admins.tableUser')" col-key="identity" :active-key="adminSortKey" :dir="adminSortDir" @sort="toggleAdminSort" />
                <SortableTh :label="t('admin.admins.tableRole')" col-key="role" :active-key="adminSortKey" :dir="adminSortDir" @sort="toggleAdminSort" />
                <SortableTh :label="t('admin.admins.tableSections')" col-key="access" :active-key="adminSortKey" :dir="adminSortDir" @sort="toggleAdminSort" />
                <SortableTh :label="t('admin.customers.tableJoined')" col-key="since" :active-key="adminSortKey" :dir="adminSortDir" @sort="toggleAdminSort" />
                <th class="actions-col" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in adminPageItems" :key="a.id" class="clickable-row" data-shot="row" tabindex="0" @click="toggleExpand(a)" @keydown.enter="toggleExpand(a)">
                <td>
                  <div class="person">
                    <span class="avatar" :class="{ 'avatar-staff': a.role !== 'USER' }">{{ initials(displayIdentity(a)) }}</span>
                    <span class="person-text">
                      <span class="person-name">{{ displayIdentity(a) }} <span v-if="a.email === auth.email" class="you">{{ t('admin.admins.you') }}</span></span>
                      <span class="person-sub">#{{ a.id.slice(0, 8) }}</span>
                    </span>
                  </div>
                </td>
                <td><span class="admin-badge" :class="roleBadgeClass(a.role)">{{ roleName(a.role) }}</span></td>
                <td>
                  <span v-if="a.role === 'SUPER_ADMIN'" class="access full">{{ t('admin.admins.fullAccess') }}</span>
                  <span v-else-if="a.panelRole" class="access">{{ a.panelRole.name }}</span>
                  <span v-else class="access none">{{ t('admin.admins.noRole') }}</span>
                </td>
                <td class="since">{{ formatDate(a.createdAt) }}</td>
                <td class="actions-col" @click.stop>
                  <template v-if="a.email !== auth.email && auth.isSuperAdmin && a.role !== 'USER'">
                    <button v-if="a.role === 'SUPER_ADMIN'" class="admin-btn admin-btn-ghost admin-btn-sm" :disabled="busy" @click="setRole(a, 'ADMIN')">{{ t('admin.admins.demoteToAdmin') }}</button>
                    <button v-else class="admin-btn admin-btn-ghost admin-btn-sm danger-text" :disabled="busy" @click="setRole(a, 'USER')">{{ t('admin.admins.demote') }}</button>
                  </template>
                </td>
              </tr>
              <tr v-if="!adminPageItems.length"><td colspan="5"><div class="empty-state">{{ t('admin.admins.noAdmins') }}</div></td></tr>
            </tbody>
          </table>
        </div>
        <ListPagination
          :page="adminPage"
          :total-pages="adminTotalPages"
          :total="adminSorted.length"
          :page-size="adminPageSize"
          @update:page="goToAdminPage"
          @update:page-size="adminPageSize = $event"
        />
      </section>
    </template>

    <!-- Roles -->
    <template v-else>
      <section class="admin-card">
        <div class="toolbar">
          <div>
            <h2>{{ t('admin.admins.rolesHeading', { count: roles.length }) }}</h2>
            <p class="admin-card-sub">{{ t('admin.admins.rolesHint') }}</p>
          </div>
          <button type="button" class="admin-btn admin-btn-primary" @click="openCreateRole">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
            {{ t('admin.admins.newRole') }}
          </button>
        </div>
        <p v-if="roleFormError && !roleDrawer" class="admin-error">{{ roleFormError }}</p>
        <div class="roles">
          <button v-for="role in roles" :key="role.id" type="button" class="role-card" @click="openEditRole(role)">
            <span class="role-head">
              <span class="role-name">{{ role.name }}</span>
              <span v-if="role.id === FULL_ACCESS_ROLE_ID" class="admin-badge admin-badge-info">{{ t('admin.admins.builtIn') }}</span>
              <span v-if="role.isDefaultForSignup" class="admin-badge admin-badge-success">{{ t('admin.admins.signupDefault') }}</span>
            </span>
            <span class="role-meta">
              {{ t('admin.admins.roleCounts', { sections: sectionsOf(role).length, actions: actionsOf(role).length }) }}
              · {{ t('admin.admins.members', { count: membersOf(role) }) }}
            </span>
            <span class="role-chips">
              <span v-for="p in role.permissions.slice(0, 6)" :key="p" class="perm-chip">{{ permissionLabel(p) }}</span>
              <span v-if="role.permissions.length > 6" class="perm-chip more">+{{ role.permissions.length - 6 }}</span>
              <span v-if="!role.permissions.length" class="perm-chip more">{{ t('admin.admins.roleNoSections') }}</span>
            </span>
            <span class="role-edit">{{ t('admin.admins.roleEdit') }} →</span>
          </button>
        </div>
      </section>
    </template>

    <!-- User drawer -->
    <AdminDrawer
      :open="!!selectedUser"
      :title="selectedUser ? displayIdentity(selectedUser) : ''"
      :eyebrow="selectedUser ? roleName(selectedUser.role) : ''"
      :close-label="t('admin.generalLedger.close')"
      width="680px"
      @close="closeUserDrawer"
    >
      <template v-if="selectedUser">
        <p v-if="detailError" class="admin-error">{{ detailError }}</p>
        <div class="d-card profile">
          <span class="avatar avatar-lg" :class="{ 'avatar-staff': selectedUser.role !== 'USER' }">{{ initials(displayIdentity(selectedUser)) }}</span>
          <div class="person-text">
            <span class="profile-name">{{ displayIdentity(selectedUser) }}</span>
            <span class="person-sub">{{ t('admin.admins.memberSince', { date: formatDate(selectedUser.createdAt) }) }}</span>
          </div>
          <span class="admin-badge profile-badge" :class="roleBadgeClass(selectedUser.role)">{{ roleName(selectedUser.role) }}</span>
        </div>

        <section v-if="selectedUser.role === 'ADMIN' || selectedUser.role === 'USER'" class="d-card">
          <span class="group-label">{{ t('admin.admins.assignHeading') }}</span>
          <p class="hint">{{ selectedUser.role === 'USER' ? t('admin.customers.assignHint') : t('admin.admins.assignAdminHint') }}</p>
          <div class="assign-row">
            <select v-model="assignRoleDraft" class="admin-input" :disabled="!auth.hasSection('roles')">
              <option value="">{{ t('admin.admins.noRole') }}</option>
              <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
            </select>
            <button v-if="auth.hasSection('roles')" class="admin-btn admin-btn-primary" :disabled="assignBusy" @click="saveAssignment(selectedUser)">{{ t('admin.admins.assignSave') }}</button>
          </div>
          <p v-if="assignSuccess" class="admin-success">{{ assignSuccess }}</p>
        </section>
        <section v-else class="d-card super-note">{{ t('admin.admins.superAdminNote') }}</section>

        <section class="d-card">
          <span class="group-label">{{ t('admin.admins.walletsHeading') }}</span>
          <p v-if="walletError" class="admin-error">{{ walletError }}</p>
          <div v-if="detail" class="wallets">
            <article v-for="w in detail.wallets" :key="w.id" class="wallet-card">
              <div class="wallet-top" :style="{ background: cardGradient({ code: w.walletType.code, cardColor: w.walletType.cardColor }, !!w.closedAt) }">
                <span class="wallet-type">{{ w.walletType.name }} · {{ w.walletType.currency.code }}</span>
                <span class="wallet-balance">{{ formatAmount(w.balance, w.walletType.currency) }}</span>
              </div>
              <div class="wallet-bottom">
                <div v-if="badges(w).length" class="badges"><span v-for="b in badges(w)" :key="b" class="admin-badge">{{ b }}</span></div>
                <div v-if="auth.hasSection('wallets')" class="wallet-actions">
                  <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" :class="{ active: openAdjustId === w.id }" :disabled="!!w.closedAt" @click="toggleAdjust(w.id)">{{ t('admin.wallets.adjust') }}</button>
                  <span class="spacer" />
                  <button v-if="w.closedAt" type="button" class="admin-btn admin-btn-ghost admin-btn-sm" :disabled="walletBusy" @click="reopenWallet(selectedUser, w)">{{ t('admin.wallets.reopen') }}</button>
                  <button v-else type="button" class="admin-btn admin-btn-danger admin-btn-sm" :disabled="walletBusy || w.balance !== '0'" :title="w.balance !== '0' ? t('dashboard.wallets.closeRequiresZero') : ''" @click="closeWallet(selectedUser, w)">{{ t('admin.wallets.close') }}</button>
                </div>
                <form v-if="openAdjustId === w.id" class="adjust" @submit.prevent="adjustWallet(selectedUser, w)">
                  <input v-model="adjustAmount[w.id]" type="number" :step="amountStep(w.walletType.currency)" class="admin-input" :placeholder="t('admin.wallets.amountPlaceholder')" required />
                  <input v-model="adjustReason[w.id]" type="text" class="admin-input" :placeholder="t('admin.wallets.reasonPlaceholder')" required />
                  <button type="submit" class="admin-btn admin-btn-primary admin-btn-sm" :disabled="walletBusy">{{ t('admin.wallets.save') }}</button>
                </form>
              </div>
            </article>
            <p v-if="!detail.wallets.length" class="hint">{{ t('admin.admins.noWallets') }}</p>
          </div>
          <div v-else class="skeleton" />
        </section>
      </template>
    </AdminDrawer>

    <!-- Role drawer -->
    <AdminDrawer
      :open="!!roleDrawer"
      :title="roleDrawer === 'create' ? t('admin.admins.roleCreateHeading') : (editingRole?.name ?? '')"
      :eyebrow="t('admin.admins.tabRoles')"
      :close-label="t('admin.generalLedger.close')"
      width="620px"
      @close="closeRoleDrawer"
    >
      <form id="role-form" class="role-form" @submit.prevent="submitRole">
        <section class="d-card">
          <label class="field">
            {{ t('admin.admins.roleNameLabel') }}
            <input v-model="draftName" type="text" class="admin-input" :placeholder="t('admin.admins.roleNamePlaceholder')" required />
          </label>
          <label class="toggle-row">
            <span class="toggle-text">
              <span class="toggle-title">{{ t('admin.admins.roleDefaultForSignup') }}</span>
              <span class="toggle-hint">{{ t('admin.admins.roleDefaultForSignupHint') }}</span>
            </span>
            <input v-model="draftDefault" type="checkbox" class="switch" />
          </label>
        </section>

        <section class="d-card">
          <div class="perm-head">
            <span class="group-label">{{ t('admin.admins.roleSectionsLabel') }}</span>
            <span class="perm-tools">
              <button type="button" class="link-btn" @click="setAll(ADMIN_SECTIONS, true)">{{ t('admin.admins.selectAll') }}</button>
              <button type="button" class="link-btn" @click="setAll(ADMIN_SECTIONS, false)">{{ t('admin.admins.clearAll') }}</button>
            </span>
          </div>
          <div class="perm-grid">
            <label v-for="section in ADMIN_SECTIONS" :key="section" class="perm-toggle" :class="{ on: draftPermissions.includes(section) }">
              <input type="checkbox" class="switch" :checked="draftPermissions.includes(section)" @change="draftPermissions = toggleInList(draftPermissions, section)" />
              {{ t(`adminNav.${section}`) }}
            </label>
          </div>
        </section>

        <section class="d-card">
          <div class="perm-head">
            <span class="group-label">{{ t('admin.admins.roleCustomerActionsLabel') }}</span>
            <span class="perm-tools">
              <button type="button" class="link-btn" @click="setAll(CUSTOMER_ACTIONS, true)">{{ t('admin.admins.selectAll') }}</button>
              <button type="button" class="link-btn" @click="setAll(CUSTOMER_ACTIONS, false)">{{ t('admin.admins.clearAll') }}</button>
            </span>
          </div>
          <div class="perm-grid">
            <label v-for="action in CUSTOMER_ACTIONS" :key="action" class="perm-toggle" :class="{ on: draftPermissions.includes(action) }">
              <input type="checkbox" class="switch" :checked="draftPermissions.includes(action)" @change="draftPermissions = toggleInList(draftPermissions, action)" />
              {{ t(`customerActions.${action}`) }}
            </label>
          </div>
        </section>
        <p v-if="roleFormError" class="admin-error">{{ roleFormError }}</p>
      </form>
      <template #footer>
        <div class="foot">
          <button
            v-if="roleDrawer === 'edit' && editingRole && editingRole.id !== FULL_ACCESS_ROLE_ID"
            type="button"
            class="admin-btn admin-btn-danger"
            :class="{ confirming: confirmDeleteRole }"
            :disabled="roleFormBusy"
            @click="removeEditingRole"
          >{{ confirmDeleteRole ? t('admin.walletTypes.confirmDelete') : t('admin.admins.roleDelete') }}</button>
          <span class="spacer" />
          <button type="button" class="admin-btn admin-btn-ghost" @click="closeRoleDrawer">{{ t('admin.admins.roleCancel') }}</button>
          <button type="submit" form="role-form" class="admin-btn admin-btn-primary" :disabled="roleFormBusy || !draftName.trim()">
            {{ roleDrawer === 'create' ? t('admin.admins.roleCreate') : t('admin.admins.roleSave') }}
          </button>
        </div>
      </template>
    </AdminDrawer>
  </AdminLayout>
</template>

<style scoped>
.readonly {
  margin: 0;
  font-size: 0.84rem;
  color: var(--text-dim);
}
.page-tabs {
  display: flex;
}
.promote {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 16px 20px;
}
.promote-icon {
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 10px;
  background: var(--badge-tint-blue);
  color: var(--accent-blue);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.promote-icon svg {
  width: 19px;
  height: 19px;
}
.promote-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 200px;
}
.promote-text span {
  font-size: 0.8rem;
  color: var(--text-dim);
}
.promote-form {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.promote-form select {
  min-width: 240px;
}
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
  width: 260px;
  max-width: 100%;
}
.avatar-staff {
  background: var(--badge-tint-orange);
  color: var(--accent-orange);
}
.you {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--badge-tint-lime);
  color: var(--accent-lime);
  margin-inline-start: 4px;
  vertical-align: middle;
}
.access {
  font-size: 0.86rem;
  font-weight: 500;
}
.access.full {
  color: var(--accent-red);
  font-weight: 600;
}
.access.none {
  color: var(--text-dimmer);
}
.since {
  white-space: nowrap;
  color: var(--text-dim);
}
.actions-col {
  text-align: end;
  white-space: nowrap;
}
.danger-text {
  color: var(--accent-red);
}
.clickable-row:focus-visible {
  outline: none;
  box-shadow: inset var(--focus-ring);
}

/* Roles */
.roles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.role-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.role-card:hover {
  border-color: color-mix(in srgb, var(--accent-blue) 45%, var(--card-border));
  box-shadow: var(--shadow-card);
}
.role-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.role-name {
  font-weight: 700;
  margin-inline-end: 2px;
}
.role-meta {
  font-size: 0.78rem;
  color: var(--text-dim);
}
.role-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.perm-chip {
  font-size: 0.72rem;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--panel-bg);
  border: 1px solid var(--divider);
  color: var(--text-dim);
}
.perm-chip.more {
  color: var(--text-dimmer);
}
.role-edit {
  margin-top: auto;
  padding-top: 4px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--accent-blue);
}

/* Drawers */
.d-card {
  padding: 16px;
  border-radius: var(--radius-md);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  margin-bottom: 14px;
}
.profile {
  display: flex;
  align-items: center;
  gap: 14px;
}
.profile-name {
  font-size: 1.05rem;
  font-weight: 700;
}
.profile-badge {
  margin-inline-start: auto;
}
.super-note {
  font-size: 0.84rem;
  color: var(--text-dim);
}
.hint {
  margin: -4px 0 10px;
  font-size: 0.8rem;
  color: var(--text-dim);
}
.assign-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.assign-row select {
  flex: 1;
}
.wallets {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
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
  font-size: 0.78rem;
  font-weight: 600;
  opacity: 0.9;
}
.wallet-balance {
  font-size: 1.2rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
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
  margin-top: auto;
}
.spacer {
  flex: 1;
}
.adjust {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--divider);
}
.skeleton {
  height: 120px;
  border-radius: 12px;
  background: linear-gradient(90deg, var(--panel-bg) 25%, var(--divider) 50%, var(--panel-bg) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite linear;
}
@keyframes shimmer {
  to { background-position: -200% 0; }
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-dim);
}
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--divider);
  cursor: pointer;
}
.toggle-text {
  display: flex;
  flex-direction: column;
}
.toggle-title {
  font-size: 0.88rem;
  font-weight: 600;
}
.toggle-hint {
  font-size: 0.78rem;
  color: var(--text-dim);
}
.perm-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.perm-tools {
  display: flex;
  gap: 12px;
}
.link-btn {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--accent-blue);
  cursor: pointer;
}
.perm-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.perm-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--card-border);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.perm-toggle.on {
  border-color: color-mix(in srgb, var(--accent-blue) 45%, var(--card-border));
  background: var(--active-tint);
}
.foot {
  display: flex;
  align-items: center;
  gap: 10px;
}
.admin-btn-danger.confirming {
  background: var(--accent-red);
  color: #fff;
}
@media (max-width: 640px) {
  .perm-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
