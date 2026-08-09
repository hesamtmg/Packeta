<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '../api/client';
import { packetaRequest } from '../api/packetaClient';
import {
  amountStep,
  formatAmount,
  formatAmountWords,
  toMinorUnits,
  type CurrencyInfo,
} from '../utils/currency';
import { formatCalendarDate, formatDateTime } from '../utils/date';

interface WidgetStatus {
  merchantName: string;
  requiresOtp: boolean;
  phoneNumber: string | null;
  status: 'PENDING' | 'AUTHENTICATED' | 'EXPIRED';
  expiresAt: string;
}

interface WidgetWallet {
  id: string;
  name: string | null;
  balance: string;
  virtualAmount: string | null;
  walletType: {
    name: string;
    code: string;
    currency: CurrencyInfo;
    depositable: boolean;
  };
}

interface WidgetTransaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER' | 'ADJUSTMENT' | 'PURCHASE' | 'VIRTUAL';
  status: 'PENDING' | 'COMPLETED' | 'REVERSED';
  fromWalletId: string | null;
  toWalletId: string | null;
  amount: string;
  createdAt: string;
}

interface WidgetTransactionDetail {
  id: string;
  type: string;
  amount: string;
  note: string | null;
  fromWallet: { id: string; name: string | null; walletType: { name: string; code: string; currency: CurrencyInfo } } | null;
  toWallet: { id: string; name: string | null; walletType: { name: string; code: string; currency: CurrencyInfo } } | null;
  direction: 'IN' | 'OUT' | 'BOTH';
  status: string;
  createdAt: string;
}

interface WidgetInstallment {
  id: string;
  walletId: string;
  sequenceNumber: number;
  amount: string;
  principalAmount: string;
  dueDate: string;
  deadlineDate: string;
  status: 'PENDING' | 'OVERDUE' | 'PAID';
  paidAt: string | null;
}

const props = defineProps<{
  token: string;
  returnUrl?: string;
}>();

const { t, locale } = useI18n();

// Same steps PayView's phone/OTP identification uses, minus everything
// purchase-specific (no wallet-select-to-pay, no confirm/cancel, no
// redirect). 'authenticating' covers the non-OTP path's automatic server
// round trip with nothing for the customer to do but wait a beat.
// 'account' is the authenticated state — a tab bar (see activeTab) picks
// between wallets/transactions/installments from there.
type Step = 'loading' | 'phone' | 'otp' | 'authenticating' | 'account' | 'error' | 'expired';
const step = ref<Step>('loading');
type Tab = 'wallets' | 'transactions' | 'installments';
const activeTab = ref<Tab>('wallets');

const status = ref<WidgetStatus | null>(null);
const phoneNumber = ref('');
const captchaId = ref('');
const captchaImage = ref('');
const captchaAnswer = ref('');
const otpDigits = ref<string[]>(['', '', '', '', '', '']);
const otpInputRefs = ref<(HTMLInputElement | null)[]>([]);
const otpCode = computed(() => otpDigits.value.join(''));
const devCodeHint = ref('');
const wallets = ref<WidgetWallet[]>([]);
const gatewayError = ref('');
const gatewayBusy = ref(false);

const walletCurrencyMap = computed(
  () => new Map(wallets.value.map((w) => [w.id, w.walletType.currency])),
);
function currencyForTx(tx: WidgetTransaction): CurrencyInfo | null {
  return (
    (tx.toWalletId && walletCurrencyMap.value.get(tx.toWalletId)) ||
    (tx.fromWalletId && walletCurrencyMap.value.get(tx.fromWalletId)) ||
    null
  );
}

// Masks a wallet id into a card-number-style group of dots ending in the
// last 4 characters — purely cosmetic, matching PayView's own maskId, so a
// wallet "card" here reads the same way a payment card does elsewhere in
// Packeta.
function maskId(id: string): string {
  const clean = id.replace(/-/g, '').toUpperCase();
  const last4 = clean.slice(-4);
  return `•••• •••• •••• ${last4}`;
}

