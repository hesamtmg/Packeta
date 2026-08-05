<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError, postMultipart } from '../../api/client';
import { formatAmount, type CurrencyInfo } from '../../utils/currency';
import { displayIdentity } from '../../utils/identity';
import AdminLayout from '../../components/admin/AdminLayout.vue';

interface CreditWalletSummary {
  id: string;
  balance: string;
  walletType: { name: string; code: string; currency: CurrencyInfo };
  virtualAmount: string | null;
  blockedAt: string | null;
  closedAt: string | null;
  repositoryWalletId: string | null;
  outstandingTotal: string;
  outstandingCount: number;
}

interface Candidate {
  id: string;
  email: string;
  phoneNumber: string | null;
  creditWallets: CreditWalletSummary[];
}

const { t } = useI18n();
const identifier = ref('');
const candidate = ref<Candidate | null>(null);
const searchError = ref('');
const searchBusy = ref(false);
const searched = ref(false);

const busyWalletId = ref<string | null>(null);
const openRepositoryId = ref<string | null>(null);
const repositoryDescription = ref<Record<string, string>>({});
const repositoryDocument = ref<Record<string, File | undefined>>({});
const actionError = ref<Record<string, string>>({});
const actionMessage = ref<Record<string, string>>({});

function owes(wallet: CreditWalletSummary): boolean {
  return BigInt(wallet.outstandingTotal) > 0n;
}

async function search() {
  if (!identifier.value.trim()) return;
  searchError.value = '';
  searchBusy.value = true;
  searched.value = true;
  candidate.value = null;
  try {
    candidate.value = await apiRequest<Candidate>(
      `/admin/offboarding/lookup?identifier=${encodeURIComponent(identifier.value.trim())}`,
    );
  } catch (err) {
    searchError.value = err instanceof ApiError ? err.message : t('admin.offboarding.searchFailed');
  } finally {
    searchBusy.value = false;
  }
}

function toggleRepositoryForm(walletId: string) {
  openRepositoryId.value = openRepositoryId.value === walletId ? null : walletId;
}

function onRepositoryFileChange(walletId: string, event: Event) {
  const input = event.target as HTMLInputElement;
  repositoryDocument.value[walletId] = input.files?.[0];
}

// Unlike every other admin action here, this one intentionally does NOT go
// through apiRequest first — the customer is meant to complete this charge,
// and admins very likely aren't logged into Packeta as that customer, so
// there's nothing useful to show them here first. Mirrors the overdue-queue
// collection flow's own ZarinPal redirect.
async function collectZarinpal(wallet: CreditWalletSummary) {
  actionError.value[wallet.id] = '';
  actionMessage.value[wallet.id] = '';
  busyWalletId.value = wallet.id;
  try {
    const result = await apiRequest<{ redirectUrl: string }>(
      `/admin/offboarding/${wallet.id}/collect/zarinpal`,
      { method: 'POST', idempotent: true },
    );
    window.location.href = result.redirectUrl;
  } catch (err) {
    actionError.value[wallet.id] = err instanceof ApiError ? err.message : t('admin.offboarding.collectFailed');
    busyWalletId.value = null;
  }
}

async function collectRepository(wallet: CreditWalletSummary) {
  actionError.value[wallet.id] = '';
  actionMessage.value[wallet.id] = '';
  const description = repositoryDescription.value[wallet.id]?.trim();
  if (!description) {
    actionError.value[wallet.id] = t('admin.offboarding.repositoryDescriptionRequired');
    return;
  }
  busyWalletId.value = wallet.id;
  try {
    await postMultipart(
      `/admin/offboarding/${wallet.id}/collect/repository`,
      { description, document: repositoryDocument.value[wallet.id] },
      { idempotent: true },
    );
    actionMessage.value[wallet.id] = t('admin.offboarding.collectSuccess');
    repositoryDescription.value[wallet.id] = '';
    repositoryDocument.value[wallet.id] = undefined;
    openRepositoryId.value = null;
    await search();
  } catch (err) {
    actionError.value[wallet.id] = err instanceof ApiError ? err.message : t('admin.offboarding.collectFailed');
  } finally {
    busyWalletId.value = null;
  }
}

async function closeWallet(wallet: CreditWalletSummary) {
  if (!window.confirm(t('admin.offboarding.closeConfirm'))) return;
  actionError.value[wallet.id] = '';
  actionMessage.value[wallet.id] = '';
  busyWalletId.value = wallet.id;
  try {
    const result = await apiRequest<{ walletId: string; reclaimed: string }>(
      `/admin/offboarding/${wallet.id}/close`,
      { method: 'POST', idempotent: true },
    );
    actionMessage.value[wallet.id] = t('admin.offboarding.closeSuccess', {
      amount: formatAmount(result.reclaimed, wallet.walletType.currency),
    });
    await search();
  } catch (err) {
    actionError.value[wallet.id] = err instanceof ApiError ? err.message : t('admin.offboarding.closeFailed');
  } finally {
    busyWalletId.value = null;
  }
}
</script>

