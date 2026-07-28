<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useWalletStore } from '../stores/wallet';
import { ApiError } from '../api/client';

const auth = useAuthStore();
const wallet = useWalletStore();
const router = useRouter();

const depositAmount = ref('');
const withdrawAmount = ref('');
const transferEmail = ref('');
const transferAmount = ref('');
const actionError = ref('');
const busy = ref(false);

const balanceDisplay = computed(() =>
  wallet.wallet ? formatCents(wallet.wallet.balance) : '—',
);

function formatCents(cents: string): string {
  return (Number(cents) / 100).toFixed(2);
}

function toCents(amount: string): number {
  return Math.round(parseFloat(amount) * 100);
}

onMounted(async () => {
  await Promise.all([wallet.fetchWallet(), wallet.fetchTransactions()]);
});

async function runAction(fn: () => Promise<void>) {
  actionError.value = '';
  busy.value = true;
  try {
    await fn();
  } catch (err) {
    actionError.value = err instanceof ApiError ? err.message : 'Action failed';
  } finally {
    busy.value = false;
  }
}

function onDeposit() {
  runAction(async () => {
    await wallet.deposit(toCents(depositAmount.value));
    depositAmount.value = '';
  });
}

function onWithdraw() {
  runAction(async () => {
    await wallet.withdraw(toCents(withdrawAmount.value));
    withdrawAmount.value = '';
  });
}

function onTransfer() {
  runAction(async () => {
    await wallet.transfer(transferEmail.value, toCents(transferAmount.value));
    transferEmail.value = '';
    transferAmount.value = '';
  });
}

function logout() {
  auth.logout();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="dashboard">
    <header>
      <h1>Packeta Wallet</h1>
      <button @click="logout">Log out</button>
    </header>

    <section class="balance">
      <span class="label">Balance</span>
      <span class="amount">${{ balanceDisplay }}</span>
    </section>

    <p v-if="actionError" class="error">{{ actionError }}</p>

    <section class="actions">
      <form @submit.prevent="onDeposit">
        <h2>Deposit</h2>
        <input v-model="depositAmount" type="number" min="0.01" step="0.01" required />
        <button type="submit" :disabled="busy">Deposit</button>
      </form>

      <form @submit.prevent="onWithdraw">
        <h2>Withdraw</h2>
        <input v-model="withdrawAmount" type="number" min="0.01" step="0.01" required />
        <button type="submit" :disabled="busy">Withdraw</button>
      </form>

      <form @submit.prevent="onTransfer">
        <h2>Transfer</h2>
        <input v-model="transferEmail" type="email" placeholder="Recipient email" required />
        <input v-model="transferAmount" type="number" min="0.01" step="0.01" required />
        <button type="submit" :disabled="busy">Transfer</button>
      </form>
    </section>

    <section class="history">
      <h2>Transaction history</h2>
      <ul>
        <li v-for="tx in wallet.transactions" :key="tx.id">
          <span>{{ tx.type }}</span>
          <span>${{ formatCents(tx.amount) }}</span>
          <span>{{ new Date(tx.createdAt).toLocaleString() }}</span>
        </li>
        <li v-if="!wallet.transactions.length">No transactions yet.</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 720px;
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
.balance {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.balance .label {
  font-size: 0.85rem;
  color: #666;
}
.balance .amount {
  font-size: 2.5rem;
  font-weight: 600;
}
.actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
}
.actions form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 1rem;
}
.actions input {
  padding: 0.5rem;
}
.actions button {
  padding: 0.5rem;
  cursor: pointer;
}
.history ul {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.history li {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #eee;
  padding: 0.4rem 0;
}
.error {
  color: #b00020;
  font-size: 0.9rem;
}
</style>
