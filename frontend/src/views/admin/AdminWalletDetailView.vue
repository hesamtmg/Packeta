<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { apiRequest, ApiError } from '../../api/client';
import { formatAmount, formatAmountWords } from '../../utils/currency';
import { formatDateTime } from '../../utils/date';
import { displayIdentity } from '../../utils/identity';
import { walletDisplayName } from '../../utils/wallet-name';
import type { Wallet } from '../../stores/wallet';
import AdminLayout from '../../components/admin/AdminLayout.vue';

interface AdminWalletDetail extends Wallet {
  ownerId: string;
  ownerEmail: string;
  ownerPhoneNumber: string | null;
}

const { t } = useI18n();
const route = useRoute();
const wallet = ref<AdminWalletDetail | null>(null);
const error = ref('');
const busy = ref(false);
const adjustAmount = ref('');
const adjustReason = ref('');

const amountWords = computed(() =>
  wallet.value ? formatAmountWords(wallet.value.balance, wallet.value.walletType.currency) : '',
);
const virtualAmountWords = computed(() =>
  wallet.value?.virtualAmount ? formatAmountWords(wallet.value.virtualAmount, wallet.value.walletType.currency) : '',
);

async function load() {
  error.value = '';
  try {
    wallet.value = await apiRequest<AdminWalletDetail>(`/admin/wallets/${route.params.id}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.walletDetail.loadFailed');
  }
}

async function onAdjust() {
  if (!wallet.value) return;
  error.value = '';
  busy.value = true;
  try {
    const amount = Math.round(Number(adjustAmount.value || '0') * 10 ** wallet.value.walletType.currency.decimalPlaces);
    await apiRequest(`/admin/wallets/${wallet.value.id}/adjust`, {
      method: 'POST',
      body: { amount, reason: adjustReason.value },
      idempotent: true,
    });
    adjustAmount.value = '';
    adjustReason.value = '';
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.wallets.adjustFailed');
  } finally {
    busy.value = false;
  }
}

async function onReopen() {
  if (!wallet.value) return;
  busy.value = true;
  try {
    await apiRequest(`/admin/wallets/${wallet.value.id}/reopen`, { method: 'POST' });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.wallets.reopenFailed');
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.walletDetail.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <section v-if="wallet" class="admin-card detail-card">
      <span class="admin-badge">{{ walletDisplayName(wallet) }}</span>
      <span class="amount">{{ formatAmount(wallet.balance, wallet.walletType.currency) }}</span>
      <span v-if="amountWords" class="amount-words">{{ amountWords }}</span>
      <div class="badges">
        <span v-if="wallet.closedAt" class="status-badge reversed">{{ t('admin.wallets.statusClosed') }}</span>
        <span v-if="wallet.blockedAt" class="status-badge reversed">{{ t('walletDetail.blocked') }}</span>
        <span v-if="!wallet.closedAt && !wallet.blockedAt" class="status-badge completed">{{ t('admin.wallets.statusActive') }}</span>
      </div>

      <dl>
        <dt>{{ t('walletDetail.id') }}</dt>
        <dd class="mono">{{ wallet.id }}</dd>
        <dt>{{ t('admin.walletDetail.owner') }}</dt>
        <dd>
          {{ displayIdentity({ email: wallet.ownerEmail, phoneNumber: wallet.ownerPhoneNumber }) }}
          <div class="mono-id">{{ wallet.ownerId }}</div>
        </dd>
        <dt>{{ t('walletDetail.name') }}</dt>
        <dd>{{ wallet.name ?? t('common.none') }}</dd>
        <dt>{{ t('walletDetail.type') }}</dt>
        <dd>{{ wallet.walletType.name }} ({{ wallet.walletType.code }})</dd>
        <dt>{{ t('walletDetail.currency') }}</dt>
        <dd>{{ wallet.walletType.currency.code }}</dd>
        <dt>{{ t('walletDetail.balance') }}</dt>
        <dd class="mono">{{ wallet.balance }}</dd>

        <template v-if="wallet.virtualAmount !== null">
          <dt>{{ t('walletDetail.virtualAmount') }}</dt>
          <dd>
            {{ formatAmount(wallet.virtualAmount, wallet.walletType.currency) }}
            <span v-if="virtualAmountWords" class="amount-words">{{ virtualAmountWords }}</span>
          </dd>
        </template>
        <template v-if="wallet.repositoryWalletId">
          <dt>{{ t('walletDetail.repositoryWalletId') }}</dt>
          <dd class="mono">
            <router-link :to="{ name: 'admin-wallet-detail', params: { id: wallet.repositoryWalletId } }">
              {{ wallet.repositoryWalletId }}
            </router-link>
          </dd>
        </template>
        <template v-if="wallet.nationalCode">
          <dt>{{ t('walletDetail.nationalCode') }}</dt>
          <dd class="mono">{{ wallet.nationalCode }}</dd>
        </template>
        <template v-if="wallet.purchaseTimeoutSeconds">
          <dt>{{ t('walletDetail.purchaseTimeoutSeconds') }}</dt>
          <dd>{{ wallet.purchaseTimeoutSeconds }}</dd>
        </template>
        <template v-if="wallet.minTransactionAmount">
          <dt>{{ t('walletDetail.minTransactionAmount') }}</dt>
          <dd>{{ formatAmount(wallet.minTransactionAmount, wallet.walletType.currency) }}</dd>
        </template>
        <template v-if="wallet.maxTransactionAmount">
          <dt>{{ t('walletDetail.maxTransactionAmount') }}</dt>
          <dd>{{ formatAmount(wallet.maxTransactionAmount, wallet.walletType.currency) }}</dd>
        </template>
        <template v-if="wallet.restrictedCounterparties?.length">
          <dt>{{ t('walletDetail.restrictedCounterparties') }}</dt>
          <dd>{{ wallet.restrictedCounterparties.join(', ') }}</dd>
        </template>
        <template v-if="wallet.terminalId">
          <dt>{{ t('walletDetail.terminalId') }}</dt>
          <dd class="mono">{{ wallet.terminalId }}</dd>
        </template>
        <template v-if="wallet.acceptorCode">
          <dt>{{ t('walletDetail.acceptorCode') }}</dt>
          <dd class="mono">{{ wallet.acceptorCode }}</dd>
        </template>
        <template v-if="wallet.storeName">
          <dt>{{ t('walletDetail.storeName') }}</dt>
          <dd>{{ wallet.storeName }}</dd>
        </template>
        <template v-if="wallet.storeSite">
          <dt>{{ t('walletDetail.storeSite') }}</dt>
          <dd class="mono">{{ wallet.storeSite }}</dd>
        </template>
        <template v-if="wallet.allowedIps?.length">
          <dt>{{ t('walletDetail.allowedIps') }}</dt>
          <dd class="mono">{{ wallet.allowedIps.join(', ') }}</dd>
        </template>
        <template v-if="wallet.callbackUrl">
          <dt>{{ t('walletDetail.callbackUrl') }}</dt>
          <dd class="mono">{{ wallet.callbackUrl }}</dd>
        </template>
        <template v-if="wallet.category">
          <dt>{{ t('walletDetail.category') }}</dt>
          <dd>{{ wallet.category }}{{ wallet.subCategory ? ` / ${wallet.subCategory}` : '' }}</dd>
        </template>
        <template v-if="wallet.railType">
          <dt>{{ t('walletDetail.railType') }}</dt>
          <dd>{{ t(`dashboard.settlement.rail.${wallet.railType}`) }}</dd>
        </template>
        <template v-if="wallet.railScheduleTimes?.length">
          <dt>{{ t('walletDetail.railScheduleTimes') }}</dt>
          <dd>{{ wallet.railScheduleTimes.join(', ') }}</dd>
        </template>
        <template v-if="wallet.settlementAccounts?.length">
          <dt>{{ t('walletDetail.settlementAccounts') }}</dt>
          <dd>
            <div v-for="account in wallet.settlementAccounts" :key="account.id">
              {{ account.iban }} — {{ account.percent }}%{{ account.label ? ` (${account.label})` : '' }}
            </div>
          </dd>
        </template>
        <template v-if="wallet.closedAt">
          <dt>{{ t('walletDetail.closedAt') }}</dt>
          <dd>{{ formatDateTime(wallet.closedAt) }}</dd>
        </template>
        <template v-if="wallet.blockedAt">
          <dt>{{ t('walletDetail.blockedAt') }}</dt>
          <dd>{{ formatDateTime(wallet.blockedAt) }}</dd>
        </template>
        <dt>{{ t('walletDetail.createdAt') }}</dt>
        <dd>{{ formatDateTime(wallet.createdAt) }}</dd>
      </dl>

      <div class="actions-row">
        <router-link
          v-if="wallet.walletType.code === 'CREDIT'"
          :to="{ name: 'wallet-installments', params: { walletId: wallet.id } }"
          class="admin-btn admin-btn-ghost"
        >
          {{ t('dashboard.installments.viewLink') }}
        </router-link>
        <button v-if="wallet.closedAt" class="admin-btn admin-btn-ghost" :disabled="busy" @click="onReopen">
          {{ t('admin.wallets.reopen') }}
        </button>
      </div>

      <form class="adjust-form" @submit.prevent="onAdjust">
        <h2>{{ t('admin.wallets.adjust') }}</h2>
        <input
          v-model="adjustAmount"
          type="number"
          :step="10 ** -wallet.walletType.currency.decimalPlaces"
          class="admin-input"
          :placeholder="t('admin.wallets.amountPlaceholder')"
        />
        <input v-model="adjustReason" type="text" class="admin-input" :placeholder="t('admin.wallets.reasonPlaceholder')" />
        <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">{{ t('admin.wallets.save') }}</button>
      </form>
    </section>
  </AdminLayout>
</template>

<style scoped>
.detail-card {
  max-width: 680px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.amount {
  font-size: 2rem;
  font-weight: 700;
}
.badges {
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
}
.status-badge {
  align-self: flex-start;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-radius: 999px;
  padding: 3px 10px;
}
.status-badge.completed {
  background: rgba(122, 162, 255, 0.15);
  color: var(--accent-blue);
}
.status-badge.reversed {
  background: rgba(255, 107, 107, 0.15);
  color: var(--accent-red);
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.4rem 1rem;
  margin: 4px 0 0;
}
dt {
  color: var(--text-dimmer);
  font-size: 0.82rem;
}
dd {
  margin: 0;
}
.mono {
  font-family: monospace;
  font-size: 0.82rem;
  word-break: break-all;
  color: var(--text-dim);
}
.actions-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.adjust-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--card-border);
}
.adjust-form h2 {
  margin: 0 0 2px;
  font-size: 1rem;
}
</style>
