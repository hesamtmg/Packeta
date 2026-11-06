<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../api/client';

// Email/username + password, for both /auth/login and /auth/signup. The
// backend stores either an email or a plain username in the same column
// (SignupDto: 3–255 chars) and matches it exactly on login, so the field is
// labelled for both and the limits below mirror the DTOs.
const props = defineProps<{ mode: 'login' | 'signup' }>();
const emit = defineEmits<{ success: [accessToken: string] }>();
const { t } = useI18n();

const IDENTIFIER_MIN = 3;
const IDENTIFIER_MAX = 255;
const PASSWORD_MIN = 8;

const identifier = ref('');
const password = ref('');
const confirmPassword = ref('');
const showPassword = ref(false);
const capsLock = ref(false);
const submitted = ref(false);
const error = ref('');
const loading = ref(false);

const isSignup = computed(() => props.mode === 'signup');
const trimmedIdentifier = computed(() => identifier.value.trim());

const identifierError = computed(() => {
  if (!trimmedIdentifier.value) return t('auth.password.identifierRequired');
  if (isSignup.value && trimmedIdentifier.value.length < IDENTIFIER_MIN) {
    return t('auth.password.identifierTooShort', { min: IDENTIFIER_MIN });
  }
  return '';
});
const passwordError = computed(() => {
  if (!password.value) return t('auth.password.passwordRequired');
  if (isSignup.value && password.value.length < PASSWORD_MIN) {
    return t('auth.password.passwordTooShort', { min: PASSWORD_MIN });
  }
  return '';
});
const confirmError = computed(() => {
  if (!isSignup.value) return '';
  if (!confirmPassword.value) return t('auth.password.confirmRequired');
  if (confirmPassword.value !== password.value) return t('auth.password.mismatch');
  return '';
});
// Don't flag a mismatch while the user is still typing the confirmation.
const showConfirmError = computed(
  () =>
    !!confirmError.value &&
    (submitted.value || (!!confirmPassword.value && confirmPassword.value.length >= password.value.length)),
);
const passwordLongEnough = computed(() => password.value.length >= PASSWORD_MIN);
const formValid = computed(() => !identifierError.value && !passwordError.value && !confirmError.value);

function onKey(e: KeyboardEvent) {
  capsLock.value = typeof e.getModifierState === 'function' && e.getModifierState('CapsLock');
}

