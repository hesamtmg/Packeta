<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { apiRequest, ApiError } from '../../api/client';
import { amountStep, formatAmount, toMinorUnits } from '../../utils/currency';
import type { AdminWallet } from '../../types/admin';
import AdminLayout from '../../components/admin/AdminLayout.vue';

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
    error.value = err instanceof ApiError ? err.message : 'Failed to load wallets';
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
    error.value = err instanceof ApiError ? err.message : 'Adjustment failed';
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout title="Wallets">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <div class="admin-card">
      <div class="filter-row">
        <h2>All wallets ({{ filtered.length }})</h2>
        <input v-model="search" class="admin-input" placeholder="Search by owner or wallet type…" />
      </div>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Owner</th>
            <th>Type</th>
            <th>Currency</th>
            <th>Balance</th>
            <th>Created</th>
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
              <td><button class="admin-btn admin-btn-ghost" @click="toggleAdjust(w.id)">Adjust</button></td>
            </tr>
            <tr v-if="openAdjustId === w.id">
              <td colspan="6">
                <div class="adjust-row">
                  <input
                    v-model="adjustAmount[w.id]"
                    type="number"
                    :step="amountStep(w.walletType.currency)"
                    class="admin-input"
                    placeholder="+/- amount"
                  />
                  <input v-model="adjustReason[w.id]" type="text" class="admin-input" placeholder="Reason" />
                  <button class="admin-btn admin-btn-primary" :disabled="busy" @click="adjust(w)">Save</button>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="!filtered.length"><td colspan="6">No wallets found.</td></tr>
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
