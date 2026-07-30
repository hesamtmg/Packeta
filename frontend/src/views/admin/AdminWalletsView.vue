<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { amountStep, formatAmount, toMinorUnits } from '../../utils/currency';
import type { AdminWallet } from '../../types/admin';
import AdminLayout from '../../components/admin/AdminLayout.vue';

const { t } = useI18n();
const wallets = ref<AdminWallet[]>([]);
const error = ref('');
const search = ref('');
const busy = ref(false);

const adjustAmount = ref<Record<string, string>>({});
const adjustReason = ref<Record<string, string>>({});
const openAdjustId = ref<string | null>(null);

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return wallets.value;
  return wallets.value.filter(
    (w) => w.ownerEmail.toLowerCase().includes(term) || w.walletType.name.toLowerCase().includes(term),
  );
});

async function load() {
  error.value = '';
  try {
    wallets.value = await apiRequest<AdminWallet[]>('/admin/wallets');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.wallets.loadFailed');
  }
}

function toggleAdjust(walletId: string) {
  openAdjustId.value = openAdjustId.value === walletId ? null : walletId;
}

async function adjust(wallet: AdminWallet) {
  error.value = '';
  busy.value = true;
  try {
    const amount = toMinorUnits(adjustAmount.value[wallet.id] ?? '0', wallet.walletType.currency);
    const reason = adjustReason.value[wallet.id] ?? '';
    await apiRequest(`/admin/wallets/${wallet.id}/adjust`, {
      method: 'POST',
      body: { amount, reason },
      idempotent: true,
    });
    adjustAmount.value[wallet.id] = '';
    adjustReason.value[wallet.id] = '';
    openAdjustId.value = null;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.wallets.adjustFailed');
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.wallets.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <div class="admin-card">
      <div class="filter-row">
        <h2>{{ t('admin.wallets.allWallets', { count: filtered.length }) }}</h2>
        <input v-model="search" class="admin-input" :placeholder="t('admin.wallets.searchPlaceholder')" />
      </div>
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t('admin.wallets.tableOwner') }}</th>
            <th>{{ t('admin.wallets.tableType') }}</th>
            <th>{{ t('admin.wallets.tableCurrency') }}</th>
            <th>{{ t('admin.wallets.tableBalance') }}</th>
            <th>{{ t('admin.wallets.tableCreated') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="w in filtered" :key="w.id">
            <tr>
              <td>{{ w.ownerEmail }}</td>
              <td>{{ w.walletType.name }}</td>
              <td>{{ w.walletType.currency.code }}</td>
              <td>{{ formatAmount(w.balance, w.walletType.currency) }}</td>
              <td>{{ new Date(w.createdAt).toLocaleDateString() }}</td>
              <td><button class="admin-btn admin-btn-ghost" @click="toggleAdjust(w.id)">{{ t('admin.wallets.adjust') }}</button></td>
            </tr>
            <tr v-if="openAdjustId === w.id">
              <td colspan="6">
                <div class="adjust-row">
                  <input
                    v-model="adjustAmount[w.id]"
                    type="number"
                    :step="amountStep(w.walletType.currency)"
                    class="admin-input"
                    :placeholder="t('admin.wallets.amountPlaceholder')"
                  />
                  <input v-model="adjustReason[w.id]" type="text" class="admin-input" :placeholder="t('admin.wallets.reasonPlaceholder')" />
                  <button class="admin-btn admin-btn-primary" :disabled="busy" @click="adjust(w)">{{ t('admin.wallets.save') }}</button>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="!filtered.length"><td colspan="6">{{ t('admin.wallets.noWallets') }}</td></tr>
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
.adjust-row {
  display: flex;
  gap: 10px;
  padding: 8px 0;
}
</style>
