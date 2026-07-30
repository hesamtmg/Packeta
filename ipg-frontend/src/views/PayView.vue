<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { apiRequest, ApiError } from '../api/client';
import { packetaRequest } from '../api/packetaClient';
import { formatAmount, type CurrencyInfo } from '../utils/currency';
import { setLocale } from '../i18n';

interface PaymentInfo {
  merchantName: string;
  displayAmount: string;
  status: 'INITIATED' | 'AUTHORIZED' | 'VERIFIED' | 'CANCELED' | 'EXPIRED';
  expiresAt: string;
}

interface ChargeStatus {
  needsWalletSelection: boolean;
  merchantName: string;
  displayAmount: string;
  expiresAt: string | null;
  language: string;
}

interface EligibleWallet {
  id: string;
  balance: string;
  walletType: {
    name: string;
    code: string;
    currency: CurrencyInfo;
  };
}

const route = useRoute();
const authority = route.params.authority as string;
const { t, locale } = useI18n();

function toggleLocale() {
  setLocale(locale.value === 'fa' ? 'en' : 'fa');
}

// A charge-based purchase (merchant only named an amount) has no wallet
// assigned yet, so the customer identifies themselves here first. A
// customer-initiated purchase (they already picked their own wallet on
// Packeta before being redirected) skips straight to the pay step.
type Step = 'loading' | 'phone' | 'otp' | 'wallet' | 'pay' | 'redirecting';
const step = ref<Step>('loading');

const chargeInfo = ref<ChargeStatus | null>(null);

const phoneNumber = ref('');
const captchaId = ref('');
const captchaQuestion = ref('');
const captchaAnswer = ref('');
const otpDigits = ref<string[]>(['', '', '', '', '', '']);
const otpInputRefs = ref<(HTMLInputElement | null)[]>([]);
const otpCode = computed(() => otpDigits.value.join(''));
const devCodeHint = ref('');
const sessionToken = ref('');
const eligibleWallets = ref<EligibleWallet[]>([]);
const selectedWalletId = ref('');
const carousel = ref<HTMLElement | null>(null);
const gatewayError = ref('');
const gatewayBusy = ref(false);

const info = ref<PaymentInfo | null>(null);
const loadError = ref('');
const busy = ref(false);
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;

// A single countdown driven by the merchant wallet's own configured
// purchaseTimeoutSeconds (set at wallet creation), shown from the very
// first screen — not just once the pay step loads its own copy from the
// IPG — so the customer can't spend the whole window on phone/OTP/wallet
// steps and then find the payment itself has already expired.
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

const isActionable = computed(
  () => info.value?.status === 'INITIATED' && !isExpired.value,
);

const statusMessage = computed(() => {
  if (!info.value) return '';
  switch (info.value.status) {
    case 'AUTHORIZED':
      return t('pay.authorized');
    case 'VERIFIED':
      return t('pay.verified');
    case 'CANCELED':
      return t('pay.canceled');
    case 'EXPIRED':
      return t('pay.expired');
    default:
      return isExpired.value ? t('pay.expired') : '';
  }
});

async function loadCaptcha() {
  try {
    const result = await packetaRequest<{ captchaId: string; question: string }>(
      '/purchase-gateway/captcha',
    );
    captchaId.value = result.captchaId;
    captchaQuestion.value = result.question;
    captchaAnswer.value = '';
  } catch {
    captchaQuestion.value = '';
  }
}

async function loadPaymentInfo() {
  try {
    info.value = await apiRequest<PaymentInfo>(`/payments/${authority}`);
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : t('errors.paymentNotFound');
  }
}

async function act(action: 'confirm' | 'cancel') {
  busy.value = true;
  try {
    const result = await apiRequest<{ redirectUrl: string }>(
      `/payments/${authority}/${action}`,
      { method: 'POST' },
    );
    enterRedirectStep(result.redirectUrl);
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : t('errors.actionFailed');
    await loadPaymentInfo();
  } finally {
    busy.value = false;
  }
}

// Instead of navigating away instantly, show the customer where they're
// headed and let them go now or wait a few seconds — makes the handoff
// back to the merchant something you can actually see and pause on rather
// than an invisible instant jump.
const redirectUrl = ref('');
const redirectSecondsLeft = ref(0);
let redirectTimer: ReturnType<typeof setInterval> | undefined;

function enterRedirectStep(url: string) {
  redirectUrl.value = url;
  redirectSecondsLeft.value = 4;
  step.value = 'redirecting';
  redirectTimer = setInterval(() => {
    redirectSecondsLeft.value -= 1;
    if (redirectSecondsLeft.value <= 0) {
      goToCallbackNow();
    }
  }, 1000);
}

