<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../api/client';
import { isValidPhone, normalizePhoneInput, toLatinDigits } from '../utils/digits';

// Phone + OTP is a single flow on the backend: a known number is signed in,
// an unknown one gets a fresh account (see AuthService.verifyPhoneOtp). The
// `mode` only changes the wording so each page explains that honestly.
const props = defineProps<{ mode: 'login' | 'signup' }>();
const emit = defineEmits<{ success: [accessToken: string] }>();
const { t } = useI18n();

const OTP_LENGTH = 6;
const CAPTCHA_LENGTH = 5;
// Must match the backend: AuthOtpService OTP_TTL_MS.
const OTP_TTL_SECONDS = 5 * 60;
const RESEND_AFTER_SECONDS = 60;

type Step = 'phone' | 'otp';
const step = ref<Step>('phone');

const phoneNumber = ref('');
const phoneTouched = ref(false);
const captchaId = ref('');
const captchaImage = ref('');
const captchaAnswer = ref('');
const captchaLoading = ref(false);
const captchaFailed = ref(false);
const captchaInput = ref<HTMLInputElement | null>(null);

const otpDigits = ref<string[]>(Array(OTP_LENGTH).fill(''));
const otpInputRefs = ref<(HTMLInputElement | null)[]>([]);
const devCodeHint = ref('');
const sentTo = ref('');
const sentAt = ref(0);
const now = ref(Date.now());
const error = ref('');
const busy = ref(false);

const timer = window.setInterval(() => {
  now.value = Date.now();
}, 1000);
onBeforeUnmount(() => window.clearInterval(timer));

const normalizedPhone = computed(() => normalizePhoneInput(phoneNumber.value));
const phoneValid = computed(() => isValidPhone(phoneNumber.value));
const showPhoneError = computed(() => phoneTouched.value && !!phoneNumber.value && !phoneValid.value);
const captchaValid = computed(() => captchaAnswer.value.length === CAPTCHA_LENGTH);
const canRequest = computed(() => phoneValid.value && captchaValid.value && !!captchaId.value && !busy.value);

const elapsed = computed(() => Math.floor((now.value - sentAt.value) / 1000));
const expiresIn = computed(() => Math.max(0, OTP_TTL_SECONDS - elapsed.value));
const resendIn = computed(() => Math.max(0, RESEND_AFTER_SECONDS - elapsed.value));
const codeExpired = computed(() => step.value === 'otp' && expiresIn.value === 0);
const otpCode = computed(() => otpDigits.value.join(''));
const otpComplete = computed(() => otpCode.value.length === OTP_LENGTH);

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function loadCaptcha() {
  captchaLoading.value = true;
  captchaFailed.value = false;
  captchaAnswer.value = '';
  try {
    const captcha = await apiRequest<{ captchaId: string; image: string }>('/auth/phone/captcha');
    captchaId.value = captcha.captchaId;
    captchaImage.value = captcha.image;
  } catch {
    captchaId.value = '';
    captchaImage.value = '';
    captchaFailed.value = true;
  } finally {
    captchaLoading.value = false;
  }
}

loadCaptcha();

function onPhoneInput(e: Event) {
  const target = e.target as HTMLInputElement;
  // Keep what the user typed (minus non-phone characters) so the caret
  // doesn't jump; normalisation happens on submit.
  phoneNumber.value = toLatinDigits(target.value).replace(/[^\d+\s\-()]/g, '');
  target.value = phoneNumber.value;
}

function onCaptchaInput(e: Event) {
  const target = e.target as HTMLInputElement;
  captchaAnswer.value = toLatinDigits(target.value).replace(/\D/g, '').slice(0, CAPTCHA_LENGTH);
  target.value = captchaAnswer.value;
}

