<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWalletStore, type Wallet, type WalletOptionsInput, type SettlementRailType } from '../stores/wallet';
import { useAuthStore } from '../stores/auth';
import { apiRequest, ApiError, API_URL } from '../api/client';
import { amountStep, formatAmount, formatAmountWords, toMinorUnits, type CurrencyInfo } from '../utils/currency';
import { formatDateTime } from '../utils/date';
import { cardGradient } from '../utils/cardTheme';
import { transactionTypeClass, transactionStatusClass } from '../types/admin';
import { walletDisplayName } from '../utils/wallet-name';
import { useListControls } from '../composables/useListControls';
import { groupTransactionClusters } from '../utils/txCluster';
import AppLayout from '../components/AppLayout.vue';
import ActivityChart from '../components/ActivityChart.vue';

const wallet = useWalletStore();
const auth = useAuthStore();
const { t } = useI18n();

const chargeAmount = ref('');
const chargeCurrencyCode = ref('');
const chargeLanguage = ref<'en' | 'fa'>('en');
const chargeBusy = ref(false);
const chargeError = ref('');
const chargeResult = ref<{ redirectUrl: string; expiresAt: string } | null>(null);
const chargeLinkCopied = ref(false);

const newWalletType = ref('');
const newWalletName = ref('');
const newWalletPurchaseTimeoutMinutes = ref('');
const newWalletSettlementAccounts = ref<{ iban: string; label: string; percent: string }[]>([]);
const newWalletRestrictedCounterparties = ref('');
const newWalletTerminalId = ref('');
const newWalletAcceptorCode = ref('');
const newWalletMinAmount = ref('');
const newWalletMaxAmount = ref('');
const newWalletStoreName = ref('');
const newWalletStoreSite = ref('');
const newWalletAllowedIps = ref('');
const newWalletCallbackUrl = ref('');
const newWalletCategory = ref('');
const newWalletSubCategory = ref('');
const newWalletRailType = ref('');
const newWalletRailScheduleTimes = ref('');
const newWalletVirtualAmount = ref('');

const editingWalletId = ref<string | null>(null);
const editWalletName = ref('');
const editRestrictedCounterparties = ref('');
const editPurchaseTimeoutMinutes = ref('');
const editSettlementAccounts = ref<{ iban: string; label: string; percent: string }[]>([]);
const editTerminalId = ref('');
const editAcceptorCode = ref('');
const editMinAmount = ref('');
const editMaxAmount = ref('');
const editStoreName = ref('');
const editStoreSite = ref('');
const editAllowedIps = ref('');
const editCallbackUrl = ref('');
const editCategory = ref('');
const editSubCategory = ref('');
const editRailType = ref('');
const editRailScheduleTimes = ref('');
const chargeSettlementSplits = ref<
  { iban: string; label: string; type: 'PERCENT' | 'FIXED'; value: string }[]
>([]);
const depositWalletId = ref('');
const depositAmount = ref('');
const withdrawWalletId = ref('');
const withdrawAmount = ref('');
const withdrawRailType = ref<SettlementRailType | ''>('');
const withdrawDestinationIban = ref('');
const transferFromWalletId = ref('');
const transferEmail = ref('');
const transferAmount = ref('');
const purchaseFromWalletId = ref('');
const purchaseEmail = ref('');
const purchaseAmount = ref('');
const actionError = ref('');
const busy = ref(false);

const grantRepositoryWalletId = ref('');
const grantPersonnelPhone = ref('');
const grantWalletTypeId = ref('');
const grantVirtualAmount = ref('');
const grantNationalCode = ref('');
const grantBusy = ref(false);
const grantError = ref('');
const grantSuccess = ref('');

// Merchant-style (supportsAutoWithdraw) wallets never withdraw manually —
// their balance only leaves on the auto-withdraw sweep schedule — so they're
// excluded here even if allowWithdraw happens to also be true.
const withdrawableWallets = computed(() =>
  wallet.wallets.filter((w) => w.walletType.allowWithdraw && !w.walletType.supportsAutoWithdraw),
);
const p2pWallets = computed(() =>
  wallet.wallets.filter((w) => w.walletType.allowP2pOut),
);
const purchaseWallets = computed(() =>
  wallet.wallets.filter((w) => w.walletType.allowPurchaseOut),
);