function walletTotal(w: WidgetWallet): string {
  return (BigInt(w.balance) + BigInt(w.virtualAmount || '0')).toString();
}

async function loadCaptcha() {
  try {
    const result = await packetaRequest<{ captchaId: string; image: string }>(
      '/widget/captcha',
    );
    captchaId.value = result.captchaId;
    captchaImage.value = result.image;
    captchaAnswer.value = '';
  } catch {
    captchaImage.value = '';
  }
}

async function onRequestOtp() {
  gatewayError.value = '';
  gatewayBusy.value = true;
  try {
    const result = await packetaRequest<{ devCode: string }>(
      `/widget/sessions/${props.token}/otp/request`,
      {
        method: 'POST',
        body: {
          phoneNumber: status.value?.phoneNumber ? undefined : phoneNumber.value,
          captchaId: captchaId.value,
          captchaAnswer: captchaAnswer.value,
        },
      },
    );
    devCodeHint.value = result.devCode;
    otpDigits.value = ['', '', '', '', '', ''];
    step.value = 'otp';
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : t('widget.errors.sendCodeFailed');
    await loadCaptcha();
  } finally {
    gatewayBusy.value = false;
  }
}

function setOtpRef(el: Element | { $el?: Element } | null, i: number) {
  otpInputRefs.value[i] = (el as HTMLInputElement) ?? null;
}

function onOtpInput(i: number, e: Event) {
  const target = e.target as HTMLInputElement;
  const digit = target.value.replace(/\D/g, '').slice(-1);
  otpDigits.value[i] = digit;
  target.value = digit;
  if (digit && i < otpDigits.value.length - 1) {
    otpInputRefs.value[i + 1]?.focus();
  }
}

function onOtpKeydown(i: number, e: KeyboardEvent) {
  if (e.key === 'Backspace' && !otpDigits.value[i] && i > 0) {
    otpDigits.value[i - 1] = '';
    otpInputRefs.value[i - 1]?.focus();
  }
}

function onOtpPaste(e: ClipboardEvent) {
  const digits = (e.clipboardData?.getData('text') ?? '')
    .replace(/\D/g, '')
    .slice(0, otpDigits.value.length)
    .split('');
  if (!digits.length) return;
  e.preventDefault();
  digits.forEach((d, i) => {
    otpDigits.value[i] = d;
  });
  otpInputRefs.value[Math.min(digits.length, otpDigits.value.length - 1)]?.focus();
}

watch(otpCode, (code) => {
  if (code.length === otpDigits.value.length && step.value === 'otp' && !gatewayBusy.value) {
    onVerifyOtp();
  }
});

async function onVerifyOtp() {
  gatewayError.value = '';
  gatewayBusy.value = true;
  try {
    await packetaRequest(`/widget/sessions/${props.token}/otp/verify`, {
      method: 'POST',
      body: { code: otpCode.value },
    });
    await loadWallets();
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : t('widget.errors.invalidCode');
  } finally {
    gatewayBusy.value = false;
  }
}

async function loadWallets() {
  try {
    wallets.value = await packetaRequest<WidgetWallet[]>(`/widget/sessions/${props.token}/wallets`);
    step.value = 'account';
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : t('widget.errors.loadWalletsFailed');
    step.value = 'error';
  }
}

// The non-OTP "trusted" path — the host already asserted this phone number
// server-to-server when it minted the session (see WidgetService.createSession),
// so there's nothing for the customer to type here at all.
async function authenticateTrusted() {
  step.value = 'authenticating';
  try {
    await packetaRequest(`/widget/sessions/${props.token}/authenticate`, { method: 'POST' });
    await loadWallets();
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : t('widget.errors.authenticateFailed');
    step.value = 'error';
  }
}

async function goToPhoneStep() {
  step.value = 'phone';
  await loadCaptcha();
}

// ---------------------------------------------------------------------
// Deposit — one form open at a time, toggled per wallet.
// ---------------------------------------------------------------------
const depositingWalletId = ref<string | null>(null);
const depositAmount = ref('');
const depositBusy = ref(false);
const depositError = ref('');

