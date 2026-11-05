<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { apiRequest, ApiError } from '../api/client';
import { packetaRequest, PACKETA_API_URL } from '../api/packetaClient';
import { formatAmount, formatAmountWords, type CurrencyInfo } from '../utils/currency';
import { cardGradient } from '../utils/cardTheme';
import { setLocale } from '../i18n';
import { formatCalendarDate } from '../utils/date';

interface PaymentInfo {
  merchantName: string;
  displayAmount: string;
  displayAmountFa?: string | null;
  displayAmountWordsEn?: string | null;
  displayAmountWordsFa?: string | null;
  status: 'INITIATED' | 'AUTHORIZED' | 'VERIFIED' | 'CANCELED' | 'EXPIRED';
  expiresAt: string;
  terminalId?: string | null;
  acceptorCode?: string | null;
  storeSite?: string | null;
  category?: string | null;
  subCategory?: string | null;
}

interface ChargeStatus {
  needsWalletSelection: boolean;
  merchantName: string;
  storeSite: string | null;
  terminalId: string | null;
  acceptorCode: string | null;
  category: string | null;
  subCategory: string | null;
  displayAmount: string;
  displayAmountFa: string;
  displayAmountWordsEn: string;
  displayAmountWordsFa: string;
  expiresAt: string | null;
  language: string;
  // Filled once a credit wallet is attached: the installment plan this
  // purchase will turn into when it settles (see backend
  // InstallmentsService.buildSchedule).
  installmentPlan?: PlanRow[];
}

interface PlanRow {
  sequenceNumber: number;
  dueDate: string;
  deadlineDate: string;
  displayAmount: string;
}

interface EligibleWallet {
  id: string;
  balance: string;
  virtualAmount :string;
  walletType: {
    name: string;
    code: string;
    currency: CurrencyInfo;
    cardColor: string | null;
    cardImageFilename: string | null;
  };
}