async function onRequestCode() {
  phoneTouched.value = true;
  if (!canRequest.value) return;
  error.value = '';
  busy.value = true;
  try {
    const phone = normalizedPhone.value;
    const result = await apiRequest<{ devCode?: string }>('/auth/phone/request-otp', {
      method: 'POST',
      body: { phoneNumber: phone, captchaId: captchaId.value, captchaAnswer: captchaAnswer.value },
    });
    devCodeHint.value = result.devCode ?? '';
    sentTo.value = phone;
    sentAt.value = Date.now();
    now.value = sentAt.value;
    otpDigits.value = Array(OTP_LENGTH).fill('');
    step.value = 'otp';
    await nextTick();
    otpInputRefs.value[0]?.focus();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('auth.phone.requestError');
    // The CAPTCHA is single-use server-side, so any attempt burns it.
    await loadCaptcha();
    captchaInput.value?.focus();
  } finally {
    busy.value = false;
  }
}

async function submitCode() {
  if (!otpComplete.value || busy.value || codeExpired.value) return;
  error.value = '';
  busy.value = true;
  try {
    const result = await apiRequest<{ accessToken: string }>('/auth/phone/verify-otp', {
      method: 'POST',
      body: { phoneNumber: sentTo.value, code: otpCode.value },
    });
    emit('success', result.accessToken);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('auth.phone.verifyError');
    otpDigits.value = Array(OTP_LENGTH).fill('');
    await nextTick();
    otpInputRefs.value[0]?.focus();
  } finally {
    busy.value = false;
  }
}

function setOtpRef(el: unknown, i: number) {
  otpInputRefs.value[i] = (el as HTMLInputElement | null) ?? null;
}

function fillDigits(from: number, digits: string[]) {
  digits.slice(0, OTP_LENGTH - from).forEach((d, k) => {
    otpDigits.value[from + k] = d;
  });
  const next = Math.min(from + digits.length, OTP_LENGTH - 1);
  otpInputRefs.value[next]?.focus();
  if (otpComplete.value) submitCode();
}

function onOtpInput(i: number, e: Event) {
  const target = e.target as HTMLInputElement;
  const digits = toLatinDigits(target.value).replace(/\D/g, '').split('');
  if (digits.length > 1) {
    // SMS autofill / IME can drop the whole code into one box.
    target.value = otpDigits.value[i];
    fillDigits(i, digits);
    return;
  }
  otpDigits.value[i] = digits[0] ?? '';
  target.value = otpDigits.value[i];
  if (digits.length && i < OTP_LENGTH - 1) {
    otpInputRefs.value[i + 1]?.focus();
  }
  if (otpComplete.value) submitCode();
}

function onOtpKeydown(i: number, e: KeyboardEvent) {
  const rtlSafePrev = 'ArrowLeft';
  const rtlSafeNext = 'ArrowRight';
  if (e.key === 'Backspace' && !otpDigits.value[i] && i > 0) {
    e.preventDefault();
    otpDigits.value[i - 1] = '';
    otpInputRefs.value[i - 1]?.focus();
  } else if (e.key === rtlSafePrev && i > 0) {
    e.preventDefault();
    otpInputRefs.value[i - 1]?.focus();
  } else if (e.key === rtlSafeNext && i < OTP_LENGTH - 1) {
    e.preventDefault();
    otpInputRefs.value[i + 1]?.focus();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    submitCode();
  }
}

function onOtpPaste(e: ClipboardEvent) {
  const digits = toLatinDigits(e.clipboardData?.getData('text') ?? '')
    .replace(/\D/g, '')
    .slice(0, OTP_LENGTH)
    .split('');
  if (!digits.length) return;
  e.preventDefault();
  otpDigits.value = Array(OTP_LENGTH).fill('');
  fillDigits(0, digits);
}

// Requesting another code needs a fresh CAPTCHA (the backend requires one on
// every request-otp), so "resend" and "change number" both go back to the
// first step — resend keeps the number and jumps straight to the CAPTCHA.
async function backToPhone(keepNumber: boolean) {
  step.value = 'phone';
  otpDigits.value = Array(OTP_LENGTH).fill('');
  devCodeHint.value = '';
  error.value = '';
  if (!keepNumber) phoneNumber.value = '';
  await loadCaptcha();
  await nextTick();
  captchaInput.value?.focus();
}
</script>

