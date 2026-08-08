<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { apiRequest, ApiError } from '../api/client';
import { packetaRequest } from '../api/packetaClient';
import { formatAmount, type CurrencyInfo } from '../utils/currency';
import { setLocale } from '../i18n';

interface ChargeStatus {
  needsWalletSelection: boolean;
  merchantName: string;
  displayAmount: string;
  displayAmountFa: string;
  displayAmountWordsEn: string;
  displayAmountWordsFa: string;
  expiresAt: string | null;
  language: string;
}

interface EligibleWallet {
  id: string;
  balance: string;
  virtualAmount: string;
  walletType: {
    name: string;
    code: string;
    currency: CurrencyInfo;
  };
}

const route = useRoute();
const authority = route.params.authority as string;
const { t, locale } = useI18n();

// Everything up through 'wallet' mirrors PayView.vue's phone/OTP
// identification. From there this diverges: 'confirming' settles the
// purchase with two plain API calls (no redirect at all) instead of
// PayView's confirm-then-redirect-to-the-customer-dashboard dance — see
// attemptSettlement. Only the credit-shortfall branch ever leaves this
// iframe (real ZarinPal, can't be framed).
type Step =
  | 'loading'
  | 'phone'
  | 'otp'
  | 'wallet'
  | 'insufficient-credit'
  | 'confirming'
  | 'completed'
  | 'failed'
  | 'error'
  | 'expired';
const step = ref<Step>('loading');

const chargeInfo = ref<ChargeStatus | null>(null);
const phoneNumber = ref('');
const captchaId = ref('');
const captchaImage = ref('');
const captchaAnswer = ref('');
const otpDigits = ref<string[]>(['', '', '', '', '', '']);
const otpInputRefs = ref<(HTMLInputElement | null)[]>([]);
const otpCode = computed(() => otpDigits.value.join(''));
const devCodeHint = ref('');
const sessionToken = ref('');
const eligibleWallets = ref<EligibleWallet[]>([]);
const selectedWalletId = ref('');
const transactionId = ref('');
const insufficientCredit = ref<{ shortfall: string; availableCredit: string } | null>(null);
const resultMessage = ref('');
const gatewayError = ref('');
const gatewayBusy = ref(false);

const merchantAmount = computed(() => {
  if (!chargeInfo.value) return '';
  return locale.value === 'fa' ? chargeInfo.value.displayAmountFa : chargeInfo.value.displayAmount;
});
const merchantAmountWords = computed(() => {
  if (!chargeInfo.value) return '';
  return locale.value === 'fa'
    ? chargeInfo.value.displayAmountWordsFa
    : chargeInfo.value.displayAmountWordsEn;
});

const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;
const secondsLeft = computed(() => {
  const expiresAt = chargeInfo.value?.expiresAt;
  if (!expiresAt) return null;
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now.value) / 1000));
});
const isExpired = computed(() => secondsLeft.value !== null && secondsLeft.value <= 0);
const countdownLabel = computed(() => {
  if (secondsLeft.value === null) return '';
  const m = Math.floor(secondsLeft.value / 60);
  const s = String(secondsLeft.value % 60).padStart(2, '0');
  return `${m}:${s}`;
});
watch(isExpired, (expired) => {
  if (expired && step.value !== 'completed' && step.value !== 'failed') {
    step.value = 'expired';
  }
});

function postResize() {
  nextTick(() => {
    window.parent?.postMessage(
      { type: 'packeta-widget-resize', height: document.documentElement.scrollHeight },
      '*',
    );
  });
}
watch(step, postResize);