function cardImageSrc(walletType: { cardImageFilename: string | null }): string | null {
  return walletType.cardImageFilename
    ? `${PACKETA_API_URL}/uploads/wallet-type-cards/${walletType.cardImageFilename}`
    : null;
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
// 'insufficient-credit' and 'topup-result' back the credit-shortfall
// top-up detour: a chosen CREDIT wallet that can't cover the purchase on
// its own shows the gap and, if the customer agrees to pay it, redirects
// to ZarinPal — which lands back on this same page with a query param
// ('topup-result', handled entirely on mount) instead of the normal
// sandbox-IPG confirm/redirect step.
type Step =
  | 'loading'
  | 'phone'
  | 'otp'
  | 'wallet'
  | 'insufficient-credit'
  | 'pay'
  | 'redirecting'
  | 'topup-result';
const step = ref<Step>('loading');

// Progress shown in the checkout stepper: identify → choose wallet → pay → done.
const stepIndex = computed(() => {
  switch (step.value) {
    case 'phone':
    case 'otp':
      return 0;
    case 'wallet':
    case 'insufficient-credit':
      return 1;
    case 'pay':
      return 2;
    case 'redirecting':
    case 'topup-result':
      return 3;
    default:
      return -1;
  }
});

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
const gatewayError = ref('');
const gatewayBusy = ref(false);
const insufficientCredit = ref<{ shortfall: string; availableCredit: string } | null>(null);
const topUpResult = ref<'success' | 'failed'>('success');
const topUpResultMessage = ref('');
const selectedWallet = computed(() =>
  eligibleWallets.value.find((w) => w.id === selectedWalletId.value),
);
const shortfallDisplay = computed(() =>
  insufficientCredit.value && selectedWallet.value
    ? formatAmount(insufficientCredit.value.shortfall, selectedWallet.value.walletType.currency)
    : '',
);

// One merchant-info source regardless of which flow got us here: the
// charge-based flow (identify yourself first) reports it on chargeInfo,
// the direct/already-wallet-picked flow reports it on info (PaymentInfo) —
// same fields, just two different response shapes upstream.
const merchantSummary = computed(() => ({
  name: chargeInfo.value?.merchantName ?? info.value?.merchantName ?? '',
  storeSite: chargeInfo.value?.storeSite ?? info.value?.storeSite ?? null,
  terminalId: chargeInfo.value?.terminalId ?? info.value?.terminalId ?? null,
  acceptorCode: chargeInfo.value?.acceptorCode ?? info.value?.acceptorCode ?? null,
  category: chargeInfo.value?.category ?? info.value?.category ?? null,
  subCategory: chargeInfo.value?.subCategory ?? info.value?.subCategory ?? null,
  displayAmount:
    (locale.value === 'fa'
      ? chargeInfo.value?.displayAmountFa ?? info.value?.displayAmountFa
      : undefined) ??
    chargeInfo.value?.displayAmount ??
    info.value?.displayAmount ??
    '',
  displayAmountWords:
    (locale.value === 'fa'
      ? chargeInfo.value?.displayAmountWordsFa ?? info.value?.displayAmountWordsFa
      : chargeInfo.value?.displayAmountWordsEn ?? info.value?.displayAmountWordsEn) ?? '',
}));
const hasMerchantPanel = computed(
  () =>
    !!merchantSummary.value.name &&
    (step.value === 'phone' ||
      step.value === 'otp' ||
      step.value === 'wallet' ||
      step.value === 'insufficient-credit' ||
      step.value === 'pay'),
);

// Masks any id (wallet id or payment authority) into a card-number-style
// group of dots ending in the last 4 characters — purely cosmetic, this is
// never a real card number since customers pay from an existing Packeta
// wallet, not a card entered here.
function maskId(id: string): string {
  const clean = id.replace(/-/g, '').toUpperCase();
  const last4 = clean.slice(-4);
  return `•••• •••• •••• ${last4}`;
}

// Drives the always-visible summary "card" once a wallet is either
// selected (wallet step) or already attached (later steps) — falls back to
// a transaction-level summary card before any wallet is known yet.
const activeCard = computed(() => {
  if (selectedWallet.value) {
    return {
      masked: maskId(selectedWallet.value.id),
      holderLabel: t('card.wallet'),
      holderValue: selectedWallet.value.walletType.name,
      subLabel: t('card.balance'),
      subValue: formatAmount(
        (
          BigInt(selectedWallet.value.balance) +
          BigInt(selectedWallet.value.virtualAmount || '0')
        ).toString(),
        selectedWallet.value.walletType.currency,
      ),
      subWords: formatAmountWords(
        (
          BigInt(selectedWallet.value.balance) +
          BigInt(selectedWallet.value.virtualAmount || '0')
        ).toString(),
        selectedWallet.value.walletType.currency,
        locale.value === 'fa' ? 'fa' : 'en',
      ),
      background: cardGradient(selectedWallet.value.walletType, false),
      logoSrc: cardImageSrc(selectedWallet.value.walletType),
    };
  }
  return {
    masked: maskId(authority ?? ''),
    holderLabel: t('card.payTo'),
    holderValue: merchantSummary.value.name || t('brand'),
    subLabel: t('card.amount'),
    subValue: merchantSummary.value.displayAmount,
    subWords: merchantSummary.value.displayAmountWords,
    background: undefined as string | undefined,
    logoSrc: null as string | null,
  };
});

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

// Split-flap "flip clock" digits, one tile per character (minutes tens/ones,
// seconds tens/ones). flipDisplay is what's actually painted on each tile —
// it lags one animation cycle behind countdownDigits on purpose, so the old
// value stays visible while a tile is mid-flip and only swaps at the
// halfway point of the CSS flip animation (see .flip-digit.flipping below).
const countdownDigits = computed(() => {
  if (secondsLeft.value === null) return null;
  const m = String(Math.min(Math.floor(secondsLeft.value / 60), 99)).padStart(2, '0');
  const s = String(secondsLeft.value % 60).padStart(2, '0');
  return { mt: m[0], mo: m[1], st: s[0], so: s[1] };
});
type FlipKey = 'mt' | 'mo' | 'st' | 'so';
const flipDisplay = ref<Record<FlipKey, string>>({ mt: '0', mo: '0', st: '0', so: '0' });
const flipAnimating = ref<Record<FlipKey, boolean>>({
  mt: false,
  mo: false,
  st: false,
  so: false,
});
watch(countdownDigits, (val, oldVal) => {
  if (!val) return;
  if (!oldVal) {
    flipDisplay.value = { ...val };
    return;
  }
  (Object.keys(val) as FlipKey[]).forEach((key) => {
    if (val[key] === flipDisplay.value[key]) return;
    flipAnimating.value[key] = true;
    setTimeout(() => {
      flipDisplay.value[key] = val[key];
    }, 260);
    setTimeout(() => {
      flipAnimating.value[key] = false;
    }, 560);
  });
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
  await Promise.all([loadPaymentInfo(), refreshChargeInfo()]);
}

// Re-reads the charge status after a wallet was attached, so the pay step
// can show the installment plan a credit wallet will be charged on.
async function refreshChargeInfo() {
  try {
    chargeInfo.value = await packetaRequest<ChargeStatus>(
      `/purchase-gateway/charge/${authority}/status`,
    );
  } catch {
    // Non-critical — the plan preview just stays hidden.
  }
}

// The plan actually saved when a credit-shortfall top-up completed the
// purchase (see resolveTopUpCallback) — takes priority over the preview.
const settledPlan = ref<PlanRow[]>([]);
const installmentPlan = computed<PlanRow[]>(() =>
  settledPlan.value.length ? settledPlan.value : (chargeInfo.value?.installmentPlan ?? []),
);

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
      step.value = 'insufficient-credit';
      return;
    }
    await enterPayStep();
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : t('errors.walletSelectFailed');
  } finally {
    gatewayBusy.value = false;
  }
}

