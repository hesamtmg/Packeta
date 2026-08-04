<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { amountStep, formatAmount, toMinorUnits, type CurrencyInfo } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { displayIdentity } from '../../utils/identity';
import { ADMIN_SECTIONS, type AdminUser } from '../../types/admin';
import AdminLayout from '../../components/admin/AdminLayout.vue';
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

const admins = computed(() =>
  users.value.filter((u) => u.role === 'ADMIN' || u.role === 'SUPER_ADMIN'),
);
const customers = computed(() => users.value.filter((u) => u.role === 'USER'));

const expandedId = ref<string | null>(null);
const detail = ref<UserDetail | null>(null);
const detailError = ref('');
const permissionsDraft = ref<string[]>([]);
const permissionsBusy = ref(false);
const permissionsSuccess = ref('');

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
  permissionsSuccess.value = '';
  try {
    const found = await apiRequest<UserDetail>(`/admin/users/${user.id}`);
    detail.value = found;
    permissionsDraft.value = [...(found.permissions ?? [])];
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

function togglePermission(section: string) {
  const i = permissionsDraft.value.indexOf(section);
  if (i === -1) permissionsDraft.value.push(section);
  else permissionsDraft.value.splice(i, 1);
}

async function savePermissions(user: AdminUser) {
  detailError.value = '';
  permissionsSuccess.value = '';
  permissionsBusy.value = true;
  try {
    await apiRequest(`/admin/users/${user.id}/permissions`, {
      method: 'PATCH',
      body: { permissions: permissionsDraft.value },
    });
    permissionsSuccess.value = t('admin.admins.permissionsSaved');
    await Promise.all([load(), loadDetail(user)]);
  } catch (err) {
    detailError.value = err instanceof ApiError ? err.message : t('admin.admins.permissionsFailed');
  } finally {
    permissionsBusy.value = false;
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
</script>

<template>
  <AdminLayout :title="t('admin.admins.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>
    <p v-if="!auth.isSuperAdmin" class="hint">{{ t('admin.admins.readOnlyHint') }}</p>

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

    <div class="admin-card">
      <h2>{{ t('admin.admins.adminsHeading', { count: admins.length }) }}</h2>
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t('admin.admins.tableEmail') }}</th>
            <th>{{ t('admin.admins.tableRole') }}</th>
            <th>{{ t('admin.admins.tableSections') }}</th>
            <th>{{ t('admin.admins.tableSince') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="a in admins" :key="a.id">
            <tr class="admin-row" @click="toggleExpand(a)">
              <td>{{ displayIdentity(a) }}</td>
              <td>{{ a.role === 'SUPER_ADMIN' ? t('admin.admins.roleSuperAdmin') : t('admin.admins.roleAdmin') }}</td>
              <td>
                <span v-if="a.role === 'SUPER_ADMIN'" class="admin-badge">{{ t('admin.admins.fullAccess') }}</span>
                <span v-else class="admin-badge">
                  {{ t('admin.admins.sectionsCount', { granted: a.permissions?.length ?? 0, total: ADMIN_SECTIONS.length }) }}
                </span>
              </td>
              <td>{{ formatDate(a.createdAt) }}</td>
              <td @click.stop>
                <span v-if="a.email === auth.email" class="you-badge">{{ t('admin.admins.you') }}</span>
                <template v-else-if="auth.isSuperAdmin">
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

                  <div v-if="a.role === 'ADMIN'" class="permissions-block">
                    <h3>{{ t('admin.admins.permissionsHeading') }}</h3>
                    <div class="permissions-grid">
                      <label v-for="section in ADMIN_SECTIONS" :key="section" class="permission-checkbox">
                        <input
                          type="checkbox"
                          :checked="permissionsDraft.includes(section)"
                          :disabled="!auth.isSuperAdmin"
                          @change="togglePermission(section)"
                        />
                        {{ t(`adminNav.${section}`) }}
                      </label>
                    </div>
                    <button
                      v-if="auth.isSuperAdmin"
                      class="admin-btn admin-btn-primary"
                      :disabled="permissionsBusy"
                      @click="savePermissions(a)"
                    >
                      {{ t('admin.admins.permissionsSave') }}
                    </button>
                    <p v-if="permissionsSuccess" class="admins-success">{{ permissionsSuccess }}</p>
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
          <tr v-if="!admins.length"><td colspan="5">{{ t('admin.admins.noAdmins') }}</td></tr>
        </tbody>
      </table>
    </div>
  </AdminLayout>
</template>

<style scoped>
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
.permissions-block {
  margin-bottom: 18px;
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