async function loadCaptcha() {
  try {
    const result = await packetaRequest<{ captchaId: string; image: string }>(
      '/purchase-gateway/captcha',
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
    const result = await packetaRequest<{ devCode: string }>('/purchase-gateway/otp/request', {
      method: 'POST',
      body: {
        authority,
        phoneNumber: phoneNumber.value,
        captchaId: captchaId.value,
        captchaAnswer: captchaAnswer.value,
      },
    });
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
    const result = await packetaRequest<{ sessionToken: string; wallets: EligibleWallet[] }>(
      '/purchase-gateway/otp/verify',
      { method: 'POST', body: { authority, code: otpCode.value } },
    );
    sessionToken.value = result.sessionToken;
    eligibleWallets.value = result.wallets;
    selectedWalletId.value = '';
    step.value = 'wallet';
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : t('widget.errors.invalidCode');
  } finally {
    gatewayBusy.value = false;
  }
}

function selectWallet(id: string) {
  selectedWalletId.value = id;
}

const selectedWallet = computed(() =>
  eligibleWallets.value.find((w) => w.id === selectedWalletId.value),
);

// Masks a wallet id the same cosmetic way WidgetView.vue does.
function maskId(id: string): string {
  const clean = id.replace(/-/g, '').toUpperCase();
  return `•••• •••• •••• ${clean.slice(-4)}`;
}

async function onContinueWithWallet() {
  gatewayError.value = '';
  gatewayBusy.value = true;
  try {
    const result = await packetaRequest<{
      transactionId: string;
      insufficientCredit?: { shortfall: string; availableCredit: string };
    }>('/purchase-gateway/attach-wallet', {
      method: 'POST',
      body: { authority, sessionToken: sessionToken.value, walletId: selectedWalletId.value },
    });
    if (result.insufficientCredit) {
      insufficientCredit.value = result.insufficientCredit;
      transactionId.value = result.transactionId;
      step.value = 'insufficient-credit';
      return;
    }
    transactionId.value = result.transactionId;
    await attemptSettlement();
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : t('errors.walletSelectFailed');
  } finally {
    gatewayBusy.value = false;
  }
}

// The happy path never leaves this iframe: confirm flips the sandbox IPG's
// PaymentIntent to AUTHORIZED (its own redirectUrl is irrelevant here —
// that's for the full-page flow), then verify is the actual money-moving
// call, both plain public JSON POSTs. Success/failure renders inline and
// tells the embedding page via postMessage instead of navigating anywhere.
async function attemptSettlement() {
  step.value = 'confirming';
  try {
    await apiRequest(`/payments/${authority}/confirm`, { method: 'POST' });
    const verifyResult = await packetaRequest<{ status: string; reason?: string }>(
      `/transactions/purchase/${transactionId.value}/verify`,
      { method: 'POST' },
    );
    if (verifyResult.status === 'COMPLETED') {
      step.value = 'completed';
    } else {
      resultMessage.value = verifyResult.reason ?? '';
      step.value = 'failed';
    }
  } catch (err) {
    resultMessage.value = err instanceof ApiError ? err.message : '';
    step.value = 'failed';
  }
  window.parent?.postMessage(
    {
      type: 'packeta-payment-complete',
      transactionId: transactionId.value,
      status: step.value === 'completed' ? 'COMPLETED' : 'FAILED',
    },
    '*',
  );
}

// Customer agreed to pay the credit-shortfall gap — a real ZarinPal
// payment, which cannot run inside this sandboxed iframe. window.top
// breaks all the way out (needs allow-top-navigation-by-user-activation on
// the embedding sdk/js/pay-widget.js iframe, triggered by this click).
// ZarinPal's callback is already hardcoded server-side to the full-page
// /pay/:authority route, which already knows how to finish and hand the
// browser back to the merchant via the wallet's own callbackUrl.
async function onConfirmTopUp() {
  gatewayError.value = '';
  gatewayBusy.value = true;
  try {
    const result = await packetaRequest<{ redirectUrl: string }>('/purchase-gateway/support-topup', {
      method: 'POST',
      body: { authority, sessionToken: sessionToken.value, walletId: selectedWalletId.value },
    });
    window.top!.location.href = result.redirectUrl;
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : t('errors.topUpFailed');
    gatewayBusy.value = false;
  }
}

function backToWalletSelection() {
  insufficientCredit.value = null;
  gatewayError.value = '';
  step.value = 'wallet';
}

async function goToPhoneStep() {
  step.value = 'phone';
  await loadCaptcha();
}

onMounted(async () => {
  try {
    chargeInfo.value = await packetaRequest<ChargeStatus>(
      `/purchase-gateway/charge/${authority}/status`,
    );
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : t('widget.errors.generic');
    step.value = 'error';
    postResize();
    return;
  }
  setLocale(chargeInfo.value.language === 'fa' ? 'fa' : 'en');

  if (chargeInfo.value.needsWalletSelection) {
    await goToPhoneStep();
  } else {
    // Wallet already attached (customer-initiated purchase) — nothing left
    // to identify, go straight to settling it.
    step.value = 'confirming';
  }
  clock = setInterval(() => (now.value = Date.now()), 1000);
  postResize();
});
onUnmounted(() => {
  if (clock) clearInterval(clock);
});
</script>

<template>
  <div class="widget-shell">
    <div class="widget-card">
      <header class="widget-nav">
        <span class="logo-mark">P</span>
        <span class="logo-text">{{ t('brand') }}</span>
        <span v-if="countdownLabel && step !== 'completed' && step !== 'failed'" class="countdown" :class="{ expiring: isExpired }">{{ countdownLabel }}</span>
      </header>

      <div v-if="chargeInfo?.merchantName" class="merchant-panel">
        <div class="merchant-panel-row">
          <span class="merchant-panel-label">{{ t('merchantInfo.company') }}</span>
          <span class="merchant-panel-value">{{ chargeInfo.merchantName }}</span>
        </div>
        <div class="merchant-panel-row">
          <span class="merchant-panel-label">{{ t('totals.label') }}</span>
          <span class="merchant-panel-value merchant-panel-amount">{{ merchantAmount }}</span>
        </div>
        <span v-if="merchantAmountWords" class="merchant-panel-words">{{ merchantAmountWords }}</span>
      </div>

      <template v-if="step === 'loading'">
        <p class="status">{{ t('widget.loading') }}</p>
      </template>

      <template v-else-if="step === 'expired'">
        <p class="error">{{ t('expiredMessage') }}</p>
      </template>

      <template v-else-if="step === 'error'">
        <p class="error">{{ gatewayError || t('widget.errors.generic') }}</p>
      </template>

      <template v-else-if="step === 'phone'">
        <p class="status">{{ t('phone.prompt') }}</p>
        <form class="gateway-form" @submit.prevent="onRequestOtp">
          <label class="icon-field">
            <span class="icon-field-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M6.5 2h3l2 5-2.3 1.6a13 13 0 0 0 6.2 6.2L17 12.5l5 2v3a2 2 0 0 1-2.2 2A18 18 0 0 1 4.5 4.2 2 2 0 0 1 6.5 2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            </span>
            <input v-model="phoneNumber" type="tel" :placeholder="t('phone.placeholder')" required />
          </label>
          <label v-if="captchaImage" class="captcha-label">
            {{ t('phone.captchaPrefix') }}
            <img :src="captchaImage" :alt="t('phone.captchaPrefix')" class="captcha-image" />
            <span class="icon-field">
              <span class="icon-field-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 2 4 5v6c0 5 3.4 8.7 8 9 4.6-.3 8-4 8-9V5l-8-3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              <input v-model="captchaAnswer" type="text" inputmode="numeric" :placeholder="t('phone.answerPlaceholder')" required />
            </span>
          </label>
          <button class="confirm" type="submit" :disabled="gatewayBusy">{{ t('phone.sendCode') }}</button>
        </form>
        <p v-if="gatewayError" class="error">{{ gatewayError }}</p>
      </template>

      <template v-else-if="step === 'otp'">
        <p class="status">{{ t('otp.prompt', { phone: phoneNumber }) }}</p>
        <p v-if="devCodeHint" class="dev-hint">{{ t('otp.devHint', { code: devCodeHint }) }}</p>
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
        <button class="confirm" :disabled="gatewayBusy || otpCode.length < 6" @click="onVerifyOtp">{{ t('otp.verify') }}</button>
        <button class="link-btn" :disabled="gatewayBusy" @click="onRequestOtp">{{ t('otp.resend') }}</button>
        <p v-if="gatewayError" class="error">{{ gatewayError }}</p>
      </template>

      <template v-else-if="step === 'wallet'">
        <p class="status">{{ t('wallet.prompt') }}</p>
        <p v-if="!eligibleWallets.length" class="status">{{ t('wallet.none') }}</p>
        <div v-else class="wallet-list">
          <button
            v-for="w in eligibleWallets"
            :key="w.id"
            type="button"
            class="paycard paycard-selectable"
            :class="{ selected: selectedWalletId === w.id }"
            @click="selectWallet(w.id)"
          >
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
                <span class="paycard-value">{{ w.walletType.name }}</span>
              </div>
              <div class="paycard-field paycard-field-right">
                <span class="paycard-label">{{ t('card.balance') }}</span>
                <span class="paycard-value">{{ formatAmount((BigInt(w.balance) + BigInt(w.virtualAmount || '0')).toString(), w.walletType.currency) }}</span>
              </div>
            </div>
          </button>
        </div>
        <button
          v-if="eligibleWallets.length"
          class="confirm"
          :disabled="gatewayBusy || !selectedWalletId"
          @click="onContinueWithWallet"
        >
          {{ t('wallet.continue') }}
        </button>
        <p v-if="gatewayError" class="error">{{ gatewayError }}</p>
      </template>

      <template v-else-if="step === 'insufficient-credit'">
        <p class="status">
          {{ t('insufficientCredit.message', { amount: insufficientCredit && selectedWallet ? formatAmount(insufficientCredit.shortfall, selectedWallet.walletType.currency) : '' }) }}
        </p>
        <button class="confirm" :disabled="gatewayBusy" @click="onConfirmTopUp">
          {{ t('insufficientCredit.payDifference', { amount: insufficientCredit && selectedWallet ? formatAmount(insufficientCredit.shortfall, selectedWallet.walletType.currency) : '' }) }}
        </button>
        <button class="link-btn" :disabled="gatewayBusy" @click="backToWalletSelection">
          {{ t('insufficientCredit.chooseDifferent') }}
        </button>
        <p v-if="gatewayError" class="error">{{ gatewayError }}</p>
      </template>

      <template v-else-if="step === 'confirming'">
        <p class="status">{{ t('widget.loading') }}</p>
      </template>

      <template v-else-if="step === 'completed'">
        <p class="status status-success">{{ t('widget.pay.completed') }}</p>
      </template>

      <template v-else-if="step === 'failed'">
        <p class="error">{{ resultMessage || t('widget.errors.generic') }}</p>
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
.countdown {
  margin-inline-start: auto;
  font-size: 0.78rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  direction: ltr;
  color: #2f6fed;
}
.countdown.expiring {
  color: #c62828;
}
.merchant-panel {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.7rem 0.85rem;
  border-radius: 14px;
  background: #f4f8ff;
  border: 1px solid #e3e9f7;
}
.merchant-panel-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
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
.merchant-panel-amount {
  font-size: 1.05rem;
}
.merchant-panel-words {
  font-size: 0.68rem;
  color: #64748b;
  text-align: right;
}
.status {
  color: #6b7280;
  font-size: 0.88rem;
  margin: 0;
}
.status-success {
  color: #15803d;
  font-weight: 700;
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
.wallet-list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
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
.paycard-selectable {
  border: 2px solid transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  opacity: 0.72;
  transform: scale(0.98);
  transition: opacity 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
}
.paycard-selectable.selected {
  opacity: 1;
  transform: scale(1);
  border-color: #fff;
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
.widget-footer {
  margin: 0;
  padding-top: 0.4rem;
  text-align: center;
  font-size: 0.68rem;
  color: #94a3b8;
}
</style>