// Customer agreed to pay the gap — kicks off a real ZarinPal payment for
// exactly the shortfall and leaves the app entirely (real gateway, not the
// in-house sandbox IPG). ZarinPal's own callback lands back on this same
// /pay/:authority/topup/:topupTxnId URL, picked up on mount.
async function onConfirmTopUp() {
  gatewayError.value = '';
  gatewayBusy.value = true;
  try {
    const result = await packetaRequest<{ redirectUrl: string }>(
      '/purchase-gateway/support-topup',
      {
        method: 'POST',
        body: { authority, sessionToken: sessionToken.value, walletId: selectedWalletId.value },
      },
    );
    window.location.href = result.redirectUrl;
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

// Resolves the ZarinPal leg of a credit-shortfall top-up: verifies the
// payment (crediting the customer's support wallet and completing the
// purchase server-side — see TransactionsService.completeSupportTopUp),
// then shows the outcome right here instead of bouncing to Packeta's own
// app, since this customer never had a Packeta session to begin with.
async function resolveTopUpCallback(topUpTransactionId: string) {
  let redirectUrlFromServer = '';
  try {
    // ZarinPal's own cancel/failure signal — same check WidgetCallbackView
    // and the customer app's PurchaseCallbackView use. Cancelling the
    // still-PENDING top-up (never the purchase itself) frees the customer
    // to start a fresh top-up instead of being handed the dead one again.
    if (route.query.Status === 'NOK') {
      await packetaRequest(`/transactions/purchase/${topUpTransactionId}/cancel`, {
        method: 'POST',
      }).catch(() => undefined);
      topUpResult.value = 'failed';
      topUpResultMessage.value = t('topUpResult.canceled');
      step.value = 'topup-result';
      await loadChargeHeader();
      return;
    }
    const result = await packetaRequest<{
      status: string;
      reason?: string;
      redirectUrl?: string;
      installments?: { sequenceNumber: number; dueDate: string; deadlineDate: string; amount: string }[];
      installmentCurrency?: CurrencyInfo;
    }>(`/transactions/purchase/${topUpTransactionId}/verify`, { method: 'POST' });
    if (result.status === 'COMPLETED') {
      topUpResult.value = 'success';
      const currency = result.installmentCurrency;
      settledPlan.value = (result.installments ?? []).map((i) => ({
        sequenceNumber: i.sequenceNumber,
        dueDate: i.dueDate,
        deadlineDate: i.deadlineDate,
        displayAmount: currency ? formatAmount(i.amount, currency) : i.amount,
      }));
    } else {
      topUpResult.value = 'failed';
      topUpResultMessage.value = result.reason ?? '';
    }
    redirectUrlFromServer = result.redirectUrl ?? '';
  } catch (err) {
    topUpResult.value = 'failed';
    topUpResultMessage.value = err instanceof ApiError ? err.message : '';
  }

  // The purchase is fully settled server-side by this point (or definitively
  // failed) — only now does the customer head back to the merchant, the same
  // "redirecting in a few seconds" handoff the sandbox-IPG confirm step uses.
  // No merchant callbackUrl configured just means staying here with the
  // plain result message instead.
  if (redirectUrlFromServer) {
    enterRedirectStep(redirectUrlFromServer);
  } else {
    step.value = 'topup-result';
  }

  await loadChargeHeader();
}

async function loadChargeHeader() {
  try {
    const status = await packetaRequest<ChargeStatus>(
      `/purchase-gateway/charge/${authority}/status`,
    );
    chargeInfo.value = status;
    setLocale(status.language === 'fa' ? 'fa' : 'en');
  } catch {
    // Non-critical — only used for the merchant/amount header up top.
  }
}

// The top-up's transaction id: from the /pay/:authority/topup/:id path
// (current callbacks), or the legacy ?topupTxnId= query a payment started
// before that change still returns with. ZarinPal appends
// `?Authority=...` to that old URL verbatim, which glues onto the id
// (`<id>?Authority=...`), so anything after a `?` is dropped.
function topUpTransactionIdFromRoute(): string | undefined {
  const fromPath = route.params.topupTxnId as string | undefined;
  if (fromPath) return fromPath;
  const raw = route.query.topupTxnId;
  const fromQuery = Array.isArray(raw) ? raw[0] : raw;
  return fromQuery ? fromQuery.split('?')[0] : undefined;
}

onMounted(async () => {
  const topUpTransactionId = topUpTransactionIdFromRoute();
  if (topUpTransactionId) {
    await resolveTopUpCallback(topUpTransactionId);
    clock = setInterval(() => (now.value = Date.now()), 1000);
    return;
  }

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
    <header class="nav">
      <div class="nav-brand">
        <span class="logo-mark">P</span>
        <span class="logo-text">{{ t('brand') }}</span>
        <span class="secure-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
          {{ t('secureCheckout') }}
        </span>
      </div>
      <div class="nav-actions">
        <button type="button" class="lang-toggle" @click="toggleLocale">{{ locale === 'fa' ? 'EN' : 'فارسی' }}</button>
      </div>
    </header>

    <main class="page">
      <div class="checkout">
        <aside class="summary">
          <div class="summary-head">
            <span class="summary-merchant-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6" /></svg>
            </span>
            <div class="summary-merchant">
              <span class="summary-label">{{ t('payingTo') }}</span>
              <strong class="summary-merchant-name">{{ merchantSummary.name || t('heading') }}</strong>
              <span v-if="merchantSummary.storeSite" class="summary-merchant-site">{{ merchantSummary.storeSite }}</span>
            </div>
          </div>

          <div v-if="step !== 'loading' && merchantSummary.displayAmount" class="summary-amount">
            <span class="summary-label">{{ t('totals.label') }}</span>
            <strong class="summary-amount-value">{{ merchantSummary.displayAmount }}</strong>
            <span v-if="merchantSummary.displayAmountWords" class="summary-amount-words">{{ merchantSummary.displayAmountWords }}</span>
          </div>

          <div
            v-if="countdownDigits && step !== 'redirecting' && step !== 'loading'"
            class="summary-timer"
          >
            <span class="summary-label">{{ isExpired ? t('expired') : t('timeLeft') }}</span>
            <div class="flipclock" :class="{ expiring: isExpired }">
              <div class="flip-group">
                <div class="flip-digit" :class="{ flipping: flipAnimating.mt }">{{ flipDisplay.mt }}</div>
                <div class="flip-digit" :class="{ flipping: flipAnimating.mo }">{{ flipDisplay.mo }}</div>
              </div>
              <div class="flip-colon"><span></span><span></span></div>
              <div class="flip-group">
                <div class="flip-digit" :class="{ flipping: flipAnimating.st }">{{ flipDisplay.st }}</div>
                <div class="flip-digit" :class="{ flipping: flipAnimating.so }">{{ flipDisplay.so }}</div>
              </div>
            </div>
          </div>

          <div
            v-if="hasMerchantPanel && (merchantSummary.terminalId || merchantSummary.acceptorCode || merchantSummary.category || merchantSummary.subCategory)"
            class="merchant-panel"
          >
            <div v-if="merchantSummary.terminalId" class="merchant-panel-row">
            <span class="merchant-panel-label">{{ t('merchantInfo.terminalId') }}</span>
            <span class="merchant-panel-value">{{ merchantSummary.terminalId }}</span>
          </div>
          <div v-if="merchantSummary.acceptorCode" class="merchant-panel-row">
            <span class="merchant-panel-label">{{ t('merchantInfo.acceptorCode') }}</span>
            <span class="merchant-panel-value">{{ merchantSummary.acceptorCode }}</span>
          </div>
          <div v-if="merchantSummary.category" class="merchant-panel-row">
            <span class="merchant-panel-label">{{ t('merchantInfo.category') }}</span>
            <span class="merchant-panel-value">{{ merchantSummary.category }}</span>
          </div>
          <div v-if="merchantSummary.subCategory" class="merchant-panel-row">
            <span class="merchant-panel-label">{{ t('merchantInfo.subCategory') }}</span>
            <span class="merchant-panel-value">{{ merchantSummary.subCategory }}</span>
          </div>
          </div>

          <div class="summary-foot">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg>
            {{ t('protected') }}
          </div>
        </aside>

        <section class="panel">
          <ol v-if="stepIndex >= 0" class="stepper">
            <li
              v-for="(label, i) in [t('steps.identify'), t('steps.wallet'), t('steps.pay')]"
              :key="i"
              :class="{ done: stepIndex > i, current: stepIndex === i }"
            >
              <span class="stepper-dot">
                <svg v-if="stepIndex > i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                <template v-else>{{ i + 1 }}</template>
              </span>
              <span class="stepper-label">{{ label }}</span>
            </li>
          </ol>

          <p v-if="step === 'wallet' && !isExpired" class="status">{{ t('wallet.prompt') }}</p>
          <div v-if="step === 'wallet' && eligibleWallets.length" class="wallet-options" role="radiogroup" :aria-label="t('wallet.prompt')">
            <button
              v-for="w in eligibleWallets"
              :key="w.id"
              type="button"
              role="radio"
              class="wallet-option"
              :class="{ selected: selectedWalletId === w.id }"
              :aria-checked="selectedWalletId === w.id"
              @click="selectWallet(w.id)"
            >
              <span class="wallet-option-chip" :style="{ background: cardGradient(w.walletType, false) }">
                <img v-if="cardImageSrc(w.walletType)" :src="cardImageSrc(w.walletType)!" alt="" />
                <template v-else>{{ w.walletType.currency.code.slice(0, 3) }}</template>
              </span>
              <span class="wallet-option-main">
                <span class="wallet-option-name">{{ w.walletType.name }}</span>
                <span class="wallet-option-mask">{{ maskId(w.id) }}</span>
              </span>
              <span class="wallet-option-balance">
                <span class="wallet-option-balance-label">{{ t('wallet.available') }}</span>
                {{ formatAmount((BigInt(w.balance) + BigInt(w.virtualAmount || '0')).toString(), w.walletType.currency) }}
              </span>
              <span class="wallet-option-radio" aria-hidden="true"></span>
            </button>
          </div>

          <div
          v-if="step !== 'wallet' && step !== 'loading' && step !== 'phone' && step !== 'otp'"
          class="paycard paycard-static"
          :style="activeCard.background ? { background: activeCard.background } : undefined"
          aria-hidden="false"
        >
          <div class="paycard-top">
            <img v-if="activeCard.logoSrc" :src="activeCard.logoSrc" class="paycard-logo" alt="" />
            <span v-else class="paycard-chip" aria-hidden="true">
              <svg viewBox="0 0 32 24" fill="none"><rect x="1" y="1" width="30" height="22" rx="4" fill="currentColor" opacity="0.9"/><path d="M1 9h30M1 15h30M11 1v22M21 1v22" stroke="#fff" stroke-width="1"/></svg>
            </span>
            <span class="paycard-top-right">
              <span class="paycard-contactless" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M7 9a7 7 0 0 1 0 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M10.3 6.5a11 11 0 0 1 0 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13.6 4a15 15 0 0 1 0 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
              </span>
              <span class="paycard-brand">{{ t('brand') }}</span>
            </span>
          </div>
          <div class="paycard-number">{{ activeCard.masked }}</div>
          <div class="paycard-bottom">
            <div class="paycard-field">
              <span class="paycard-label">{{ activeCard.holderLabel }}</span>
              <span class="paycard-value">{{ activeCard.holderValue }}</span>
            </div>
            <div class="paycard-field paycard-field-right">
              <span class="paycard-label">{{ activeCard.subLabel }}</span>
              <span class="paycard-value">{{ activeCard.subValue }}</span>
              <span v-if="activeCard.subWords" class="paycard-value-words">{{ activeCard.subWords }}</span>
            </div>
          </div>
        </div>

          <div class="step-body">
          <template v-if="step === 'loading'">
          <p class="status">{{ t('loading') }}</p>
        </template>

        <template
          v-else-if="isExpired && step !== 'redirecting' && step !== 'insufficient-credit' && step !== 'topup-result'"
        >
          <p class="error">{{ t('expiredMessage') }}</p>
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
          <p v-if="!eligibleWallets.length" class="status">{{ t('wallet.none') }}</p>
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
          <p class="status">{{ t('insufficientCredit.message', { amount: shortfallDisplay }) }}</p>
          <button class="confirm" :disabled="gatewayBusy" @click="onConfirmTopUp">
            {{ t('insufficientCredit.payDifference', { amount: shortfallDisplay }) }}
          </button>
          <button class="link-btn" :disabled="gatewayBusy" @click="backToWalletSelection">
            {{ t('insufficientCredit.chooseDifferent') }}
          </button>
          <p v-if="gatewayError" class="error">{{ gatewayError }}</p>
        </template>

        <template v-else-if="step === 'topup-result'">
          <p class="status" :class="{ error: topUpResult === 'failed' }">
            {{ topUpResult === 'success' ? t('topUpResult.success') : topUpResultMessage || t('topUpResult.failed') }}
          </p>
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

        <div
          v-if="installmentPlan.length && (step === 'pay' || step === 'topup-result' || step === 'redirecting')"
          class="plan"
        >
          <p class="plan-heading">
            {{ step === 'pay' ? t('plan.previewHeading') : t('plan.settledHeading') }}
          </p>
          <p class="plan-hint">{{ t('plan.hint', { count: installmentPlan.length }) }}</p>
          <ol class="plan-list">
            <li v-for="row in installmentPlan" :key="row.sequenceNumber">
              <span class="plan-seq">#{{ row.sequenceNumber }}</span>
              <span class="plan-dates">
                <span>{{ t('plan.due', { date: formatCalendarDate(row.dueDate) }) }}</span>
                <span v-if="row.deadlineDate !== row.dueDate" class="plan-deadline">
                  {{ t('plan.deadline', { date: formatCalendarDate(row.deadlineDate) }) }}
                </span>
              </span>
              <span class="plan-amount">{{ row.displayAmount }}</span>
            </li>
          </ol>
        </div>
          </div>
        </section>
      </div>
    </main>

    <footer class="site-footer">
      <p>{{ t('footer') }}</p>
    </footer>
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}
.shell {
  --ink: #0f172a;
  --ink-dim: #5b6478;
  --ink-dimmer: #8e97aa;
  --line: #e4e8f1;
  --soft: #f6f8fc;
  --brand: #2457d6;
  --brand-gradient: linear-gradient(135deg, #4f8bff 0%, #2457d6 55%, #1a3fa8 100%);
  --danger: #d12f2f;
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  color: var(--ink);
  background:
    radial-gradient(1000px 500px at 100% -10%, rgba(79, 139, 255, 0.16), transparent 60%),
    radial-gradient(800px 500px at -10% 110%, rgba(36, 87, 214, 0.12), transparent 60%),
    #f3f5fa;
}

.nav {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1.5rem;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: saturate(1.4) blur(12px);
  border-bottom: 1px solid var(--line);
}
.nav-brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.logo-mark {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-gradient);
  color: #fff;
  font-weight: 800;
  font-size: 1.05rem;
  box-shadow: 0 6px 16px -6px rgba(36, 87, 214, 0.7);
}
.logo-text {
  font-weight: 700;
  font-size: 1.05rem;
}
.secure-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-inline-start: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(21, 128, 61, 0.1);
  color: #15803d;
  font-size: 0.72rem;
  font-weight: 700;
}
.secure-badge svg {
  width: 13px;
  height: 13px;
}
.nav-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.lang-toggle {
  min-height: 36px;
  padding: 0 0.85rem;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}
.lang-toggle:hover {
  border-color: var(--brand);
}

.page {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 1rem;
}

/* Two-panel checkout: order summary (dark) + steps (light). Stacks on
   narrow screens with the summary on top. */
.checkout {
  width: 100%;
  max-width: 920px;
  display: grid;
  grid-template-columns: minmax(0, 340px) minmax(0, 1fr);
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 26px;
  overflow: hidden;
  box-shadow: 0 30px 70px -30px rgba(15, 35, 95, 0.35);
}

.summary {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.75rem;
  color: #fff;
  background: linear-gradient(160deg, #13245a 0%, #1a3fa8 60%, #2457d6 100%);
  overflow: hidden;
}
.summary::before {
  content: '';
  position: absolute;
  width: 320px;
  height: 320px;
  top: -160px;
  inset-inline-end: -120px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.18), transparent 70%);
  pointer-events: none;
}
.summary > * {
  position: relative;
}
.summary-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.summary-merchant-icon {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.summary-merchant-icon svg {
  width: 22px;
  height: 22px;
}
.summary-merchant {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.summary-label {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.7);
}
.summary-merchant-name {
  font-size: 1.05rem;
  overflow-wrap: anywhere;
}
.summary-merchant-site {
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.75);
  overflow-wrap: anywhere;
}
.summary-amount {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 1rem 1.1rem;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.16);
}
.summary-amount-value {
  font-size: 1.85rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.summary-amount-words {
  font-size: 0.76rem;
  color: rgba(255, 255, 255, 0.75);
}
.summary-timer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.summary-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.76rem;
  color: rgba(255, 255, 255, 0.72);
}
.summary-foot svg {
  width: 16px;
  height: 16px;
  flex: none;
}

