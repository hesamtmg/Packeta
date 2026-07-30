<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWalletStore, type Wallet } from '../stores/wallet';
import { apiRequest, ApiError } from '../api/client';
import { amountStep, formatAmount, toMinorUnits, type CurrencyInfo } from '../utils/currency';
import AppLayout from '../components/AppLayout.vue';
import MiniLineChart from '../components/admin/MiniLineChart.vue';

const wallet = useWalletStore();
const { t } = useI18n();

const phoneNumber = ref('');
const phoneNumberSaved = ref<string | null>(null);
const phoneBusy = ref(false);
const phoneError = ref('');
const phoneSuccess = ref('');

const chargeAmount = ref('');
const chargeCurrencyCode = ref('');
const chargeLanguage = ref<'en' | 'fa'>('en');
const chargeBusy = ref(false);
const chargeError = ref('');
const chargeResult = ref<{ redirectUrl: string; expiresAt: string } | null>(null);
const chargeLinkCopied = ref(false);

const newWalletType = ref('');
const newWalletAutoWithdrawTimes = ref(['', '', '']);
const newWalletPurchaseTimeoutMinutes = ref('');
const depositWalletId = ref('');
const depositAmount = ref('');
const withdrawWalletId = ref('');
const withdrawAmount = ref('');
const transferFromWalletId = ref('');
const transferEmail = ref('');
const transferAmount = ref('');
const purchaseFromWalletId = ref('');
const purchaseEmail = ref('');
const purchaseAmount = ref('');
const actionError = ref('');
const busy = ref(false);

const withdrawableWallets = computed(() =>
  wallet.wallets.filter((w) => w.walletType.allowWithdraw),
);
const p2pWallets = computed(() =>
  wallet.wallets.filter((w) => w.walletType.allowP2pOut),
);
const purchaseWallets = computed(() =>
  wallet.wallets.filter((w) => w.walletType.allowPurchaseOut),
);

// Currencies the user could charge a customer in (i.e. they hold at least
// one wallet whose type can receive purchases), deduped by currency code.
const purchaseInCurrencies = computed(() => {
  const map = new Map<string, CurrencyInfo>();
  for (const w of wallet.wallets) {
    if (w.walletType.allowPurchaseIn) {
      map.set(w.walletType.currency.code, w.walletType.currency);
    }
  }
  return [...map.values()];
});
const chargeCurrency = computed(() =>
  purchaseInCurrencies.value.find((c) => c.code === chargeCurrencyCode.value),
);
const chargeStep = computed(() =>
  chargeCurrency.value ? amountStep(chargeCurrency.value) : '0.01',
);

const selectedNewWalletType = computed(() =>
  wallet.walletTypes.find((t) => t.id === newWalletType.value),
);
const showAutoWithdrawFields = computed(
  () => selectedNewWalletType.value?.supportsAutoWithdraw ?? false,
);
const showPurchaseTimeoutField = computed(
  () => selectedNewWalletType.value?.allowPurchaseIn ?? false,
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
const purchaseStep = computed(() => {
  const w = findWallet(purchaseFromWalletId.value);
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
      t('dashboard.wallets.creditLimit', {
        amount: formatAmount(w.walletType.creditLimit ?? '0', w.walletType.currency),
      }),
    );
  }
  if (!w.walletType.allowWithdraw) list.push(t('dashboard.wallets.noCashOut'));
  if (!w.walletType.allowP2pOut && !w.walletType.allowP2pIn) {
    list.push(t('dashboard.wallets.noTransfers'));
  }
  return list;
}

function describeTransaction(tx: (typeof wallet.transactions)[number]): string {
  const fromMine = tx.fromWalletId ? walletsById.value.get(tx.fromWalletId) : null;
  const toMine = tx.toWalletId ? walletsById.value.get(tx.toWalletId) : null;
  const walletFallback = t('transaction.direction.wallet');

  if (tx.type === 'DEPOSIT') return t('transaction.direction.depositTo', { wallet: toMine?.walletType.name ?? walletFallback });
  if (tx.type === 'WITHDRAW') return t('transaction.direction.withdrawFrom', { wallet: fromMine?.walletType.name ?? walletFallback });
  if (tx.type === 'PURCHASE') {
    return fromMine
      ? t('transaction.direction.purchasePaidTo', { wallet: t('transaction.direction.merchant') })
      : t('transaction.direction.purchase');
  }
  if (fromMine) return t('transaction.direction.sentFrom', { wallet: fromMine.walletType.name });
  if (toMine) return t('transaction.direction.receivedInto', { wallet: toMine.walletType.name });
  return t('transaction.direction.transfer');
}

