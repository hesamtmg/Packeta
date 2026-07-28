<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useWalletStore, type Wallet } from '../stores/wallet';
import { ApiError } from '../api/client';
import { amountStep, formatAmount, toMinorUnits } from '../utils/currency';

const auth = useAuthStore();
const wallet = useWalletStore();
const router = useRouter();

const newWalletType = ref('');
const depositWalletId = ref('');
const depositAmount = ref('');
const withdrawWalletId = ref('');
const withdrawAmount = ref('');
const transferFromWalletId = ref('');
const transferEmail = ref('');
const transferAmount = ref('');
const actionError = ref('');
const busy = ref(false);

const withdrawableWallets = computed(() =>
  wallet.wallets.filter((w) => w.walletType.allowWithdraw),
);
const p2pWallets = computed(() =>
  wallet.wallets.filter((w) => w.walletType.allowP2pOut),
);

const walletsById = computed(() => {
  const map = new Map(wallet.wallets.map((w) => [w.id, w]));
  return map;
});

function findWallet(id: string): Wallet | undefined {
  return walletsById.value.get(id);
}

const depositStep = computed(() => {
  const w = findWallet(depositWalletId.value);
  return w ? amountStep(w.walletType.currency) : '0.01';
});
const withdrawStep = computed(() => {
  const w = findWallet(withdrawWalletId.value);
  return w ? amountStep(w.walletType.currency) : '0.01';
});
const transferStep = computed(() => {
  const w = findWallet(transferFromWalletId.value);
  return w ? amountStep(w.walletType.currency) : '0.01';
});

function walletLabel(w: Wallet): string {
  return `${w.walletType.name} (${w.walletType.currency.code}) — ${formatAmount(w.balance, w.walletType.currency)}`;
}

function badges(w: Wallet): string[] {
  const list: string[] = [];
  if (w.walletType.allowNegativeBalance) {
    list.push(
      `Credit limit ${formatAmount(w.walletType.creditLimit ?? '0', w.walletType.currency)}`,
    );
  }
  if (!w.walletType.allowWithdraw) list.push('No cash-out');
  if (!w.walletType.allowP2pOut && !w.walletType.allowP2pIn) {
    list.push('No transfers');
  }
  return list;
}

function describeTransaction(tx: (typeof wallet.transactions)[number]): string {
  const fromMine = tx.fromWalletId ? walletsById.value.get(tx.fromWalletId) : null;
  const toMine = tx.toWalletId ? walletsById.value.get(tx.toWalletId) : null;

  if (tx.type === 'DEPOSIT') return `Deposit to ${toMine?.walletType.name ?? 'wallet'}`;
  if (tx.type === 'WITHDRAW') return `Withdraw from ${fromMine?.walletType.name ?? 'wallet'}`;
  if (fromMine) return `Sent from ${fromMine.walletType.name}`;
  if (toMine) return `Received into ${toMine.walletType.name}`;
  return 'Transfer';
}

function formatTransactionAmount(tx: (typeof wallet.transactions)[number]): string {
  const w = (tx.fromWalletId && walletsById.value.get(tx.fromWalletId)) ||
    (tx.toWalletId && walletsById.value.get(tx.toWalletId));
  if (!w) return tx.amount;
  return formatAmount(tx.amount, w.walletType.currency);
}

