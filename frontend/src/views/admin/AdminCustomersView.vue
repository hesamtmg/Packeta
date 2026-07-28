<script setup lang="ts">
import { computed, ref } from 'vue';
import { apiRequest, ApiError } from '../../api/client';
import { amountStep, formatAmount, toMinorUnits, type CurrencyInfo } from '../../utils/currency';
import type { AdminUser } from '../../types/admin';
import AdminLayout from '../../components/admin/AdminLayout.vue';

interface WalletType {
  id: string;
  code: string;
  name: string;
  currency: CurrencyInfo;
  allowNegativeBalance: boolean;
  creditLimit: string | null;
  allowWithdraw: boolean;
  allowP2pOut: boolean;
  allowP2pIn: boolean;
}

interface Wallet {
  id: string;
  balance: string;
  walletType: WalletType;
}

interface UserDetail extends AdminUser {
  wallets: Wallet[];
}

interface AdminTransaction {
  id: string;
  type: string;
  fromWalletId: string | null;
  toWalletId: string | null;
  amount: string;
  note: string | null;
  createdAt: string;
}

const users = ref<AdminUser[]>([]);
const selected = ref<UserDetail | null>(null);
const transactions = ref<AdminTransaction[]>([]);
const listError = ref('');
const detailError = ref('');
const adjustError = ref('');
const busy = ref(false);
const search = ref('');

const adjustAmount = ref<Record<string, string>>({});
const adjustReason = ref<Record<string, string>>({});

const customers = computed(() => users.value.filter((u) => u.role === 'USER'));
const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return customers.value;
  return customers.value.filter((u) => u.email.toLowerCase().includes(term));
});

function transactionCurrency(tx: AdminTransaction): CurrencyInfo | null {
  const wallets = selected.value?.wallets ?? [];
  const w = wallets.find((w) => w.id === tx.fromWalletId || w.id === tx.toWalletId);
  return w?.walletType.currency ?? null;
}

async function loadUsers() {
  listError.value = '';
  try {
    users.value = await apiRequest<AdminUser[]>('/admin/users');
  } catch (err) {
    listError.value = err instanceof ApiError ? err.message : 'Failed to load customers';
  }
}

async function selectUser(id: string) {
  detailError.value = '';
  adjustError.value = '';
  try {
    const [detail, txs] = await Promise.all([
      apiRequest<UserDetail>(`/admin/users/${id}`),
      apiRequest<AdminTransaction[]>(`/admin/users/${id}/transactions`),
    ]);
    selected.value = detail;
    transactions.value = txs;
  } catch (err) {
    detailError.value = err instanceof ApiError ? err.message : 'Failed to load customer';
  }
}

async function adjust(wallet: Wallet) {
  adjustError.value = '';
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
    if (selected.value) await selectUser(selected.value.id);
  } catch (err) {
    adjustError.value = err instanceof ApiError ? err.message : 'Adjustment failed';
  } finally {
    busy.value = false;
  }
}

loadUsers();
</script>

<template>
  <AdminLayout title="Customers">
    <p v-if="listError" class="admin-error">{{ listError }}</p>

    <div class="admin-card">
      <div class="filter-row">
        <h2>Customers ({{ filtered.length }})</h2>
        <input v-model="search" class="admin-input" placeholder="Search by email…" />
      </div>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Joined</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in filtered" :key="u.id">
            <td>{{ u.email }}</td>
            <td>{{ new Date(u.createdAt).toLocaleDateString() }}</td>
            <td><button class="admin-btn admin-btn-ghost" @click="selectUser(u.id)">View</button></td>
          </tr>
          <tr v-if="!filtered.length"><td colspan="3">No customers found.</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="selected" class="admin-card">
      <h2>{{ selected.email }}</h2>
      <p v-if="detailError" class="admin-error">{{ detailError }}</p>
      <p v-if="adjustError" class="admin-error">{{ adjustError }}</p>

      <div class="wallets">
        <article v-for="w in selected.wallets" :key="w.id" class="wallet-card">
          <span class="wallet-type">{{ w.walletType.name }} · {{ w.walletType.currency.code }}</span>
          <span class="wallet-balance">{{ formatAmount(w.balance, w.walletType.currency) }}</span>
          <div class="adjust-form">
            <input
              v-model="adjustAmount[w.id]"
              type="number"
              :step="amountStep(w.walletType.currency)"
              class="admin-input"
              placeholder="+/- amount"
            />
            <input v-model="adjustReason[w.id]" type="text" class="admin-input" placeholder="Reason" />
            <button class="admin-btn admin-btn-primary" :disabled="busy" @click="adjust(w)">Adjust</button>
          </div>
        </article>
      </div>

      <h3>Transaction history</h3>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Amount</th>
            <th>Note</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tx in transactions" :key="tx.id">
            <td><span class="admin-badge">{{ tx.type }}</span></td>
            <td>{{ transactionCurrency(tx) ? formatAmount(tx.amount, transactionCurrency(tx)!) : tx.amount }}</td>
            <td>{{ tx.note ?? '—' }}</td>
            <td>{{ new Date(tx.createdAt).toLocaleString() }}</td>
          </tr>
          <tr v-if="!transactions.length"><td colspan="4">No transactions yet.</td></tr>
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
h3 {
  font-size: 0.85rem;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin: 20px 0 10px;
}
.wallets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
  margin-top: 8px;
}
.wallet-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
  padding: 14px;
}
.wallet-type {
  font-size: 0.78rem;
  color: var(--text-dim);
  text-transform: uppercase;
}
.wallet-balance {
  font-size: 1.3rem;
  font-weight: 700;
}
.adjust-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