function formatTransactionAmount(tx: (typeof wallet.transactions)[number]): string {
  const w = (tx.fromWalletId && walletsById.value.get(tx.fromWalletId)) ||
    (tx.toWalletId && walletsById.value.get(tx.toWalletId));
  if (!w) return tx.amount;
  return formatAmount(tx.amount, w.walletType.currency);
}

const currencyCount = computed(
  () => new Set(wallet.wallets.map((w) => w.walletType.currency.code)).size,
);
const typeCount = computed(
  () => new Set(wallet.wallets.map((w) => w.walletType.code)).size,
);
const latestTransaction = computed(() => wallet.transactions[0] ?? null);

const transactionsPerDay = computed(() => {
  const days = 14;
  const buckets = new Array(days).fill(0);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  for (const tx of wallet.transactions) {
    const diff = Math.floor((now.getTime() - new Date(tx.createdAt).getTime()) / dayMs);
    const idx = days - 1 - diff;
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
});

onMounted(async () => {
  await Promise.all([
    wallet.fetchWallets(),
    wallet.fetchWalletTypes(),
    wallet.fetchTransactions(),
  ]);
  try {
    const me = await apiRequest<{ phoneNumber: string | null }>('/users/me');
    phoneNumberSaved.value = me.phoneNumber;
    phoneNumber.value = me.phoneNumber ?? '';
  } catch {
    // Non-critical — the phone number card just stays blank.
  }
});

async function onSavePhoneNumber() {
  phoneError.value = '';
  phoneSuccess.value = '';
  phoneBusy.value = true;
  try {
    const result = await apiRequest<{ phoneNumber: string }>('/users/me/phone-number', {
      method: 'PATCH',
      body: { phoneNumber: phoneNumber.value },
    });
    phoneNumberSaved.value = result.phoneNumber;
    phoneSuccess.value = t('dashboard.phone.saved');
  } catch (err) {
    phoneError.value = err instanceof ApiError ? err.message : t('dashboard.phone.error');
  } finally {
    phoneBusy.value = false;
  }
}

async function onCreateCharge() {
  chargeError.value = '';
  chargeResult.value = null;
  chargeLinkCopied.value = false;
  chargeBusy.value = true;
  try {
    const currency = chargeCurrency.value;
    if (!currency) return;
    const result = await wallet.createCharge(
      toMinorUnits(chargeAmount.value, currency),
      currency.code,
      chargeLanguage.value,
    );
    chargeResult.value = result;
    chargeAmount.value = '';
  } catch (err) {
    chargeError.value = err instanceof ApiError ? err.message : t('dashboard.charge.error');
  } finally {
    chargeBusy.value = false;
  }
}

async function onCopyChargeLink() {
  if (!chargeResult.value) return;
  try {
    await navigator.clipboard.writeText(chargeResult.value.redirectUrl);
    chargeLinkCopied.value = true;
  } catch {
    // Clipboard API unavailable — the link is still visible to copy manually.
  }
}

async function runAction(fn: () => Promise<void>) {
  actionError.value = '';
  busy.value = true;
  try {
    await fn();
  } catch (err) {
    actionError.value = err instanceof ApiError ? err.message : t('dashboard.actions.error');
  } finally {
    busy.value = false;
  }
}

function onAddWallet() {
  runAction(async () => {
    const options: { autoWithdrawTimes?: string[]; purchaseTimeoutSeconds?: number } = {};
    if (showAutoWithdrawFields.value) {
      options.autoWithdrawTimes = newWalletAutoWithdrawTimes.value;
    }
    if (showPurchaseTimeoutField.value && newWalletPurchaseTimeoutMinutes.value) {
      options.purchaseTimeoutSeconds = Math.round(
        Number(newWalletPurchaseTimeoutMinutes.value) * 60,
      );
    }
    await wallet.createWallet(newWalletType.value, options);
    newWalletType.value = '';
    newWalletAutoWithdrawTimes.value = ['', '', ''];
    newWalletPurchaseTimeoutMinutes.value = '';
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

function onPurchase() {
  runAction(async () => {
    const w = findWallet(purchaseFromWalletId.value);
    if (!w) return;
    const result = await wallet.initiatePurchase(
      w.id,
      purchaseEmail.value,
      toMinorUnits(purchaseAmount.value, w.walletType.currency),
    );
    window.location.href = result.redirectUrl;
  });
}
</script>

<template>
  <AppLayout :title="t('dashboard.title')">
    <p v-if="actionError" class="admin-error">{{ actionError }}</p>

    <div class="admin-grid admin-grid-2">
      <div class="hero-card">
        <div class="hero-copy">
          <span class="hero-eyebrow">{{ t('dashboard.overviewEyebrow') }}</span>
          <h2>{{ t('dashboard.overviewHeading') }}</h2>
          <p>
            {{ t('dashboard.overviewSummary', { wallets: wallet.wallets.length, currencies: currencyCount, transactions: wallet.transactions.length }) }}
          </p>
        </div>

        <div class="hero-pills">
          <div class="pill">
            <span class="pill-value">{{ wallet.wallets.length }}</span>
            <span class="pill-label"><i class="dot dot-orange" />{{ t('dashboard.walletsLabel') }}</span>
          </div>
          <div class="pill">
            <span class="pill-value">{{ currencyCount }}</span>
            <span class="pill-label"><i class="dot dot-lime" />{{ t('dashboard.currenciesLabel') }}</span>
          </div>
          <div class="pill">
            <span class="pill-value">{{ wallet.transactions.length }}</span>
            <span class="pill-label"><i class="dot dot-blue" />{{ t('dashboard.transactionsLabel') }}</span>
          </div>
          <div class="pill">
            <span class="pill-value">{{ typeCount }}</span>
            <span class="pill-label"><i class="dot dot-red" />{{ t('dashboard.typesLabel') }}</span>
          </div>
        </div>
      </div>

      <div class="side-stack">
        <div class="admin-card">
          <h2>{{ t('dashboard.activityHeading') }}</h2>
          <MiniLineChart :data="transactionsPerDay" color="#d8ff5c" :height="70" />
        </div>
        <div class="admin-card" v-if="latestTransaction">
          <h2>{{ t('dashboard.latestTransactionHeading') }}</h2>
          <div class="latest-amount">{{ formatTransactionAmount(latestTransaction) }}</div>
          <div class="latest-meta">{{ describeTransaction(latestTransaction) }}</div>
          <div class="latest-meta">{{ new Date(latestTransaction.createdAt).toLocaleString() }}</div>
        </div>
      </div>
    </div>

    <div class="admin-grid admin-grid-2">
      <div class="admin-card">
        <h2>{{ t('dashboard.phone.title') }}</h2>
        <p class="hint">{{ t('dashboard.phone.hint') }}</p>
        <form class="phone-form" @submit.prevent="onSavePhoneNumber">
          <input
            v-model="phoneNumber"
            type="tel"
            :placeholder="t('dashboard.phone.placeholder')"
            class="admin-input"
            required
          />
          <button type="submit" class="admin-btn admin-btn-primary" :disabled="phoneBusy">{{ t('dashboard.phone.save') }}</button>
        </form>
        <p v-if="phoneNumberSaved" class="hint">{{ t('dashboard.phone.current', { phone: phoneNumberSaved }) }}</p>
        <p v-if="phoneError" class="admin-error">{{ phoneError }}</p>
        <p v-if="phoneSuccess" class="phone-success">{{ phoneSuccess }}</p>
      </div>

      <div v-if="purchaseInCurrencies.length" class="admin-card">
        <h2>{{ t('dashboard.charge.title') }}</h2>
        <p class="hint">{{ t('dashboard.charge.hint') }}</p>
        <form class="charge-form" @submit.prevent="onCreateCharge">
          <select v-model="chargeCurrencyCode" class="admin-input" required>
            <option value="" disabled>{{ t('dashboard.charge.currencyPlaceholder') }}</option>
            <option v-for="c in purchaseInCurrencies" :key="c.code" :value="c.code">{{ c.code }}</option>
          </select>
          <input
            v-model="chargeAmount"
            type="number"
            min="0"
            :step="chargeStep"
            :placeholder="t('dashboard.charge.amountPlaceholder')"
            class="admin-input"
            required
          />
          <select v-model="chargeLanguage" class="admin-input">
            <option value="en">{{ t('dashboard.charge.languageEn') }}</option>
            <option value="fa">{{ t('dashboard.charge.languageFa') }}</option>
          </select>
          <button type="submit" class="admin-btn admin-btn-primary" :disabled="chargeBusy">
            {{ t('dashboard.charge.create') }}
          </button>
        </form>
        <p v-if="chargeError" class="admin-error">{{ chargeError }}</p>
        <div v-if="chargeResult" class="charge-result">
          <input readonly class="admin-input mono" :value="chargeResult.redirectUrl" />
          <button class="admin-btn admin-btn-ghost" @click="onCopyChargeLink">
            {{ chargeLinkCopied ? t('dashboard.charge.copied') : t('dashboard.charge.copy') }}
          </button>
        </div>
      </div>
    </div>

    <div class="admin-card">
      <h2>{{ t('dashboard.wallets.title') }}</h2>
      <div class="wallets">
        <article v-for="w in wallet.wallets" :key="w.id" class="wallet-card">
          <span class="wallet-type">{{ w.walletType.name }} · {{ w.walletType.currency.code }}</span>
          <span class="wallet-balance">{{ formatAmount(w.balance, w.walletType.currency) }}</span>
          <div class="badges">
            <span v-for="b in badges(w)" :key="b" class="admin-badge">{{ b }}</span>
          </div>
        </article>
      </div>

      <form class="add-wallet" @submit.prevent="onAddWallet">
        <select v-model="newWalletType" class="admin-input" required>
          <option value="" disabled>{{ t('dashboard.wallets.addPlaceholder') }}</option>
          <option v-for="t2 in wallet.walletTypes" :key="t2.id" :value="t2.id">
            {{ t2.name }} ({{ t2.currency.code }})
          </option>
        </select>

        <template v-if="showAutoWithdrawFields">
          <span class="hint">{{ t('dashboard.wallets.autoWithdrawLabel') }}</span>
          <input v-model="newWalletAutoWithdrawTimes[0]" type="time" class="admin-input" required />
          <input v-model="newWalletAutoWithdrawTimes[1]" type="time" class="admin-input" required />
          <input v-model="newWalletAutoWithdrawTimes[2]" type="time" class="admin-input" required />
        </template>

        <template v-if="showPurchaseTimeoutField">
          <span class="hint">{{ t('dashboard.wallets.verifyTimeoutLabel') }}</span>
          <input
            v-model="newWalletPurchaseTimeoutMinutes"
            type="number"
            min="1"
            placeholder="15"
            class="admin-input"
          />
        </template>

        <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">{{ t('dashboard.wallets.add') }}</button>
      </form>
    </div>

    <div class="admin-grid admin-grid-4 actions">
      <form class="admin-card" @submit.prevent="onDeposit">
        <h2>{{ t('dashboard.actions.deposit.title') }}</h2>
        <select v-model="depositWalletId" class="admin-input" required>
          <option value="" disabled>{{ t('dashboard.actions.deposit.chooseWallet') }}</option>
          <option v-for="w in wallet.wallets" :key="w.id" :value="w.id">
            {{ walletLabel(w) }}
          </option>
        </select>
        <input v-model="depositAmount" type="number" min="0" :step="depositStep" class="admin-input" required />
        <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">{{ t('dashboard.actions.deposit.submit') }}</button>
      </form>

      <form class="admin-card" @submit.prevent="onWithdraw">
        <h2>{{ t('dashboard.actions.withdraw.title') }}</h2>
        <select v-model="withdrawWalletId" class="admin-input" required>
          <option value="" disabled>{{ t('dashboard.actions.withdraw.chooseWallet') }}</option>
          <option v-for="w in withdrawableWallets" :key="w.id" :value="w.id">
            {{ walletLabel(w) }}
          </option>
        </select>
        <input v-model="withdrawAmount" type="number" min="0" :step="withdrawStep" class="admin-input" required />
        <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">{{ t('dashboard.actions.withdraw.submit') }}</button>
      </form>

      <form class="admin-card" @submit.prevent="onTransfer">
        <h2>{{ t('dashboard.actions.transfer.title') }}</h2>
        <select v-model="transferFromWalletId" class="admin-input" required>
          <option value="" disabled>{{ t('dashboard.actions.transfer.fromWallet') }}</option>
          <option v-for="w in p2pWallets" :key="w.id" :value="w.id">
            {{ walletLabel(w) }}
          </option>
        </select>
        <input v-model="transferEmail" type="email" :placeholder="t('dashboard.actions.transfer.recipientPlaceholder')" class="admin-input" required />
        <input v-model="transferAmount" type="number" min="0" :step="transferStep" class="admin-input" required />
        <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">{{ t('dashboard.actions.transfer.submit') }}</button>
      </form>

      <form class="admin-card" @submit.prevent="onPurchase">
        <h2>{{ t('dashboard.actions.purchase.title') }}</h2>
        <select v-model="purchaseFromWalletId" class="admin-input" required>
          <option value="" disabled>{{ t('dashboard.actions.purchase.payFrom') }}</option>
          <option v-for="w in purchaseWallets" :key="w.id" :value="w.id">
            {{ walletLabel(w) }}
          </option>
        </select>
        <input v-model="purchaseEmail" type="email" :placeholder="t('dashboard.actions.purchase.merchantPlaceholder')" class="admin-input" required />
        <input v-model="purchaseAmount" type="number" min="0" :step="purchaseStep" class="admin-input" required />
        <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">{{ t('dashboard.actions.purchase.submit') }}</button>
      </form>
    </div>

    <div class="admin-card">
      <h2>{{ t('dashboard.history.title') }}</h2>
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t('dashboard.history.description') }}</th>
            <th>{{ t('dashboard.history.amount') }}</th>
            <th>{{ t('dashboard.history.date') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tx in wallet.transactions" :key="tx.id" class="tx-row-clickable" @click="$router.push({ name: 'transaction-detail', params: { id: tx.id } })">
            <td>{{ describeTransaction(tx) }}</td>
            <td>{{ formatTransactionAmount(tx) }}</td>
            <td>{{ new Date(tx.createdAt).toLocaleString() }}</td>
          </tr>
          <tr v-if="!wallet.transactions.length"><td colspan="3">{{ t('dashboard.history.empty') }}</td></tr>
        </tbody>
      </table>
    </div>
  </AppLayout>
</template>

<style scoped>
.hero-card {
  position: relative;
  border-radius: var(--radius-md);
  padding: 32px 28px 56px;
  background: linear-gradient(135deg, #3a2418 0%, #1e1c25 65%);
  overflow: visible;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 260px;
}

.hero-eyebrow {
  font-size: 0.78rem;
  color: var(--accent-orange-soft);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
}

.hero-copy h2 {
  font-size: 1.9rem;
  line-height: 1.2;
  margin: 10px 0 12px;
  max-width: 420px;
}

.hero-copy p {
  color: var(--text-dim);
  max-width: 440px;
  margin: 0 0 20px;
}

.hero-pills {
  position: absolute;
  left: 28px;
  right: 28px;
  bottom: -22px;
  display: flex;
  background: rgba(15, 13, 18, 0.85);
  backdrop-filter: blur(6px);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  gap: 28px;
}

.pill {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pill-value {
  font-size: 1.4rem;
  font-weight: 700;
}

.pill-label {
  font-size: 0.75rem;
  color: var(--text-dim);
  display: flex;
  align-items: center;
  gap: 6px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.dot-orange { background: var(--accent-orange); }
.dot-lime { background: var(--accent-lime); }
.dot-blue { background: var(--accent-blue); }
.dot-red { background: var(--accent-red); }

.side-stack {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.latest-amount {
  font-size: 1.8rem;
  font-weight: 700;
}

.latest-meta {
  color: var(--text-dim);
  font-size: 0.82rem;
  margin-top: 4px;
}

.wallets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin-bottom: 18px;
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
  font-size: 0.72rem;
  color: var(--text-dimmer);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.wallet-balance {
  font-size: 1.5rem;
  font-weight: 700;
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.add-wallet {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.add-wallet select {
  flex: 1;
  min-width: 160px;
}
.hint {
  font-size: 0.8rem;
  color: var(--text-dim);
}
.actions form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tx-row-clickable {
  cursor: pointer;
}
.phone-form,
.charge-form {
  display: flex;
  gap: 8px;
  margin: 10px 0;
}
.phone-form input {
  flex: 1;
}
.charge-form select {
  flex: 0 0 90px;
}
.charge-form input {
  flex: 1;
}
.phone-success {
  color: var(--accent-lime);
  font-size: 0.85rem;
}
.charge-result {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.charge-result input {
  flex: 1;
}
.mono {
  font-family: monospace;
  font-size: 0.8rem;
}
</style>