onMounted(async () => {
  await Promise.all([
    wallet.fetchWallets(),
    wallet.fetchWalletTypes(),
    wallet.fetchTransactions(),
  ]);
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

function onAddWallet() {
  runAction(async () => {
    await wallet.createWallet(newWalletType.value);
    newWalletType.value = '';
  });
}

function onDeposit() {
  runAction(async () => {
    const w = findWallet(depositWalletId.value);
    if (!w) return;
    await wallet.deposit(w.id, toMinorUnits(depositAmount.value, w.walletType.currency));
    depositAmount.value = '';
  });
}

function onWithdraw() {
  runAction(async () => {
    const w = findWallet(withdrawWalletId.value);
    if (!w) return;
    await wallet.withdraw(w.id, toMinorUnits(withdrawAmount.value, w.walletType.currency));
    withdrawAmount.value = '';
  });
}

function onTransfer() {
  runAction(async () => {
    const w = findWallet(transferFromWalletId.value);
    if (!w) return;
    await wallet.transfer(
      w.id,
      transferEmail.value,
      toMinorUnits(transferAmount.value, w.walletType.currency),
    );
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
      <nav v-if="auth.isAdmin" class="admin-nav">
        <router-link :to="{ name: 'admin-users' }">Admin: Users</router-link>
        <router-link :to="{ name: 'admin-wallet-types' }">Admin: Wallet Types</router-link>
      </nav>
      <button @click="logout">Log out</button>
    </header>

    <p v-if="actionError" class="error">{{ actionError }}</p>

    <section class="wallets">
      <article v-for="w in wallet.wallets" :key="w.id" class="wallet-card">
        <span class="wallet-type">{{ w.walletType.name }} · {{ w.walletType.currency.code }}</span>
        <span class="wallet-balance">{{ formatAmount(w.balance, w.walletType.currency) }}</span>
        <div class="badges">
          <span v-for="b in badges(w)" :key="b" class="badge">{{ b }}</span>
        </div>
      </article>
    </section>

    <form class="add-wallet" @submit.prevent="onAddWallet">
      <select v-model="newWalletType" required>
        <option value="" disabled>Add a wallet…</option>
        <option v-for="t in wallet.walletTypes" :key="t.id" :value="t.id">
          {{ t.name }} ({{ t.currency.code }})
        </option>
      </select>
      <button type="submit" :disabled="busy">Add</button>
    </form>

    <section class="actions">
      <form @submit.prevent="onDeposit">
        <h2>Deposit</h2>
        <select v-model="depositWalletId" required>
          <option value="" disabled>Choose wallet</option>
          <option v-for="w in wallet.wallets" :key="w.id" :value="w.id">
            {{ walletLabel(w) }}
          </option>
        </select>
        <input v-model="depositAmount" type="number" min="0" :step="depositStep" required />
        <button type="submit" :disabled="busy">Deposit</button>
      </form>

      <form @submit.prevent="onWithdraw">
        <h2>Withdraw</h2>
        <select v-model="withdrawWalletId" required>
          <option value="" disabled>Choose wallet</option>
          <option v-for="w in withdrawableWallets" :key="w.id" :value="w.id">
            {{ walletLabel(w) }}
          </option>
        </select>
        <input v-model="withdrawAmount" type="number" min="0" :step="withdrawStep" required />
        <button type="submit" :disabled="busy">Withdraw</button>
      </form>

      <form @submit.prevent="onTransfer">
        <h2>Transfer</h2>
        <select v-model="transferFromWalletId" required>
          <option value="" disabled>From wallet</option>
          <option v-for="w in p2pWallets" :key="w.id" :value="w.id">
            {{ walletLabel(w) }}
          </option>
        </select>
        <input v-model="transferEmail" type="email" placeholder="Recipient email" required />
        <input v-model="transferAmount" type="number" min="0" :step="transferStep" required />
        <button type="submit" :disabled="busy">Transfer</button>
      </form>
    </section>

    <section class="history">
      <h2>Transaction history</h2>
      <ul>
        <li v-for="tx in wallet.transactions" :key="tx.id">
          <span>{{ describeTransaction(tx) }}</span>
          <span>{{ formatTransactionAmount(tx) }}</span>
          <span>{{ new Date(tx.createdAt).toLocaleString() }}</span>
        </li>
        <li v-if="!wallet.transactions.length">No transactions yet.</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 820px;
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
  gap: 1rem;
}
.admin-nav {
  display: flex;
  gap: 1rem;
  font-size: 0.85rem;
}
.wallets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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
  letter-spacing: 0.03em;
}
.wallet-balance {
  font-size: 1.6rem;
  font-weight: 600;
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.badge {
  font-size: 0.7rem;
  background: #f0f0f0;
  border-radius: 4px;
  padding: 0.15rem 0.4rem;
  color: #444;
}
.add-wallet {
  display: flex;
  gap: 0.5rem;
}
.add-wallet select {
  flex: 1;
  padding: 0.5rem;
}
.actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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
.actions input,
.actions select {
  padding: 0.5rem;
}
.actions button,
.add-wallet button {
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
