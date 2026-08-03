<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError, postMultipart } from '../../api/client';
import { displayIdentity } from '../../utils/identity';
import { formatAmount, type CurrencyInfo } from '../../utils/currency';
import AdminLayout from '../../components/admin/AdminLayout.vue';

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
const search = ref('');

const blockedWallets = ref<BlockedWallet[]>([]);
const overdueError = ref('');
const busyWalletId = ref<string | null>(null);
const openManualId = ref<string | null>(null);
const manualDescription = ref<Record<string, string>>({});
const manualDocument = ref<Record<string, File | undefined>>({});
const zarinpalLinks = ref<Record<string, string>>({});
const collectionMessage = ref<Record<string, string>>({});

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return installments.value;
  return installments.value.filter(
    (i) => i.ownerEmail.toLowerCase().includes(term) || (i.ownerPhoneNumber ?? '').includes(term),
  );
});

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

function toggleManual(walletId: string) {
  openManualId.value = openManualId.value === walletId ? null : walletId;
}

function onManualFileChange(walletId: string, event: Event) {
  const input = event.target as HTMLInputElement;
  manualDocument.value[walletId] = input.files?.[0];
}

async function collectZarinpal(wallet: BlockedWallet) {
  overdueError.value = '';
  collectionMessage.value[wallet.walletId] = '';
  busyWalletId.value = wallet.walletId;
  try {
    const result = await apiRequest<{ redirectUrl: string }>(
      `/admin/installments/${wallet.walletId}/collect/zarinpal`,
      { method: 'POST', idempotent: true },
    );
    zarinpalLinks.value[wallet.walletId] = result.redirectUrl;
  } catch (err) {
    overdueError.value = err instanceof ApiError ? err.message : t('admin.installments.collectFailed');
  } finally {
    busyWalletId.value = null;
  }
}

async function collectRepository(wallet: BlockedWallet) {
  overdueError.value = '';
  collectionMessage.value[wallet.walletId] = '';
  busyWalletId.value = wallet.walletId;
  try {
    await apiRequest(`/admin/installments/${wallet.walletId}/collect/repository`, {
      method: 'POST',
      idempotent: true,
    });
    collectionMessage.value[wallet.walletId] = t('admin.installments.collectSuccess');
    await loadOverdue();
  } catch (err) {
    overdueError.value = err instanceof ApiError ? err.message : t('admin.installments.collectFailed');
  } finally {
    busyWalletId.value = null;
  }
}