// Repository/credit-line feature: wallets the caller owns that can grant
// credit (type code REPOSITORY), and the CREDIT-type wallet types available
// to grant into.
const repositoryWallets = computed(() =>
  wallet.wallets.filter((w) => w.walletType.code === 'REPOSITORY' && !w.closedAt),
);
const creditWalletTypes = computed(() =>
  wallet.walletTypes.filter((wt) => wt.code === 'CREDIT'),
);
const grantRepositoryWallet = computed(() =>
  repositoryWallets.value.find((w) => w.id === grantRepositoryWalletId.value),
);
const grantAmountStep = computed(() =>
  grantRepositoryWallet.value ? amountStep(grantRepositoryWallet.value.walletType.currency) : '0.01',
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
const showVirtualAmountField = computed(
  () => selectedNewWalletType.value?.hasVirtualBalance ?? false,
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
  return `${walletDisplayName(w)} (${w.walletType.currency.code}) — ${formatAmount(w.balance, w.walletType.currency)}`;
}

// Item: give each wallet a payment-card look — the gradient an admin
// picked for its wallet type (or a deterministic hash-based default, see
// utils/cardTheme.ts) and a masked-number-style echo of its id, the way a
// bank app shows the last 4 digits of a card instead of the full PAN.
function cardFaceStyle(w: Wallet): { background: string } {
  return { background: cardGradient(w.walletType, !!w.closedAt) };
}
function cardImageSrc(w: Wallet): string | null {
  return w.walletType.cardImageFilename
    ? `${API_URL}/uploads/wallet-type-cards/${w.walletType.cardImageFilename}`
    : null;
}
function maskedWalletId(w: Wallet): string {
  const clean = w.id.replace(/-/g, '').toUpperCase();
  return `${clean.slice(0, 4)} •••• •••• ${clean.slice(-4)}`;
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
  if (!w.walletType.depositable) list.push(t('dashboard.wallets.noDeposits'));
  if (w.restrictedCounterparties?.length) list.push(t('dashboard.wallets.marketBadge'));
  if (w.closedAt) list.push(t('dashboard.wallets.closedBadge'));
  if (w.walletType.code === 'REPOSITORY' && w.virtualAmount !== null) {
    list.push(
      t('dashboard.wallets.virtualPoolBadge', {
        amount: formatAmount(w.virtualAmount, w.walletType.currency),
      }),
    );
  }
  if (w.walletType.code === 'CREDIT' && w.virtualAmount !== null) {
    list.push(
      t('dashboard.wallets.creditCeilingBadge', {
        amount: formatAmount(w.virtualAmount, w.walletType.currency),
      }),
    );
  }
  if (w.repositoryWalletId) list.push(t('dashboard.wallets.repositoryBackedBadge'));
  if (w.blockedAt) list.push(t('dashboard.wallets.blockedBadge'));
  if (w.railType) list.push(t(`dashboard.settlement.rail.${w.railType}`));
  return list;
}

function describeTransaction(tx: (typeof wallet.transactions)[number]): string {
  const fromMine = tx.fromWalletId ? walletsById.value.get(tx.fromWalletId) : null;
  const toMine = tx.toWalletId ? walletsById.value.get(tx.toWalletId) : null;
  const walletFallback = t('transaction.direction.wallet');

  if (tx.type === 'DEPOSIT') return t('transaction.direction.depositTo', { wallet: toMine ? walletDisplayName(toMine) : walletFallback });
  if (tx.type === 'WITHDRAW') return t('transaction.direction.withdrawFrom', { wallet: fromMine ? walletDisplayName(fromMine) : walletFallback });
  if (tx.type === 'PURCHASE') {
    return fromMine
      ? t('transaction.direction.purchasePaidTo', { wallet: t('transaction.direction.merchant') })
      : t('transaction.direction.purchase');
  }
  if (fromMine) return t('transaction.direction.sentFrom', { wallet: walletDisplayName(fromMine) });
  if (toMine) return t('transaction.direction.receivedInto', { wallet: walletDisplayName(toMine) });
  return t('transaction.direction.transfer');
}

function formatTransactionAmount(tx: (typeof wallet.transactions)[number]): string {
  const w = (tx.fromWalletId && walletsById.value.get(tx.fromWalletId)) ||
    (tx.toWalletId && walletsById.value.get(tx.toWalletId));
  if (!w) return tx.amount;
  return formatAmount(tx.amount, w.walletType.currency);
}

function formatTransactionAmountWords(tx: (typeof wallet.transactions)[number]): string {
  const w = (tx.fromWalletId && walletsById.value.get(tx.fromWalletId)) ||
    (tx.toWalletId && walletsById.value.get(tx.toWalletId));
  if (!w) return '';
  return formatAmountWords(tx.amount, w.walletType.currency);
}

// Whether money is landing in one of the customer's own wallets on this
// transaction — used to color the +/- treatment. toWalletId is checked
// first since for a transfer between two of the customer's own wallets
// both sides are technically "mine"; the incoming side wins.
function isIncoming(tx: (typeof wallet.transactions)[number]): boolean {
  return !!tx.toWalletId && walletsById.value.has(tx.toWalletId);
}

const historySource = computed(() => wallet.transactions);

function historySearchText(tx: (typeof wallet.transactions)[number]): (string | null)[] {
  const fromMine = tx.fromWalletId ? walletsById.value.get(tx.fromWalletId) : null;
  const toMine = tx.toWalletId ? walletsById.value.get(tx.toWalletId) : null;
  return [
    tx.type,
    tx.status,
    tx.note,
    fromMine ? walletDisplayName(fromMine) : null,
    toMine ? walletDisplayName(toMine) : null,
  ];
}

const { search: historySearch, sorted: historySorted } = useListControls(historySource, {
  searchFields: historySearchText,
  sortAccessors: {
    date: (tx) => new Date(tx.createdAt).getTime(),
  },
  defaultSort: { key: 'date', dir: 'desc' },
});

// See utils/txCluster.ts for why a single customer action can span more
// than one ledger row, and how those rows get grouped back together.
const historyClusters = computed(() =>
  groupTransactionClusters(historySorted.value).sort(
    (a, b) => new Date(b.primary.createdAt).getTime() - new Date(a.primary.createdAt).getTime(),
  ),
);

const expandedTx = ref(new Set<string>());
function toggleTx(id: string) {
  const next = new Set(expandedTx.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedTx.value = next;
}

const currencyCount = computed(
  () => new Set(wallet.wallets.map((w) => w.walletType.currency.code)).size,
);
const typeCount = computed(
  () => new Set(wallet.wallets.map((w) => w.walletType.code)).size,
);
const latestCluster = computed(() => historyClusters.value[0] ?? null);

// Drives the wallet stack's peek/expanded state (item 3): pinning it open
// (tap/click), editing a wallet, or having an inline deposit/withdraw/
// transfer/purchase form open all keep it expanded so the form you're
// using doesn't collapse out from under you. Real mouse-hover expansion is
// handled separately in pure CSS (gated to `(hover: hover)` devices) —
// tracking hover in JS caused stray state on touch: a tap leaves a
// "phantom" :hover the way it does on any mobile site, and an SPA route
// change can leave a real mouse sitting over content that just shifted
// under it, both of which produced a stack stuck open. CSS `:hover` has
// neither problem: it always matches the live cursor position and is
// simply switched off outside real-hover devices.
const stackPinned = ref(false);
const addWalletOpen = ref(false);
const openWalletAction = ref<{
  walletId: string;
  action: 'deposit' | 'withdraw' | 'transfer' | 'purchase';
} | null>(null);

const stackExpanded = computed(
  () =>
    stackPinned.value ||
    editingWalletId.value !== null ||
    openWalletAction.value !== null ||
    addWalletOpen.value,
);

function isWalletActionOpen(w: Wallet, action: 'deposit' | 'withdraw' | 'transfer' | 'purchase'): boolean {
  return openWalletAction.value?.walletId === w.id && openWalletAction.value?.action === action;
}

// Item 2: quick actions live on the wallet they act on instead of a
// separate panel with its own "choose wallet" dropdown — opening one here
// just points the existing deposit/withdraw/transfer/purchase state at
// this wallet and resets its fields.
function toggleWalletAction(w: Wallet, action: 'deposit' | 'withdraw' | 'transfer' | 'purchase') {
  if (isWalletActionOpen(w, action)) {
    openWalletAction.value = null;
    return;
  }
  openWalletAction.value = { walletId: w.id, action };
  if (action === 'deposit') {
    depositWalletId.value = w.id;
    depositAmount.value = '';
  } else if (action === 'withdraw') {
    withdrawWalletId.value = w.id;
    withdrawAmount.value = '';
    withdrawRailType.value = '';
    withdrawDestinationIban.value = '';
  } else if (action === 'transfer') {
    transferFromWalletId.value = w.id;
    transferEmail.value = '';
    transferAmount.value = '';
  } else {
    purchaseFromWalletId.value = w.id;
    purchaseEmail.value = '';
    purchaseAmount.value = '';
  }
}

onMounted(async () => {
  await Promise.all([
    wallet.fetchWallets(),
    wallet.fetchWalletTypes(),
    wallet.fetchTransactions(),
  ]);
  try {
    const me = await apiRequest<{
      role: string;
      avatarUrl: string | null;
      panelRole: { permissions: string[] } | null;
    }>('/users/me');
    auth.setRole(me.role);
    auth.setPermissions(me.panelRole?.permissions ?? null);
    auth.setAvatarUrl(me.avatarUrl ?? null);
  } catch {
    // Non-critical — the gated cards just keep whatever was cached.
  }
});

function addChargeSplitRow() {
  chargeSettlementSplits.value.push({ iban: '', label: '', type: 'PERCENT', value: '' });
}
function removeChargeSplitRow(index: number) {
  chargeSettlementSplits.value.splice(index, 1);
}

async function onCreateCharge() {
  chargeError.value = '';
  chargeResult.value = null;
  chargeLinkCopied.value = false;
  chargeBusy.value = true;
  try {
    const currency = chargeCurrency.value;
    if (!currency) return;
    const filledSplits = chargeSettlementSplits.value.filter((row) => row.iban && row.value);
    const settlementSplits = filledSplits.length
      ? filledSplits.map((row) => ({
          iban: row.iban,
          label: row.label || undefined,
          type: row.type,
          value: row.type === 'FIXED' ? toMinorUnits(row.value, currency) : Number(row.value),
        }))
      : undefined;
    const result = await wallet.createCharge(
      toMinorUnits(chargeAmount.value, currency),
      currency.code,
      chargeLanguage.value,
      settlementSplits,
    );
    chargeResult.value = result;
    chargeAmount.value = '';
    chargeSettlementSplits.value = [];
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

function addSettlementAccountRow() {
  newWalletSettlementAccounts.value.push({ iban: '', label: '', percent: '' });
}
function removeSettlementAccountRow(index: number) {
  newWalletSettlementAccounts.value.splice(index, 1);
}

function addEditSettlementAccountRow() {
  editSettlementAccounts.value.push({ iban: '', label: '', percent: '' });
}
function removeEditSettlementAccountRow(index: number) {
  editSettlementAccounts.value.splice(index, 1);
}

function parseEmailList(raw: string): string[] {
  return raw
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}

function toggleEditWallet(w: Wallet) {
  if (editingWalletId.value === w.id) {
    editingWalletId.value = null;
    return;
  }
  editingWalletId.value = w.id;
  editWalletName.value = w.name ?? '';
  editRestrictedCounterparties.value = (w.restrictedCounterparties ?? []).join(', ');
  editPurchaseTimeoutMinutes.value = w.purchaseTimeoutSeconds
    ? String(Math.round(w.purchaseTimeoutSeconds / 60))
    : '';
  editSettlementAccounts.value = (w.settlementAccounts ?? []).map((account) => ({
    iban: account.iban,
    label: account.label ?? '',
    percent: account.percent,
  }));
  editTerminalId.value = w.terminalId ?? '';
  editAcceptorCode.value = w.acceptorCode ?? '';
  editMinAmount.value = w.minTransactionAmount
    ? String(Number(w.minTransactionAmount) / 10 ** w.walletType.currency.decimalPlaces)
    : '';
  editMaxAmount.value = w.maxTransactionAmount
    ? String(Number(w.maxTransactionAmount) / 10 ** w.walletType.currency.decimalPlaces)
    : '';
  editStoreName.value = w.storeName ?? '';
  editStoreSite.value = w.storeSite ?? '';
  editAllowedIps.value = (w.allowedIps ?? []).join(', ');
  editCallbackUrl.value = w.callbackUrl ?? '';
  editCategory.value = w.category ?? '';
  editSubCategory.value = w.subCategory ?? '';
  editRailType.value = w.railType ?? '';
  editRailScheduleTimes.value = (w.railScheduleTimes ?? []).join(', ');
}

function parseIpList(raw: string): string[] {
  return raw
    .split(',')
    .map((ip) => ip.trim())
    .filter((ip) => ip.length > 0);
}

function parseTimeList(raw: string): string[] {
  return raw
    .split(',')
    .map((time) => time.trim())
    .filter((time) => time.length > 0);
}

function onSaveWalletEdit(w: Wallet) {
  runAction(async () => {
    const options: WalletOptionsInput = {
      name: editWalletName.value,
      restrictedCounterparties: parseEmailList(editRestrictedCounterparties.value),
    };
    const scale = 10 ** w.walletType.currency.decimalPlaces;
    if (editMinAmount.value) {
      options.minTransactionAmount = Math.round(Number(editMinAmount.value) * scale);
    }
    if (editMaxAmount.value) {
      options.maxTransactionAmount = Math.round(Number(editMaxAmount.value) * scale);
    }
    if (w.walletType.supportsAutoWithdraw) {
      const filledAccounts = editSettlementAccounts.value.filter(
        (row) => row.iban && row.percent,
      );
      options.settlementAccounts = filledAccounts.length
        ? filledAccounts.map((row) => ({
            iban: row.iban,
            label: row.label || undefined,
            percent: Number(row.percent),
          }))
        : undefined;
      if (editRailType.value) {
        options.railType = editRailType.value as WalletOptionsInput['railType'];
        options.railScheduleTimes = editRailScheduleTimes.value
          ? parseTimeList(editRailScheduleTimes.value)
          : undefined;
      }
    }
    if (w.walletType.allowPurchaseIn) {
      options.purchaseTimeoutSeconds = editPurchaseTimeoutMinutes.value
        ? Math.round(Number(editPurchaseTimeoutMinutes.value) * 60)
        : undefined;
      options.terminalId = editTerminalId.value;
      options.acceptorCode = editAcceptorCode.value;
      options.storeName = editStoreName.value;
      options.storeSite = editStoreSite.value;
      options.allowedIps = parseIpList(editAllowedIps.value);
      options.callbackUrl = editCallbackUrl.value;
      options.category = editCategory.value;
      options.subCategory = editSubCategory.value;
    }
    await wallet.updateWallet(w.id, options);
    editingWalletId.value = null;
  });
}

function onCloseWallet(w: Wallet) {
  runAction(() => wallet.closeWallet(w.id));
}

function onAddWallet() {
  runAction(async () => {
    const options: WalletOptionsInput = {};
    if (newWalletName.value.trim()) options.name = newWalletName.value.trim();
    const restricted = parseEmailList(newWalletRestrictedCounterparties.value);
    if (restricted.length) {
      options.restrictedCounterparties = restricted;
    }
    const scale = 10 ** (selectedNewWalletType.value?.currency.decimalPlaces ?? 0);
    if (newWalletMinAmount.value) {
      options.minTransactionAmount = Math.round(Number(newWalletMinAmount.value) * scale);
    }
    if (newWalletMaxAmount.value) {
      options.maxTransactionAmount = Math.round(Number(newWalletMaxAmount.value) * scale);
    }
    if (showAutoWithdrawFields.value) {
      const filledAccounts = newWalletSettlementAccounts.value.filter(
        (row) => row.iban && row.percent,
      );
      if (filledAccounts.length) {
        options.settlementAccounts = filledAccounts.map((row) => ({
          iban: row.iban,
          label: row.label || undefined,
          percent: Number(row.percent),
        }));
      }
      if (newWalletRailType.value) {
        options.railType = newWalletRailType.value as WalletOptionsInput['railType'];
        if (newWalletRailScheduleTimes.value) {
          options.railScheduleTimes = parseTimeList(newWalletRailScheduleTimes.value);
        }
      }
    }
    if (showPurchaseTimeoutField.value) {
      if (newWalletPurchaseTimeoutMinutes.value) {
        options.purchaseTimeoutSeconds = Math.round(
          Number(newWalletPurchaseTimeoutMinutes.value) * 60,
        );
      }
      if (newWalletTerminalId.value) options.terminalId = newWalletTerminalId.value;
      if (newWalletAcceptorCode.value) options.acceptorCode = newWalletAcceptorCode.value;
      if (newWalletStoreName.value) options.storeName = newWalletStoreName.value;
      if (newWalletStoreSite.value) options.storeSite = newWalletStoreSite.value;
      const ips = parseIpList(newWalletAllowedIps.value);
      if (ips.length) options.allowedIps = ips;
      if (newWalletCallbackUrl.value) options.callbackUrl = newWalletCallbackUrl.value;
      if (newWalletCategory.value) options.category = newWalletCategory.value;
      if (newWalletSubCategory.value) options.subCategory = newWalletSubCategory.value;
    }
    if (showVirtualAmountField.value && newWalletVirtualAmount.value) {
      options.virtualAmount = toMinorUnits(newWalletVirtualAmount.value, selectedNewWalletType.value!.currency);
    }
    await wallet.createWallet(newWalletType.value, options);
    newWalletType.value = '';
    newWalletName.value = '';
    newWalletPurchaseTimeoutMinutes.value = '';
    newWalletSettlementAccounts.value = [];
    newWalletRestrictedCounterparties.value = '';
    newWalletTerminalId.value = '';
    newWalletAcceptorCode.value = '';
    newWalletMinAmount.value = '';
    newWalletMaxAmount.value = '';
    newWalletStoreName.value = '';
    newWalletStoreSite.value = '';
    newWalletAllowedIps.value = '';
    newWalletCallbackUrl.value = '';
    newWalletCategory.value = '';
    newWalletSubCategory.value = '';
    newWalletRailType.value = '';
    newWalletRailScheduleTimes.value = '';
    newWalletVirtualAmount.value = '';
    addWalletOpen.value = false;
  });
}

function onDeposit() {
  runAction(async () => {
    const w = findWallet(depositWalletId.value);
    if (!w) return;
    const result = await wallet.deposit(
      w.id,
      toMinorUnits(depositAmount.value, w.walletType.currency),
    );
    window.location.href = result.redirectUrl;
  });
}

function onWithdraw() {
  runAction(async () => {
    const w = findWallet(withdrawWalletId.value);
    if (!w || !withdrawRailType.value || !withdrawDestinationIban.value) return;
    await wallet.withdraw(
      w.id,
      toMinorUnits(withdrawAmount.value, w.walletType.currency),
      withdrawRailType.value,
      withdrawDestinationIban.value,
    );
    withdrawAmount.value = '';
    withdrawRailType.value = '';
    withdrawDestinationIban.value = '';
    openWalletAction.value = null;
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
    openWalletAction.value = null;
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

async function onGrantCredit() {
  grantError.value = '';
  grantSuccess.value = '';
  const repo = grantRepositoryWallet.value;
  if (!repo) return;
  grantBusy.value = true;
  try {
    await wallet.grantCredit({
      repositoryWalletId: repo.id,
      personnelPhoneNumber: grantPersonnelPhone.value,
      walletTypeId: grantWalletTypeId.value,
      virtualAmount: toMinorUnits(grantVirtualAmount.value, repo.walletType.currency),
      nationalCode: grantNationalCode.value || undefined,
    });
    grantSuccess.value = t('dashboard.grantCredit.success');
    grantPersonnelPhone.value = '';
    grantVirtualAmount.value = '';
    grantNationalCode.value = '';
  } catch (err) {
    grantError.value = err instanceof ApiError ? err.message : t('dashboard.actions.error');
  } finally {
    grantBusy.value = false;
  }
}


</script>

<template>
  <AppLayout :title="t('dashboard.title')">
    <p v-if="actionError" class="admin-error">{{ actionError }}</p>

    <div class="admin-grid admin-grid-2">
      <div class="admin-card wallet-hero-card">
        <div class="wallet-hero-head">
          <div>
            <span class="hero-eyebrow">{{ t('dashboard.overviewEyebrow') }}</span>
            <h2>{{ t('dashboard.wallets.title') }}</h2>
          </div>
          <button type="button" class="admin-btn admin-btn-ghost" @click="stackPinned = !stackPinned">
            {{ stackPinned ? t('dashboard.wallets.collapseStack') : t('dashboard.wallets.expandStack') }}
          </button>
        </div>

        <div class="wallet-stack" :class="{ expanded: stackExpanded }">
          <article
            v-for="(w, i) in wallet.wallets"
            :key="w.id"
            class="wallet-card"
            :class="{ 'is-peek': !stackExpanded }"
            :style="{ zIndex: wallet.wallets.length - i }"
          >
            <div
              class="card-face"
              :style="cardFaceStyle(w)"
              role="button"
              tabindex="0"
              @click="stackPinned = true"
              @keydown.enter="stackPinned = true"
            >
              <div class="card-face-top">
                <span class="card-face-type">{{ w.walletType.name }}</span>
                <span class="card-face-currency-pill">{{ w.walletType.currency.code }}</span>
              </div>
              <div class="card-face-balance">{{ formatAmount(w.balance, w.walletType.currency) }}</div>
              <div class="card-face-number">{{ maskedWalletId(w) }}</div>
              <div class="card-face-bottom">
                <span class="card-face-name">{{ walletDisplayName(w) }}</span>
                <img v-if="cardImageSrc(w)" :src="cardImageSrc(w)!" class="card-brand-image" alt="" />
                <span v-else class="card-brand-mark" aria-hidden="true"><i /><i /></span>
              </div>
            </div>

            <div class="card-body">
              <span class="mono-id">{{ w.id }}</span>
              <div class="badges">
                <span v-for="b in badges(w)" :key="b" class="admin-badge">{{ b }}</span>
              </div>
              <div class="wallet-card-actions">
                <router-link :to="{ name: 'wallet-detail', params: { id: w.id } }" class="admin-btn admin-btn-ghost">
                  {{ t('walletDetail.viewLink') }}
                </router-link>
                <router-link
                  v-if="w.walletType.code === 'CREDIT'"
                  :to="{ name: 'wallet-installments', params: { walletId: w.id } }"
                  class="admin-btn admin-btn-ghost"
                >
                  {{ t('dashboard.installments.viewLink') }}
                </router-link>
                <button
                  type="button"
                  class="admin-btn admin-btn-ghost"
                  :disabled="!!w.closedAt"
                  @click="toggleEditWallet(w)"
                >
                  {{ editingWalletId === w.id ? t('dashboard.wallets.cancelEdit') : t('dashboard.wallets.edit') }}
                </button>
                <button
                  type="button"
                  class="admin-btn admin-btn-danger"
                  :disabled="busy || !!w.closedAt || w.balance !== '0'"
                  :title="w.balance !== '0' ? t('dashboard.wallets.closeRequiresZero') : ''"
                  @click="onCloseWallet(w)"
                >
                  {{ t('dashboard.wallets.close') }}
                </button>
              </div>

              <!-- Item 2: quick actions live on the wallet that can actually
                   perform them, instead of a separate panel with its own
                   "choose wallet" dropdown. -->
              <div class="wallet-quick-actions">
                <button
                  v-if="w.walletType.depositable && auth.canCustomerAction('deposit')"
                  type="button"
                  class="admin-btn admin-btn-ghost"
                  :class="{ active: isWalletActionOpen(w, 'deposit') }"
                  @click="toggleWalletAction(w, 'deposit')"
                >
                  {{ t('dashboard.actions.deposit.title') }}
                </button>
                <button
                  v-if="withdrawableWallets.includes(w) && auth.canCustomerAction('withdraw')"
                  type="button"
                  class="admin-btn admin-btn-ghost"
                  :class="{ active: isWalletActionOpen(w, 'withdraw') }"
                  @click="toggleWalletAction(w, 'withdraw')"
                >
                  {{ t('dashboard.actions.withdraw.title') }}
                </button>
                <button
                  v-if="p2pWallets.includes(w) && auth.canCustomerAction('transfer')"
                  type="button"
                  class="admin-btn admin-btn-ghost"
                  :class="{ active: isWalletActionOpen(w, 'transfer') }"
                  @click="toggleWalletAction(w, 'transfer')"
                >
                  {{ t('dashboard.actions.transfer.title') }}
                </button>
                <button
                  v-if="purchaseWallets.includes(w) && auth.canCustomerAction('purchaseAction')"
                  type="button"
                  class="admin-btn admin-btn-ghost"
                  :class="{ active: isWalletActionOpen(w, 'purchase') }"
                  @click="toggleWalletAction(w, 'purchase')"
                >
                  {{ t('dashboard.actions.purchase.title') }}
                </button>
              </div>

              <form v-if="isWalletActionOpen(w, 'deposit')" class="wallet-inline-form" @submit.prevent="onDeposit">
                <input v-model="depositAmount" type="number" min="0" :step="depositStep" class="admin-input" required />
                <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">{{ t('dashboard.actions.deposit.submit') }}</button>
              </form>

              <form v-if="isWalletActionOpen(w, 'withdraw')" class="wallet-inline-form" @submit.prevent="onWithdraw">
                <input v-model="withdrawAmount" type="number" min="0" :step="withdrawStep" class="admin-input" required />
                <select v-model="withdrawRailType" class="admin-input" required>
                  <option value="" disabled>{{ t('dashboard.actions.withdraw.chooseRail') }}</option>
                  <option value="POL_PAY">{{ t('dashboard.settlement.rail.POL_PAY') }}</option>
                  <option value="PAYA">{{ t('dashboard.settlement.rail.PAYA') }}</option>
                  <option value="SATNA">{{ t('dashboard.settlement.rail.SATNA') }}</option>
                  <option value="BANK_TRANSFER">{{ t('dashboard.settlement.rail.BANK_TRANSFER') }}</option>
                </select>
                <input
                  v-model="withdrawDestinationIban"
                  type="text"
                  :placeholder="t('dashboard.actions.withdraw.ibanPlaceholder')"
                  class="admin-input"
                  required
                />
                <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">{{ t('dashboard.actions.withdraw.submit') }}</button>
              </form>

              <form v-if="isWalletActionOpen(w, 'transfer')" class="wallet-inline-form" @submit.prevent="onTransfer">
                <input v-model="transferEmail" type="email" :placeholder="t('dashboard.actions.transfer.recipientPlaceholder')" class="admin-input" required />
                <input v-model="transferAmount" type="number" min="0" :step="transferStep" class="admin-input" required />
                <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">{{ t('dashboard.actions.transfer.submit') }}</button>
              </form>

              <form v-if="isWalletActionOpen(w, 'purchase')" class="wallet-inline-form" @submit.prevent="onPurchase">
                <input v-model="purchaseEmail" type="email" :placeholder="t('dashboard.actions.purchase.merchantPlaceholder')" class="admin-input" required />
                <input v-model="purchaseAmount" type="number" min="0" :step="purchaseStep" class="admin-input" required />
                <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">{{ t('dashboard.actions.purchase.submit') }}</button>
              </form>

              <form v-if="editingWalletId === w.id" class="wallet-edit-form" @submit.prevent="onSaveWalletEdit(w)">
                <label>
                  {{ t('dashboard.wallets.nameLabel') }}
                  <input
                    v-model="editWalletName"
                    type="text"
                    maxlength="100"
                    :placeholder="t('dashboard.wallets.namePlaceholder')"
                    class="admin-input"
                  />
                </label>
                <label>
                  {{ t('dashboard.wallets.marketLabel') }}
                  <input
                    v-model="editRestrictedCounterparties"
                    type="text"
                    :placeholder="t('dashboard.wallets.marketPlaceholder')"
                    class="admin-input"
                  />
                </label>
                <span class="hint">{{ t('dashboard.wallets.marketHint') }}</span>

                <label>
                  {{ t('dashboard.wallets.minAmountLabel') }}
                  <input v-model="editMinAmount" type="number" min="0" :step="amountStep(w.walletType.currency)" class="admin-input" />
                </label>
                <label>
                  {{ t('dashboard.wallets.maxAmountLabel') }}
                  <input v-model="editMaxAmount" type="number" min="0" :step="amountStep(w.walletType.currency)" class="admin-input" />
                </label>

                <template v-if="w.walletType.supportsAutoWithdraw">
                  <div class="settlement-rows">
                    <span class="hint">{{ t('dashboard.settlement.walletHint') }}</span>
                    <div v-for="(row, i2) in editSettlementAccounts" :key="i2" class="settlement-row">
                      <input v-model="row.iban" type="text" :placeholder="t('dashboard.settlement.ibanPlaceholder')" class="admin-input" />
                      <input v-model="row.label" type="text" :placeholder="t('dashboard.settlement.labelPlaceholder')" class="admin-input" />
                      <input v-model="row.percent" type="number" min="0" max="100" :placeholder="t('dashboard.settlement.percentPlaceholder')" class="admin-input" />
                      <button type="button" class="admin-btn admin-btn-ghost" @click="removeEditSettlementAccountRow(i2)">{{ t('dashboard.settlement.remove') }}</button>
                    </div>
                    <button type="button" class="admin-btn admin-btn-ghost" @click="addEditSettlementAccountRow">
                      {{ t('dashboard.settlement.addAccount') }}
                    </button>
                  </div>

                  <label>
                    {{ t('dashboard.settlement.railLabel') }}
                    <select v-model="editRailType" class="admin-input">
                      <option value="">{{ t('dashboard.settlement.railPlaceholder') }}</option>
                      <option value="POL_PAY">{{ t('dashboard.settlement.rail.POL_PAY') }}</option>
                      <option value="PAYA">{{ t('dashboard.settlement.rail.PAYA') }}</option>
                      <option value="SATNA">{{ t('dashboard.settlement.rail.SATNA') }}</option>
                      <option value="BANK_TRANSFER">{{ t('dashboard.settlement.rail.BANK_TRANSFER') }}</option>
                    </select>
                  </label>
                  <label v-if="editRailType">
                    {{ t('dashboard.settlement.railScheduleLabel') }}
                    <input
                      v-model="editRailScheduleTimes"
                      type="text"
                      :placeholder="t('dashboard.settlement.railSchedulePlaceholder')"
                      class="admin-input"
                    />
                    <span class="hint">
                      {{ editRailType === 'BANK_TRANSFER' ? t('dashboard.settlement.railScheduleRequiredHint') : t('dashboard.settlement.railScheduleHint') }}
                    </span>
                  </label>
                </template>

                <template v-if="w.walletType.allowPurchaseIn">
                  <span class="hint">{{ t('dashboard.wallets.verifyTimeoutLabel') }}</span>
                  <input v-model="editPurchaseTimeoutMinutes" type="number" min="1" placeholder="15" class="admin-input" />
                  <label>
                    {{ t('dashboard.wallets.terminalIdLabel') }}
                    <input v-model="editTerminalId" type="text" class="admin-input" />
                  </label>
                  <label>
                    {{ t('dashboard.wallets.acceptorCodeLabel') }}
                    <input v-model="editAcceptorCode" type="text" class="admin-input" />
                  </label>
                  <label>
                    {{ t('dashboard.wallets.storeNameLabel') }}
                    <input v-model="editStoreName" type="text" class="admin-input" />
                  </label>
                  <label>
                    {{ t('dashboard.wallets.storeSiteLabel') }}
                    <input v-model="editStoreSite" type="url" class="admin-input" />
                  </label>
                  <label>
                    {{ t('dashboard.wallets.allowedIpsLabel') }}
                    <input v-model="editAllowedIps" type="text" :placeholder="t('dashboard.wallets.allowedIpsPlaceholder')" class="admin-input" />
                  </label>
                  <label>
                    {{ t('dashboard.wallets.callbackUrlLabel') }}
                    <input v-model="editCallbackUrl" type="url" class="admin-input" />
                  </label>
                  <label>
                    {{ t('dashboard.wallets.categoryLabel') }}
                    <input v-model="editCategory" type="text" class="admin-input" />
                  </label>
                  <label>
                    {{ t('dashboard.wallets.subCategoryLabel') }}
                    <input v-model="editSubCategory" type="text" class="admin-input" />
                  </label>
                </template>

                <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">{{ t('dashboard.wallets.saveEdit') }}</button>
              </form>
            </div>
          </article>

          <article
            v-if="auth.canCustomerAction('addWallet')"
            class="wallet-card wallet-card-add"
            :class="{ 'is-peek': !stackExpanded }"
            :style="{ zIndex: 0 }"
          >
            <button
              type="button"
              class="card-face card-face-add"
              @click="addWalletOpen = true"
            >
              <span class="card-face-add-icon" aria-hidden="true">+</span>
              <span>{{ t('dashboard.wallets.addWalletCard') }}</span>
            </button>

            <div class="card-body">
              <div class="wallet-card-add-head">
                <span class="wallet-type">{{ t('dashboard.wallets.addWalletCard') }}</span>
                <button type="button" class="admin-btn admin-btn-ghost" @click="addWalletOpen = false">
                  {{ t('dashboard.wallets.cancelEdit') }}
                </button>
              </div>

              <form class="add-wallet" @submit.prevent="onAddWallet">
                <select v-model="newWalletType" class="admin-input" required>
                  <option value="" disabled>{{ t('dashboard.wallets.addPlaceholder') }}</option>
                  <option v-for="t2 in wallet.walletTypes" :key="t2.id" :value="t2.id">
                    {{ t2.name }} ({{ t2.currency.code }})
                  </option>
                </select>

                <label class="market-field">
                  {{ t('dashboard.wallets.nameLabel') }}
                  <input
                    v-model="newWalletName"
                    type="text"
                    maxlength="100"
                    :placeholder="t('dashboard.wallets.namePlaceholder')"
                    class="admin-input"
                  />
                </label>

                <label class="market-field">
                  {{ t('dashboard.wallets.marketLabel') }}
                  <input
                    v-model="newWalletRestrictedCounterparties"
                    type="text"
                    :placeholder="t('dashboard.wallets.marketPlaceholder')"
                    class="admin-input"
                  />
                </label>
                <span class="hint">{{ t('dashboard.wallets.marketHint') }}</span>

                <label class="market-field">
                  {{ t('dashboard.wallets.minAmountLabel') }}
                  <input
                    v-model="newWalletMinAmount"
                    type="number"
                    min="0"
                    :step="selectedNewWalletType ? amountStep(selectedNewWalletType.currency) : '0.01'"
                    class="admin-input"
                  />
                </label>
                <label class="market-field">
                  {{ t('dashboard.wallets.maxAmountLabel') }}
                  <input
                    v-model="newWalletMaxAmount"
                    type="number"
                    min="0"
                    :step="selectedNewWalletType ? amountStep(selectedNewWalletType.currency) : '0.01'"
                    class="admin-input"
                  />
                </label>

                <label v-if="showVirtualAmountField" class="market-field">
                  {{ t('dashboard.wallets.virtualAmountLabel') }}
                  <input
                    v-model="newWalletVirtualAmount"
                    type="number"
                    min="0"
                    :step="selectedNewWalletType ? amountStep(selectedNewWalletType.currency) : '0.01'"
                    :placeholder="t('dashboard.wallets.virtualAmountPlaceholder')"
                    class="admin-input"
                  />
                </label>

                <template v-if="showAutoWithdrawFields">
                  <div class="settlement-rows">
                    <span class="hint">{{ t('dashboard.settlement.walletHint') }}</span>
                    <div v-for="(row, i3) in newWalletSettlementAccounts" :key="i3" class="settlement-row">
                      <input v-model="row.iban" type="text" :placeholder="t('dashboard.settlement.ibanPlaceholder')" class="admin-input" />
                      <input v-model="row.label" type="text" :placeholder="t('dashboard.settlement.labelPlaceholder')" class="admin-input" />
                      <input v-model="row.percent" type="number" min="0" max="100" :placeholder="t('dashboard.settlement.percentPlaceholder')" class="admin-input" />
                      <button type="button" class="admin-btn admin-btn-ghost" @click="removeSettlementAccountRow(i3)">{{ t('dashboard.settlement.remove') }}</button>
                    </div>
                    <button type="button" class="admin-btn admin-btn-ghost" @click="addSettlementAccountRow">
                      {{ t('dashboard.settlement.addAccount') }}
                    </button>
                  </div>

                  <label class="market-field">
                    {{ t('dashboard.settlement.railLabel') }}
                    <select v-model="newWalletRailType" class="admin-input">
                      <option value="">{{ t('dashboard.settlement.railPlaceholder') }}</option>
                      <option value="POL_PAY">{{ t('dashboard.settlement.rail.POL_PAY') }}</option>
                      <option value="PAYA">{{ t('dashboard.settlement.rail.PAYA') }}</option>
                      <option value="SATNA">{{ t('dashboard.settlement.rail.SATNA') }}</option>
                      <option value="BANK_TRANSFER">{{ t('dashboard.settlement.rail.BANK_TRANSFER') }}</option>
                    </select>
                  </label>
                  <label v-if="newWalletRailType" class="market-field">
                    {{ t('dashboard.settlement.railScheduleLabel') }}
                    <input
                      v-model="newWalletRailScheduleTimes"
                      type="text"
                      :placeholder="t('dashboard.settlement.railSchedulePlaceholder')"
                      class="admin-input"
                    />
                    <span class="hint">
                      {{ newWalletRailType === 'BANK_TRANSFER' ? t('dashboard.settlement.railScheduleRequiredHint') : t('dashboard.settlement.railScheduleHint') }}
                    </span>
                  </label>
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
                  <label class="market-field">
                    {{ t('dashboard.wallets.terminalIdLabel') }}
                    <input v-model="newWalletTerminalId" type="text" class="admin-input" />
                  </label>
                  <label class="market-field">
                    {{ t('dashboard.wallets.acceptorCodeLabel') }}
                    <input v-model="newWalletAcceptorCode" type="text" class="admin-input" />
                  </label>
                  <label class="market-field">
                    {{ t('dashboard.wallets.storeNameLabel') }}
                    <input v-model="newWalletStoreName" type="text" class="admin-input" />
                  </label>
                  <label class="market-field">
                    {{ t('dashboard.wallets.storeSiteLabel') }}
                    <input v-model="newWalletStoreSite" type="url" class="admin-input" />
                  </label>
                  <label class="market-field">
                    {{ t('dashboard.wallets.allowedIpsLabel') }}
                    <input v-model="newWalletAllowedIps" type="text" :placeholder="t('dashboard.wallets.allowedIpsPlaceholder')" class="admin-input" />
                  </label>
                  <label class="market-field">
                    {{ t('dashboard.wallets.callbackUrlLabel') }}
                    <input v-model="newWalletCallbackUrl" type="url" class="admin-input" />
                  </label>
                  <label class="market-field">
                    {{ t('dashboard.wallets.categoryLabel') }}
                    <input v-model="newWalletCategory" type="text" class="admin-input" />
                  </label>
                  <label class="market-field">
                    {{ t('dashboard.wallets.subCategoryLabel') }}
                    <input v-model="newWalletSubCategory" type="text" class="admin-input" />
                  </label>
                </template>

                <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">{{ t('dashboard.wallets.add') }}</button>
              </form>
            </div>
          </article>
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
          <ActivityChart :transactions="wallet.transactions" />
        </div>
        <div class="admin-card">
          <h2>{{ t('dashboard.latestTransactionHeading') }}</h2>
          <template v-if="latestCluster">
            <div class="latest-amount" :class="isIncoming(latestCluster.primary) ? 'money-in' : 'money-out'">
              {{ isIncoming(latestCluster.primary) ? '+' : '−' }} {{ formatTransactionAmount(latestCluster.primary) }}
            </div>
            <div v-if="formatTransactionAmountWords(latestCluster.primary)" class="amount-words">{{ formatTransactionAmountWords(latestCluster.primary) }}</div>
            <div class="latest-meta">{{ describeTransaction(latestCluster.primary) }}</div>

            <div class="latest-detail">
              <div v-if="latestCluster.primary.fromWalletId && findWallet(latestCluster.primary.fromWalletId)" class="history-detail-row">
                <span>{{ t('transaction.fromWallet') }}</span>
                <div class="party-cell">
                  <span class="party-label">{{ walletDisplayName(findWallet(latestCluster.primary.fromWalletId)!) }} ({{ findWallet(latestCluster.primary.fromWalletId)!.walletType.currency.code }})</span>
                  <span class="money-chip money-out">− {{ formatTransactionAmount(latestCluster.primary) }}</span>
                </div>
              </div>
              <div v-else-if="latestCluster.primary.fromWalletId" class="history-detail-row">
                <span>{{ t('transaction.fromWallet') }}</span>
                <span>{{ latestCluster.primary.type === 'PURCHASE' ? t('transaction.direction.merchant') : t('dashboard.history.otherWallet') }}</span>
              </div>
              <div v-else class="history-detail-row">
                <span>{{ t('transaction.fromWallet') }}</span>
                <span>{{ t('dashboard.history.externalSource') }}</span>
              </div>

              <div v-if="latestCluster.primary.toWalletId && findWallet(latestCluster.primary.toWalletId)" class="history-detail-row">
                <span>{{ t('transaction.toWallet') }}</span>
                <div class="party-cell">
                  <span class="party-label">{{ walletDisplayName(findWallet(latestCluster.primary.toWalletId)!) }} ({{ findWallet(latestCluster.primary.toWalletId)!.walletType.currency.code }})</span>
                  <span class="money-chip money-in">+ {{ formatTransactionAmount(latestCluster.primary) }}</span>
                </div>
              </div>
              <div v-else-if="latestCluster.primary.toWalletId" class="history-detail-row">
                <span>{{ t('transaction.toWallet') }}</span>
                <span>{{ latestCluster.primary.type === 'PURCHASE' ? t('transaction.direction.merchant') : t('dashboard.history.otherWallet') }}</span>
              </div>
              <div v-else class="history-detail-row">
                <span>{{ t('transaction.toWallet') }}</span>
                <span>{{ t('dashboard.history.externalDestination') }}</span>
              </div>

              <div class="history-detail-row">
                <span>{{ t('transaction.date') }}</span>
                <span>{{ formatDateTime(latestCluster.primary.createdAt) }}</span>
              </div>
              <div class="history-detail-row">
                <span>{{ t('transaction.note') }}</span>
                <span>{{ latestCluster.primary.note ?? t('common.none') }}</span>
              </div>
              <div class="history-detail-row">
                <span>{{ t('transaction.transactionId') }}</span>
                <span class="mono-id">{{ latestCluster.primary.id }}</span>
              </div>
            </div>

            <router-link :to="{ name: 'transaction-detail', params: { id: latestCluster.primary.id } }" class="history-detail-link">
              {{ t('dashboard.history.openFullPage') }}
            </router-link>
          </template>
          <p v-else class="history-empty">{{ t('dashboard.latestTransactionEmpty') }}</p>
        </div>
      </div>
    </div>

    <div class="admin-grid admin-grid-2">
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

          <div class="settlement-rows">
            <span class="hint">{{ t('dashboard.charge.settlementHint') }}</span>
            <div v-for="(row, i) in chargeSettlementSplits" :key="i" class="settlement-row">
              <input v-model="row.iban" type="text" :placeholder="t('dashboard.settlement.ibanPlaceholder')" class="admin-input" />
              <input v-model="row.label" type="text" :placeholder="t('dashboard.settlement.labelPlaceholder')" class="admin-input" />
              <select v-model="row.type" class="admin-input">
                <option value="PERCENT">{{ t('dashboard.settlement.percent') }}</option>
                <option value="FIXED">{{ t('dashboard.settlement.fixed') }}</option>
              </select>
              <input
                v-model="row.value"
                type="number"
                min="0"
                :placeholder="row.type === 'PERCENT' ? t('dashboard.settlement.percentPlaceholder') : t('dashboard.settlement.amountPlaceholder')"
                class="admin-input"
              />
              <button type="button" class="admin-btn admin-btn-ghost" @click="removeChargeSplitRow(i)">{{ t('dashboard.settlement.remove') }}</button>
            </div>
            <button type="button" class="admin-btn admin-btn-ghost" @click="addChargeSplitRow">
              {{ t('dashboard.settlement.addSplit') }}
            </button>
          </div>

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

      <div v-if="repositoryWallets.length" class="admin-card">
        <h2>{{ t('dashboard.grantCredit.title') }}</h2>
        <p class="hint">{{ t('dashboard.grantCredit.hint') }}</p>
        <form class="charge-form" @submit.prevent="onGrantCredit">
          <select v-model="grantRepositoryWalletId" class="admin-input" required>
            <option value="" disabled>{{ t('dashboard.grantCredit.repositoryPlaceholder') }}</option>
            <option v-for="w in repositoryWallets" :key="w.id" :value="w.id">{{ walletLabel(w) }}</option>
          </select>
          <input
            v-model="grantPersonnelPhone"
            type="tel"
            :placeholder="t('dashboard.grantCredit.phonePlaceholder')"
            class="admin-input"
            required
          />
          <select v-model="grantWalletTypeId" class="admin-input" required>
            <option value="" disabled>{{ t('dashboard.grantCredit.walletTypePlaceholder') }}</option>
            <option v-for="wt in creditWalletTypes" :key="wt.id" :value="wt.id">{{ wt.name }} ({{ wt.currency.code }})</option>
          </select>
          <input
            v-model="grantVirtualAmount"
            type="number"
            min="0"
            :step="grantAmountStep"
            :placeholder="t('dashboard.grantCredit.amountPlaceholder')"
            class="admin-input"
            required
          />
          <input
            v-model="grantNationalCode"
            type="text"
            :placeholder="t('dashboard.grantCredit.nationalCodePlaceholder')"
            class="admin-input"
          />
          <button type="submit" class="admin-btn admin-btn-primary" :disabled="grantBusy">
            {{ t('dashboard.grantCredit.submit') }}
          </button>
        </form>
        <p v-if="grantError" class="admin-error">{{ grantError }}</p>
        <p v-if="grantSuccess" class="phone-success">{{ grantSuccess }}</p>
      </div>
    </div>

    <div class="admin-card">
      <div class="filter-row">
        <h2>{{ t('dashboard.history.allTransactions', { count: historySorted.length }) }}</h2>
        <input v-model="historySearch" class="admin-input" :placeholder="t('dashboard.history.searchPlaceholder')" />
      </div>

      <div class="history-list">
        <div v-for="cluster in historyClusters" :key="cluster.root" class="history-row-wrap">
          <button type="button" class="history-row" @click="toggleTx(cluster.root)">
            <span class="history-row-icon" :class="transactionTypeClass(cluster.primary.type)">
              <svg v-if="cluster.primary.type === 'DEPOSIT'" viewBox="0 0 24 24" fill="none"><path d="M12 4v11m0 0 4-4m-4 4-4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              <svg v-else-if="cluster.primary.type === 'WITHDRAW'" viewBox="0 0 24 24" fill="none"><path d="M12 15V4m0 0-4 4m4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              <svg v-else-if="cluster.primary.type === 'TRANSFER'" viewBox="0 0 24 24" fill="none"><path d="M4 8h13m0 0-3.5-3.5M17 8l-3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 16H7m0 0 3.5-3.5M7 16l3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <svg v-else-if="cluster.primary.type === 'PURCHASE'" viewBox="0 0 24 24" fill="none"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 8h6M9 12h6M9 16h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
              <svg v-else-if="cluster.primary.type === 'ADJUSTMENT'" viewBox="0 0 24 24" fill="none"><path d="M4 6h9m-9 6h16M4 18h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="6" r="2.2" fill="currentColor"/><circle cx="8" cy="18" r="2.2" fill="currentColor"/></svg>
              <svg v-else viewBox="0 0 24 24" fill="none"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </span>
            <span class="history-row-main">
              <span class="history-row-desc">
                {{ describeTransaction(cluster.primary) }}
                <span v-if="cluster.items.length > 1" class="history-row-badge">+{{ cluster.items.length - 1 }}</span>
              </span>
              <span class="history-row-date">{{ formatDateTime(cluster.primary.createdAt) }}</span>
            </span>
            <span class="history-row-amount" :class="isIncoming(cluster.primary) ? 'money-in' : 'money-out'">
              {{ isIncoming(cluster.primary) ? '+' : '−' }} {{ formatTransactionAmount(cluster.primary) }}
            </span>
            <span class="admin-badge" :class="transactionStatusClass(cluster.primary.status)">{{ t(`dashboard.history.status${cluster.primary.status}`) }}</span>
          </button>

          <div v-if="expandedTx.has(cluster.root)" class="history-detail">
            <div v-if="cluster.primary.fromWalletId && findWallet(cluster.primary.fromWalletId)" class="history-detail-row">
              <span>{{ t('transaction.fromWallet') }}</span>
              <div class="party-cell">
                <span class="party-label">{{ walletDisplayName(findWallet(cluster.primary.fromWalletId)!) }} ({{ findWallet(cluster.primary.fromWalletId)!.walletType.currency.code }})</span>
                <span class="money-chip money-out">− {{ formatTransactionAmount(cluster.primary) }}</span>
              </div>
            </div>
            <div v-else-if="cluster.primary.fromWalletId" class="history-detail-row">
              <span>{{ t('transaction.fromWallet') }}</span>
              <span>{{ cluster.primary.type === 'PURCHASE' ? t('transaction.direction.merchant') : t('dashboard.history.otherWallet') }}</span>
            </div>
            <div v-else class="history-detail-row">
              <span>{{ t('transaction.fromWallet') }}</span>
              <span>{{ t('dashboard.history.externalSource') }}</span>
            </div>

            <div v-if="cluster.primary.toWalletId && findWallet(cluster.primary.toWalletId)" class="history-detail-row">
              <span>{{ t('transaction.toWallet') }}</span>
              <div class="party-cell">
                <span class="party-label">{{ walletDisplayName(findWallet(cluster.primary.toWalletId)!) }} ({{ findWallet(cluster.primary.toWalletId)!.walletType.currency.code }})</span>
                <span class="money-chip money-in">+ {{ formatTransactionAmount(cluster.primary) }}</span>
              </div>
            </div>
            <div v-else-if="cluster.primary.toWalletId" class="history-detail-row">
              <span>{{ t('transaction.toWallet') }}</span>
              <span>{{ cluster.primary.type === 'PURCHASE' ? t('transaction.direction.merchant') : t('dashboard.history.otherWallet') }}</span>
            </div>
            <div v-else class="history-detail-row">
              <span>{{ t('transaction.toWallet') }}</span>
              <span>{{ t('dashboard.history.externalDestination') }}</span>
            </div>

            <div v-if="formatTransactionAmountWords(cluster.primary)" class="history-detail-row">
              <span>{{ t('dashboard.history.tableAmount') }}</span>
              <span>{{ formatTransactionAmount(cluster.primary) }} · {{ formatTransactionAmountWords(cluster.primary) }}</span>
            </div>
            <div class="history-detail-row">
              <span>{{ t('transaction.note') }}</span>
              <span>{{ cluster.primary.note ?? t('common.none') }}</span>
            </div>
            <div class="history-detail-row">
              <span>{{ t('transaction.transactionId') }}</span>
              <span class="mono-id">{{ cluster.primary.id }}</span>
            </div>

            <div v-if="cluster.items.length > 1" class="history-breakdown">
              <p class="history-breakdown-title">{{ t('dashboard.history.breakdownTitle') }}</p>
              <div v-for="leg in cluster.items" :key="leg.id" class="history-breakdown-row">
                <span class="admin-badge" :class="transactionTypeClass(leg.type)">{{ t(`dashboard.history.${leg.type.toLowerCase()}`) }}</span>
                <span class="history-breakdown-desc">{{ describeTransaction(leg) }}</span>
                <span class="history-breakdown-amount" :class="isIncoming(leg) ? 'money-in' : 'money-out'">
                  {{ isIncoming(leg) ? '+' : '−' }} {{ formatTransactionAmount(leg) }}
                </span>
              </div>
            </div>

            <router-link :to="{ name: 'transaction-detail', params: { id: cluster.primary.id } }" class="history-detail-link">
              {{ t('dashboard.history.openFullPage') }}
            </router-link>
          </div>
        </div>

        <p v-if="!historyClusters.length" class="history-empty">{{ t('dashboard.history.empty') }}</p>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped>
.hero-eyebrow {
  font-size: 0.78rem;
  color: var(--accent-blue);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
}

.wallet-hero-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  align-self: start;
}

.wallet-hero-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.wallet-hero-head h2 {
  margin: 4px 0 0;
}

/* Item 3: wallets stack like cards in a wallet — peeking behind the top
   one until the stack is hovered, pinned open, or a card inside it needs
   attention (editing, an inline action form). */
/* Item: the wallet stack is capped so the payment-card visual stays a
   sensible size on wide desktop columns; on narrow/mobile viewports the
   container itself is narrower than the cap, so the card just fills it. */
.wallet-stack {
  display: flex;
  flex-direction: column;
  max-width: 440px;
}
.wallet-card {
  position: relative;
  transition: margin-top 260ms ease;
}
/* A percentage margin-top resolves against the *containing block's width*,
   not the element's own height — exploited here so each card overlaps the
   one before it by a fixed fraction of the (fluid) card width, leaving a
   proportional sliver visible no matter the viewport size. */
.wallet-stack:not(.expanded) .wallet-card:not(:first-child) {
  margin-top: -50%;
}
.wallet-stack.expanded .wallet-card:not(:first-child) {
  margin-top: 14px;
}
.wallet-stack .wallet-card:first-child {
  margin-top: 0 !important;
}
.wallet-card.is-peek .card-body {
  display: none;
}

/* Real-hover devices (a mouse, not a finger) also get pointer-driven
   expand — CSS `:hover`, not JS state, so it always tracks the live
   cursor with no way to get stuck open the way a tap's synthetic hover
   can on touch. Touch/no-hover devices rely solely on tapping a card or
   the "Show all wallets" button (stackPinned) — see the note by
   stackExpanded's declaration. */
@media (hover: hover) and (pointer: fine) {
  .wallet-stack:not(.expanded):hover .wallet-card:not(:first-child) {
    margin-top: 14px;
  }
  .wallet-stack:not(.expanded):hover .wallet-card.is-peek .card-body {
    display: flex;
  }
  .wallet-stack:not(.expanded) .card-face:hover {
    transform: translateY(-3px);
  }
}
.card-face:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}

/* The payment-card face itself: fixed aspect ratio so it always reads as
   a card, a deterministic gradient per wallet type, a chip + masked
   number + balance + wallet/currency row like a real bank card. */
.card-face {
  position: relative;
  width: 100%;
  aspect-ratio: 1.95 / 1;
  border-radius: 22px;
  padding: 18px 22px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  color: #fff;
  overflow: hidden;
  cursor: pointer;
  box-shadow: 0 16px 32px -18px rgba(20, 30, 70, 0.55);
  transition: transform 200ms ease, box-shadow 200ms ease;
  font-family: inherit;
  border: none;
  text-align: start;
}
.card-face::before {
  content: '';
  position: absolute;
  inset: -35% -15% auto auto;
  width: 60%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.18), transparent 70%);
  pointer-events: none;
}
.card-face-top {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.card-face-type {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  opacity: 0.85;
}
.card-face-currency-pill {
  flex: none;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  background: rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  padding: 3px 10px;
}
.card-brand-mark {
  flex: none;
  display: flex;
  align-items: center;
}
.card-brand-mark i {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.6);
  display: block;
  font-style: normal;
}
.card-brand-mark i + i {
  margin-inline-start: -10px;
  background: rgba(255, 255, 255, 0.9);
}
.card-brand-image {
  flex: none;
  height: 28px;
  max-width: 64px;
  width: auto;
  object-fit: contain;
}

.card-face-balance {
  position: relative;
  font-size: 1.7rem;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-face-number {
  position: relative;
  font-family: 'Courier New', monospace;
  font-size: 0.9rem;
  letter-spacing: 0.1em;
  opacity: 0.85;
}
.card-face-bottom {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.card-face-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.92rem;
  font-weight: 600;
}

.card-face-add {
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--panel-bg);
  border: 1.5px dashed var(--card-border);
  color: var(--text-dim);
  box-shadow: none;
  font-weight: 600;
  font-size: 0.88rem;
}
.card-face-add:hover {
  border-color: var(--accent-blue);
  color: var(--accent-blue);
}
.card-face-add-icon {
  font-size: 1.3rem;
  line-height: 1;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 2px 4px;
}

.wallet-card-add-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

@media (max-width: 420px) {
  .card-face {
    padding: 14px 16px;
    border-radius: 14px;
  }
  .card-face-balance {
    font-size: 1.2rem;
  }
  .card-face-number {
    font-size: 0.8rem;
    letter-spacing: 0.1em;
  }
}

.wallet-quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px dashed var(--card-border);
}
.wallet-quick-actions .admin-btn.active {
  background: var(--hover-tint, rgba(21, 80, 201, 0.1));
  color: var(--accent-blue);
  border-color: var(--accent-blue);
}
.wallet-inline-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 10px;
  background: var(--panel-bg);
  border-radius: var(--radius-sm);
}
.wallet-inline-form input,
.wallet-inline-form select {
  flex: 1;
  min-width: 140px;
}

.hero-pills {
  display: flex;
  flex-wrap: wrap;
  background: var(--panel-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  gap: 16px 28px;
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

.latest-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--divider);
}

.installment-status-paid {
  color: var(--accent-lime);
}
.installment-status-overdue {
  color: var(--accent-red);
}
.installment-status-pending {
  color: var(--text-dim);
}

.wallet-type {
  font-size: 0.72rem;
  color: var(--text-dimmer);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.wallet-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.wallet-edit-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px dashed var(--card-border);
}
.wallet-edit-form label,
.market-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--text-dim);
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
.settlement-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 10px;
  border: 1px dashed var(--card-border);
  border-radius: var(--radius-sm);
}
.settlement-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.settlement-row input,
.settlement-row select {
  flex: 1;
  min-width: 100px;
}
.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 12px;
  flex-wrap: wrap;
}
.filter-row h2 {
  margin: 0;
  white-space: nowrap;
}

