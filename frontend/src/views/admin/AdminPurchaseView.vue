<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { amountStep, formatAmount, toMinorUnits, type CurrencyInfo } from '../../utils/currency';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import { formatDateTime } from '../../utils/date';
import { displayIdentity } from '../../utils/identity';
import { initials } from '../../utils/adminFormat';

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

function resetCharge() {
  result.value = null;
  linkCopied.value = false;
}

const step = computed(() => (result.value ? 4 : selectedWallet.value ? 3 : merchant.value ? 2 : 1));

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
    <div class="charge-layout">
      <section class="admin-card flow">
        <!-- Step 1 -->
        <div class="step" :class="{ done: step > 1, current: step === 1 }">
          <div class="step-marker"><span>1</span></div>
          <div class="step-body">
            <h3>{{ t('admin.purchase.step1') }}</h3>
            <p class="step-hint">{{ t('admin.purchase.lookupHint') }}</p>
            <form class="lookup" @submit.prevent="onLookup">
              <label class="admin-search lookup-input">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2" /></svg>
                <input v-model="phone" type="tel" class="admin-input" :placeholder="t('admin.purchase.phonePlaceholder')" required />
              </label>
              <button type="submit" class="admin-btn admin-btn-primary" :disabled="lookupBusy">{{ t('admin.purchase.lookup') }}</button>
            </form>
            <p v-if="lookupError" class="admin-error">{{ lookupError }}</p>
            <div v-if="merchant" class="merchant">
              <span class="avatar">{{ initials(displayIdentity(merchant)) }}</span>
              <span class="person-text">
                <span class="person-name">{{ merchant.email }}</span>
                <span class="person-sub">{{ merchant.phoneNumber ?? '' }}</span>
              </span>
              <span class="admin-badge admin-badge-success merchant-badge">{{ t('admin.purchase.merchantVerified') }}</span>
            </div>
          </div>
        </div>

        <!-- Step 2 -->
        <div class="step" :class="{ done: step > 2, current: step === 2, locked: step < 2 }">
          <div class="step-marker"><span>2</span></div>
          <div class="step-body">
            <h3>{{ t('admin.purchase.step2') }}</h3>
            <div v-if="merchant && merchant.wallets.length" class="wallet-options" role="radiogroup">
              <button
                v-for="w in merchant.wallets"
                :key="w.id"
                type="button"
                role="radio"
                data-shot="wallet-option"
                :aria-checked="selectedWalletId === w.id"
                class="wallet-option"
                :class="{ selected: selectedWalletId === w.id }"
                @click="selectedWalletId = w.id; resetCharge()"
              >
                <span class="radio" />
                <span class="wallet-text">
                  <span class="wallet-name">{{ w.walletType.name }} <span class="cur">{{ w.walletType.currency.code }}</span></span>
                  <span class="wallet-bal">{{ t('admin.purchase.balance', { amount: formatAmount(w.balance, w.walletType.currency) }) }}</span>
                </span>
              </button>
            </div>
            <p v-else class="step-hint">{{ t('admin.purchase.step2Locked') }}</p>
          </div>
        </div>

        <!-- Step 3 -->
        <div class="step" :class="{ done: step > 3, current: step === 3, locked: step < 3 }">
          <div class="step-marker"><span>3</span></div>
          <div class="step-body">
            <h3>{{ t('admin.purchase.step3') }}</h3>
            <form v-if="selectedWallet && !result" class="amount-form" @submit.prevent="onCreateCharge">
              <label class="field">
                {{ t('admin.purchase.amountLabel') }}
                <span class="amount-wrap">
                  <input v-model="amount" type="number" min="0" :step="amountStepValue" class="admin-input amount-input" :placeholder="t('admin.purchase.amountPlaceholder')" required />
                  <span class="amount-cur">{{ selectedWallet.walletType.currency.code }}</span>
                </span>
              </label>
              <div class="field">
                {{ t('admin.purchase.languageLabel') }}
                <div class="segmented">
                  <button type="button" :class="{ active: language === 'en' }" @click="language = 'en'">{{ t('dashboard.charge.languageEn') }}</button>
                  <button type="button" :class="{ active: language === 'fa' }" @click="language = 'fa'">{{ t('dashboard.charge.languageFa') }}</button>
                </div>
              </div>
              <button type="submit" class="admin-btn admin-btn-primary create-btn" :disabled="createBusy">{{ t('admin.purchase.createCharge') }}</button>
            </form>
            <p v-else-if="!result" class="step-hint">{{ t('admin.purchase.step3Locked') }}</p>
            <p v-if="createError" class="admin-error">{{ createError }}</p>

            <div v-if="result" class="result">
              <div class="result-head">
                <span class="result-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
                <span>
                  <strong>{{ t('admin.purchase.linkReady') }}</strong>
                  <span class="result-sub">{{ t('admin.purchase.expires', { when: formatDateTime(result.expiresAt) }) }}</span>
                </span>
              </div>
              <div class="link-row">
                <input readonly class="admin-input link-input" :value="result.redirectUrl" @focus="($event.target as HTMLInputElement).select()" />
                <button type="button" class="admin-btn admin-btn-primary" @click="onCopyLink">{{ linkCopied ? t('dashboard.charge.copied') : t('dashboard.charge.copy') }}</button>
                <a :href="result.redirectUrl" target="_blank" rel="noopener" class="admin-btn admin-btn-ghost">{{ t('admin.purchase.openLink') }}</a>
              </div>
              <button type="button" class="link-btn" @click="resetCharge">{{ t('admin.purchase.newCharge') }}</button>
            </div>
          </div>
        </div>
      </section>

      <aside class="admin-card how">
        <h2>{{ t('admin.purchase.howHeading') }}</h2>
        <ol class="how-list">
          <li><span class="how-n">1</span>{{ t('admin.purchase.how1') }}</li>
          <li><span class="how-n">2</span>{{ t('admin.purchase.how2') }}</li>
          <li><span class="how-n">3</span>{{ t('admin.purchase.how3') }}</li>
        </ol>
      </aside>
    </div>
  </AdminLayout>