<template>
  <form v-if="step === 'phone'" class="phone-auth" novalidate @submit.prevent="onRequestCode">
    <p class="phone-note">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
      <span>{{ props.mode === 'signup' ? t('auth.phone.signupNote') : t('auth.phone.loginNote') }}</span>
    </p>

    <div class="field">
      <label for="auth-phone">{{ t('auth.phone.phoneLabel') }}</label>
      <input
        id="auth-phone"
        :value="phoneNumber"
        type="tel"
        dir="ltr"
        inputmode="tel"
        autocomplete="tel"
        class="admin-input ltr-input"
        :class="{ invalid: showPhoneError }"
        placeholder="0912 345 6789"
        :aria-invalid="showPhoneError"
        aria-describedby="auth-phone-hint"
        required
        autofocus
        @input="onPhoneInput"
        @blur="phoneTouched = true"
      />
      <small id="auth-phone-hint" class="field-hint" :class="{ 'field-hint-error': showPhoneError }">
        {{ showPhoneError ? t('auth.phone.invalidPhone') : t('auth.phone.phoneHint') }}
      </small>
    </div>

    <div class="field">
      <label for="auth-captcha">{{ t('auth.phone.captchaLabel') }}</label>
      <div class="captcha-row">
        <div class="captcha-image" :class="{ loading: captchaLoading }">
          <img v-if="captchaImage" :src="captchaImage" :alt="t('auth.phone.captchaAlt')" />
          <span v-else-if="captchaFailed" class="captcha-failed">{{ t('auth.phone.captchaFailed') }}</span>
        </div>
        <button
          type="button"
          class="admin-icon-btn captcha-refresh"
          :title="t('auth.phone.captchaRefresh')"
          :aria-label="t('auth.phone.captchaRefresh')"
          :disabled="captchaLoading"
          @click="loadCaptcha"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" :class="{ spin: captchaLoading }">
            <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
          </svg>
        </button>
      </div>
      <input
        id="auth-captcha"
        ref="captchaInput"
        :value="captchaAnswer"
        type="text"
        dir="ltr"
        inputmode="numeric"
        autocomplete="off"
        :maxlength="CAPTCHA_LENGTH"
        class="admin-input ltr-input captcha-input"
        :placeholder="'•'.repeat(CAPTCHA_LENGTH)"
        :disabled="!captchaImage"
        required
        @input="onCaptchaInput"
      />
    </div>

    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>

    <button type="submit" class="admin-btn admin-btn-primary submit-btn" :disabled="!canRequest">
      <span v-if="busy" class="spinner" aria-hidden="true"></span>
      {{ busy ? t('auth.phone.sending') : t('auth.phone.sendCode') }}
    </button>
  </form>

  <form v-else class="phone-auth" novalidate @submit.prevent="submitCode">
    <div class="otp-head">
      <p>{{ t('auth.phone.codeSentTo') }}</p>
      <div class="otp-phone">
        <bdi dir="ltr">{{ sentTo }}</bdi>
        <button type="button" class="text-btn" @click="backToPhone(false)">{{ t('auth.phone.editNumber') }}</button>
      </div>
    </div>

    <p v-if="devCodeHint" class="dev-hint">
      {{ t('auth.phone.devHint') }} <bdi dir="ltr" class="dev-code">{{ devCodeHint }}</bdi>
    </p>

    <fieldset class="otp-fieldset">
      <legend class="sr-only">{{ t('auth.phone.codeLabel') }}</legend>
      <div dir="ltr" class="otp-boxes" :class="{ busy }" @paste="onOtpPaste">
        <input
          v-for="(d, i) in otpDigits"
          :key="i"
          :ref="(el) => setOtpRef(el, i)"
          class="otp-box"
          :class="{ filled: !!d }"
          type="text"
          inputmode="numeric"
          :maxlength="i === 0 ? OTP_LENGTH : 1"
          :autocomplete="i === 0 ? 'one-time-code' : 'off'"
          :aria-label="t('auth.phone.digitLabel', { n: i + 1, total: OTP_LENGTH })"
          :disabled="busy || codeExpired"
          :value="d"
          @input="onOtpInput(i, $event)"
          @keydown="onOtpKeydown(i, $event)"
          @focus="($event.target as HTMLInputElement).select()"
        />
      </div>
    </fieldset>

    <p class="otp-timer" :class="{ expired: codeExpired }">
      <template v-if="codeExpired">{{ t('auth.phone.codeExpired') }}</template>
      <template v-else>{{ t('auth.phone.expiresIn', { time: formatSeconds(expiresIn) }) }}</template>
    </p>

    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>

    <button type="submit" class="admin-btn admin-btn-primary submit-btn" :disabled="!otpComplete || busy || codeExpired">
      <span v-if="busy" class="spinner" aria-hidden="true"></span>
      {{ busy ? t('auth.phone.verifying') : t('auth.phone.verify') }}
    </button>

    <p class="resend">
      <template v-if="resendIn > 0 && !codeExpired">
        {{ t('auth.phone.resendIn', { time: formatSeconds(resendIn) }) }}
      </template>
      <template v-else>
        {{ t('auth.phone.noCode') }}
        <button type="button" class="text-btn" @click="backToPhone(true)">{{ t('auth.phone.resend') }}</button>
      </template>
    </p>
  </form>