<template>
  <AdminLayout :title="t('admin.offboarding.title')">
    <div class="admin-card">
      <h2>{{ t('admin.offboarding.searchHeading') }}</h2>
      <p class="hint">{{ t('admin.offboarding.searchHint') }}</p>
      <form class="search-row" @submit.prevent="search">
        <input
          v-model="identifier"
          type="text"
          class="admin-input"
          :placeholder="t('admin.offboarding.searchPlaceholder')"
          required
        />
        <button type="submit" class="admin-btn admin-btn-primary" :disabled="searchBusy">
          {{ t('admin.offboarding.searchButton') }}
        </button>
      </form>
      <p v-if="searchError" class="admin-error">{{ searchError }}</p>
    </div>

    <div v-if="candidate" class="admin-card">
      <h2>{{ displayIdentity(candidate) }}</h2>
      <p v-if="!candidate.creditWallets.length" class="hint">{{ t('admin.offboarding.noCreditWallets') }}</p>

      <div class="credit-wallets">
        <article v-for="wallet in candidate.creditWallets" :key="wallet.id" class="credit-wallet-card">
          <div class="credit-wallet-header">
            <span class="wallet-type">{{ wallet.walletType.name }} · {{ wallet.walletType.currency.code }}</span>
            <span
              class="admin-badge"
              :class="wallet.closedAt ? 'status-closed' : wallet.blockedAt ? 'status-blocked' : 'status-active'"
            >
              {{ wallet.closedAt ? t('admin.offboarding.statusClosed') : wallet.blockedAt ? t('admin.offboarding.statusBlocked') : t('admin.offboarding.statusActive') }}
            </span>
          </div>

          <div class="credit-wallet-stats">
            <div>
              <span class="stat-label">{{ t('admin.offboarding.remainingCeiling') }}</span>
              <span class="stat-value">{{ formatAmount(wallet.virtualAmount ?? '0', wallet.walletType.currency) }}</span>
            </div>
            <div>
              <span class="stat-label">{{ t('admin.offboarding.outstandingDebt') }}</span>
              <span class="stat-value" :class="{ 'money-out': owes(wallet) }">
                {{ formatAmount(wallet.outstandingTotal, wallet.walletType.currency) }}
                <span v-if="wallet.outstandingCount" class="stat-count">({{ wallet.outstandingCount }})</span>
              </span>
            </div>
          </div>

          <p v-if="actionError[wallet.id]" class="admin-error">{{ actionError[wallet.id] }}</p>
          <p v-if="actionMessage[wallet.id]" class="action-success">{{ actionMessage[wallet.id] }}</p>

          <template v-if="!wallet.closedAt">
            <div v-if="owes(wallet)" class="wallet-actions">
              <p class="hint">{{ t('admin.offboarding.collectFirstHint') }}</p>
              <div class="action-buttons">
                <button
                  type="button"
                  class="admin-btn admin-btn-ghost"
                  :disabled="busyWalletId === wallet.id"
                  @click="collectZarinpal(wallet)"
                >
                  {{ t('admin.offboarding.actionZarinpal') }}
                </button>
                <button
                  type="button"
                  class="admin-btn admin-btn-ghost"
                  :disabled="busyWalletId === wallet.id"
                  @click="toggleRepositoryForm(wallet.id)"
                >
                  {{ t('admin.offboarding.actionRepository') }}
                </button>
              </div>
              <div v-if="openRepositoryId === wallet.id" class="repository-form">
                <input
                  v-model="repositoryDescription[wallet.id]"
                  class="admin-input"
                  :placeholder="t('admin.offboarding.repositoryDescriptionPlaceholder')"
                />
                <input type="file" @change="onRepositoryFileChange(wallet.id, $event)" />
                <button
                  type="button"
                  class="admin-btn admin-btn-primary"
                  :disabled="busyWalletId === wallet.id"
                  @click="collectRepository(wallet)"
                >
                  {{ t('admin.offboarding.repositorySubmit') }}
                </button>
              </div>
            </div>
            <div v-else class="wallet-actions">
              <button
                type="button"
                class="admin-btn admin-btn-danger"
                :disabled="busyWalletId === wallet.id"
                @click="closeWallet(wallet)"
              >
                {{ t('admin.offboarding.closeButton') }}
              </button>
            </div>
          </template>
        </article>
      </div>
    </div>

    <p v-else-if="searched && !searchBusy && !searchError" class="admin-error">
      {{ t('admin.offboarding.notFound') }}
    </p>
  </AdminLayout>
</template>

<style scoped>
.hint {
  color: var(--text-dimmer);
  font-size: 0.85rem;
  margin: 4px 0 14px;
}
.search-row {
  display: flex;
  gap: 10px;
}
.search-row input {
  flex: 1;
  min-width: 260px;
}
.credit-wallets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
  margin-top: 8px;
}
.credit-wallet-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
  padding: 16px;
}
.credit-wallet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.wallet-type {
  font-size: 0.8rem;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.status-active {
  color: var(--accent-lime);
}
.status-blocked {
  color: var(--accent-red);
}
.status-closed {
  color: var(--text-dimmer);
}
.credit-wallet-stats {
  display: flex;
  gap: 24px;
}
.stat-label {
  display: block;
  font-size: 0.72rem;
  color: var(--text-dimmer);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 4px;
}
.stat-value {
  font-size: 1.15rem;
  font-weight: 700;
}
.stat-count {
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--text-dimmer);
}
.wallet-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.action-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.action-success {
  color: var(--accent-lime);
  font-size: 0.85rem;
  margin: 0;
}
.repository-form {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.repository-form input.admin-input {
  min-width: 220px;
  flex: 1;
}
</style>
