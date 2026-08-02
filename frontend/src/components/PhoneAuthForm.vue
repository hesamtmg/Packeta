<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../api/client';

const emit = defineEmits<{ success: [accessToken: string] }>();
const { t } = useI18n();

type Step = 'phone' | 'otp';
const step = ref<Step>('phone');

const phoneNumber = ref('');
const captchaId = ref('');
const captchaImage = ref('');
const captchaAnswer = ref('');
const code = ref('');
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

onMounted(loadCaptcha);

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
    code.value = '';
    step.value = 'otp';
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('auth.phone.requestError');
    await loadCaptcha();
  } finally {
    busy.value = false;
  }
}

async function onVerifyCode() {
  error.value = '';
  busy.value = true;
  try {
    const result = await apiRequest<{ accessToken: string }>(
      '/auth/phone/verify-otp',
      { method: 'POST', body: { phoneNumber: phoneNumber.value, code: code.value } },
    );
    emit('success', result.accessToken);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('auth.phone.verifyError');
  } finally {
    busy.value = false;
  }
}

function backToPhone() {
  step.value = 'phone';
  code.value = '';
  devCodeHint.value = '';
  error.value = '';
  loadCaptcha();
}
</script>

<template>
  <form v-if="step === 'phone'" class="phone-auth-form" @submit.prevent="onRequestCode">
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
      <img :src="captchaImage" :alt="t('auth.phone.captchaLabel')" class="captcha-image" />
      <input v-model="captchaAnswer" type="text" inputmode="numeric" class="admin-input" required />
    </label>
    <p v-if="error" class="admin-error">{{ error }}</p>
    <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">
      {{ t('auth.phone.sendCode') }}
    </button>
  </form>

  <form v-else class="phone-auth-form" @submit.prevent="onVerifyCode">
    <p class="hint">{{ t('auth.phone.codeSentTo', { phone: phoneNumber }) }}</p>
    <p v-if="devCodeHint" class="dev-hint">{{ t('auth.phone.devHint', { code: devCodeHint }) }}</p>
    <label>
      {{ t('auth.phone.codeLabel') }}
      <input
        v-model="code"
        type="text"
        inputmode="numeric"
        maxlength="6"
        autocomplete="one-time-code"
        class="admin-input"
        required
      />
    </label>
    <p v-if="error" class="admin-error">{{ error }}</p>
    <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">
      {{ t('auth.phone.verify') }}
    </button>
    <button type="button" class="admin-btn admin-btn-ghost" @click="backToPhone">
      {{ t('auth.phone.useDifferentNumber') }}
    </button>
  </form>
</template>

<style scoped>
.phone-auth-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  background: rgba(216, 255, 92, 0.1);
  color: var(--accent-lime);
  font-size: 0.8rem;
  font-family: monospace;
}
.captcha-field {
  gap: 6px;
}
.captcha-image {
  width: 180px;
  height: 56px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--card-border);
}
</style>