function goToCallbackNow() {
  if (redirectTimer) clearInterval(redirectTimer);
  window.location.href = redirectUrl.value;
}

async function enterPayStep() {
  step.value = 'pay';
  await loadPaymentInfo();
}

async function onRequestOtp() {
  gatewayError.value = '';
  gatewayBusy.value = true;
  try {
    const result = await packetaRequest<{ devCode: string }>(
      '/purchase-gateway/otp/request',
      {
        method: 'POST',
        body: {
          authority,
          phoneNumber: phoneNumber.value,
          captchaId: captchaId.value,
          captchaAnswer: captchaAnswer.value,
        },
      },
    );
    devCodeHint.value = result.devCode;
    otpDigits.value = ['', '', '', '', '', ''];
    step.value = 'otp';
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : t('errors.sendCodeFailed');
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
    gatewayError.value = err instanceof ApiError ? err.message : t('errors.invalidCode');
  } finally {
    gatewayBusy.value = false;
  }
}

function selectWallet(id: string) {
  selectedWalletId.value = id;
}

function scrollCarousel(direction: -1 | 1) {
  const el = carousel.value;
  if (!el) return;
  const card = el.querySelector<HTMLElement>('.wallet-card');
  const cardWidth = card ? card.offsetWidth + 12 : 220;
  el.scrollBy({ left: direction * cardWidth, behavior: 'smooth' });
}

async function onContinueWithWallet() {
  gatewayError.value = '';
  gatewayBusy.value = true;
  try {
    await packetaRequest('/purchase-gateway/attach-wallet', {
      method: 'POST',
      body: { authority, sessionToken: sessionToken.value, walletId: selectedWalletId.value },
    });
    await enterPayStep();
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : t('errors.walletSelectFailed');
  } finally {
    gatewayBusy.value = false;
  }
}

async function goToPhoneStep() {
  step.value = 'phone';
  await loadCaptcha();
}