function toggleDeposit(walletId: string) {
  depositError.value = '';
  depositAmount.value = '';
  depositingWalletId.value = depositingWalletId.value === walletId ? null : walletId;
}

async function onDeposit(wallet: WidgetWallet) {
  depositError.value = '';
  const minorAmount = toMinorUnits(depositAmount.value, wallet.walletType.currency);
  if (!minorAmount || minorAmount < 1) {
    depositError.value = t('widget.deposit.invalidAmount');
    return;
  }
  depositBusy.value = true;
  try {
    const result = await packetaRequest<{ redirectUrl: string }>(
      `/widget/sessions/${props.token}/deposit`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: { walletId: wallet.id, amount: minorAmount, returnUrl: props.returnUrl },
      },
    );
    // ZarinPal is a real external gateway that refuses to render inline —
    // window.top resolves to window itself when this panel isn't framed at
    // all (the normal native-mount case), and still correctly breaks out if
    // someone manually iframes the routed fallback page instead.
    window.top!.location.href = result.redirectUrl;
  } catch (err) {
    depositError.value = err instanceof ApiError ? err.message : t('widget.deposit.failed');
    depositBusy.value = false;
  }
}

// ---------------------------------------------------------------------
// Transactions — lazy-loaded on first tab activation.
// ---------------------------------------------------------------------
const transactions = ref<WidgetTransaction[]>([]);
const transactionsLoaded = ref(false);
const transactionsError = ref('');
const selectedTransaction = ref<WidgetTransactionDetail | null>(null);
const transactionDetailBusy = ref(false);

async function loadTransactions() {
  if (transactionsLoaded.value) return;
  transactionsError.value = '';
  try {
    transactions.value = await packetaRequest<WidgetTransaction[]>(
      `/widget/sessions/${props.token}/transactions`,
    );
    transactionsLoaded.value = true;
  } catch (err) {
    transactionsError.value = err instanceof ApiError ? err.message : t('widget.transactions.loadFailed');
  }
}

async function openTransaction(id: string) {
  transactionDetailBusy.value = true;
  try {
    selectedTransaction.value = await packetaRequest<WidgetTransactionDetail>(
      `/widget/sessions/${props.token}/transactions/${id}`,
    );
  } catch (err) {
    transactionsError.value = err instanceof ApiError ? err.message : t('widget.transactions.loadFailed');
  } finally {
    transactionDetailBusy.value = false;
  }
}

// ---------------------------------------------------------------------
// Installments — lazy-loaded on first tab activation.
// ---------------------------------------------------------------------
const installments = ref<WidgetInstallment[]>([]);
const installmentsLoaded = ref(false);
const installmentsError = ref('');
const payingInstallmentId = ref<string | null>(null);

async function loadInstallments() {
  if (installmentsLoaded.value) return;
  installmentsError.value = '';
  try {
    installments.value = await packetaRequest<WidgetInstallment[]>(
      `/widget/sessions/${props.token}/installments`,
    );
    installmentsLoaded.value = true;
  } catch (err) {
    installmentsError.value = err instanceof ApiError ? err.message : t('widget.installments.loadFailed');
  }
}

async function onPayInstallment(installment: WidgetInstallment) {
  installmentsError.value = '';
  payingInstallmentId.value = installment.id;
  try {
    const result = await packetaRequest<{ redirectUrl: string }>(
      `/widget/sessions/${props.token}/installments/${installment.id}/pay`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: { returnUrl: props.returnUrl },
      },
    );
    window.top!.location.href = result.redirectUrl;
  } catch (err) {
    installmentsError.value = err instanceof ApiError ? err.message : t('widget.installments.payFailed');
    payingInstallmentId.value = null;
  }
}

function selectTab(tab: Tab) {
  activeTab.value = tab;
  if (tab === 'transactions') loadTransactions();
  if (tab === 'installments') loadInstallments();
}

