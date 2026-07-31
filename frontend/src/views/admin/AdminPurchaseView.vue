<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { amountStep, formatAmount, toMinorUnits, type CurrencyInfo } from '../../utils/currency';
import AdminLayout from '../../components/admin/AdminLayout.vue';

const { t } = useI18n();

interface MerchantWallet {
  id: string;
  balance: string;
  walletType: {
    name: string;
    code: string;
    currency: CurrencyInfo;
  };
}

interface Merchant {
  id: string;
  email: string;
  phoneNumber: string | null;
  wallets: MerchantWallet[];
}

const phone = ref('');
const lookupError = ref('');
const lookupBusy = ref(false);
const merchant = ref<Merchant | null>(null);
const selectedWalletId = ref('');

const amount = ref('');
const language = ref<'en' | 'fa'>('en');
const createError = ref('');
const createBusy = ref(false);
const result = ref<{ redirectUrl: string; expiresAt: string } | null>(null);
const linkCopied = ref(false);

const selectedWallet = computed(() =>
  merchant.value?.wallets.find((w) => w.id === selectedWalletId.value),
);
const amountStepValue = computed(() =>
  selectedWallet.value ? amountStep(selectedWallet.value.walletType.currency) : '0.01',
);

async function onLookup() {
  lookupError.value = '';
  merchant.value = null;
  selectedWalletId.value = '';
  result.value = null;
  if (!phone.value.trim()) return;
  lookupBusy.value = true;
  try {
    const found = await apiRequest<Merchant>(
      `/admin/merchants/by-phone?phone=${encodeURIComponent(phone.value.trim())}`,
    );
    merchant.value = found;
    if (found.wallets.length === 1) {
      selectedWalletId.value = found.wallets[0].id;
    }
    if (!found.wallets.length) {
      lookupError.value = t('admin.purchase.noEligibleWallets');
    }
  } catch (err) {
    lookupError.value = err instanceof ApiError ? err.message : t('admin.purchase.lookupFailed');
  } finally {
    lookupBusy.value = false;
  }
}

async function onCreateCharge() {
  createError.value = '';
  result.value = null;
  const wallet = selectedWallet.value;
  if (!wallet) return;
  createBusy.value = true;
  try {
    const created = await apiRequest<{ transactionId: string; redirectUrl: string; expiresAt: string }>(
      '/admin/purchase/charge',
      {
        method: 'POST',
        body: {
          walletId: wallet.id,
          amount: toMinorUnits(amount.value, wallet.walletType.currency),
          language: language.value,
        },
        idempotent: true,
      },
    );
    result.value = created;
    amount.value = '';
  } catch (err) {
    createError.value = err instanceof ApiError ? err.message : t('admin.purchase.createFailed');
  } finally {
    createBusy.value = false;
  }
}

async function onCopyLink() {
  if (!result.value) return;
  try {
    await navigator.clipboard.writeText(result.value.redirectUrl);
    linkCopied.value = true;
  } catch {
    // Clipboard API unavailable — the link is still visible to copy manually.
  }
}
</script>

<template>
  <AdminLayout :title="t('admin.purchase.title')">
    <div class="admin-card">
      <h2>{{ t('admin.purchase.lookupHeading') }}</h2>
      <p class="hint">{{ t('admin.purchase.lookupHint') }}</p>
      <form class="lookup-form" @submit.prevent="onLookup">
        <input
          v-model="phone"
          type="tel"
          class="admin-input"
          :placeholder="t('admin.purchase.phonePlaceholder')"
          required
        />
        <button type="submit" class="admin-btn admin-btn-primary" :disabled="lookupBusy">
          {{ t('admin.purchase.lookup') }}
        </button>
      </form>
      <p v-if="lookupError" class="admin-error">{{ lookupError }}</p>

      <div v-if="merchant" class="merchant-found">
        <p class="merchant-line">
          {{ t('admin.purchase.merchantFound', { email: merchant.email }) }}
        </p>

        <label v-if="merchant.wallets.length > 1">
          {{ t('admin.purchase.chooseWallet') }}
          <select v-model="selectedWalletId" class="admin-input">
            <option value="" disabled>{{ t('admin.purchase.chooseWalletPlaceholder') }}</option>
            <option v-for="w in merchant.wallets" :key="w.id" :value="w.id">
              {{ w.walletType.name }} ({{ w.walletType.currency.code }}) — {{ formatAmount(w.balance, w.walletType.currency) }}
            </option>
          </select>
        </label>

        <form v-if="selectedWallet" class="charge-form" @submit.prevent="onCreateCharge">
          <input
            v-model="amount"
            type="number"
            min="0"
            :step="amountStepValue"
            class="admin-input"
            :placeholder="t('admin.purchase.amountPlaceholder')"
            required
          />
          <select v-model="language" class="admin-input">
            <option value="en">{{ t('dashboard.charge.languageEn') }}</option>
            <option value="fa">{{ t('dashboard.charge.languageFa') }}</option>
          </select>
          <button type="submit" class="admin-btn admin-btn-primary" :disabled="createBusy">
            {{ t('admin.purchase.createCharge') }}
          </button>
        </form>
        <p v-if="createError" class="admin-error">{{ createError }}</p>

        <div v-if="result" class="charge-result">
          <input readonly class="admin-input mono" :value="result.redirectUrl" />
          <button type="button" class="admin-btn admin-btn-ghost" @click="onCopyLink">
            {{ linkCopied ? t('dashboard.charge.copied') : t('dashboard.charge.copy') }}
          </button>
        </div>
      </div>
    </div>
  </AdminLayout>
</template>

<style scoped>
.hint {
  color: var(--text-dim);
  font-size: 0.85rem;
  margin: 4px 0 12px;
}
.lookup-form {
  display: flex;
  gap: 10px;
}
.lookup-form input {
  flex: 1;
}
.merchant-found {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--card-border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.merchant-line {
  margin: 0;
  font-weight: 600;
}
.merchant-found label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--text-dim);
}
.charge-form {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.charge-form input {
  flex: 1;
  min-width: 140px;
}
.charge-form select {
  flex: 0 0 100px;
}
.charge-result {
  display: flex;
  gap: 8px;
}
.charge-result input {
  flex: 1;
}
.mono {
  font-family: monospace;
  font-size: 0.8rem;
}
</style>