.history-list {
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.history-row-wrap {
  border-bottom: 1px solid var(--divider);
}
.history-row-wrap:last-child {
  border-bottom: none;
}
.history-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: start;
  color: var(--text);
  font: inherit;
}
.history-row:hover {
  background: var(--hover-tint, rgba(127, 127, 127, 0.06));
}
.history-row-icon {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.history-row-icon svg {
  width: 18px;
  height: 18px;
}
.history-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.history-row-desc {
  font-size: 0.88rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}
.history-row-badge {
  flex: none;
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--accent-blue);
  background: var(--badge-tint-blue, rgba(122, 162, 255, 0.15));
  border-radius: 999px;
  padding: 1px 7px;
}
.history-row-date {
  font-size: 0.74rem;
  color: var(--text-dimmer);
}
.history-row-amount {
  flex: none;
  font-weight: 700;
  font-size: 0.9rem;
}

/* Icon + description/date + amount + status badge is too much for one
   row on a phone width — the date was getting overlapped by the amount.
   Let the row wrap: description/date keep the first line, amount +
   status move to their own line, pushed to the end. */
@media (max-width: 480px) {
  .history-row {
    flex-wrap: wrap;
    row-gap: 4px;
  }
  .history-row-main {
    flex-basis: 100%;
  }
  .history-row-amount {
    margin-inline-start: auto;
  }
}
.history-detail {
  padding: 4px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--panel-bg, transparent);
}
.history-detail-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.84rem;
}
.history-detail-row > span:first-child {
  color: var(--text-dim);
  flex: none;
}
.history-detail-link {
  align-self: flex-start;
  font-size: 0.82rem;
  color: var(--accent-blue);
  text-decoration: underline;
}
.history-breakdown {
  border-top: 1px dashed var(--divider);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.history-breakdown-title {
  margin: 0;
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.history-breakdown-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
}
.history-breakdown-desc {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-breakdown-amount {
  flex: none;
  font-weight: 600;
}
.history-empty {
  color: var(--text-dim);
  text-align: center;
  padding: 20px 0;
}
.charge-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 10px 0;
}
.charge-form input,
.charge-form select {
  width: 100%;
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