onMounted(async () => {
  // No charge to carry a language field here (unlike PayView) — this widget
  // is embedded standalone, so it falls back to the embedding browser's own
  // language instead. Setting the local `locale` ref (rather than the old
  // document.documentElement-mutating setLocale()) keeps this panel's
  // language fully independent of the host page and of any other widget
  // instance mounted alongside it.
  locale.value = navigator.language.toLowerCase().startsWith('fa') ? 'fa' : 'en';

  try {
    status.value = await packetaRequest<WidgetStatus>(`/widget/sessions/${props.token}/status`);
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : t('widget.errors.sessionNotFound');
    step.value = 'error';
    return;
  }

  if (status.value.status === 'EXPIRED') {
    step.value = 'expired';
  } else if (status.value.status === 'AUTHENTICATED') {
    await loadWallets();
  } else if (!status.value.requiresOtp) {
    await authenticateTrusted();
  } else if (status.value.phoneNumber) {
    // A phone was pre-bound at session creation — skip straight to
    // captcha/OTP, no need to make the customer type it again.
    step.value = 'phone';
    await loadCaptcha();
  } else {
    await goToPhoneStep();
  }
});
</script>

<template>
  <div class="widget-shell" :dir="locale === 'fa' ? 'rtl' : 'ltr'" :lang="locale">
    <div class="widget-card">
      <header class="widget-nav">
        <span class="logo-mark">P</span>
        <span class="logo-text">{{ t('brand') }}</span>
        <span class="secure-badge">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 2 4 5v6c0 5 3.4 8.7 8 9 4.6-.3 8-4 8-9V5l-8-3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </header>

      <div v-if="status?.merchantName" class="merchant-panel">
        <span class="merchant-panel-label">{{ t('merchantInfo.company') }}</span>
        <span class="merchant-panel-value">{{ status.merchantName }}</span>
      </div>

      <template v-if="step === 'loading' || step === 'authenticating'">
        <p class="status">{{ t('widget.loading') }}</p>
      </template>

      <template v-else-if="step === 'expired'">
        <p class="error">{{ t('widget.expired') }}</p>
      </template>

      <template v-else-if="step === 'error'">
        <p class="error">{{ gatewayError || t('widget.errors.generic') }}</p>
      </template>

      <template v-else-if="step === 'phone'">
        <p class="status">{{ t('widget.phone.prompt') }}</p>
        <form class="gateway-form" @submit.prevent="onRequestOtp">
          <label v-if="!status?.phoneNumber" class="icon-field">
            <span class="icon-field-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M6.5 2h3l2 5-2.3 1.6a13 13 0 0 0 6.2 6.2L17 12.5l5 2v3a2 2 0 0 1-2.2 2A18 18 0 0 1 4.5 4.2 2 2 0 0 1 6.5 2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            </span>
            <input v-model="phoneNumber" type="tel" :placeholder="t('widget.phone.placeholder')" required />
          </label>
          <p v-else class="phone-prebound">{{ status.phoneNumber }}</p>
          <label v-if="captchaImage" class="captcha-label">
            {{ t('widget.phone.captchaPrefix') }}
            <img :src="captchaImage" :alt="t('widget.phone.captchaPrefix')" class="captcha-image" />
            <span class="icon-field">
              <span class="icon-field-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 2 4 5v6c0 5 3.4 8.7 8 9 4.6-.3 8-4 8-9V5l-8-3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              <input v-model="captchaAnswer" type="text" inputmode="numeric" :placeholder="t('widget.phone.answerPlaceholder')" required />
            </span>
          </label>
          <button class="confirm" type="submit" :disabled="gatewayBusy">{{ t('widget.phone.sendCode') }}</button>
        </form>
        <p v-if="gatewayError" class="error">{{ gatewayError }}</p>
      </template>

      <template v-else-if="step === 'otp'">
        <p class="status">{{ t('widget.otp.prompt', { phone: status?.phoneNumber || phoneNumber }) }}</p>
        <p v-if="devCodeHint" class="dev-hint">{{ t('widget.otp.devHint', { code: devCodeHint }) }}</p>
        <div class="otp-boxes" @paste="onOtpPaste">
          <input
            v-for="(d, i) in otpDigits"
            :key="i"
            :ref="(el) => setOtpRef(el as Element | null, i)"
            class="otp-box"
            type="text"
            inputmode="numeric"
            maxlength="1"
            autocomplete="one-time-code"
            :value="d"
            @input="onOtpInput(i, $event)"
            @keydown="onOtpKeydown(i, $event)"
          />
        </div>
        <button class="confirm" :disabled="gatewayBusy || otpCode.length < 6" @click="onVerifyOtp">{{ t('widget.otp.verify') }}</button>
        <button class="link-btn" :disabled="gatewayBusy" @click="onRequestOtp">{{ t('widget.otp.resend') }}</button>
        <p v-if="gatewayError" class="error">{{ gatewayError }}</p>
      </template>

      <template v-else-if="step === 'account'">
        <div class="tab-bar">
          <button type="button" class="tab" :class="{ active: activeTab === 'wallets' }" @click="selectTab('wallets')">{{ t('widget.tabs.wallets') }}</button>
          <button type="button" class="tab" :class="{ active: activeTab === 'transactions' }" @click="selectTab('transactions')">{{ t('widget.tabs.transactions') }}</button>
          <button type="button" class="tab" :class="{ active: activeTab === 'installments' }" @click="selectTab('installments')">{{ t('widget.tabs.installments') }}</button>
        </div>

        <div v-if="activeTab === 'wallets'">
          <p v-if="!wallets.length" class="status">{{ t('widget.wallets.none') }}</p>
          <div v-else class="wallet-list">
            <div v-for="w in wallets" :key="w.id" class="paycard-wrap">
              <div class="paycard">
                <div class="paycard-top">
                  <span class="paycard-chip" aria-hidden="true">
                    <svg viewBox="0 0 32 24" fill="none"><rect x="1" y="1" width="30" height="22" rx="4" fill="currentColor" opacity="0.9"/><path d="M1 9h30M1 15h30M11 1v22M21 1v22" stroke="#fff" stroke-width="1"/></svg>
                  </span>
                  <span class="paycard-brand">{{ t('brand') }}</span>
                </div>
                <div class="paycard-number">{{ maskId(w.id) }}</div>
                <div class="paycard-bottom">
                  <div class="paycard-field">
                    <span class="paycard-label">{{ t('card.wallet') }}</span>
                    <span class="paycard-value">{{ w.name || w.walletType.name }}</span>
                  </div>
                  <div class="paycard-field paycard-field-right">
                    <span class="paycard-label">{{ t('card.balance') }}</span>
                    <span class="paycard-value">{{ formatAmount(walletTotal(w), w.walletType.currency) }}</span>
                    <span class="paycard-value-words">{{ formatAmountWords(walletTotal(w), w.walletType.currency, locale === 'fa' ? 'fa' : 'en') }}</span>
                  </div>
                </div>
              </div>
              <button
                v-if="w.walletType.depositable"
                type="button"
                class="link-btn wallet-action"
                @click="toggleDeposit(w.id)"
              >
                {{ depositingWalletId === w.id ? t('widget.deposit.cancel') : t('widget.deposit.action') }}
              </button>
              <form
                v-if="depositingWalletId === w.id"
                class="gateway-form deposit-form"
                @submit.prevent="onDeposit(w)"
              >
                <label class="icon-field">
                  <input
                    v-model="depositAmount"
                    type="number"
                    min="0"
                    :step="amountStep(w.walletType.currency)"
                    :placeholder="t('widget.deposit.amountPlaceholder', { code: w.walletType.currency.code })"
                    required
                  />
                </label>
                <button class="confirm" type="submit" :disabled="depositBusy">{{ t('widget.deposit.submit') }}</button>
                <p v-if="depositError" class="error">{{ depositError }}</p>
              </form>
            </div>
          </div>
        </div>

        <div v-else-if="activeTab === 'transactions'">
          <p v-if="transactionsError" class="error">{{ transactionsError }}</p>
          <p v-else-if="!transactionsLoaded" class="status">{{ t('widget.loading') }}</p>
          <p v-else-if="!transactions.length" class="status">{{ t('widget.transactions.none') }}</p>
          <ul v-else class="row-list">
            <li v-for="tx in transactions" :key="tx.id" class="row-item" @click="openTransaction(tx.id)">
              <div class="row-main">
                <span class="row-title">{{ t(`widget.transactions.type.${tx.type}`) }}</span>
                <span class="row-sub">{{ formatDateTime(tx.createdAt) }}</span>
              </div>
              <div class="row-side">
                <span class="row-amount">{{ currencyForTx(tx) ? formatAmount(tx.amount, currencyForTx(tx)!) : tx.amount }}</span>
                <span class="badge" :class="`badge-${tx.status.toLowerCase()}`">{{ t(`widget.transactions.status.${tx.status}`) }}</span>
              </div>
            </li>
          </ul>

          <div v-if="selectedTransaction || transactionDetailBusy" class="detail-overlay" @click.self="selectedTransaction = null">
            <div class="detail-card">
              <button type="button" class="link-btn detail-close" @click="selectedTransaction = null">{{ t('widget.transactions.close') }}</button>
              <p v-if="transactionDetailBusy" class="status">{{ t('widget.loading') }}</p>
              <template v-else-if="selectedTransaction">
                <h3 class="detail-heading">{{ t(`widget.transactions.type.${selectedTransaction.type}`) }}</h3>
                <span class="badge" :class="`badge-${selectedTransaction.status.toLowerCase()}`">{{ t(`widget.transactions.status.${selectedTransaction.status}`) }}</span>
                <dl class="detail-list">
                  <dt>{{ t('widget.transactions.amount') }}</dt>
                  <dd>{{ selectedTransaction.toWallet ? formatAmount(selectedTransaction.amount, selectedTransaction.toWallet.walletType.currency) : (selectedTransaction.fromWallet ? formatAmount(selectedTransaction.amount, selectedTransaction.fromWallet.walletType.currency) : selectedTransaction.amount) }}</dd>
                  <template v-if="selectedTransaction.fromWallet">
                    <dt>{{ t('widget.transactions.from') }}</dt>
                    <dd>{{ selectedTransaction.fromWallet.name || selectedTransaction.fromWallet.walletType.name }}</dd>
                  </template>
                  <template v-if="selectedTransaction.toWallet">
                    <dt>{{ t('widget.transactions.to') }}</dt>
                    <dd>{{ selectedTransaction.toWallet.name || selectedTransaction.toWallet.walletType.name }}</dd>
                  </template>
                  <dt>{{ t('widget.transactions.date') }}</dt>
                  <dd>{{ formatDateTime(selectedTransaction.createdAt) }}</dd>
                  <template v-if="selectedTransaction.note">
                    <dt>{{ t('widget.transactions.note') }}</dt>
                    <dd>{{ selectedTransaction.note }}</dd>
                  </template>
                </dl>
              </template>
            </div>
          </div>
        </div>

        <div v-else-if="activeTab === 'installments'">
          <p v-if="installmentsError" class="error">{{ installmentsError }}</p>
          <p v-else-if="!installmentsLoaded" class="status">{{ t('widget.loading') }}</p>
          <p v-else-if="!installments.length" class="status">{{ t('widget.installments.none') }}</p>
          <ul v-else class="row-list">
            <li v-for="inst in installments" :key="inst.id" class="row-item row-item-static">
              <div class="row-main">
                <span class="row-title">{{ t('widget.installments.sequence', { n: inst.sequenceNumber }) }}</span>
                <span class="row-sub">{{ t('widget.installments.due') }}: {{ formatCalendarDate(inst.deadlineDate) }}</span>
              </div>
              <div class="row-side">
                <span class="row-amount">{{ walletCurrencyMap.get(inst.walletId) ? formatAmount(inst.amount, walletCurrencyMap.get(inst.walletId)!) : inst.amount }}</span>
                <span class="badge" :class="`badge-${inst.status.toLowerCase()}`">{{ t(`widget.installments.status.${inst.status}`) }}</span>
                <button
                  v-if="inst.status !== 'PAID'"
                  type="button"
                  class="confirm pay-btn"
                  :disabled="payingInstallmentId === inst.id"
                  @click="onPayInstallment(inst)"
                >
                  {{ t('widget.installments.pay') }}
                </button>
              </div>
            </li>
          </ul>
        </div>
      </template>

      <footer class="widget-footer">{{ t('footer') }}</footer>
    </div>
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}
.widget-shell {
  font-family:
    'Vazirmatn', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    Helvetica, Arial, sans-serif;
  padding: 1rem;
  background: #eef3ff;
}
.widget-card {
  max-width: 380px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.widget-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.logo-mark {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #4f8bff, #2f6fed);
  color: #fff;
  font-weight: 700;
  font-size: 0.85rem;
  flex: 0 0 auto;
}
.logo-text {
  font-weight: 800;
  font-size: 0.92rem;
  color: #14213d;
}
.secure-badge {
  margin-inline-start: auto;
  width: 18px;
  height: 18px;
  color: #2f6fed;
  opacity: 0.75;
}
.secure-badge svg {
  width: 100%;
  height: 100%;
}
.merchant-panel {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.7rem 0.85rem;
  border-radius: 14px;
  background: #f4f8ff;
  border: 1px solid #e3e9f7;
}
.merchant-panel-label {
  font-size: 0.72rem;
  color: #64748b;
  white-space: nowrap;
}
.merchant-panel-value {
  font-size: 0.85rem;
  font-weight: 800;
  color: #14213d;
  text-align: right;
  overflow-wrap: anywhere;
}
.status {
  color: #6b7280;
  font-size: 0.88rem;
  margin: 0;
}
.error {
  color: #c62828;
  font-size: 0.88rem;
  margin: 0;
}
.dev-hint {
  color: #92400e;
  background: #fef3c7;
  border-radius: 10px;
  padding: 0.5rem 0.7rem;
  font-size: 0.82rem;
  font-family: monospace;
  margin: 0;
}
.gateway-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.icon-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.7rem;
  border-radius: 12px;
  border: 1px solid #e3e9f7;
  background: #f4f8ff;
}
.icon-field:focus-within {
  border-color: #2f6fed;
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.18);
}
.icon-field-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  color: #2f6fed;
}
.icon-field-icon svg {
  width: 100%;
  height: 100%;
}
.icon-field input {
  width: 100%;
  padding: 0.7rem 0;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  font-size: 0.92rem;
  color: #14213d;
}
.icon-field input:focus {
  outline: none;
}
.phone-prebound {
  margin: 0;
  padding: 0.7rem 0.8rem;
  border-radius: 12px;
  background: #f4f8ff;
  border: 1px solid #e3e9f7;
  color: #14213d;
  font-size: 0.92rem;
  font-family: monospace;
}
.captcha-label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  color: #64748b;
  font-size: 0.82rem;
}
.captcha-image {
  width: 160px;
  height: 50px;
  align-self: center;
  border-radius: 12px;
  border: 1px solid #e3e9f7;
}
.confirm {
  background: linear-gradient(135deg, #4f8bff, #1550c9);
  color: #fff;
  padding: 0.75rem;
  border-radius: 999px;
  border: none;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 10px 20px -8px rgba(21, 80, 201, 0.5);
}
.confirm:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}
.link-btn {
  background: none;
  border: none;
  color: #2f6fed;
  font-size: 0.8rem;
  cursor: pointer;
  text-decoration: underline;
}
.otp-boxes {
  display: flex;
  justify-content: center;
  gap: 0.45rem;
}
.otp-box {
  width: 38px;
  height: 46px;
  border-radius: 12px;
  border: 1px solid #e3e9f7;
  background: #f4f8ff;
  color: #14213d;
  font-size: 1.2rem;
  font-weight: 700;
  text-align: center;
}
.otp-box:focus {
  outline: none;
  border-color: #2f6fed;
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.18);
}
.tab-bar {
  display: flex;
  gap: 0.4rem;
  padding: 3px;
  border-radius: 999px;
  background: #f4f8ff;
  border: 1px solid #e3e9f7;
}
.tab {
  flex: 1;
  padding: 0.5rem 0.4rem;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}