.merchant-panel {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.16);
}
.merchant-panel-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}
.merchant-panel-label {
  font-size: 0.76rem;
  color: rgba(255, 255, 255, 0.68);
  white-space: nowrap;
}
.merchant-panel-value {
  font-size: 0.82rem;
  font-weight: 600;
  text-align: end;
  overflow-wrap: anywhere;
}

/* Right panel */
.panel {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 1.75rem 2rem 2rem;
  min-width: 0;
}
.step-body {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.stepper {
  list-style: none;
  margin: 0 0 0.25rem;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.stepper li {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--ink-dimmer);
  font-size: 0.8rem;
  font-weight: 600;
  min-width: 0;
}
.stepper li:not(:last-child)::after {
  content: '';
  flex: 1;
  height: 2px;
  border-radius: 2px;
  background: var(--line);
  min-width: 12px;
}
.stepper li.done:not(:last-child)::after {
  background: var(--brand);
}
.stepper-dot {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  background: var(--soft);
  border: 1.5px solid var(--line);
}
.stepper-dot svg {
  width: 13px;
  height: 13px;
}
.stepper li.current {
  color: var(--ink);
}
.stepper li.current .stepper-dot {
  border-color: var(--brand);
  color: var(--brand);
  box-shadow: 0 0 0 4px rgba(36, 87, 214, 0.12);
}
.stepper li.done .stepper-dot {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
.stepper-label {
  white-space: nowrap;
}

/* Wallet selection: radio-style rows instead of a sideways carousel. */
.wallet-options {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  max-height: 340px;
  overflow-y: auto;
  padding: 2px;
}
.wallet-option {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  width: 100%;
  padding: 0.8rem 0.95rem;
  border-radius: 14px;
  border: 1.5px solid var(--line);
  background: #fff;
  color: var(--ink);
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}
.wallet-option:hover {
  border-color: rgba(36, 87, 214, 0.5);
}
.wallet-option.selected {
  border-color: var(--brand);
  background: rgba(36, 87, 214, 0.05);
  box-shadow: 0 0 0 3px rgba(36, 87, 214, 0.12);
}
.wallet-option-chip {
  flex: none;
  width: 52px;
  height: 34px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  box-shadow: 0 6px 14px -8px rgba(15, 23, 42, 0.6);
}
.wallet-option-chip img {
  max-width: 34px;
  max-height: 18px;
  object-fit: contain;
}
.wallet-option-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.wallet-option-name {
  font-weight: 700;
  font-size: 0.92rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wallet-option-mask {
  font-size: 0.74rem;
  color: var(--ink-dimmer);
  direction: ltr;
  text-align: start;
  font-variant-numeric: tabular-nums;
}
.wallet-option-balance {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-weight: 700;
  font-size: 0.88rem;
  font-variant-numeric: tabular-nums;
}
.wallet-option-balance-label {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--ink-dimmer);
}
.wallet-option-radio {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid var(--line);
  position: relative;
}
.wallet-option.selected .wallet-option-radio {
  border-color: var(--brand);
}
.wallet-option.selected .wallet-option-radio::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: var(--brand);
}

.flipclock {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 0.25rem;
  /* Minutes:seconds always reads left-to-right, even inside the Farsi/RTL
     layout — same reasoning as the card number staying LTR. */
  direction: ltr;
}
.flip-group {
  display: flex;
  gap: 4px;
  perspective: 240px;
}
.flip-digit {
  position: relative;
  width: 34px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #0c1636, #050b22);
  color: #fff;
  border-radius: 8px;
  font-size: 1.3rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 6px 14px -4px rgba(15, 24, 48, 0.5);
  transform-style: preserve-3d;
}
.flip-digit::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  background: rgba(0, 0, 0, 0.35);
  transform: translateY(-1px);
}
.flip-digit.flipping {
  animation: flipTile 0.56s ease-in-out;
}
@keyframes flipTile {
  0% {
    transform: rotateX(0deg);
  }
  50% {
    transform: rotateX(-90deg);
  }
  100% {
    transform: rotateX(0deg);
  }
}
.flip-colon {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.flip-colon span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.85);
}
.flipclock.expiring .flip-digit {
  background: linear-gradient(180deg, #b5342f, #7a1f1c);
  animation: pulse 1s ease-in-out infinite;
}
.flipclock.expiring .flip-colon span {
  background: #b5342f;
}
@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 6px 14px -4px rgba(181, 52, 47, 0.45);
  }
  50% {
    box-shadow: 0 8px 20px -4px rgba(181, 52, 47, 0.7);
  }
}

