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
  expiresAt: string | null;
  language: string;
}

interface EligibleWallet {
  id: string;
  balance: string;
  virtualAmount :string;
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
const carousel = ref<HTMLElement | null>(null);
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
  displayAmount: chargeInfo.value?.displayAmount ?? info.value?.displayAmount ?? '',
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
    };
  }
  return {
    masked: maskId(authority ?? ''),
    holderLabel: t('card.payTo'),
    holderValue: merchantSummary.value.name || t('brand'),
    subLabel: t('card.amount'),
    subValue: merchantSummary.value.displayAmount,
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
// /pay/:authority URL with a topupTxnId query param, picked up on mount.
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
    const result = await packetaRequest<{
      status: string;
      reason?: string;
      redirectUrl?: string;
    }>(`/transactions/purchase/${topUpTransactionId}/verify`, { method: 'POST' });
    if (result.status === 'COMPLETED') {
      topUpResult.value = 'success';
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

onMounted(async () => {
  const topUpTransactionId = route.query.topupTxnId as string | undefined;
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
       <div class="merchant-column">
        <div v-if="hasMerchantPanel" class="merchant-panel">
          <div class="merchant-panel-row merchant-panel-title">
            <span class="merchant-panel-label">{{ t('merchantInfo.company') }}</span>
            <span class="merchant-panel-value">{{ merchantSummary.name }}</span>
          </div>
          <div v-if="merchantSummary.storeSite" class="merchant-panel-row">
            <span class="merchant-panel-label">{{ t('merchantInfo.storeSite') }}</span>
            <span class="merchant-panel-value">{{ merchantSummary.storeSite }}</span>
          </div>
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

        <div v-if="step !== 'loading' && merchantSummary.displayAmount" class="totals-bar">
          <span class="totals-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 8h6M9 12h6M9 16h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </span>
          <div class="totals-text">
            <span class="totals-label">{{ t('totals.label') }}</span>
            <strong class="totals-amount">{{ merchantSummary.displayAmount }}</strong>
          </div>
        </div>
       </div>

       <div class="form-column">
        <!-- No wallet is known yet on the very first (phone) step, so there's
             nothing meaningful to put on a card — it only appears from the
             next step onward. Wallet step shows every eligible wallet as its
             own selectable card; every later step shows one static summary
             card (the selected wallet once known, otherwise the transaction
             itself). -->
        <div v-if="step === 'wallet' && eligibleWallets.length" class="carousel-wrap">
          <button class="carousel-nav" type="button" @click="scrollCarousel(-1)">‹</button>
          <div ref="carousel" class="carousel">
            <button
              v-for="w in eligibleWallets"
              :key="w.id"
              type="button"
              class="paycard"
              :class="{ selected: selectedWalletId === w.id }"
              @click="selectWallet(w.id)"
            >
              <div class="paycard-top">
                <span class="paycard-chip" aria-hidden="true">
                  <svg viewBox="0 0 32 24" fill="none"><rect x="1" y="1" width="30" height="22" rx="4" fill="currentColor" opacity="0.9"/><path d="M1 9h30M1 15h30M11 1v22M21 1v22" stroke="#fff" stroke-width="1"/></svg>
                </span>
                <span class="paycard-top-right">
                  <span class="paycard-contactless" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M7 9a7 7 0 0 1 0 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M10.3 6.5a11 11 0 0 1 0 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13.6 4a15 15 0 0 1 0 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                  </span>
                  <span class="paycard-brand">{{ t('brand') }}</span>
                </span>
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
          <button class="carousel-nav" type="button" @click="scrollCarousel(1)">›</button>
        </div>

        <div v-else-if="step !== 'loading' && step !== 'phone'" class="paycard paycard-static" aria-hidden="false">
          <div class="paycard-top">
            <span class="paycard-chip" aria-hidden="true">
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
            </div>
          </div>
        </div>

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
          <p class="status">{{ t('wallet.prompt') }}</p>
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
       </div>
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
  background: linear-gradient(135deg, #6fa8ff, #2f6fed);
  opacity: 0.9;
}
.blob-2 {
  width: 90px;
  height: 90px;
  top: 60px;
  right: 190px;
  background: #2f6fed;
  opacity: 0.6;
}
.blob-3 {
  width: 360px;
  height: 360px;
  bottom: -140px;
  left: -120px;
  background: linear-gradient(135deg, #4f8bff, #1550c9);
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
  background: linear-gradient(135deg, #4f8bff, #2f6fed);
  color: #fff;
  font-weight: 700;
  font-size: 1.05rem;
}
.logo-text {
  font-weight: 700;
  font-size: 1.05rem;
  color: #14213d;
}
.nav-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.lang-toggle {
  padding: 0.4rem 0.8rem;
  border-radius: 999px;
  border: 1px solid #dce6fb;
  background: #fff;
  color: #2f6fed;
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
  color: #2f6fed;
  font-weight: 700;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  box-shadow:
    0 6px 16px rgba(47, 111, 237, 0.18),
    0 1px 2px rgba(20, 33, 61, 0.06);
  border: 1px solid #dce6fb;
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
  color: #14213d;
}
.page-subheading {
  margin: 0 0 1.75rem;
  color: #64748b;
  font-size: 0.95rem;
}
.card {
  width: 100%;
  max-width: 420px;
  background: #ffffff;
  border: 1px solid #e3e9f7;
  border-radius: 22px;
  padding: 1.75rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  box-shadow: 0 24px 60px -18px rgba(20, 60, 140, 0.25);
}
.merchant-column,
.form-column {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  min-width: 0;
}

/* At desktop widths there's room to show the merchant/wallet card
   alongside the phone/OTP/wallet-recognition form instead of stacking
   them, so the customer can see who and how much they're paying without
   scrolling past it first. */
@media (min-width: 860px) {
  .card {
    max-width: 760px;
    flex-direction: row;
    align-items: flex-start;
    text-align: left;
    padding: 2rem;
  }
  .merchant-column {
    flex: 0 0 320px;
  }
  .form-column {
    flex: 1 1 auto;
    justify-content: center;
    padding-top: 0.5rem;
    border-left: 1px solid #edf1fb;
    padding-left: 2rem;
  }
  [dir='rtl'] .form-column {
    border-left: none;
    border-right: 1px solid #edf1fb;
    padding-left: 0;
    padding-right: 2rem;
  }
}

/* The "physical card" visual: represents either the wallet the customer is
   about to pay from, or (before one's chosen) the transaction itself. */
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
  text-align: left;
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
  text-align: right;
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
.paycard-brand {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.85);
}

.merchant-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.9rem 1rem;
  border-radius: 14px;
  background: #f4f8ff;
  border: 1px solid #e3e9f7;
  text-align: left;
}
.merchant-panel-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}
.merchant-panel-title .merchant-panel-value {
  font-size: 1rem;
  font-weight: 800;
  color: #14213d;
}
.merchant-panel-label {
  font-size: 0.75rem;
  color: #64748b;
  white-space: nowrap;
}
.merchant-panel-value {
  font-size: 0.82rem;
  font-weight: 600;
  color: #1e2a4a;
  text-align: right;
  overflow-wrap: anywhere;
}

.totals-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border-radius: 14px;
  background: linear-gradient(135deg, #eaf1ff, #f7faff);
  border: 1px solid #dce6fb;
}
.totals-icon {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  color: #2f6fed;
}
.totals-icon svg {
  width: 100%;
  height: 100%;
}
.totals-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.totals-label {
  font-size: 0.78rem;
  color: #5b6b8c;
}
.totals-amount {
  font-size: 1.4rem;
  font-weight: 800;
  color: #14213d;
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
  background: linear-gradient(135deg, #4f8bff, #1550c9);
  color: #fff;
  padding: 0.8rem;
  border-radius: 999px;
  border: none;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 12px 24px -8px rgba(21, 80, 201, 0.55);
}
.cancel {
  background: #fff;
  color: #14213d;
  border: 1px solid #e3e9f7 !important;
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
  width: 100%;
  padding: 0.7rem 0.8rem;
  border-radius: 12px;
  border: 1px solid #e3e9f7;
  background: #f4f8ff;
  color: #14213d;
  font-size: 0.95rem;
  text-align: left;
}
.gateway-form input:focus {
  outline: none;
  border-color: #2f6fed;
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.18);
}
.icon-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-left: 0.7rem;
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
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  padding-left: 0 !important;
}
.captcha-label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  color: #64748b;
  font-size: 0.85rem;
}
.captcha-image {
  width: 180px;
  height: 56px;
  align-self: center;
  border-radius: 12px;
  border: 1px solid #e3e9f7;
}
.link-btn {
  background: none;
  border: none;
  color: #2f6fed;
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
  border: 1px solid #e3e9f7;
  background: #f4f8ff;
  color: #14213d;
  font-size: 1.3rem;
  font-weight: 700;
  text-align: center;
}
.otp-box:focus {
  outline: none;
  border-color: #2f6fed;
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.18);
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
  border: 1px solid #e3e9f7;
  background: #fff;
  color: #2f6fed;
  font-size: 1.1rem;
  cursor: pointer;
  box-shadow: 0 4px 10px rgba(20, 60, 140, 0.12);
}

.site-footer {
  z-index: 1;
  text-align: center;
  padding: 1rem;
  font-size: 0.75rem;
  color: #94a3b8;
  border-top: 1px solid #e3e9f7;
  background: rgba(255, 255, 255, 0.6);
}
.site-footer p {
  margin: 0;
}
</style>
