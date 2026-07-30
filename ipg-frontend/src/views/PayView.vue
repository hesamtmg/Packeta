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
type Step = 'loading' | 'phone' | 'otp' | 'wallet' | 'pay';
const step = ref<Step>('loading');

const phoneNumber = ref('');
const otpCode = ref('');
const devCodeHint = ref('');
const sessionToken = ref('');
const eligibleWallets = ref<EligibleWallet[]>([]);
const selectedWalletId = ref('');
const gatewayError = ref('');
const gatewayBusy = ref(false);

const info = ref<PaymentInfo | null>(null);
const loadError = ref('');
const busy = ref(false);
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;

const secondsLeft = computed(() => {
  if (!info.value) return 0;
  return Math.max(
    0,
    Math.floor((new Date(info.value.expiresAt).getTime() - now.value) / 1000),
  );
});

const isActionable = computed(
  () => info.value?.status === 'INITIATED' && secondsLeft.value > 0,
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
      return secondsLeft.value === 0 ? 'This payment link has expired.' : '';
  }
});

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
    window.location.href = result.redirectUrl;
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : 'Action failed';
    await loadPaymentInfo();
  } finally {
    busy.value = false;
  }
}

async function enterPayStep() {
  step.value = 'pay';
  await loadPaymentInfo();
  clock = setInterval(() => (now.value = Date.now()), 1000);
}

async function onRequestOtp() {
  gatewayError.value = '';
  gatewayBusy.value = true;
  try {
    const result = await packetaRequest<{ devCode: string }>(
      '/purchase-gateway/otp/request',
      { method: 'POST', body: { authority, phoneNumber: phoneNumber.value } },
    );
    devCodeHint.value = result.devCode;
    otpCode.value = '';
    step.value = 'otp';
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : 'Failed to send code';
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
    step.value = 'wallet';
  } catch (err) {
    gatewayError.value = err instanceof ApiError ? err.message : 'Invalid or expired code';
  } finally {
    gatewayBusy.value = false;
  }
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

onMounted(async () => {
  try {
    const status = await packetaRequest<{ needsWalletSelection: boolean }>(
      `/purchase-gateway/charge/${authority}/status`,
    );
    step.value = status.needsWalletSelection ? 'phone' : 'pay';
  } catch {
    // Fall back to the direct pay screen — matches pre-charge-flow behavior
    // if the status check itself is unreachable.
    step.value = 'pay';
  }
  if (step.value === 'pay') {
    await enterPayStep();
  }
});
onUnmounted(() => clock && clearInterval(clock));
</script>

<template>
  <div class="page">
    <div class="card">
      <div class="brand">Secure Payment</div>

      <template v-if="step === 'loading'">
        <p class="status">Loading…</p>
      </template>

      <template v-else-if="step === 'phone'">
        <p class="status">Enter your phone number to identify yourself and pick a wallet to pay from.</p>
        <form class="gateway-form" @submit.prevent="onRequestOtp">
          <input v-model="phoneNumber" type="tel" placeholder="+15551234567" required />
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
        <div v-if="eligibleWallets.length" class="wallet-list">
          <label v-for="w in eligibleWallets" :key="w.id" class="wallet-option">
            <input v-model="selectedWalletId" type="radio" name="wallet" :value="w.id" />
            <span>{{ w.walletType.name }} — {{ formatAmount(w.balance, w.walletType.currency) }}</span>
          </label>
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

      <template v-else>
        <p v-if="loadError" class="error">{{ loadError }}</p>

        <template v-else-if="info">
          <div class="merchant">{{ info.merchantName }}</div>
          <div class="amount">{{ info.displayAmount }}</div>

          <div v-if="isActionable" class="timer">
            Expires in {{ Math.floor(secondsLeft / 60) }}:{{
              String(secondsLeft % 60).padStart(2, '0')
            }}
          </div>

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
  max-width: 360px;
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
.link-btn {
  background: none;
  border: none;
  color: #9d99aa;
  font-size: 0.82rem;
  cursor: pointer;
  text-decoration: underline;
}
.wallet-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  text-align: left;
}
.wallet-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #f5f4f7;
  font-size: 0.9rem;
  cursor: pointer;
}
</style>