async function onSubmit() {
  submitted.value = true;
  error.value = '';
  if (!formValid.value) return;
  loading.value = true;
  try {
    const { accessToken } = await apiRequest<{ accessToken: string }>(
      isSignup.value ? '/auth/signup' : '/auth/login',
      { method: 'POST', body: { email: trimmedIdentifier.value, password: password.value } },
    );
    emit('success', accessToken);
  } catch (err) {
    error.value =
      err instanceof ApiError ? err.message : t(isSignup.value ? 'auth.signup.error' : 'auth.login.error');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <form class="password-auth" novalidate @submit.prevent="onSubmit">
    <div class="field">
      <label for="auth-identifier">{{ t('auth.password.identifierLabel') }}</label>
      <input
        id="auth-identifier"
        v-model="identifier"
        type="text"
        dir="ltr"
        autocomplete="username"
        autocapitalize="none"
        spellcheck="false"
        :maxlength="IDENTIFIER_MAX"
        class="admin-input ltr-input"
        :class="{ invalid: submitted && identifierError }"
        :placeholder="t('auth.password.identifierPlaceholder')"
        :aria-invalid="submitted && !!identifierError"
        aria-describedby="auth-identifier-hint"
        autofocus
      />
      <small id="auth-identifier-hint" class="field-hint" :class="{ 'field-hint-error': submitted && identifierError }">
        <template v-if="submitted && identifierError">{{ identifierError }}</template>
        <template v-else-if="isSignup">{{ t('auth.password.identifierHintSignup', { min: IDENTIFIER_MIN }) }}</template>
        <template v-else>{{ t('auth.password.identifierHintLogin') }}</template>
      </small>
    </div>

    <div class="field">
      <label for="auth-password">{{ t('auth.password.passwordLabel') }}</label>
      <div class="password-wrap">
        <input
          id="auth-password"
          v-model="password"
          :type="showPassword ? 'text' : 'password'"
          dir="ltr"
          :autocomplete="isSignup ? 'new-password' : 'current-password'"
          class="admin-input ltr-input"
          :class="{ invalid: submitted && passwordError }"
          :aria-invalid="submitted && !!passwordError"
          aria-describedby="auth-password-hint"
          @keydown="onKey"
          @keyup="onKey"
        />
        <button
          type="button"
          class="reveal-btn"
          :aria-label="showPassword ? t('auth.password.hide') : t('auth.password.show')"
          :title="showPassword ? t('auth.password.hide') : t('auth.password.show')"
          :aria-pressed="showPassword"
          @click="showPassword = !showPassword"
        >
          <svg v-if="showPassword" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A9.8 9.8 0 0 1 12 5c5 0 8.5 4.5 9.5 7a13 13 0 0 1-2.6 3.8M6.2 6.2C4.2 7.6 2.9 9.6 2.5 12c1 2.5 4.5 7 9.5 7 1.6 0 3-.4 4.3-1.1" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2.5 12C3.5 9.5 7 5 12 5s8.5 4.5 9.5 7c-1 2.5-4.5 7-9.5 7s-8.5-4.5-9.5-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
      <small id="auth-password-hint" class="field-hint" :class="{ 'field-hint-error': submitted && passwordError }">
        <template v-if="submitted && passwordError">{{ passwordError }}</template>
        <template v-else-if="isSignup">
          <span class="rule" :class="{ ok: passwordLongEnough }">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path v-if="passwordLongEnough" d="M5 12l5 5 9-10" />
              <circle v-else cx="12" cy="12" r="4" />
            </svg>
            {{ t('auth.password.minLength', { min: PASSWORD_MIN }) }}
          </span>
        </template>
      </small>
      <small v-if="capsLock" class="field-hint caps-warning" role="status">{{ t('auth.password.capsLock') }}</small>
    </div>

    <div v-if="isSignup" class="field">
      <label for="auth-confirm">{{ t('auth.password.confirmLabel') }}</label>
      <input
        id="auth-confirm"
        v-model="confirmPassword"
        :type="showPassword ? 'text' : 'password'"
        dir="ltr"
        autocomplete="new-password"
        class="admin-input ltr-input"
        :class="{ invalid: showConfirmError }"
        :aria-invalid="showConfirmError"
        @keydown="onKey"
        @keyup="onKey"
      />
      <small v-if="showConfirmError" class="field-hint field-hint-error">{{ confirmError }}</small>
    </div>

    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>

    <button type="submit" class="admin-btn admin-btn-primary submit-btn" :disabled="loading">
      <span v-if="loading" class="spinner" aria-hidden="true"></span>
      <template v-if="isSignup">{{ loading ? t('auth.signup.submitting') : t('auth.signup.submit') }}</template>
      <template v-else>{{ loading ? t('auth.login.submitting') : t('auth.login.submit') }}</template>
    </button>
  </form>
</template>

<style scoped>
.admin-error {
  white-space: pre-line;
}
.password-auth {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
.caps-warning {
  color: var(--accent-orange);
  font-weight: 600;
}
.rule {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.rule svg {
  width: 13px;
  height: 13px;
}
.rule.ok {
  color: var(--accent-lime);
}
.password-wrap {
  position: relative;
}
/* Physical sides on purpose: the input itself is dir="ltr" while the page
   may be RTL, so logical properties would resolve against different axes
   for the input and the button. */
.password-wrap .admin-input {
  padding-right: 46px;
}
[dir='rtl'] .password-wrap .admin-input {
  padding-right: 12px;
  padding-left: 46px;
}
.reveal-btn {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
[dir='rtl'] .reveal-btn {
  right: auto;
  left: 6px;
}
.reveal-btn:hover {
  color: var(--text);
  background: var(--hover-tint);
}
.reveal-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.reveal-btn svg {
  width: 18px;
  height: 18px;
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
</style>
