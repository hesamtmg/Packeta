<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { ApiError } from '../api/client';
import { packetaRequest } from '../api/packetaClient';
import { setLocale } from '../i18n';

const route = useRoute();
const { t } = useI18n();

type Status = 'working' | 'completed' | 'canceled' | 'failed' | 'redirecting';
const status = ref<Status>('working');
const message = ref('');

// verify()'s response for a plain widget deposit/installment-pay carries no
// redirectUrl of its own (unlike PurchaseGatewayService's support-topup,
// which gets one for free from the merchant wallet's callbackUrl) — the
// only way back to the merchant's page is the returnUrl the widget itself
// passed through when it started this ZarinPal leg (see
// WidgetService.buildWidgetCallbackUrl). It never touches a database —
// purely a query-string round trip, same trick as ?topupTxnId=.
const returnUrl = route.query.returnUrl as string | undefined;
const redirectSecondsLeft = ref(4);
let redirectTimer: ReturnType<typeof setInterval> | undefined;

function goNow() {
  if (redirectTimer) clearInterval(redirectTimer);
  window.location.href = returnUrl!;
}

function enterRedirectStep() {
  status.value = 'redirecting';
  redirectSecondsLeft.value = 4;
  redirectTimer = setInterval(() => {
    redirectSecondsLeft.value -= 1;
    if (redirectSecondsLeft.value <= 0) goNow();
  }, 1000);
}

const displayMessage = computed(() => {
  switch (status.value) {
    case 'canceled':
      return t('widget.callback.canceled');
    case 'completed':
      return t('widget.callback.completed');
    case 'failed':
      return message.value || t('widget.callback.failed');
    default:
      return t('widget.callback.working');
  }
});

onMounted(async () => {
  setLocale(navigator.language.toLowerCase().startsWith('fa') ? 'fa' : 'en');

  const transactionId = route.params.transactionId as string;
  // ZarinPal's own cancel signal — same check PurchaseCallbackView.vue uses
  // for the customer-dashboard app's equivalent callback.
  const zarinpalStatus = route.query.Status as string | undefined;

  try {
    if (zarinpalStatus === 'NOK') {
      await packetaRequest(`/transactions/purchase/${transactionId}/cancel`, {
        method: 'POST',
      });
      status.value = 'canceled';
    } else {
      const result = await packetaRequest<{ status: string; reason?: string }>(
        `/transactions/purchase/${transactionId}/verify`,
        { method: 'POST' },
      );
      if (result.status === 'COMPLETED') {
        status.value = 'completed';
      } else {
        status.value = 'failed';
        message.value = result.reason ?? '';
      }
    }
  } catch (err) {
    status.value = 'failed';
    message.value = err instanceof ApiError ? err.message : '';
  }

  // Every branch above assigns a terminal status before reaching here.
  if (returnUrl) {
    enterRedirectStep();
  }
});
onUnmounted(() => {
  if (redirectTimer) clearInterval(redirectTimer);
});
</script>

<template>
  <div class="widget-shell">
    <div class="widget-card">
      <header class="widget-nav">
        <span class="logo-mark">P</span>
        <span class="logo-text">{{ t('brand') }}</span>
      </header>

      <template v-if="status === 'redirecting'">
        <p class="status">{{ t('widget.callback.redirecting', { seconds: redirectSecondsLeft }) }}</p>
        <button class="confirm" @click="goNow">{{ t('widget.callback.continueNow') }}</button>
      </template>
      <template v-else>
        <p class="status" :class="{ error: status === 'failed' || status === 'canceled' }">
          {{ displayMessage }}
        </p>
      </template>

      <footer class="widget-footer">{{ t('footer') }}</footer>
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
  background: #eef3ff;
  min-height: 100vh;
  display: flex;
  align-items: center;
}
.widget-card {
  max-width: 380px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  text-align: center;
}
.widget-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}
.logo-mark {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #4f8bff, #2f6fed);
  color: #fff;
  font-weight: 700;
  font-size: 0.85rem;
}
.logo-text {
  font-weight: 800;
  font-size: 0.92rem;
  color: #14213d;
}
.status {
  color: #6b7280;
  font-size: 0.92rem;
  margin: 0;
}
.status.error {
  color: #c62828;
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
.widget-footer {
  margin: 0;
  padding-top: 0.4rem;
  text-align: center;
  font-size: 0.68rem;
  color: #94a3b8;
}
</style>
