<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { apiRequest, ApiError } from '../api/client';
import { packetaRequest } from '../api/packetaClient';
import { formatAmount, type CurrencyInfo } from '../utils/currency';

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
const otpCode = ref('');
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
      return 'Payment authorized — returning to merchant…';
    case 'VERIFIED':
      return 'Payment already completed.';
    case 'CANCELED':
      return 'Payment was canceled.';
    case 'EXPIRED':
      return 'This payment link has expired.';
    default:
      return isExpired.value ? 'This payment link has expired.' : '';
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
    loadError.value = err instanceof ApiError ? err.message : 'Payment not found';
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
    loadError.value = err instanceof ApiError ? err.message : 'Action failed';
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
    otpCode.value = '';
    step.value = 'otp';
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : 'Failed to send code';
    await loadCaptcha();
  } finally {
    gatewayBusy.value = false;
  }
}

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
    gatewayError.value = err instanceof ApiError ? err.message : 'Invalid or expired code';
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
    gatewayError.value = err instanceof ApiError ? err.message : 'Failed to select wallet';
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
  <div class="page">
    <div class="card">
      <div class="brand">Secure Payment</div>

      <template v-if="chargeInfo && step !== 'loading'">
        <div class="merchant-header">
          <div class="merchant">{{ chargeInfo.merchantName }}</div>
          <div class="amount">{{ chargeInfo.displayAmount }}</div>
          <div v-if="secondsLeft !== null && step !== 'redirecting'" class="timer" :class="{ expiring: secondsLeft < 60 }">
            {{ isExpired ? 'Expired' : `Expires in ${countdownLabel}` }}
          </div>
        </div>
      </template>

      <template v-if="step === 'loading'">
        <p class="status">Loading…</p>
      </template>

      <template v-else-if="isExpired && step !== 'redirecting'">
        <p class="error">This payment has expired. Ask the merchant for a new link.</p>
      </template>

      <template v-else-if="step === 'phone'">
        <p class="status">Enter your phone number to identify yourself and pick a wallet to pay from.</p>
        <form class="gateway-form" @submit.prevent="onRequestOtp">
          <input v-model="phoneNumber" type="tel" placeholder="+15551234567" required />
          <label v-if="captchaQuestion" class="captcha-label">
            Quick check: {{ captchaQuestion }}
            <input v-model="captchaAnswer" type="text" inputmode="numeric" placeholder="Answer" required />
          </label>
          <button class="confirm" type="submit" :disabled="gatewayBusy">Send code</button>
        </form>
        <p v-if="gatewayError" class="error">{{ gatewayError }}</p>
      </template>

      <template v-else-if="step === 'otp'">
        <p class="status">Enter the code sent to {{ phoneNumber }}.</p>
        <p v-if="devCodeHint" class="dev-hint">Sandbox code (no real SMS sent): {{ devCodeHint }}</p>
        <form class="gateway-form" @submit.prevent="onVerifyOtp">
          <input v-model="otpCode" type="text" inputmode="numeric" maxlength="6" placeholder="123456" required />
          <button class="confirm" type="submit" :disabled="gatewayBusy">Verify</button>
        </form>
        <button class="link-btn" :disabled="gatewayBusy" @click="onRequestOtp">Resend code</button>
        <p v-if="gatewayError" class="error">{{ gatewayError }}</p>
      </template>

      <template v-else-if="step === 'wallet'">
        <p class="status">Choose which wallet to pay from.</p>
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
        <p v-else class="status">You have no wallet eligible for this purchase.</p>
        <button
          v-if="eligibleWallets.length"
          class="confirm"
          :disabled="gatewayBusy || !selectedWalletId"
          @click="onContinueWithWallet"
        >
          Continue
        </button>
        <p v-if="gatewayError" class="error">{{ gatewayError }}</p>
      </template>

      <template v-else-if="step === 'redirecting'">
        <p class="status">Redirecting you back to the merchant in {{ redirectSecondsLeft }}s…</p>
        <p class="redirect-url">{{ redirectUrl }}</p>
        <button class="confirm" @click="goToCallbackNow">Continue now</button>
      </template>

      <template v-else>
        <p v-if="loadError" class="error">{{ loadError }}</p>

        <template v-else-if="info">
          <p v-if="statusMessage" class="status">{{ statusMessage }}</p>

          <div v-if="isActionable" class="actions">
            <button class="confirm" :disabled="busy" @click="act('confirm')">
              Confirm Payment
            </button>
            <button class="cancel" :disabled="busy" @click="act('cancel')">
              Cancel
            </button>
          </div>
        </template>

        <p v-else class="status">Loading…</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.card {
  width: 100%;
  max-width: 400px;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  padding: 2rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.brand {
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #9d99aa;
}
.merchant-header {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 0.25rem;
}
.merchant {
  font-size: 1rem;
  color: #9d99aa;
}
.amount {
  font-size: 2.25rem;
  font-weight: 700;
  color: #f5f4f7;
}
.timer {
  font-size: 0.8rem;
  color: #716d7d;
  font-variant-numeric: tabular-nums;
}
.timer.expiring {
  color: #ff6b6b;
}
.status {
  color: #9d99aa;
  font-size: 0.9rem;
}
.dev-hint {
  color: #d8ff5c;
  font-size: 0.85rem;
  font-family: monospace;
}
.error {
  color: #ff6b6b;
  font-size: 0.9rem;
}
.redirect-url {
  color: #716d7d;
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
  padding: 0.75rem;
  border-radius: 999px;
  border: none;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}
.confirm {
  background: #d8ff5c;
  color: #18171e;
  padding: 0.75rem;
  border-radius: 999px;
  border: none;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}
.cancel {
  background: rgba(255, 255, 255, 0.07);
  color: #f5f4f7;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
}
.actions button:disabled,
.gateway-form button:disabled,
.confirm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.gateway-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.gateway-form input {
  padding: 0.65rem 0.8rem;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.06);
  color: #f5f4f7;
  font-size: 0.95rem;
  text-align: center;
}
.captcha-label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  color: #9d99aa;
  font-size: 0.85rem;
}
.link-btn {
  background: none;
  border: none;
  color: #9d99aa;
  font-size: 0.82rem;
  cursor: pointer;
  text-decoration: underline;
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
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.06);
  color: #f5f4f7;
  font-size: 1.1rem;
  cursor: pointer;
}
.wallet-card {
  flex: 0 0 45%;
  scroll-snap-align: center;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: #f5f4f7;
  cursor: pointer;
  text-align: left;
}
.wallet-card.selected {
  border-color: #d8ff5c;
  background: rgba(216, 255, 92, 0.08);
}
.wallet-card-type {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #9d99aa;
}
.wallet-card-balance {
  font-size: 1.15rem;
  font-weight: 700;
}
.wallet-card-currency {
  font-size: 0.72rem;
  color: #716d7d;
}
</style>