</template>

<style scoped>
.charge-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 22px;
  align-items: start;
}
.flow {
  padding: 26px 26px 10px;
}
.step {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 16px;
  position: relative;
  padding-bottom: 22px;
}
.step:not(:last-child)::before {
  content: '';
  position: absolute;
  inset-inline-start: 15px;
  top: 34px;
  bottom: 2px;
  width: 2px;
  background: var(--divider);
}
.step.done:not(:last-child)::before {
  background: var(--accent-blue);
}
.step-marker span {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
  background: var(--panel-bg);
  color: var(--text-dimmer);
  border: 2px solid var(--card-border);
}
.step.current .step-marker span {
  background: var(--accent-blue);
  border-color: var(--accent-blue);
  color: #fff;
  box-shadow: var(--focus-ring);
}
.step.done .step-marker span {
  background: var(--badge-tint-blue);
  border-color: var(--accent-blue);
  color: var(--accent-blue);
}
.step-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding-top: 4px;
}
.step h3 {
  margin: 0;
  font-size: 0.98rem;
}
.step.locked h3 {
  color: var(--text-dimmer);
}
.step-hint {
  margin: 0;
  font-size: 0.84rem;
  color: var(--text-dim);
}
.step.locked .step-hint {
  color: var(--text-dimmer);
}
.lookup {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.lookup-input {
  flex: 1;
  min-width: 220px;
}
.merchant {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  border: 1px solid var(--divider);
}
.merchant-badge {
  margin-inline-start: auto;
}
.wallet-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.wallet-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.wallet-option:hover {
  border-color: color-mix(in srgb, var(--accent-blue) 45%, var(--card-border));
}
.wallet-option.selected {
  border-color: var(--accent-blue);
  background: var(--active-tint);
}
.radio {
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 50%;
  border: 2px solid var(--card-border);
  position: relative;
}
.wallet-option.selected .radio {
  border-color: var(--accent-blue);
}
.wallet-option.selected .radio::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: var(--accent-blue);
}
.wallet-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.wallet-name {
  font-weight: 600;
}
.cur {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-dimmer);
  margin-inline-start: 4px;
}
.wallet-bal {
  font-size: 0.78rem;
  color: var(--text-dim);
}
.amount-form {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  flex-wrap: wrap;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-dim);
}
.amount-wrap {
  position: relative;
  display: flex;
}
.amount-input {
  width: 240px;
  font-size: 1.05rem;
  font-weight: 600;
  padding-inline-end: 56px;
}
.amount-cur {
  position: absolute;
  inset-inline-end: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-dimmer);
}
.create-btn {
  min-height: 40px;
}
.result {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: var(--radius-sm);
  background: var(--badge-tint-lime);
  border: 1px solid color-mix(in srgb, var(--accent-lime) 25%, transparent);
}
.result-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.result-head strong {
  display: block;
  color: var(--accent-lime);
}
.result-sub {
  font-size: 0.8rem;
  color: var(--text-dim);
}
.result-icon {
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 50%;
  background: var(--accent-lime);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.result-icon svg {
  width: 16px;
  height: 16px;
}
.link-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.link-input {
  flex: 1;
  min-width: 220px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.82rem;
}
.link-btn {
  align-self: flex-start;
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--accent-blue);
  cursor: pointer;
}
.how h2 {
  margin-bottom: 12px;
}
.how-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: 0.85rem;
  color: var(--text-dim);
}
.how-list li {
  display: flex;
  gap: 10px;
}
.how-n {
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 50%;
  background: var(--badge-tint-blue);
  color: var(--accent-blue);
  font-size: 0.72rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
@media (max-width: 1024px) {
  .charge-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 640px) {
  .flow {
    padding: 18px 16px 4px;
  }
  .amount-input {
    width: 100%;
  }
}
</style>
