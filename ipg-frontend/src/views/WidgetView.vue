<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { ApiError } from '../api/client';
import { packetaRequest } from '../api/packetaClient';
import { formatAmount, type CurrencyInfo } from '../utils/currency';
import { setLocale } from '../i18n';

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
  };
}

const route = useRoute();
const token = route.params.token as string;
const { t } = useI18n();

// Same steps PayView's phone/OTP identification uses, minus everything
// purchase-specific (no wallet-select-to-pay, no confirm/cancel, no
// redirect) — this only ever shows a read-only wallet list once
// authenticated. 'authenticating' covers the non-OTP path's automatic
// server round trip with nothing for the customer to do but wait a beat.
type Step = 'loading' | 'phone' | 'otp' | 'authenticating' | 'wallets' | 'error' | 'expired';
const step = ref<Step>('loading');

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

// The embedding page sizes its iframe off this — see sdk/js/wallet-widget.js
// — so any step change that could change content height posts a fresh one.
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
      `/widget/sessions/${token}/otp/request`,
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
    await packetaRequest(`/widget/sessions/${token}/otp/verify`, {
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
    wallets.value = await packetaRequest<WidgetWallet[]>(`/widget/sessions/${token}/wallets`);
    step.value = 'wallets';
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
    await packetaRequest(`/widget/sessions/${token}/authenticate`, { method: 'POST' });
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

onMounted(async () => {
  // No charge to carry a language field here (unlike PayView) — this widget
  // is embedded standalone, so it falls back to the embedding browser's own
  // language instead.
  setLocale(navigator.language.toLowerCase().startsWith('fa') ? 'fa' : 'en');

  try {
    status.value = await packetaRequest<WidgetStatus>(`/widget/sessions/${token}/status`);
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : t('widget.errors.sessionNotFound');
    step.value = 'error';
    postResize();
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
  postResize();
});
</script>

<template>
  <div class="widget-shell">
    <div class="widget-card">
      <div v-if="status?.merchantName" class="widget-merchant">{{ status.merchantName }}</div>

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
            <input v-model="phoneNumber" type="tel" :placeholder="t('widget.phone.placeholder')" required />
          </label>
          <p v-else class="phone-prebound">{{ status.phoneNumber }}</p>
          <label v-if="captchaImage" class="captcha-label">
            {{ t('widget.phone.captchaPrefix') }}
            <img :src="captchaImage" :alt="t('widget.phone.captchaPrefix')" class="captcha-image" />
            <span class="icon-field">
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

      <template v-else-if="step === 'wallets'">
        <p class="status">{{ t('widget.wallets.heading') }}</p>
        <p v-if="!wallets.length" class="status">{{ t('widget.wallets.none') }}</p>
        <ul v-else class="wallet-list">
          <li v-for="w in wallets" :key="w.id" class="wallet-row">
            <span class="wallet-name">{{ w.name || w.walletType.name }}</span>
            <span class="wallet-balance">
              {{ formatAmount((BigInt(w.balance) + BigInt(w.virtualAmount || '0')).toString(), w.walletType.currency) }}
            </span>
          </li>
        </ul>
      </template>
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
}
.widget-card {
  max-width: 360px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.widget-merchant {
  font-size: 0.95rem;
  font-weight: 800;
  color: #14213d;
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
  padding: 0 0.7rem;
  border-radius: 12px;
  border: 1px solid #e3e9f7;
  background: #f4f8ff;
}
.icon-field:focus-within {
  border-color: #2f6fed;
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.18);
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
.wallet-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.wallet-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.7rem 0.85rem;
  border-radius: 14px;
  background: #f4f8ff;
  border: 1px solid #e3e9f7;
}
.wallet-name {
  font-size: 0.88rem;
  font-weight: 700;
  color: #14213d;
}
.wallet-balance {
  font-size: 0.9rem;
  font-weight: 800;
  color: #1550c9;
}
</style>
