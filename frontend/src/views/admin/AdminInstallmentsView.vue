<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { displayIdentity } from '../../utils/identity';
import { formatAmount, type CurrencyInfo } from '../../utils/currency';
import AdminLayout from '../../components/admin/AdminLayout.vue';

interface AdminInstallment {
  id: string;
  walletId: string;
  sequenceNumber: number;
  amount: string;
  principalAmount: string;
  penaltyApplied: boolean;
  penaltyDaysApplied: number;
  dueDate: string;
  deadlineDate: string;
  status: 'PENDING' | 'OVERDUE' | 'PAID';
  paidAt: string | null;
  ownerEmail: string;
  ownerPhoneNumber: string | null;
  walletTypeName: string;
  currency: CurrencyInfo;
}

const { t } = useI18n();
const installments = ref<AdminInstallment[]>([]);
const error = ref('');
const search = ref('');

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return installments.value;
  return installments.value.filter(
    (i) => i.ownerEmail.toLowerCase().includes(term) || (i.ownerPhoneNumber ?? '').includes(term),
  );
});

async function load() {
  error.value = '';
  try {
    installments.value = await apiRequest<AdminInstallment[]>('/admin/installments');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.installments.loadFailed');
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.installments.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <div class="admin-card">
      <div class="filter-row">
        <h2>{{ t('admin.installments.all', { count: filtered.length }) }}</h2>
        <input v-model="search" class="admin-input" :placeholder="t('admin.installments.searchPlaceholder')" />
      </div>
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t('admin.installments.tableOwner') }}</th>
            <th>{{ t('admin.installments.tableWalletType') }}</th>
            <th>#</th>
            <th>{{ t('admin.installments.tableAmount') }}</th>
            <th>{{ t('admin.installments.tableDeadline') }}</th>
            <th>{{ t('admin.installments.tableStatus') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in filtered" :key="i.id">
            <td>{{ displayIdentity({ email: i.ownerEmail, phoneNumber: i.ownerPhoneNumber }) }}</td>
            <td>{{ i.walletTypeName }}</td>
            <td>{{ i.sequenceNumber }}</td>
            <td>{{ formatAmount(i.amount, i.currency) }}</td>
            <td>{{ i.deadlineDate }}</td>
            <td><span class="admin-badge" :class="`installment-status-${i.status.toLowerCase()}`">{{ i.status }}</span></td>
          </tr>
          <tr v-if="!filtered.length"><td colspan="6">{{ t('admin.installments.none') }}</td></tr>
        </tbody>
      </table>
    </div>
  </AdminLayout>
</template>

<style scoped>
.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 12px;
}
.filter-row h2 {
  margin: 0;
  white-space: nowrap;
}
.filter-row input {
  min-width: 260px;
}
</style>
