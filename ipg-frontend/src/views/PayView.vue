<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { apiRequest, ApiError } from '../api/client';

interface PaymentInfo {
  merchantName: string;
  displayAmount: string;
  status: 'INITIATED' | 'AUTHORIZED' | 'VERIFIED' | 'CANCELED' | 'EXPIRED';
  expiresAt: string;
}

const route = useRoute();
const authority = route.params.authority as string;

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

async function load() {
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
    await load();
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  load();
  clock = setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => clock && clearInterval(clock));
</script>

<template>
  <div class="page">
    <div class="card">
      <div class="brand">Secure Payment</div>

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
.actions button {
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
}
.cancel {
  background: rgba(255, 255, 255, 0.07);
  color: #f5f4f7;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
}
.actions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