.paycard {
  position: relative;
  width: 100%;
  min-height: 168px;
  border-radius: 18px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  text-align: start;
  color: #fff;
  background: linear-gradient(135deg, #2f6fed 0%, #1550c9 60%, #103e9e 100%);
  box-shadow: 0 16px 34px -14px rgba(21, 80, 201, 0.55);
  border: none;
  cursor: default;
  font-family: inherit;
}
.paycard-static {
  cursor: default;
}
button.paycard {
  cursor: pointer;
  flex: 0 0 84%;
  scroll-snap-align: center;
  opacity: 0.72;
  transform: scale(0.96);
  transition: opacity 0.18s ease, transform 0.18s ease;
}
button.paycard.selected {
  opacity: 1;
  transform: scale(1);
  box-shadow: 0 20px 40px -14px rgba(21, 80, 201, 0.65);
}
.paycard-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.paycard-top-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.paycard-chip {
  width: 34px;
  height: 24px;
  color: rgba(255, 255, 255, 0.85);
}
.paycard-chip svg,
.paycard-contactless svg {
  width: 100%;
  height: 100%;
}
.paycard-logo {
  height: 26px;
  max-width: 72px;
  width: auto;
  object-fit: contain;
  flex: none;
}
.paycard-contactless {
  width: 22px;
  height: 22px;
  color: rgba(255, 255, 255, 0.85);
}
.paycard-number {
  font-size: 1.05rem;
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
  text-align: end;
  align-items: flex-end;
}
.paycard-label {
  font-size: 0.62rem;
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
  font-size: 0.62rem;
  font-weight: 500;
  line-height: 1.3;
  color: rgba(255, 255, 255, 0.65);
  white-space: normal;
  max-width: 100%;
}
.paycard-brand {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.85);
}


