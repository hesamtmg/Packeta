<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { useWalletStore, type Installment } from '../stores/wallet';
import { ApiError } from '../api/client';
import { formatAmount } from '../utils/currency';
import AppLayout from '../components/AppLayout.vue';

const wallet = useWalletStore();
const route = useRoute();
const { t } = useI18n();

const walletId = computed(() => route.params.walletId as string);
const installments = ref<Installment[]>([]);
const loadError = ref('');
const payBusy = ref<string | null>(null);
const payError = ref('');

const thisWallet = computed(() => wallet.wallets.find((w) => w.id === walletId.value) ?? null);

const sortedInstallments = computed(() =>
  [...installments.value].sort((a, b) => a.deadlineDate.localeCompare(b.deadlineDate)),
);

function installmentStatusLabel(status: Installment['status']): string {
  if (status === 'PAID') return t('dashboard.installments.statusPaid');
  if (status === 'OVERDUE') return t('dashboard.installments.statusOverdue');
  return t('dashboard.installments.statusPending');
}

async function load() {
  loadError.value = '';
  try {
    if (!wallet.wallets.length) await wallet.fetchWallets();
    installments.value = await wallet.fetchInstallmentsForWallet(walletId.value);
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : t('dashboard.actions.error');
  }
}

async function onPayInstallment(installment: Installment) {
  payError.value = '';
  payBusy.value = installment.id;
  try {
    const result = await wallet.payInstallment(installment.id);
    window.location.href = result.redirectUrl;
  } catch (err) {
    payError.value = err instanceof ApiError ? err.message : t('dashboard.actions.error');
    payBusy.value = null;
  }
}

onMounted(load);
</script>

<template>
  <AppLayout :title="t('dashboard.installments.title')">
    <router-link :to="{ name: 'dashboard' }" class="back-link">{{ t('nav.backToWallet') }}</router-link>

    <p v-if="loadError" class="admin-error">{{ loadError }}</p>

    <div class="admin-card">
      <h2 v-if="thisWallet">{{ thisWallet.walletType.name }} · {{ thisWallet.walletType.currency.code }}</h2>
      <p class="hint">{{ t('dashboard.installments.hint') }}</p>

      <table class="admin-table">
        <thead>
          <tr>
            <th>#</th>
            <th>{{ t('dashboard.installments.dueDate') }}</th>
            <th>{{ t('dashboard.installments.deadlineDate') }}</th>
            <th>{{ t('dashboard.installments.amount') }}</th>
            <th>{{ t('dashboard.installments.status') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in sortedInstallments" :key="i.id">
            <td>{{ i.sequenceNumber }}</td>
            <td>{{ i.dueDate }}</td>
            <td>{{ i.deadlineDate }}</td>
            <td>{{ thisWallet ? formatAmount(i.amount, thisWallet.walletType.currency) : i.amount }}</td>
            <td>
              <span class="admin-badge" :class="`installment-status-${i.status.toLowerCase()}`">{{ installmentStatusLabel(i.status) }}</span>
            </td>
            <td>
              <button
                v-if="i.status !== 'PAID'"
                type="button"
                class="admin-btn admin-btn-primary"
                :disabled="payBusy === i.id"
                @click="onPayInstallment(i)"
              >
                {{ t('dashboard.installments.pay') }}
              </button>
            </td>
          </tr>
          <tr v-if="!sortedInstallments.length"><td colspan="6">{{ t('dashboard.installments.none') }}</td></tr>
        </tbody>
      </table>
      <p v-if="payError" class="admin-error">{{ payError }}</p>
    </div>
  </AppLayout>
</template>

<style scoped>
.back-link {
  display: inline-block;
  margin-bottom: 14px;
  color: var(--text-dim);
  font-size: 0.85rem;
}
</style>