.tab.active {
  background: linear-gradient(135deg, #4f8bff, #1550c9);
  color: #fff;
}
.wallet-list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.paycard-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.wallet-action {
  align-self: flex-start;
}
.deposit-form {
  padding: 0.6rem;
  border-radius: 12px;
  background: #f4f8ff;
  border: 1px solid #e3e9f7;
}
/* Same "physical card" visual PayView uses for a wallet — a read-only
   stack of them here instead of a selectable carousel, since there's
   nothing to pick, just wallets to look at. */
.paycard {
  position: relative;
  border-radius: 16px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: #fff;
  background: linear-gradient(135deg, #2f6fed 0%, #1550c9 60%, #103e9e 100%);
  box-shadow: 0 14px 28px -14px rgba(21, 80, 201, 0.55);
}
.paycard-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.paycard-chip {
  width: 28px;
  height: 20px;
  color: rgba(255, 255, 255, 0.85);
}
.paycard-chip svg {
  width: 100%;
  height: 100%;
}
.paycard-brand {
  margin-inline-start: auto;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.85);
}
.paycard-number {
  font-size: 0.92rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  direction: ltr;
  text-align: left;
}
.paycard-bottom {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
}
.paycard-field {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.paycard-field-right {
  text-align: right;
  align-items: flex-end;
}
.paycard-label {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.65);
}
.paycard-value {
  font-size: 0.85rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.paycard-value-words {
  font-size: 0.6rem;
  font-weight: 500;
  line-height: 1.3;
  color: rgba(255, 255, 255, 0.65);
  white-space: normal;
  max-width: 100%;
}
.row-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.row-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.65rem 0.8rem;
  border-radius: 14px;
  background: #f4f8ff;
  border: 1px solid #e3e9f7;
  cursor: pointer;
}
.row-item-static {
  cursor: default;
  flex-wrap: wrap;
}
.row-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.row-title {
  font-size: 0.85rem;
  font-weight: 700;
  color: #14213d;
}
.row-sub {
  font-size: 0.72rem;
  color: #64748b;
}
.row-side {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.row-amount {
  font-size: 0.85rem;
  font-weight: 800;
  color: #1550c9;
}
.badge {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 2px 8px;
  border-radius: 999px;
}
.badge-completed,
.badge-paid {
  background: rgba(34, 197, 94, 0.15);
  color: #15803d;
}
.badge-pending {
  background: rgba(234, 179, 8, 0.18);
  color: #92610a;
}
.badge-reversed,
.badge-overdue {
  background: rgba(220, 38, 38, 0.15);
  color: #b91c1c;
}
.pay-btn {
  padding: 0.4rem 0.9rem;
  font-size: 0.78rem;
}
.detail-overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 33, 61, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 1rem;
  z-index: 10;
}
.detail-card {
  width: 100%;
  max-width: 380px;
  background: #fff;
  border-radius: 16px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.detail-close {
  align-self: flex-end;
}
.detail-heading {
  margin: 0;
  font-size: 1rem;
  color: #14213d;
}
.detail-list {
  margin: 0.4rem 0 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.35rem 0.75rem;
}
.detail-list dt {
  font-size: 0.72rem;
  color: #64748b;
}
.detail-list dd {
  margin: 0;
  font-size: 0.82rem;
  color: #14213d;
  text-align: right;
}
.widget-footer {
  margin: 0;
  padding-top: 0.4rem;
  text-align: center;
  font-size: 0.68rem;
  color: #94a3b8;
}
</style>