.status {
  margin: 0;
  color: var(--ink-dim);
  font-size: 0.92rem;
}
.plan {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line, #e5e7eb);
}
.plan-heading {
  margin: 0;
  font-weight: 600;
  color: var(--ink);
}
.plan-hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--ink-dim);
}
.plan-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.plan-list li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 8px;
  font-size: 0.9rem;
  color: var(--ink);
}
.plan-seq {
  color: var(--ink-dim);
  font-variant-numeric: tabular-nums;
}
.plan-dates {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.plan-deadline {
  font-size: 0.78rem;
  color: var(--ink-dim);
}
.plan-amount {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.dev-hint {
  margin: 0;
  color: #92400e;
  background: #fef3c7;
  border-radius: 10px;
  padding: 0.55rem 0.75rem;
  font-size: 0.85rem;
  font-family: ui-monospace, monospace;
}
.error {
  margin: 0;
  color: var(--danger);
  background: rgba(209, 47, 47, 0.08);
  border: 1px solid rgba(209, 47, 47, 0.2);
  border-radius: 10px;
  padding: 0.6rem 0.8rem;
  font-size: 0.88rem;
}
.redirect-url {
  margin: 0;
  color: var(--ink-dimmer);
  font-size: 0.78rem;
  word-break: break-all;
  font-family: ui-monospace, monospace;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-top: 0.25rem;
}
.confirm,
.cancel {
  min-height: 48px;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  border: none;
  font: inherit;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  transition: filter 0.15s, transform 0.08s;
}
.confirm {
  background: var(--brand-gradient);
  color: #fff;
  box-shadow: 0 12px 24px -10px rgba(36, 87, 214, 0.65);
}
.confirm:hover:not(:disabled) {
  filter: brightness(1.07);
}
.confirm:active:not(:disabled),
.cancel:active:not(:disabled) {
  transform: translateY(1px);
}
.cancel {
  background: #fff;
  color: var(--ink);
  border: 1px solid var(--line);
}
.cancel:hover:not(:disabled) {
  border-color: var(--danger);
  color: var(--danger);
}
.confirm:disabled,
.cancel:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}
.gateway-form {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.gateway-form input {
  width: 100%;
  min-height: 46px;
  padding: 0.7rem 0.8rem;
  border: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 0.98rem;
  outline: none;
}
.icon-field {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding-inline-start: 0.85rem;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: #fff;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.icon-field:focus-within {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(36, 87, 214, 0.15);
}
.icon-field-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  color: var(--ink-dimmer);
}
.icon-field:focus-within .icon-field-icon {
  color: var(--brand);
}
.icon-field-icon svg {
  width: 100%;
  height: 100%;
}
.captcha-label {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  color: var(--ink-dim);
  font-size: 0.85rem;
}
.captcha-image {
  width: 180px;
  height: 56px;
  border-radius: 12px;
  border: 1px solid var(--line);
}
.link-btn {
  align-self: center;
  background: none;
  border: none;
  color: var(--brand);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0.25rem;
}
.link-btn:hover {
  text-decoration: underline;
}
.link-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.otp-boxes {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  direction: ltr;
}
.otp-box {
  width: 46px;
  height: 56px;
  border-radius: 12px;
  border: 1.5px solid var(--line);
  background: #fff;
  color: var(--ink);
  font: inherit;
  font-size: 1.35rem;
  font-weight: 700;
  text-align: center;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.otp-box:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(36, 87, 214, 0.15);
}

.site-footer {
  text-align: center;
  padding: 1rem;
  font-size: 0.75rem;
  color: var(--ink-dimmer);
}
.site-footer p {
  margin: 0;
}

@media (max-width: 820px) {
  .checkout {
    grid-template-columns: minmax(0, 1fr);
    max-width: 480px;
  }
  .summary {
    gap: 1rem;
    padding: 1.4rem;
  }
  .summary-foot {
    display: none;
  }
  .panel {
    padding: 1.4rem;
  }
}
@media (max-width: 480px) {
  .page {
    padding: 1rem 0.75rem 1.5rem;
  }
  .checkout {
    border-radius: 20px;
  }
  .secure-badge {
    display: none;
  }
  .stepper-label {
    display: none;
  }
  .stepper li.current .stepper-label {
    display: inline;
  }
  .otp-box {
    width: 40px;
    height: 50px;
  }
}
</style>