</template>

<style scoped>
.admin-error {
  white-space: pre-line;
}
.phone-auth {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.phone-note {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--badge-tint-blue);
  color: var(--text);
  font-size: 0.83rem;
  line-height: 1.5;
}
.phone-note svg {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  color: var(--accent-blue);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text);
}
.field .admin-input {
  width: 100%;
  min-height: 44px;
  font-size: 0.95rem;
}
.ltr-input {
  direction: ltr;
  text-align: start;
}
[dir='rtl'] .ltr-input {
  text-align: right;
}
.admin-input.invalid {
  border-color: var(--accent-red);
}
.field-hint {
  font-size: 0.78rem;
  color: var(--text-dimmer);
}
.field-hint-error {
  color: var(--accent-red);
}
.captcha-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.captcha-image {
  flex: 1;
  height: 56px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--card-border);
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: opacity 0.15s;
}
.captcha-image.loading {
  opacity: 0.5;
}
.captcha-image img {
  height: 100%;
  width: auto;
  max-width: 100%;
}
.captcha-failed {
  font-size: 0.78rem;
  color: var(--accent-red);
  padding: 0 8px;
  text-align: center;
}
.captcha-refresh {
  flex: none;
  width: 44px;
  height: 44px;
}
.captcha-input {
  letter-spacing: 0.35em;
  font-weight: 600;
}
.spin {
  animation: spin 0.8s linear infinite;
}
.submit-btn {
  width: 100%;
  min-height: 46px;
  font-size: 0.92rem;
}
.spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.text-btn {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: var(--accent-blue);
  cursor: pointer;
}
.text-btn:hover {
  text-decoration: underline;
}

/* ---------- OTP step ---------- */
.otp-head p {
  margin: 0 0 4px;
  font-size: 0.88rem;
  color: var(--text-dim);
}
.otp-phone {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1rem;
  font-weight: 700;
}
.otp-phone .text-btn {
  font-size: 0.84rem;
}
.dev-hint {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--dev-hint-bg);
  color: var(--dev-hint-text);
  font-size: 0.82rem;
  line-height: 1.5;
}
.dev-code {
  font-family: ui-monospace, monospace;
  font-weight: 700;
  letter-spacing: 0.15em;
}
.otp-fieldset {
  border: none;
  margin: 0;
  padding: 0;
  min-width: 0;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.otp-boxes {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}
.otp-boxes.busy {
  opacity: 0.6;
}
.otp-box {
  width: 100%;
  min-width: 0;
  height: 56px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--card-border);
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
  font-size: 1.4rem;
  font-weight: 700;
  text-align: center;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.otp-box.filled {
  border-color: color-mix(in srgb, var(--accent-blue) 45%, var(--card-border));
}
.otp-box:focus {
  outline: none;
  border-color: var(--accent-blue);
  box-shadow: var(--focus-ring);
}
.otp-box:disabled {
  opacity: 0.6;
}
.otp-timer {
  margin: -6px 0 0;
  font-size: 0.8rem;
  color: var(--text-dimmer);
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.otp-timer.expired {
  color: var(--accent-red);
  font-weight: 600;
}
.resend {
  margin: 0;
  font-size: 0.84rem;
  color: var(--text-dim);
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>
