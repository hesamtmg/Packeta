<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiRequest, ApiError } from '../api/client';
import '../styles/admin-theme.css';

const route = useRoute();
const router = useRouter();

const status = ref<'working' | 'completed' | 'canceled' | 'failed'>('working');
const message = ref('Finalizing your payment…');

onMounted(async () => {
  const transactionId = route.params.id as string;
  const ipgStatus = route.query.status as string | undefined;

  try {
    if (ipgStatus === 'canceled') {
      await apiRequest(`/transactions/${transactionId}/reverse`, {
        method: 'POST',
        body: { reason: 'Customer canceled on the payment page' },
        idempotent: true,
      });
      status.value = 'canceled';
      message.value = 'Payment was canceled.';
      return;
    }

    const result = await apiRequest<{ status: string; reason?: string }>(
      `/transactions/purchase/${transactionId}/verify`,
      { method: 'POST' },
    );
    if (result.status === 'COMPLETED') {
      status.value = 'completed';
      message.value = 'Payment completed successfully.';
    } else {
      status.value = 'failed';
      message.value = result.reason ?? 'Payment could not be verified yet.';
    }
  } catch (err) {
    status.value = 'failed';
    message.value = err instanceof ApiError ? err.message : 'Verification failed';
  }
});

function goToTransaction() {
  router.push({ name: 'transaction-detail', params: { id: route.params.id as string } });
}
</script>

<template>
  <div class="admin-theme callback-theme">
    <div class="callback-page">
      <div class="admin-card card">
        <span class="icon" :class="status">{{
          status === 'completed' ? '✓' : status === 'working' ? '…' : '✕'
        }}</span>
        <p>{{ message }}</p>
        <button v-if="status !== 'working'" class="admin-btn admin-btn-primary" @click="goToTransaction">
          View transaction
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
