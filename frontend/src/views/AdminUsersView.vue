<script setup lang="ts">
import { ref } from 'vue';
import { apiRequest, ApiError } from '../api/client';

interface AdminUser {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

interface WalletType {
  code: string;
  name: string;
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

const adjustAmount = ref<Record<string, string>>({});
const adjustReason = ref<Record<string, string>>({});

function formatCents(cents: string): string {
  return (Number(cents) / 100).toFixed(2);
}

async function loadUsers() {
  listError.value = '';
  try {
    users.value = await apiRequest<AdminUser[]>('/admin/users');
  } catch (err) {
    listError.value = err instanceof ApiError ? err.message : 'Failed to load users';
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
    detailError.value = err instanceof ApiError ? err.message : 'Failed to load user';
  }
}

async function adjust(walletId: string) {
  adjustError.value = '';
  busy.value = true;
  try {
    const amount = Math.round(parseFloat(adjustAmount.value[walletId] ?? '0') * 100);
    const reason = adjustReason.value[walletId] ?? '';
    await apiRequest(`/admin/wallets/${walletId}/adjust`, {
      method: 'POST',
      body: { amount, reason },
      idempotent: true,
    });
    adjustAmount.value[walletId] = '';
    adjustReason.value[walletId] = '';
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
  <div class="admin-page">
    <header>
      <h1>Admin: Users</h1>
      <router-link :to="{ name: 'dashboard' }">Back to wallet</router-link>
    </header>

    <p v-if="listError" class="error">{{ listError }}</p>

    <table class="users-table">
      <thead>
        <tr>
          <th>Email</th>
          <th>Role</th>
          <th>Joined</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in users" :key="u.id">
          <td>{{ u.email }}</td>
          <td>{{ u.role }}</td>
          <td>{{ new Date(u.createdAt).toLocaleDateString() }}</td>
          <td><button @click="selectUser(u.id)">View</button></td>
        </tr>
      </tbody>
    </table>

    <section v-if="selected" class="detail">
      <h2>{{ selected.email }}</h2>
      <p v-if="detailError" class="error">{{ detailError }}</p>
      <p v-if="adjustError" class="error">{{ adjustError }}</p>

      <div class="wallets">
        <article v-for="w in selected.wallets" :key="w.id" class="wallet-card">
          <span class="wallet-type">{{ w.walletType.name }}</span>
          <span class="wallet-balance">${{ formatCents(w.balance) }}</span>
          <div class="adjust-form">
            <input
              v-model="adjustAmount[w.id]"
              type="number"
              step="0.01"
              placeholder="+/- amount"
            />
            <input v-model="adjustReason[w.id]" type="text" placeholder="Reason" />
            <button :disabled="busy" @click="adjust(w.id)">Adjust</button>
          </div>
        </article>
      </div>

      <h3>Transaction history</h3>
      <ul class="history">
        <li v-for="tx in transactions" :key="tx.id">
          <span>{{ tx.type }}</span>
          <span>${{ formatCents(tx.amount) }}</span>
          <span>{{ tx.note ?? '' }}</span>
          <span>{{ new Date(tx.createdAt).toLocaleString() }}</span>
        </li>
        <li v-if="!transactions.length">No transactions yet.</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.admin-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.users-table {
  width: 100%;
  border-collapse: collapse;
}
.users-table th,
.users-table td {
  text-align: left;
  padding: 0.5rem;
  border-bottom: 1px solid #eee;
}
.detail {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  border-top: 1px solid #ddd;
  padding-top: 1rem;
}
.wallets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}
.wallet-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 1rem;
}
.wallet-type {
  font-size: 0.85rem;
  color: #666;
  text-transform: uppercase;
}
.wallet-balance {
  font-size: 1.4rem;
  font-weight: 600;
}
.adjust-form {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.adjust-form input {
  padding: 0.4rem;
}
.adjust-form button {
  padding: 0.4rem;
  cursor: pointer;
}
.history {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.history li {
  display: flex;
  gap: 1rem;
  border-bottom: 1px solid #eee;
  padding: 0.4rem 0;
}
.error {
  color: #b00020;
  font-size: 0.9rem;
}
</style>