async function collectManual(wallet: BlockedWallet) {
  overdueError.value = '';
  collectionMessage.value[wallet.walletId] = '';
  const description = manualDescription.value[wallet.walletId]?.trim();
  if (!description) {
    overdueError.value = t('admin.installments.manualDescriptionRequired');
    return;
  }
  busyWalletId.value = wallet.walletId;
  try {
    await postMultipart(
      `/admin/installments/${wallet.walletId}/collect/manual`,
      { description, document: manualDocument.value[wallet.walletId] },
      { idempotent: true },
    );
    collectionMessage.value[wallet.walletId] = t('admin.installments.collectSuccess');
    manualDescription.value[wallet.walletId] = '';
    manualDocument.value[wallet.walletId] = undefined;
    openManualId.value = null;
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

    <div class="admin-card overdue-card">
      <h2>{{ t('admin.installments.overdueHeading', { count: blockedWallets.length }) }}</h2>
      <table class="admin-table" v-if="blockedWallets.length">
        <thead>
          <tr>
            <th>{{ t('admin.installments.tableOwner') }}</th>
            <th>{{ t('admin.installments.tableWalletType') }}</th>
            <th>{{ t('admin.installments.colBlockedAt') }}</th>
            <th>{{ t('admin.installments.colTotalOwed') }}</th>
            <th>{{ t('admin.installments.colActions') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="w in blockedWallets" :key="w.walletId">
            <tr>
              <td>{{ displayIdentity({ email: w.ownerEmail, phoneNumber: w.ownerPhoneNumber }) }}</td>
              <td>{{ w.walletTypeName }}</td>
              <td>{{ new Date(w.blockedAt).toLocaleDateString() }}</td>
              <td>{{ formatAmount(w.totalOwed, w.currency) }}</td>
              <td class="overdue-actions">
                <button
                  type="button"
                  class="admin-btn admin-btn-ghost overdue-btn"
                  :disabled="busyWalletId === w.walletId"
                  @click="collectZarinpal(w)"
                >
                  {{ t('admin.installments.actionZarinpal') }}
                </button>
                <button
                  type="button"
                  class="admin-btn admin-btn-ghost overdue-btn"
                  :disabled="busyWalletId === w.walletId"
                  @click="collectRepository(w)"
                >
                  {{ t('admin.installments.actionRepository') }}
                </button>
                <button
                  type="button"
                  class="admin-btn admin-btn-ghost overdue-btn"
                  :disabled="busyWalletId === w.walletId"
                  @click="toggleManual(w.walletId)"
                >
                  {{ t('admin.installments.actionManual') }}
                </button>
              </td>
            </tr>
            <tr v-if="zarinpalLinks[w.walletId]">
              <td colspan="5">
                <a :href="zarinpalLinks[w.walletId]" target="_blank" rel="noopener">{{ t('admin.installments.openPaymentLink') }}</a>
              </td>
            </tr>
            <tr v-if="collectionMessage[w.walletId]">
              <td colspan="5" class="overdue-success">{{ collectionMessage[w.walletId] }}</td>
            </tr>
            <tr v-if="openManualId === w.walletId">
              <td colspan="5">
                <div class="manual-form">
                  <input
                    v-model="manualDescription[w.walletId]"
                    class="admin-input"
                    :placeholder="t('admin.installments.manualDescriptionPlaceholder')"
                  />
                  <input type="file" @change="onManualFileChange(w.walletId, $event)" />
                  <button
                    type="button"
                    class="admin-btn admin-btn-primary overdue-btn"
                    :disabled="busyWalletId === w.walletId"
                    @click="collectManual(w)"
                  >
                    {{ t('admin.installments.manualSubmit') }}
                  </button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <p v-else class="overdue-empty">{{ t('admin.installments.overdueEmpty') }}</p>
    </div>

    <div class="admin-card">
      <div class="filter-row">
        <h2>{{ t('admin.installments.all', { count: filtered.length }) }}</h2>
        <input v-model="search" class="admin-input" :placeholder="t('admin.installments.searchPlaceholder')" />
      </div>
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t('admin.installments.tableOwner') }}</th>
            <th>{{ t('admin.installments.tableWalletType') }}</th>
            <th>#</th>
            <th>{{ t('admin.installments.tableAmount') }}</th>
            <th>{{ t('admin.installments.tableDeadline') }}</th>
            <th>{{ t('admin.installments.tableStatus') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in filtered" :key="i.id">
            <td>{{ displayIdentity({ email: i.ownerEmail, phoneNumber: i.ownerPhoneNumber }) }}</td>
            <td>{{ i.walletTypeName }}</td>
            <td>{{ i.sequenceNumber }}</td>
            <td>{{ formatAmount(i.amount, i.currency) }}</td>
            <td>{{ i.deadlineDate }}</td>
            <td><span class="admin-badge" :class="`installment-status-${i.status.toLowerCase()}`">{{ i.status }}</span></td>
          </tr>
          <tr v-if="!filtered.length"><td colspan="6">{{ t('admin.installments.none') }}</td></tr>
        </tbody>
      </table>
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
}
.filter-row h2 {
  margin: 0;
  white-space: nowrap;
}
.filter-row input {
  min-width: 260px;
}
.overdue-card {
  margin-bottom: 20px;
}
.overdue-card h2 {
  margin: 0 0 14px;
}
.overdue-empty {
  color: var(--text-dimmer);
  margin: 0;
}
.overdue-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.overdue-btn {
  padding: 6px 12px;
  font-size: 0.8rem;
}
.overdue-success {
  color: var(--accent-lime);
}
.manual-form {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 0;
}
.manual-form input.admin-input {
  min-width: 280px;
  flex: 1;
}
</style>