onMounted(async () => {
  try {
    const status = await packetaRequest<ChargeStatus>(
      `/purchase-gateway/charge/${authority}/status`,
    );
    chargeInfo.value = status;
    setLocale(status.language === 'fa' ? 'fa' : 'en');
    if (status.needsWalletSelection) {
      await goToPhoneStep();
    } else {
      await enterPayStep();
    }
  } catch {
    // Fall back to the direct pay screen — matches pre-charge-flow behavior
    // if the status check itself is unreachable.
    await enterPayStep();
  }
  clock = setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => {
  if (clock) clearInterval(clock);
  if (redirectTimer) clearInterval(redirectTimer);
});
</script>

<template>
  <div class="shell">
    <span class="blob blob-1" aria-hidden="true"></span>
    <span class="blob blob-2" aria-hidden="true"></span>
    <span class="blob blob-3" aria-hidden="true"></span>

    <header class="nav">
      <div class="nav-brand">
        <span class="logo-mark">P</span>
        <span class="logo-text">{{ t('brand') }}</span>
      </div>
      <div class="nav-actions">
        <button type="button" class="lang-toggle" @click="toggleLocale">{{ locale === 'fa' ? 'EN' : 'فارسی' }}</button>
        <div
          v-if="secondsLeft !== null && step !== 'redirecting' && step !== 'loading'"
          class="timer-chip"
          :class="{ expiring: secondsLeft < 60 }"
        >
          <svg class="timer-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="13" r="8" stroke="currentColor" stroke-width="2" />
            <path d="M12 9v4l2.5 2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            <path d="M10 2h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <span>{{ isExpired ? t('expired') : countdownLabel }}</span>
        </div>
      </div>
    </header>

    <main class="page">
      <h1 class="page-heading">{{ t('heading') }}</h1>
      <p class="page-subheading">{{ t('subheading') }}</p>

      <div class="card">
        <template v-if="chargeInfo && step !== 'loading'">
          <div class="merchant-header">
            <div class="merchant">{{ chargeInfo.merchantName }}</div>
            <div class="amount">{{ chargeInfo.displayAmount }}</div>
          </div>
        </template>

        <template v-if="step === 'loading'">
          <p class="status">{{ t('loading') }}</p>
        </template>

        <template v-else-if="isExpired && step !== 'redirecting'">
          <p class="error">{{ t('expiredMessage') }}</p>
        </template>

        <template v-else-if="step === 'phone'">
          <p class="status">{{ t('phone.prompt') }}</p>
          <form class="gateway-form" @submit.prevent="onRequestOtp">
            <input v-model="phoneNumber" type="tel" :placeholder="t('phone.placeholder')" required />
            <label v-if="captchaQuestion" class="captcha-label">
              {{ t('phone.captchaPrefix', { question: captchaQuestion }) }}
              <input v-model="captchaAnswer" type="text" inputmode="numeric" :placeholder="t('phone.answerPlaceholder')" required />
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
          <div v-if="eligibleWallets.length" class="carousel-wrap">
            <button class="carousel-nav" type="button" @click="scrollCarousel(-1)">‹</button>
            <div ref="carousel" class="carousel">
              <button
                v-for="w in eligibleWallets"
                :key="w.id"
                type="button"
                class="wallet-card"
                :class="{ selected: selectedWalletId === w.id }"
                @click="selectWallet(w.id)"
              >
                <span class="wallet-card-type">{{ w.walletType.name }}</span>
                <span class="wallet-card-balance">{{ formatAmount(w.balance, w.walletType.currency) }}</span>
                <span class="wallet-card-currency">{{ w.walletType.currency.code }}</span>
              </button>
            </div>
            <button class="carousel-nav" type="button" @click="scrollCarousel(1)">›</button>
          </div>
          <p v-else class="status">{{ t('wallet.none') }}</p>
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

        <template v-else-if="step === 'redirecting'">
          <p class="status">{{ t('redirecting.message', { seconds: redirectSecondsLeft }) }}</p>
          <p class="redirect-url">{{ redirectUrl }}</p>
          <button class="confirm" @click="goToCallbackNow">{{ t('redirecting.continueNow') }}</button>
        </template>

        <template v-else>
          <p v-if="loadError" class="error">{{ loadError }}</p>

          <template v-else-if="info">
            <p v-if="statusMessage" class="status">{{ statusMessage }}</p>

            <div v-if="isActionable" class="actions">
              <button class="confirm" :disabled="busy" @click="act('confirm')">
                {{ t('pay.confirm') }}
              </button>
              <button class="cancel" :disabled="busy" @click="act('cancel')">
                {{ t('pay.cancel') }}
              </button>
            </div>
          </template>

          <p v-else class="status">{{ t('loading') }}</p>
        </template>
      </div>
    </main>

    <footer class="site-footer">
      <p>{{ t('footer') }}</p>
    </footer>
  </div>
</template>

<style scoped>
.shell {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  z-index: 1;
  overflow-x: hidden;
}
.blob {
  position: fixed;
  border-radius: 50%;
  z-index: 0;
  pointer-events: none;
}
.blob-1 {
  width: 240px;
  height: 240px;
  top: -70px;
  right: -50px;
  background: linear-gradient(135deg, #8b7bf0, #4b39ef);
  opacity: 0.9;
}
.blob-2 {
  width: 90px;
  height: 90px;
  top: 60px;
  right: 190px;
  background: #4b39ef;
  opacity: 0.6;
}
.blob-3 {
  width: 360px;
  height: 360px;
  bottom: -140px;
  left: -120px;
  background: linear-gradient(135deg, #6c5dd3, #3c2fc7);
  opacity: 0.85;
}

.nav {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.5rem;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid #e3e5f2;
}
.nav-brand {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}
.logo-mark {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #6c5dd3, #4b39ef);
  color: #fff;
  font-weight: 700;
  font-size: 1.05rem;
}
.logo-text {
  font-weight: 700;
  font-size: 1.05rem;
  color: #1c1b3a;
}
.nav-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.lang-toggle {
  padding: 0.4rem 0.8rem;
  border-radius: 999px;
  border: 1px solid #e3e5f2;
  background: #fff;
  color: #4b39ef;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}
.timer-chip {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.9rem;
  border-radius: 999px;
  background: #fff;
  color: #4b39ef;
  font-weight: 700;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  box-shadow:
    0 6px 16px rgba(75, 57, 239, 0.18),
    0 1px 2px rgba(28, 27, 58, 0.06);
  border: 1px solid #e3e5f2;
}
.timer-icon {
  width: 16px;
  height: 16px;
}
.timer-chip.expiring {
  color: #c62828;
  background: #fdecec;
  border-color: #f6c9c9;
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    box-shadow:
      0 6px 16px rgba(198, 40, 40, 0.18),
      0 1px 2px rgba(28, 27, 58, 0.06);
  }
  50% {
    box-shadow:
      0 6px 22px rgba(198, 40, 40, 0.32),
      0 1px 2px rgba(28, 27, 58, 0.06);
  }
}

.page {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 1rem;
  z-index: 1;
}
.page-heading {
  margin: 0 0 0.35rem;
  font-size: 1.9rem;
  font-weight: 800;
  color: #1c1b3a;
}
.page-subheading {
  margin: 0 0 1.75rem;
  color: #6b7280;
  font-size: 0.95rem;
}
.card {
  width: 100%;
  max-width: 400px;
  background: #ffffff;
  border: 1px solid #e3e5f2;
  border-radius: 22px;
  padding: 2rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  box-shadow: 0 24px 60px -18px rgba(43, 33, 111, 0.28);
}
.merchant-header {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #edeef8;
  margin-bottom: 0.25rem;
}
.merchant {
  font-size: 1rem;
  color: #6b7280;
}
.amount {
  font-size: 2.25rem;
  font-weight: 800;
  color: #1c1b3a;
}
.status {
  color: #6b7280;
  font-size: 0.9rem;
}
.dev-hint {
  color: #92400e;
  background: #fef3c7;
  border-radius: 10px;
  padding: 0.5rem 0.7rem;
  font-size: 0.85rem;
  font-family: monospace;
}
.error {
  color: #c62828;
  font-size: 0.9rem;
}
.redirect-url {
  color: #9294ab;
  font-size: 0.78rem;
  word-break: break-all;
  font-family: monospace;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-top: 0.5rem;
}
.actions button,
.gateway-form button {
  padding: 0.8rem;
  border-radius: 999px;
  border: none;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
}
.confirm {
  background: linear-gradient(135deg, #6c5dd3, #4b39ef);
  color: #fff;
  padding: 0.8rem;
  border-radius: 999px;
  border: none;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 12px 24px -8px rgba(75, 57, 239, 0.55);
}
.cancel {
  background: #fff;
  color: #1c1b3a;
  border: 1px solid #e3e5f2 !important;
}
.actions button:disabled,
.gateway-form button:disabled,
.confirm:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}
.gateway-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.gateway-form input {
  padding: 0.7rem 0.8rem;
  border-radius: 12px;
  border: 1px solid #e3e5f2;
  background: #f3f4fb;
  color: #1c1b3a;
  font-size: 0.95rem;
  text-align: center;
}
.gateway-form input:focus {
  outline: none;
  border-color: #6c5dd3;
  box-shadow: 0 0 0 3px rgba(108, 93, 211, 0.18);
}
.captcha-label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  color: #6b7280;
  font-size: 0.85rem;
}
.link-btn {
  background: none;
  border: none;
  color: #6c5dd3;
  font-size: 0.82rem;
  cursor: pointer;
  text-decoration: underline;
}
.otp-boxes {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
}
.otp-box {
  width: 42px;
  height: 52px;
  border-radius: 12px;
  border: 1px solid #e3e5f2;
  background: #f3f4fb;
  color: #1c1b3a;
  font-size: 1.3rem;
  font-weight: 700;
  text-align: center;
}
.otp-box:focus {
  outline: none;
  border-color: #6c5dd3;
  box-shadow: 0 0 0 3px rgba(108, 93, 211, 0.18);
}
.carousel-wrap {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.carousel {
  flex: 1;
  display: flex;
  gap: 12px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding: 4px 2px 8px;
  scrollbar-width: none;
}
.carousel::-webkit-scrollbar {
  display: none;
}
.carousel-nav {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid #e3e5f2;
  background: #fff;
  color: #4b39ef;
  font-size: 1.1rem;
  cursor: pointer;
  box-shadow: 0 4px 10px rgba(43, 33, 111, 0.12);
}
.wallet-card {
  flex: 0 0 45%;
  scroll-snap-align: center;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid #e3e5f2;
  background: #f8f8fd;
  color: #1c1b3a;
  cursor: pointer;
  text-align: left;
}
.wallet-card.selected {
  border-color: #6c5dd3;
  background: rgba(108, 93, 211, 0.08);
  box-shadow: 0 8px 20px -8px rgba(75, 57, 239, 0.45);
}
.wallet-card-type {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6b7280;
}
.wallet-card-balance {
  font-size: 1.15rem;
  font-weight: 700;
}
.wallet-card-currency {
  font-size: 0.72rem;
  color: #9294ab;
}

.site-footer {
  z-index: 1;
  text-align: center;
  padding: 1rem;
  font-size: 0.75rem;
  color: #9294ab;
  border-top: 1px solid #e3e5f2;
  background: rgba(255, 255, 255, 0.6);
}
.site-footer p {
  margin: 0;
}
</style>
