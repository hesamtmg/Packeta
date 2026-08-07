<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../api/client';

const props = defineProps<{ eyebrow?: string }>();
const emit = defineEmits<{ success: [accessToken: string] }>();
const { t } = useI18n();

type Step = 'phone' | 'otp';
const step = ref<Step>('phone');

const phoneNumber = ref('');
const captchaId = ref('');
const captchaImage = ref('');
const captchaAnswer = ref('');
const otpDigits = ref<string[]>(['', '', '', '', '', '']);
const otpInputRefs = ref<(HTMLInputElement | null)[]>([]);
const devCodeHint = ref('');
const error = ref('');
const busy = ref(false);

async function loadCaptcha() {
  try {
    const captcha = await apiRequest<{ captchaId: string; image: string }>(
      '/auth/phone/captcha',
    );
    captchaId.value = captcha.captchaId;
    captchaImage.value = captcha.image;
    captchaAnswer.value = '';
  } catch {
    // Non-critical — the captcha field just stays blank and request-otp
    // will fail with a clear error if the user tries to submit anyway.
  }
}

loadCaptcha();

async function onRequestCode() {
  error.value = '';
  busy.value = true;
  try {
    const result = await apiRequest<{ devCode: string }>(
      '/auth/phone/request-otp',
      {
        method: 'POST',
        body: {
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
    error.value = err instanceof ApiError ? err.message : t('auth.phone.requestError');
    await loadCaptcha();
  } finally {
    busy.value = false;
  }
}

async function submitCode(code: string) {
  error.value = '';
  busy.value = true;
  try {
    const result = await apiRequest<{ accessToken: string }>(
      '/auth/phone/verify-otp',
      { method: 'POST', body: { phoneNumber: phoneNumber.value, code } },
    );
    emit('success', result.accessToken);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('auth.phone.verifyError');
    otpDigits.value = ['', '', '', '', '', ''];
    otpInputRefs.value[0]?.focus();
  } finally {
    busy.value = false;
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
  const code = otpDigits.value.join('');
  if (code.length === otpDigits.value.length && !busy.value) {
    submitCode(code);
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
  const code = otpDigits.value.join('');
  if (code.length === otpDigits.value.length) {
    submitCode(code);
  }
}

function backToPhone() {
  step.value = 'phone';
  otpDigits.value = ['', '', '', '', '', ''];
  devCodeHint.value = '';
  error.value = '';
  loadCaptcha();
}
</script>

<template>
  <form v-if="step === 'phone'" class="phone-auth-form" @submit.prevent="onRequestCode">
    <div class="phone-hero">
      <span class="phone-hero-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z"
            stroke="currentColor"
            stroke-width="1.6"
          />
          <path d="M11 17.2h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </span>
      <div class="phone-hero-text">
        <span class="phone-hero-tag">{{ t('auth.recommended') }}</span>
        <p v-if="props.eyebrow" class="phone-hero-eyebrow">{{ props.eyebrow }}</p>
      </div>
    </div>

    <label>
      {{ t('auth.phone.phoneLabel') }}
      <input
        v-model="phoneNumber"
        type="tel"
        class="admin-input"
        placeholder="+15551234567"
        required
      />
    </label>
    <label v-if="captchaImage" class="captcha-field">
      {{ t('auth.phone.captchaLabel') }}
      <span class="captcha-row">
        <img :src="captchaImage" :alt="t('auth.phone.captchaLabel')" class="captcha-image" />
        <input
          v-model="captchaAnswer"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          class="admin-input"
          required
        />
      </span>
    </label>
    <p v-if="error" class="admin-error">{{ error }}</p>
    <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">
      {{ t('auth.phone.sendCode') }}
    </button>
  </form>

  <div v-else class="phone-auth-form">
    <p class="hint">{{ t('auth.phone.codeSentTo', { phone: phoneNumber }) }}</p>
    <p v-if="devCodeHint" class="dev-hint">{{ t('auth.phone.devHint', { code: devCodeHint }) }}</p>
    <div class="otp-boxes" :class="{ busy }" @paste="onOtpPaste">
      <input
        v-for="(d, i) in otpDigits"
        :key="i"
        :ref="(el) => setOtpRef(el as Element | null, i)"
        class="otp-box"
        type="text"
        inputmode="numeric"
        maxlength="1"
        autocomplete="one-time-code"
        :disabled="busy"
        :value="d"
        @input="onOtpInput(i, $event)"
        @keydown="onOtpKeydown(i, $event)"
      />
    </div>
    <p v-if="error" class="admin-error">{{ error }}</p>
    <button type="button" class="admin-btn admin-btn-ghost" @click="backToPhone">
      {{ t('auth.phone.useDifferentNumber') }}
    </button>
  </div>
</template>

<style scoped>
.phone-auth-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.phone-hero {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--hover-tint, rgba(255, 255, 255, 0.06));
}
.phone-hero-icon {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-gradient, var(--text));
  color: #fff;
  box-shadow: var(--shadow-btn, none);
}
.phone-hero-icon svg {
  width: 20px;
  height: 20px;
}
.phone-hero-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.phone-hero-tag {
  align-self: flex-start;
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent-blue, var(--text));
  background: var(--badge-tint-blue, rgba(122, 162, 255, 0.15));
  padding: 2px 8px;
  border-radius: 999px;
}
.phone-hero-eyebrow {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-dim);
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.85rem;
}
.dev-hint {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--dev-hint-bg, rgba(216, 255, 92, 0.1));
  color: var(--dev-hint-text, var(--accent-lime));
  font-size: 0.8rem;
  font-family: monospace;
}
.captcha-field {
  gap: 6px;
}
.captcha-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.captcha-row .admin-input {
  flex: 1;
  min-width: 0;
}
.captcha-image {
  flex: none;
  width: 150px;
  height: 56px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--card-border);
}
.otp-boxes {
  display: flex;
  justify-content: center;
  gap: 8px;
}
.otp-boxes.busy {
  opacity: 0.6;
}
.otp-box {
  width: 44px;
  height: 54px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--card-border);
  background: var(--input-bg, transparent);
  color: var(--text);
  font-size: 1.3rem;
  font-weight: 700;
  text-align: center;
}
.otp-box:focus {
  outline: none;
  border-color: var(--accent-blue);
  box-shadow: 0 0 0 3px rgba(21, 80, 201, 0.15);
}
</style>
