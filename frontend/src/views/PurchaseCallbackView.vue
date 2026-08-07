<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { apiRequest, ApiError } from '../api/client';
import '../styles/admin-theme.css';
import '../styles/customer-theme.css';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const status = ref<'working' | 'completed' | 'canceled' | 'failed'>('working');
const message = ref('');
const messageOverride = ref('');

const displayMessage = computed(() => {
  if (messageOverride.value) return messageOverride.value;
  switch (status.value) {
    case 'canceled':
      return t('callback.canceled');
    case 'completed':
      return t('callback.completed');
    case 'failed':
      return message.value || t('callback.verificationFailed');
    default:
      return t('callback.finalizing');
  }
});

onMounted(async () => {
  const transactionId = route.params.id as string;
  const ipgStatus = route.query.status as string | undefined;
  // ZarinPal (used for deposits) redirects back with its own `Status=NOK`
  // query param instead of the in-house sandbox IPG's `status=canceled`.
  const zarinpalStatus = route.query.Status as string | undefined;

  try {
    if (ipgStatus === 'canceled' || zarinpalStatus === 'NOK') {
      await apiRequest(`/transactions/purchase/${transactionId}/cancel`, {
        method: 'POST',
      });
      status.value = 'canceled';
      return;
    }

    const result = await apiRequest<{ status: string; reason?: string }>(
      `/transactions/purchase/${transactionId}/verify`,
      { method: 'POST' },
    );
    if (result.status === 'COMPLETED') {
      status.value = 'completed';
    } else {
      status.value = 'failed';
      messageOverride.value = result.reason ?? t('callback.couldNotVerify');
    }
  } catch (err) {
    status.value = 'failed';
    messageOverride.value = err instanceof ApiError ? err.message : t('callback.verificationFailed');
  }
});

function goToTransaction() {
  router.push({ name: 'transaction-detail', params: { id: route.params.id as string } });
}
</script>

<template>
  <div class="customer-theme callback-theme">
    <div class="callback-page">
      <div class="admin-card card">
        <span class="icon" :class="status">{{
          status === 'completed' ? '✓' : status === 'working' ? '…' : '✕'
        }}</span>
        <p>{{ displayMessage }}</p>
        <button v-if="status !== 'working'" class="admin-btn admin-btn-primary" @click="goToTransaction">
          {{ t('callback.viewTransaction') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.callback-theme {
  padding: 0;
}
.callback-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.card {
  max-width: 360px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2.5rem 2rem;
}
.card p {
  color: var(--text-dim);
  margin: 0;
}
.icon {
  font-size: 2.5rem;
  font-weight: 700;
}
.icon.completed {
  color: var(--accent-lime);
}
.icon.canceled,
.icon.failed {
  color: var(--accent-red);
}
.icon.working {
  color: var(--text-dim);
}
</style>
