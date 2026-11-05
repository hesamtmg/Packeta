<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError, API_URL, postMultipart } from '../../api/client';
import { amountStep, toMinorUnits, type CurrencyInfo } from '../../utils/currency';
import type { SettlementRailType } from '../../stores/wallet';
import { CARD_THEME_OPTIONS, cardGradient } from '../../utils/cardTheme';
import { useAuthStore } from '../../stores/auth';
import AdminLayout from '../../components/admin/AdminLayout.vue';

const { t } = useI18n();
const auth = useAuthStore();

interface WalletType {
  id: string;
  code: string;
  name: string;
  currency: CurrencyInfo;
  // Card appearance every wallet of this type's dashboard card picks up
  // automatically (see frontend/src/utils/cardTheme.ts) — both null until set.
  cardColor: string | null;
  cardImageFilename: string | null;
  allowNegativeBalance: boolean;
  // Minor units, as a string.
  creditLimit: string | null;
  allowWithdraw: boolean;
  allowP2pOut: boolean;
  allowP2pIn: boolean;
  supportsAutoWithdraw: boolean;
  autoWithdrawTimes: string[] | null;
  allowPurchaseOut: boolean;
  allowPurchaseIn: boolean;
  depositable: boolean;
  // A new self-service signup automatically gets a wallet of every starter type.
  isStarterType: boolean;
  // Wallets of this type may carry a manually-set virtual balance at creation
  // (e.g. a REPOSITORY wallet's funding pool).
  hasVirtualBalance: boolean;
  // Hidden from a customer's own wallets/transactions lists; admin unaffected.
  hiddenFromCustomer: boolean;
  // Wallet-viewing widget (sdk/js/wallet-widget.js) — only meaningful on
  // MERCHANT-code types, enforced server-side.
  allowWidget: boolean;
  widgetRequiresOtp: boolean;
  // Credit-line / installment billing rules shared by every wallet of this
  // type. feePercent / penaltyPercentPerDay are percentages (0-100, up to 3
  // decimals), unblockFee is minor units. overdueDaysBeforeBlock is how long
  // an installment may stay OVERDUE before the wallet is blocked (see backend
  // InstallmentsService.applyOverduePenalties).
  installmentDate: number | null;
  paymentDeadlineDate: number | null;
  feePercent: string | null;
  penaltyPercentPerDay: string | null;
  unblockFee: string | null;
  installmentCount: number | null;
  overdueDaysBeforeBlock: number | null;
  // Where an installment repayment's fee/penalty/unblock-fee slices are routed
  // instead of the credit wallet's backing repository — each must be a
  // MERCHANT_REPOSITORY wallet in this type's currency (see backend
  // WalletTypesService.validateSubRepository). Null keeps the main repository.
  feeRepositoryWalletId: string | null;
  penaltyRepositoryWalletId: string | null;
  unblockFeeRepositoryWalletId: string | null;
  // Merchant (supportsAutoWithdraw) types only: which payout rails a merchant
  // may pick, and what each payout over that rail costs — feePercent of the
  // payout plus fixedFee (minor units), moved into feeRepositoryWalletId (a
  // MERCHANT_REPOSITORY wallet in this currency). Null = every rail, no fee.
  withdrawalMethods: WithdrawalMethod[] | null;
}

interface WithdrawalMethod {
  railType: SettlementRailType;
  enabled: boolean;
  feePercent: string;
  fixedFee: string;
  feeRepositoryWalletId: string | null;
}

// Draft row: fixedFee is in major units, like every other money field here.
interface WithdrawalMethodDraft {
  railType: SettlementRailType;
  enabled: boolean;
  feePercent: string;
  fixedFee: string;
  feeRepositoryWalletId: string;
}

const WITHDRAWAL_RAILS: SettlementRailType[] = ['POL_PAY', 'PAYA', 'SATNA', 'BANK_TRANSFER'];

function defaultWithdrawalMethods(): WithdrawalMethodDraft[] {
  return WITHDRAWAL_RAILS.map((railType) => ({
    railType,
    enabled: true,
    feePercent: '',
    fixedFee: '',
    feeRepositoryWalletId: '',
  }));
}

type BoolKey =
  | 'allowNegativeBalance'
  | 'allowWithdraw'
  | 'allowP2pOut'
  | 'allowP2pIn'
  | 'supportsAutoWithdraw'
  | 'allowPurchaseOut'
  | 'allowPurchaseIn'
  | 'depositable'
  | 'isStarterType'
  | 'hasVirtualBalance'
  | 'hiddenFromCustomer'
  | 'allowWidget'
  | 'widgetRequiresOtp';

// One editable shape for both "create" and "edit" — every number is kept as
// the string the input holds, and money fields are in major units, so the
// form binds with plain v-model and conversion happens once, in toPayload().
interface Draft extends Record<BoolKey, boolean> {
  code: string;
  name: string;
  currencyCode: string;
  cardColor: string;
  creditLimit: string;
  autoWithdrawTimes: string[];
  enableCreditLine: boolean;
  installmentDate: string;
  paymentDeadlineDate: string;
  installmentCount: string;
  feePercent: string;
  penaltyPercentPerDay: string;
  unblockFee: string;
  overdueDaysBeforeBlock: string;
  feeRepositoryWalletId: string;
  penaltyRepositoryWalletId: string;
  unblockFeeRepositoryWalletId: string;
  // Off = every rail allowed with no fee (sends an empty list).
  manageWithdrawalMethods: boolean;
  withdrawalMethods: WithdrawalMethodDraft[];
}

// The seeded built-in codes (see backend WalletTypeCode) — offered as
// suggestions; a custom code is still valid.
const KNOWN_WALLET_TYPE_CODES = [
  'BUY',
  'SELL',
  'CREDIT',
  'GIFT',
  'MERCHANT',
  'REPOSITORY',
  'SUPPORT',
  'MERCHANT_REPOSITORY',
];

function emptyDraft(): Draft {
  return {
    code: '',
    name: '',
    currencyCode: '',
    cardColor: '',
    allowNegativeBalance: false,
    creditLimit: '',
    allowWithdraw: true,
    allowP2pOut: false,
    allowP2pIn: false,
    supportsAutoWithdraw: false,
    autoWithdrawTimes: ['', '', ''],
    allowPurchaseOut: false,
    allowPurchaseIn: false,
    depositable: true,
    isStarterType: false,
    hasVirtualBalance: false,
    hiddenFromCustomer: false,
    allowWidget: false,
    widgetRequiresOtp: true,
    enableCreditLine: false,
    installmentDate: '',
    paymentDeadlineDate: '',
    installmentCount: '',
    feePercent: '',
    penaltyPercentPerDay: '',
    unblockFee: '',
    overdueDaysBeforeBlock: '',
    feeRepositoryWalletId: '',
    penaltyRepositoryWalletId: '',
    unblockFeeRepositoryWalletId: '',
    manageWithdrawalMethods: false,
    withdrawalMethods: defaultWithdrawalMethods(),
  };
}

function minorToMajor(value: string | null, currency: CurrencyInfo): string {
  if (!value) return '';
  return (Number(value) / 10 ** currency.decimalPlaces).toFixed(currency.decimalPlaces);
}

const str = (v: number | string | null) => (v == null ? '' : String(v));

function hasCreditLineFields(type: WalletType): boolean {
  return [
    type.installmentDate,
    type.paymentDeadlineDate,
    type.feePercent,
    type.penaltyPercentPerDay,
    type.unblockFee,
    type.installmentCount,
    type.overdueDaysBeforeBlock,
    type.feeRepositoryWalletId,
    type.penaltyRepositoryWalletId,
    type.unblockFeeRepositoryWalletId,
  ].some((v) => v != null);
}

function draftFromType(type: WalletType): Draft {
  const times = type.autoWithdrawTimes ?? [];
  return {
    code: type.code,
    name: type.name,
    currencyCode: type.currency.code,
    cardColor: type.cardColor ?? '',
    allowNegativeBalance: type.allowNegativeBalance,
    creditLimit: minorToMajor(type.creditLimit, type.currency),
    allowWithdraw: type.allowWithdraw,
    allowP2pOut: type.allowP2pOut,
    allowP2pIn: type.allowP2pIn,
    supportsAutoWithdraw: type.supportsAutoWithdraw,
    autoWithdrawTimes: [times[0] ?? '', times[1] ?? '', times[2] ?? ''],
    allowPurchaseOut: type.allowPurchaseOut,
    allowPurchaseIn: type.allowPurchaseIn,
    depositable: type.depositable,
    isStarterType: type.isStarterType,
    hasVirtualBalance: type.hasVirtualBalance,
    hiddenFromCustomer: type.hiddenFromCustomer,
    allowWidget: type.allowWidget,
    widgetRequiresOtp: type.widgetRequiresOtp,
    enableCreditLine: hasCreditLineFields(type),
    installmentDate: str(type.installmentDate),
    paymentDeadlineDate: str(type.paymentDeadlineDate),
    installmentCount: str(type.installmentCount),
    feePercent: str(type.feePercent),
    penaltyPercentPerDay: str(type.penaltyPercentPerDay),
    unblockFee: minorToMajor(type.unblockFee, type.currency),
    overdueDaysBeforeBlock: str(type.overdueDaysBeforeBlock),
    feeRepositoryWalletId: type.feeRepositoryWalletId ?? '',
    penaltyRepositoryWalletId: type.penaltyRepositoryWalletId ?? '',
    unblockFeeRepositoryWalletId: type.unblockFeeRepositoryWalletId ?? '',
    manageWithdrawalMethods: !!type.withdrawalMethods?.length,
    withdrawalMethods: WITHDRAWAL_RAILS.map((railType) => {
      const saved = type.withdrawalMethods?.find((m) => m.railType === railType);
      if (!saved) {
        // A rail missing from a saved config is not selectable.
        return {
          railType,
          enabled: !type.withdrawalMethods?.length,
          feePercent: '',
          fixedFee: '',
          feeRepositoryWalletId: '',
        };
      }
      return {
        railType,
        enabled: saved.enabled,
        feePercent: Number(saved.feePercent) ? String(Number(saved.feePercent)) : '',
        fixedFee: Number(saved.fixedFee) ? minorToMajor(saved.fixedFee, type.currency) : '',
        feeRepositoryWalletId: saved.feeRepositoryWalletId ?? '',
      };
    }),
  };
}

// Converts a draft to the request body. Credit-line fields are only sent when
// installment billing is on (undefined leaves them untouched server-side),
// matching the previous form's behaviour. autoWithdrawTimes: any fill sends
// all three slots, none sends [] to clear.
function toPayload(d: Draft, currency: CurrencyInfo | null, isCreate: boolean) {
  const credit = d.enableCreditLine;
  const num = (v: string) => (credit && v !== '' ? Number(v) : undefined);
  // On edit, an emptied picker sends '' so the server clears it back to the
  // main repository; on create, empty is simply omitted.
  const id = (v: string) => (credit && (v || !isCreate) ? v : undefined);
  const filledTimes = d.autoWithdrawTimes.filter(Boolean);
  const body: Record<string, unknown> = {
    name: d.name,
    allowNegativeBalance: d.allowNegativeBalance,
    creditLimit:
      d.allowNegativeBalance && currency ? toMinorUnits(d.creditLimit || '0', currency) : undefined,
    allowWithdraw: d.allowWithdraw,
    allowP2pOut: d.allowP2pOut,
    allowP2pIn: d.allowP2pIn,
    supportsAutoWithdraw: d.supportsAutoWithdraw,
    autoWithdrawTimes: filledTimes.length ? d.autoWithdrawTimes : [],
    allowPurchaseOut: d.allowPurchaseOut,
    allowPurchaseIn: d.allowPurchaseIn,
    depositable: d.depositable,
    isStarterType: d.isStarterType,
    hasVirtualBalance: d.hasVirtualBalance,
    hiddenFromCustomer: d.hiddenFromCustomer,
    allowWidget: d.allowWidget,
    widgetRequiresOtp: d.widgetRequiresOtp,
    installmentDate: num(d.installmentDate),
    paymentDeadlineDate: num(d.paymentDeadlineDate),
    installmentCount: num(d.installmentCount),
    feePercent: num(d.feePercent),
    penaltyPercentPerDay: num(d.penaltyPercentPerDay),
    unblockFee:
      credit && d.unblockFee !== '' && currency ? toMinorUnits(d.unblockFee, currency) : undefined,
    overdueDaysBeforeBlock: num(d.overdueDaysBeforeBlock),
    feeRepositoryWalletId: id(d.feeRepositoryWalletId),
    penaltyRepositoryWalletId: id(d.penaltyRepositoryWalletId),
    unblockFeeRepositoryWalletId: id(d.unblockFeeRepositoryWalletId),
  };
  // Only sent for merchant-style types; turning supportsAutoWithdraw off
  // clears the config server-side.
  if (d.supportsAutoWithdraw) {
    body.withdrawalMethods = d.manageWithdrawalMethods
      ? d.withdrawalMethods.map((m) => ({
          railType: m.railType,
          enabled: m.enabled,
          feePercent: m.feePercent !== '' ? Number(m.feePercent) : 0,
          fixedFee: m.fixedFee !== '' && currency ? toMinorUnits(m.fixedFee, currency) : 0,
          feeRepositoryWalletId: m.feeRepositoryWalletId || undefined,
        }))
      : [];
  }
  if (isCreate) {
    body.code = d.code.trim().toUpperCase();
    body.currencyCode = d.currencyCode;
    body.cardColor = d.cardColor || undefined;
  } else {
    // '' clears a previously chosen color back to Auto.
    body.cardColor = d.cardColor;
  }
  return body;
}

// ---- Presets (create only) -------------------------------------------------
// Starting points that set the code and the handful of switches that define
// each common kind of wallet; everything stays editable afterwards.
interface Preset {
  key: string;
  code: string;
  color: string;
  apply: Partial<Draft>;
}
const PRESETS: Preset[] = [
  {
    key: 'Standard',
    code: 'BUY',
    color: 'indigo',
    apply: { depositable: true, allowWithdraw: true, allowP2pOut: true, allowP2pIn: true, allowPurchaseOut: true },
  },
  {
    key: 'Credit',
    code: 'CREDIT',
    color: 'violet',
    apply: {
      depositable: false,
      allowWithdraw: false,
      allowPurchaseOut: true,
      allowNegativeBalance: true,
      enableCreditLine: true,
    },
  },
  {
    key: 'Merchant',
    code: 'MERCHANT',
    color: 'amber',
    apply: { depositable: false, allowWithdraw: true, allowPurchaseIn: true, allowWidget: true },
  },
  {
    key: 'Repository',
    code: 'REPOSITORY',
    color: 'teal',
    apply: { depositable: false, allowWithdraw: false, hasVirtualBalance: true, hiddenFromCustomer: true },
  },
];
const activePreset = ref<string | null>(null);

function applyPreset(p: Preset) {
  const fresh = emptyDraft();
  Object.assign(draft, fresh, {
    name: draft.name,
    currencyCode: draft.currencyCode,
    code: p.code,
    cardColor: p.color,
    ...p.apply,
  });
  activePreset.value = p.key;
}

// ---- Data ------------------------------------------------------------------
const types = ref<WalletType[]>([]);
const currencies = ref<CurrencyInfo[]>([]);
const loaded = ref(false);
const error = ref('');
const busy = ref(false);

async function loadTypes() {
  try {
    const [loadedTypes, loadedCurrencies] = await Promise.all([
      apiRequest<WalletType[]>('/wallet-types'),
      apiRequest<CurrencyInfo[]>('/currencies'),
    ]);
    types.value = loadedTypes;
    currencies.value = loadedCurrencies;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.walletTypes.loadFailed');
  } finally {
    loaded.value = true;
  }
}

function capabilityChips(type: WalletType): { label: string; tone?: string }[] {
  const chips: { label: string; tone?: string }[] = [];
  if (type.isStarterType) chips.push({ label: t('admin.walletTypes.chipStarter'), tone: 'info' });
  if (type.allowNegativeBalance) chips.push({ label: t('admin.walletTypes.chipCredit'), tone: 'violet' });
  if (hasCreditLineFields(type)) chips.push({ label: t('admin.walletTypes.chipInstallments'), tone: 'violet' });
  if (type.hiddenFromCustomer) chips.push({ label: t('admin.walletTypes.chipHidden'), tone: 'warning' });
  if (type.depositable) chips.push({ label: t('admin.walletTypes.chipDeposit') });
  if (type.allowWithdraw) chips.push({ label: t('admin.walletTypes.chipWithdraw') });
  if (type.supportsAutoWithdraw) chips.push({ label: t('admin.walletTypes.chipAuto') });
  if (type.withdrawalMethods?.length) {
    chips.push({
      label: t('admin.walletTypes.chipWithdrawalMethods', {
        count: type.withdrawalMethods.filter((m) => m.enabled).length,
      }),
    });
  }
  if (type.allowP2pOut) chips.push({ label: t('admin.walletTypes.chipSend') });
  if (type.allowP2pIn) chips.push({ label: t('admin.walletTypes.chipReceive') });
  if (type.allowPurchaseOut) chips.push({ label: t('admin.walletTypes.chipPurchase') });
  if (type.allowPurchaseIn) chips.push({ label: t('admin.walletTypes.chipMerchant') });
  if (type.hasVirtualBalance) chips.push({ label: t('admin.walletTypes.chipVirtual') });
  if (type.allowWidget) chips.push({ label: t('admin.walletTypes.chipWidget') });
  return chips;
}

function cardImageSrc(filename: string | null): string | null {
  return filename ? `${API_URL}/uploads/wallet-type-cards/${filename}` : null;
}

// ---- Editor ----------------------------------------------------------------
const editorOpen = ref(false);
const editing = ref<WalletType | null>(null); // null = creating
const draft = reactive<Draft>(emptyDraft());
const confirmingDelete = ref(false);
const editorError = ref('');

const isCreate = computed(() => editing.value === null);
const readOnly = computed(() => !auth.isSuperAdmin);
const draftCurrency = computed(
  () =>
    editing.value?.currency ??
    currencies.value.find((c) => c.code === draft.currencyCode) ??
    null,
);
const moneyStep = computed(() => (draftCurrency.value ? amountStep(draftCurrency.value) : '0.01'));
const currencyCodeLabel = computed(() => draftCurrency.value?.code ?? '');
const previewGradient = computed(() =>
  cardGradient({ code: draft.code || 'NEW', cardColor: draft.cardColor || null }, false),
);
const editorTitle = computed(() => {
  if (isCreate.value) return t('admin.walletTypes.newType');
  return readOnly.value ? t('admin.walletTypes.viewHeading') : t('admin.walletTypes.editHeading');
});

function openCreate() {
  editing.value = null;
  Object.assign(draft, emptyDraft());
  activePreset.value = null;
  openEditor();
}

function openEdit(type: WalletType) {
  editing.value = type;
  Object.assign(draft, draftFromType(type));
  openEditor();
}

// MERCHANT_REPOSITORY wallets a rail's fee can be routed into — only the
// super admin edits types, and their /admin/wallets listing is unscoped.
interface RepositoryOption {
  id: string;
  name: string | null;
  ownerEmail: string;
  closedAt: string | null;
  walletType: { code: string; currency: { code: string } };
}
const repositoryWallets = ref<RepositoryOption[]>([]);
let repositoryWalletsLoaded = false;
async function loadRepositoryWallets() {
  if (repositoryWalletsLoaded || !auth.isSuperAdmin) return;
  try {
    const wallets = await apiRequest<RepositoryOption[]>('/admin/wallets');
    repositoryWallets.value = wallets.filter(
      (w) => w.walletType.code === 'MERCHANT_REPOSITORY' && !w.closedAt,
    );
    repositoryWalletsLoaded = true;
  } catch {
    // Non-fatal: the picker just shows no options; the backend still validates.
  }
}
const feeRepositoryOptions = computed(() =>
  repositoryWallets.value.filter((w) => w.walletType.currency.code === draftCurrency.value?.code),
);
// Name only, so it fits the narrow column; the full id is in the tooltip.
function repositoryLabel(w: RepositoryOption): string {
  return w.name || w.ownerEmail;
}
function methodHasFee(m: WithdrawalMethodDraft): boolean {
  return Number(m.feePercent) > 0 || Number(m.fixedFee) > 0;
}

function openEditor() {
  loadRepositoryWallets();
  confirmingDelete.value = false;
  editorError.value = '';
  logoFile.value = undefined;
  editorOpen.value = true;
}

function closeEditor() {
  editorOpen.value = false;
}

async function submit() {
  editorError.value = '';
  busy.value = true;
  try {
    if (isCreate.value) {
      await apiRequest('/wallet-types', {
        method: 'POST',
        body: toPayload(draft, draftCurrency.value, true),
      });
    } else {
      await apiRequest(`/wallet-types/${editing.value!.id}`, {
        method: 'PATCH',
        body: toPayload(draft, draftCurrency.value, false),
      });
    }
    await loadTypes();
    closeEditor();
  } catch (err) {
    const fallback = isCreate.value ? 'admin.walletTypes.createFailed' : 'admin.walletTypes.saveFailed';
    editorError.value = err instanceof ApiError ? err.message : t(fallback);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!editing.value) return;
  if (!confirmingDelete.value) {
    confirmingDelete.value = true;
    return;
  }
  editorError.value = '';
  busy.value = true;
  try {
    await apiRequest(`/wallet-types/${editing.value.id}`, { method: 'DELETE' });
    await loadTypes();
    closeEditor();
  } catch (err) {
    editorError.value = err instanceof ApiError ? err.message : t('admin.walletTypes.deleteFailed');
    confirmingDelete.value = false;
  } finally {
    busy.value = false;
  }
}

// Card logo — uploaded straight away (own endpoint), only once a type exists.
const logoFile = ref<File | undefined>();
const logoBusy = ref(false);

async function onLogoSelected(event: Event) {
  logoFile.value = (event.target as HTMLInputElement).files?.[0];
  const type = editing.value;
  if (!logoFile.value || !type) return;
  editorError.value = '';
  logoBusy.value = true;
  try {
    const result = await postMultipart<{ cardImageFilename: string }>(
      `/wallet-types/${type.id}/card-image`,
      { image: logoFile.value },
    );
    type.cardImageFilename = result.cardImageFilename;
  } catch (err) {
    editorError.value =
      err instanceof ApiError ? err.message : t('admin.walletTypes.cardImageUploadFailed');
  } finally {
    logoBusy.value = false;
    logoFile.value = undefined;
    (event.target as HTMLInputElement).value = '';
  }
}

async function removeLogo() {
  const type = editing.value;
  if (!type) return;
  editorError.value = '';
  logoBusy.value = true;
  try {
    await apiRequest(`/wallet-types/${type.id}/card-image`, { method: 'DELETE' });
    type.cardImageFilename = null;
  } catch (err) {
    editorError.value =
      err instanceof ApiError ? err.message : t('admin.walletTypes.cardImageUploadFailed');
  } finally {
    logoBusy.value = false;
  }
}

// Switch rows, grouped by section, rendered from data so every toggle looks
// and behaves the same.
interface ToggleDef {
  key: BoolKey;
  title: string;
  hint: string;
}
const movementToggles = computed<ToggleDef[]>(() => [
  { key: 'depositable', title: t('admin.walletTypes.depositableTitle'), hint: t('admin.walletTypes.depositableHint') },
  { key: 'allowWithdraw', title: t('admin.walletTypes.allowWithdrawTitle'), hint: t('admin.walletTypes.allowWithdrawHint') },
  { key: 'supportsAutoWithdraw', title: t('admin.walletTypes.autoWithdrawTitle'), hint: t('admin.walletTypes.autoWithdrawHint') },
  { key: 'allowP2pOut', title: t('admin.walletTypes.p2pOutTitle'), hint: t('admin.walletTypes.p2pOutHint') },
  { key: 'allowP2pIn', title: t('admin.walletTypes.p2pInTitle'), hint: t('admin.walletTypes.p2pInHint') },
  { key: 'allowPurchaseOut', title: t('admin.walletTypes.purchaseOutTitle'), hint: t('admin.walletTypes.purchaseOutHint') },
  { key: 'allowPurchaseIn', title: t('admin.walletTypes.purchaseInTitle'), hint: t('admin.walletTypes.purchaseInHint') },
]);
const accessToggles = computed<ToggleDef[]>(() => [
  { key: 'isStarterType', title: t('admin.walletTypes.starterTitle'), hint: t('admin.walletTypes.starterHint') },
  { key: 'hiddenFromCustomer', title: t('admin.walletTypes.hiddenTitle'), hint: t('admin.walletTypes.hiddenHint') },
  { key: 'hasVirtualBalance', title: t('admin.walletTypes.virtualTitle'), hint: t('admin.walletTypes.virtualHint') },
  { key: 'allowWidget', title: t('admin.walletTypes.widgetTitle'), hint: t('admin.walletTypes.widgetHint') },
]);

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && editorOpen.value) closeEditor();
}
window.addEventListener('keydown', onKeydown);
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

loadTypes();
</script>

<template>
  <AdminLayout :title="t('admin.walletTypes.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <section class="admin-card">
      <div class="admin-card-head">
        <div>
          <h2>{{ t('admin.walletTypes.typesHeading', { count: types.length }) }}</h2>
          <p class="admin-card-sub">{{ t('admin.walletTypes.subtitle') }}</p>
        </div>
        <button v-if="auth.isSuperAdmin" type="button" class="admin-btn admin-btn-primary" @click="openCreate">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
          {{ t('admin.walletTypes.newType') }}
        </button>
      </div>
      <p v-if="!auth.isSuperAdmin" class="readonly-note">{{ t('admin.walletTypes.readOnlyHint') }}</p>

      <p v-if="loaded && !types.length" class="empty">{{ t('admin.walletTypes.emptyState') }}</p>

      <ul class="type-list">
        <li v-for="wt in types" :key="wt.id">
          <button type="button" class="type-row" @click="openEdit(wt)">
            <span class="mini-card" :style="{ background: cardGradient(wt, false) }">
              <img v-if="wt.cardImageFilename" :src="cardImageSrc(wt.cardImageFilename)!" alt="" />
              <span v-else>{{ wt.currency.symbol }}</span>
            </span>
            <span class="type-main">
              <span class="type-name">{{ wt.name }}</span>
              <span class="type-meta">
                <code>{{ wt.code }}</code>
                <span class="dot" />
                {{ wt.currency.code }}
              </span>
            </span>
            <span class="chips">
              <span
                v-for="chip in capabilityChips(wt)"
                :key="chip.label"
                class="admin-badge"
                :class="chip.tone ? `chip-${chip.tone}` : ''"
              >{{ chip.label }}</span>
            </span>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </li>
      </ul>
    </section>

    <!-- Editor slide-over (create + edit share it) -->
    <Teleport to="body">
      <div v-if="editorOpen" class="admin-theme editor-layer">
        <div class="editor-scrim" @click="closeEditor" />
        <form class="editor" role="dialog" aria-modal="true" :aria-label="editorTitle" @submit.prevent="submit">
          <header class="editor-head">
            <div>
              <span class="eyebrow">{{ isCreate ? t('admin.walletTypes.title') : `${editing!.code} · ${editing!.currency.code}` }}</span>
              <h2>{{ editorTitle }}</h2>
            </div>
            <button type="button" class="admin-icon-btn close-btn" :aria-label="t('admin.walletTypes.close')" @click="closeEditor">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </header>

          <div class="editor-body">
            <!-- Live preview -->
            <div class="preview-wrap">
              <div class="preview-card" :style="{ background: previewGradient }">
                <div class="preview-top">
                  <span class="preview-code">{{ draft.code || 'CODE' }}</span>
                  <img v-if="editing?.cardImageFilename" :src="cardImageSrc(editing.cardImageFilename)!" class="preview-logo" alt="" />
                </div>
                <span class="preview-label">{{ t('admin.walletTypes.previewBalance') }}</span>
                <span class="preview-amount">{{ draftCurrency?.symbol ?? '' }} 0{{ draftCurrency && draftCurrency.decimalPlaces ? '.' + '0'.repeat(draftCurrency.decimalPlaces) : '' }}</span>
                <span class="preview-name">{{ draft.name || t('admin.walletTypes.previewName') }}</span>
              </div>
            </div>

            <fieldset :disabled="readOnly" class="sections">
              <!-- Presets -->
              <section v-if="isCreate" class="section">
                <h3>{{ t('admin.walletTypes.presetHeading') }}</h3>
                <div class="presets">
                  <button
                    v-for="p in PRESETS"
                    :key="p.key"
                    type="button"
                    class="preset"
                    :class="{ active: activePreset === p.key }"
                    @click="applyPreset(p)"
                  >
                    <span class="preset-swatch" :style="{ background: cardGradient({ code: p.code, cardColor: p.color }, false) }" />
                    <span class="preset-title">{{ t(`admin.walletTypes.preset${p.key}`) }}</span>
                    <span class="preset-hint">{{ t(`admin.walletTypes.preset${p.key}Hint`) }}</span>
                  </button>
                </div>
              </section>

              <!-- Basics -->
              <section class="section">
                <h3>{{ t('admin.walletTypes.sectionBasics') }}</h3>
                <div class="form-grid">
                  <label class="field span-2">
                    {{ t('admin.walletTypes.nameLabel') }}
                    <input v-model="draft.name" type="text" class="admin-input" required :placeholder="t('admin.walletTypes.namePlaceholder')" />
                  </label>
                  <label class="field">
                    {{ t('admin.walletTypes.codeLabel') }}
                    <input
                      v-model="draft.code"
                      type="text"
                      class="admin-input mono"
                      required
                      list="wallet-type-codes"
                      :disabled="!isCreate"
                      :placeholder="t('admin.walletTypes.codePlaceholder')"
                      @input="activePreset = null"
                    />
                    <datalist id="wallet-type-codes">
                      <option v-for="code in KNOWN_WALLET_TYPE_CODES" :key="code" :value="code" />
                    </datalist>
                  </label>
                  <label class="field">
                    {{ t('admin.walletTypes.currencyLabel') }}
                    <select v-model="draft.currencyCode" class="admin-input" required :disabled="!isCreate">
                      <option value="" disabled>{{ t('admin.walletTypes.chooseCurrency') }}</option>
                      <option v-for="c in currencies" :key="c.code" :value="c.code">{{ c.code }}</option>
                    </select>
                  </label>
                  <span class="field-hint span-2">{{ isCreate ? t('admin.walletTypes.codeHint') : t('admin.walletTypes.lockedAfterCreate') }}</span>
                </div>
              </section>

              <!-- Money movement -->
              <section class="section">
                <h3>{{ t('admin.walletTypes.sectionMovement') }}</h3>
                <p class="section-hint">{{ t('admin.walletTypes.sectionMovementHint') }}</p>
                <div class="toggle-list">
                  <template v-for="item in movementToggles" :key="item.key">
                    <label class="toggle-row">
                      <span class="toggle-text">
                        <span class="toggle-title">{{ item.title }}</span>
                        <span class="toggle-hint">{{ item.hint }}</span>
                      </span>
                      <input v-model="draft[item.key]" type="checkbox" class="switch" />
                    </label>
                    <div v-if="item.key === 'supportsAutoWithdraw' && draft.supportsAutoWithdraw" class="nested">
                      <span class="nested-label">{{ t('admin.walletTypes.timesLabel') }}</span>
                      <div class="time-row">
                        <input v-for="i in 3" :key="i" v-model="draft.autoWithdrawTimes[i - 1]" type="time" class="admin-input" />
                      </div>
                    </div>
                    <div v-if="item.key === 'supportsAutoWithdraw' && draft.supportsAutoWithdraw" class="nested withdrawal-methods">
                      <label class="toggle-row nested-toggle">
                        <span class="toggle-text">
                          <span class="toggle-title">{{ t('admin.walletTypes.withdrawalMethodsTitle') }}</span>
                          <span class="toggle-hint">{{ t('admin.walletTypes.withdrawalMethodsHint') }}</span>
                        </span>
                        <input v-model="draft.manageWithdrawalMethods" type="checkbox" class="switch" />
                      </label>
                      <template v-if="draft.manageWithdrawalMethods">
                        <div v-for="m in draft.withdrawalMethods" :key="m.railType" class="method-row" :class="{ off: !m.enabled }">
                          <label class="method-head">
                            <input v-model="m.enabled" type="checkbox" />
                            <strong>{{ t(`dashboard.settlement.rail.${m.railType}`) }}</strong>
                            <span class="field-hint">{{ m.enabled ? t('admin.walletTypes.methodEnabled') : t('admin.walletTypes.methodDisabled') }}</span>
                          </label>
                          <div v-if="m.enabled" class="grid-3">
                            <label class="field">
                              {{ t('admin.walletTypes.methodFeePercent') }}
                              <span class="affix">
                                <input v-model="m.feePercent" type="number" min="0" max="100" step="0.001" class="admin-input" placeholder="0" />
                                <span class="suffix">%</span>
                              </span>
                            </label>
                            <label class="field">
                              {{ t('admin.walletTypes.methodFixedFee') }}
                              <span class="affix">
                                <input v-model="m.fixedFee" type="number" min="0" :step="moneyStep" class="admin-input" placeholder="0" />
                                <span class="suffix">{{ currencyCodeLabel }}</span>
                              </span>
                            </label>
                            <label class="field">
                              {{ t('admin.walletTypes.methodFeeRepository') }}
                              <select v-model="m.feeRepositoryWalletId" class="admin-input" :required="methodHasFee(m)">
                                <option value="">{{ t('admin.walletTypes.methodNoRepository') }}</option>
                                <option v-for="w in feeRepositoryOptions" :key="w.id" :value="w.id" :title="w.id">{{ repositoryLabel(w) }}</option>
                                <option
                                  v-if="m.feeRepositoryWalletId && !feeRepositoryOptions.some((w) => w.id === m.feeRepositoryWalletId)"
                                  :value="m.feeRepositoryWalletId"
                                >{{ m.feeRepositoryWalletId }}</option>
                              </select>
                            </label>
                          </div>
                        </div>
                        <p class="field-hint">{{ t('admin.walletTypes.withdrawalMethodsFeeHint') }}</p>
                        <p v-if="!feeRepositoryOptions.length" class="field-hint">{{ t('admin.walletTypes.methodNoRepositories') }}</p>
                      </template>
                    </div>
                  </template>
                </div>
              </section>

              <!-- Access -->
              <section class="section">
                <h3>{{ t('admin.walletTypes.sectionAccess') }}</h3>
                <div class="toggle-list">
                  <template v-for="item in accessToggles" :key="item.key">
                    <label class="toggle-row">
                      <span class="toggle-text">
                        <span class="toggle-title">{{ item.title }}</span>
                        <span class="toggle-hint">{{ item.hint }}</span>
                      </span>
                      <input v-model="draft[item.key]" type="checkbox" class="switch" />
                    </label>
                    <label v-if="item.key === 'allowWidget' && draft.allowWidget" class="toggle-row nested-toggle">
                      <span class="toggle-text">
                        <span class="toggle-title">{{ t('admin.walletTypes.widgetOtpTitle') }}</span>
                        <span class="toggle-hint">{{ t('admin.walletTypes.widgetOtpHint') }}</span>
                      </span>
                      <input v-model="draft.widgetRequiresOtp" type="checkbox" class="switch" />
                    </label>
                  </template>
                </div>
              </section>

              <!-- Credit -->
              <section class="section">
                <h3>{{ t('admin.walletTypes.sectionCredit') }}</h3>
                <div class="toggle-list">
                  <label class="toggle-row">
                    <span class="toggle-text">
                      <span class="toggle-title">{{ t('admin.walletTypes.negativeTitle') }}</span>
                      <span class="toggle-hint">{{ t('admin.walletTypes.negativeHint') }}</span>
                    </span>
                    <input v-model="draft.allowNegativeBalance" type="checkbox" class="switch" />
                  </label>
                  <div v-if="draft.allowNegativeBalance" class="nested">
                    <label class="field">
                      {{ t('admin.walletTypes.creditLimitShort') }}
                      <span class="affix">
                        <input v-model="draft.creditLimit" type="number" min="0" :step="moneyStep" class="admin-input" required />
                        <span class="suffix">{{ currencyCodeLabel }}</span>
                      </span>
                    </label>
                  </div>

                  <label class="toggle-row">
                    <span class="toggle-text">
                      <span class="toggle-title">{{ t('admin.walletTypes.installmentsTitle') }}</span>
                      <span class="toggle-hint">{{ t('admin.walletTypes.installmentsHint') }}</span>
                    </span>
                    <input v-model="draft.enableCreditLine" type="checkbox" class="switch" />
                  </label>
                  <div v-if="draft.enableCreditLine" class="nested credit-block">
                    <span class="nested-label">{{ t('admin.walletTypes.scheduleGroup') }}</span>
                    <div class="grid-3">
                      <label class="field">
                        {{ t('admin.walletTypes.generationDay') }}
                        <input v-model="draft.installmentDate" type="number" min="1" max="31" class="admin-input" :placeholder="t('admin.walletTypes.dayOfMonth')" />
                      </label>
                      <label class="field">
                        {{ t('admin.walletTypes.deadlineDay') }}
                        <input v-model="draft.paymentDeadlineDate" type="number" min="1" max="31" class="admin-input" :placeholder="t('admin.walletTypes.dayOfMonth')" />
                      </label>
                      <label class="field">
                        {{ t('admin.walletTypes.countShort') }}
                        <input v-model="draft.installmentCount" type="number" min="1" class="admin-input" />
                      </label>
                    </div>

                    <span class="nested-label">{{ t('admin.walletTypes.chargesGroup') }}</span>
                    <div class="form-grid">
                      <label class="field">
                        {{ t('admin.walletTypes.feeShort') }}
                        <span class="affix">
                          <input v-model="draft.feePercent" type="number" min="0" max="100" step="0.001" class="admin-input" />
                          <span class="suffix">%</span>
                        </span>
                      </label>
                      <label class="field">
                        {{ t('admin.walletTypes.penaltyShort') }}
                        <span class="affix">
                          <input v-model="draft.penaltyPercentPerDay" type="number" min="0" max="100" step="0.001" class="admin-input" />
                          <span class="suffix">%</span>
                        </span>
                      </label>
                      <span class="field-hint span-2">{{ t('admin.walletTypes.percentOfPrincipal') }}</span>
                      <label class="field">
                        {{ t('admin.walletTypes.unblockShort') }}
                        <span class="affix">
                          <input v-model="draft.unblockFee" type="number" min="0" :step="moneyStep" class="admin-input" />
                          <span class="suffix">{{ currencyCodeLabel }}</span>
                        </span>
                      </label>
                      <label class="field">
                        {{ t('admin.walletTypes.overdueShort') }}
                        <span class="affix">
                          <input v-model="draft.overdueDaysBeforeBlock" type="number" min="1" class="admin-input" />
                          <span class="suffix">{{ t('admin.walletTypes.daysSuffix') }}</span>
                        </span>
                      </label>
                    </div>

                    <details class="routing" :open="!!(draft.feeRepositoryWalletId || draft.penaltyRepositoryWalletId || draft.unblockFeeRepositoryWalletId)">
                      <summary>{{ t('admin.walletTypes.routingGroup') }}</summary>
                      <p class="field-hint">{{ t('admin.walletTypes.routingHint') }}</p>
                      <p v-if="!feeRepositoryOptions.length" class="field-hint">{{ t('admin.walletTypes.methodNoRepositories') }}</p>
                      <div class="routing-fields">
                        <label class="field">
                          {{ t('admin.walletTypes.feeRepoShort') }}
                          <select v-model="draft.feeRepositoryWalletId" class="admin-input">
                            <option value="">{{ t('admin.walletTypes.routingMainRepository') }}</option>
                            <option v-for="w in feeRepositoryOptions" :key="w.id" :value="w.id" :title="w.id">{{ repositoryLabel(w) }}</option>
                            <option
                              v-if="draft.feeRepositoryWalletId && !feeRepositoryOptions.some((w) => w.id === draft.feeRepositoryWalletId)"
                              :value="draft.feeRepositoryWalletId"
                            >{{ draft.feeRepositoryWalletId }}</option>
                          </select>
                        </label>
                        <label class="field">
                          {{ t('admin.walletTypes.penaltyRepoShort') }}
                          <select v-model="draft.penaltyRepositoryWalletId" class="admin-input">
                            <option value="">{{ t('admin.walletTypes.routingMainRepository') }}</option>
                            <option v-for="w in feeRepositoryOptions" :key="w.id" :value="w.id" :title="w.id">{{ repositoryLabel(w) }}</option>
                            <option
                              v-if="draft.penaltyRepositoryWalletId && !feeRepositoryOptions.some((w) => w.id === draft.penaltyRepositoryWalletId)"
                              :value="draft.penaltyRepositoryWalletId"
                            >{{ draft.penaltyRepositoryWalletId }}</option>
                          </select>
                        </label>
                        <label class="field">
                          {{ t('admin.walletTypes.unblockRepoShort') }}
                          <select v-model="draft.unblockFeeRepositoryWalletId" class="admin-input">
                            <option value="">{{ t('admin.walletTypes.routingMainRepository') }}</option>
                            <option v-for="w in feeRepositoryOptions" :key="w.id" :value="w.id" :title="w.id">{{ repositoryLabel(w) }}</option>
                            <option
                              v-if="draft.unblockFeeRepositoryWalletId && !feeRepositoryOptions.some((w) => w.id === draft.unblockFeeRepositoryWalletId)"
                              :value="draft.unblockFeeRepositoryWalletId"
                            >{{ draft.unblockFeeRepositoryWalletId }}</option>
                          </select>
                        </label>
                      </div>
                    </details>
                  </div>
                </div>
              </section>

              <!-- Appearance -->
              <section class="section">
                <h3>{{ t('admin.walletTypes.sectionAppearance') }}</h3>
                <p class="section-hint">{{ t('admin.walletTypes.cardColorHint') }}</p>
                <div class="swatch-row">
                  <button
                    type="button"
                    class="swatch swatch-auto"
                    :class="{ selected: !draft.cardColor }"
                    @click="draft.cardColor = ''"
                  >{{ t('admin.walletTypes.cardColorAuto') }}</button>
                  <button
                    v-for="opt in CARD_THEME_OPTIONS"
                    :key="opt.key"
                    type="button"
                    class="swatch"
                    :class="{ selected: draft.cardColor === opt.key }"
                    :style="{ background: opt.gradient }"
                    :title="opt.label"
                    :aria-label="opt.label"
                    @click="draft.cardColor = opt.key"
                  />
                </div>

                <div class="logo-row">
                  <span class="nested-label">{{ t('admin.walletTypes.cardImageLabel') }}</span>
                  <template v-if="!isCreate">
                    <div class="logo-controls">
                      <span class="logo-box">
                        <img v-if="editing?.cardImageFilename" :src="cardImageSrc(editing.cardImageFilename)!" :alt="t('admin.walletTypes.cardImageLabel')" />
                        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                      </span>
                      <label class="admin-btn admin-btn-ghost admin-btn-sm file-btn" :class="{ disabled: logoBusy || readOnly }">
                        {{ t('admin.walletTypes.chooseFile') }}
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" :disabled="logoBusy || readOnly" @change="onLogoSelected" />
                      </label>
                      <button v-if="editing?.cardImageFilename" type="button" class="admin-btn admin-btn-ghost admin-btn-sm" :disabled="logoBusy" @click="removeLogo">
                        {{ t('admin.walletTypes.cardImageRemove') }}
                      </button>
                    </div>
                    <span class="field-hint">{{ t('admin.walletTypes.cardLogoHint') }}</span>
                  </template>
                  <span v-else class="field-hint">{{ t('admin.walletTypes.cardImageAfterCreateHint') }}</span>
                </div>
              </section>
            </fieldset>
          </div>

          <footer class="editor-foot">
            <p v-if="editorError" class="admin-error foot-error">{{ editorError }}</p>
            <div class="foot-actions">
              <button
                v-if="!isCreate && !readOnly"
                type="button"
                class="admin-btn admin-btn-danger"
                :class="{ confirming: confirmingDelete }"
                :disabled="busy"
                @click="remove"
              >{{ confirmingDelete ? t('admin.walletTypes.confirmDelete') : t('admin.walletTypes.delete') }}</button>
              <span class="spacer" />
              <button type="button" class="admin-btn admin-btn-ghost" @click="closeEditor">
                {{ readOnly ? t('admin.walletTypes.close') : t('admin.walletTypes.cancel') }}
              </button>
              <button v-if="!readOnly" type="submit" class="admin-btn admin-btn-primary" :disabled="busy">
                {{ isCreate ? t('admin.walletTypes.create') : t('admin.walletTypes.saveChanges') }}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </Teleport>
  </AdminLayout>
</template>

<style scoped>
/* ---------- List ---------- */
.readonly-note {
  margin: -6px 0 14px;
  font-size: 0.82rem;
  color: var(--text-dim);
}
.empty {
  color: var(--text-dim);
  font-size: 0.9rem;
  padding: 24px 0;
  text-align: center;
}
.type-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.type-row {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(160px, 240px) 1fr auto;
  align-items: center;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.type-row:hover {
  border-color: color-mix(in srgb, var(--accent-blue) 40%, var(--card-border));
  background: var(--hover-tint);
}
.type-row:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.mini-card {
  width: 56px;
  height: 36px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  font-size: 0.9rem;
  box-shadow: 0 4px 10px -6px rgba(15, 23, 42, 0.5);
  overflow: hidden;
}
.mini-card img {
  max-width: 70%;
  max-height: 70%;
  object-fit: contain;
}
.type-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.type-name {
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.type-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: var(--text-dim);
}
.type-meta code,
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
  letter-spacing: 0.02em;
}
.dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--text-dimmer);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 0;
}
.chips .admin-badge {
  padding: 2px 8px;
  font-size: 0.7rem;
}
.chip-info {
  background: var(--badge-tint-blue);
  color: var(--accent-blue);
}
.chip-violet {
  background: color-mix(in srgb, var(--accent-violet) 12%, transparent);
  color: var(--accent-violet);
}
.chip-warning {
  background: var(--badge-tint-orange);
  color: var(--accent-orange);
}
.chevron {
  width: 18px;
  height: 18px;
  color: var(--text-dimmer);
}
[dir='rtl'] .chevron {
  transform: scaleX(-1);
}

/* ---------- Slide-over ---------- */
.editor-layer {
  position: fixed;
  inset: 0;
  z-index: 100;
  min-height: 0;
  background: transparent;
}
.editor-scrim {
  position: absolute;
  inset: 0;
  background: rgba(8, 12, 24, 0.45);
  backdrop-filter: blur(2px);
  animation: fade-in 0.15s ease;
}
.editor {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  width: min(600px, 100%);
  display: flex;
  flex-direction: column;
  background: var(--admin-bg);
  border-inline-start: 1px solid var(--card-border);
  box-shadow: var(--shadow-pop);
  animation: slide-in 0.2s ease;
}
[dir='rtl'] .editor {
  animation-name: slide-in-rtl;
}
@keyframes slide-in {
  from { transform: translateX(24px); opacity: 0; }
}
@keyframes slide-in-rtl {
  from { transform: translateX(-24px); opacity: 0; }
}
.editor-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 24px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--card-border);
}
.editor-head h2 {
  margin: 0;
  font-size: 1.15rem;
  letter-spacing: -0.01em;
}
.eyebrow {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dimmer);
}
.close-btn svg {
  width: 18px;
  height: 18px;
}
.editor-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 28px;
}
.editor-foot {
  padding: 14px 24px;
  background: var(--card-bg);
  border-top: 1px solid var(--card-border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.foot-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.spacer {
  flex: 1;
}
.admin-btn-danger.confirming {
  background: var(--accent-red);
  color: #fff;
}

/* Preview */
.preview-wrap {
  display: flex;
  justify-content: center;
  padding: 4px 0 20px;
}
.preview-card {
  width: 300px;
  aspect-ratio: 1.586;
  border-radius: 16px;
  padding: 18px 20px;
  color: #fff;
  display: flex;
  flex-direction: column;
  box-shadow: 0 18px 36px -18px rgba(15, 23, 42, 0.55);
  transition: background 0.25s;
}
.preview-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 26px;
}
.preview-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.2);
}
.preview-logo {
  max-height: 26px;
  max-width: 80px;
  object-fit: contain;
}
.preview-label {
  margin-top: auto;
  font-size: 0.72rem;
  opacity: 0.8;
}
.preview-amount {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}
.preview-name {
  margin-top: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  opacity: 0.92;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.editor .admin-input:disabled {
  background: var(--panel-bg);
  color: var(--text-dim);
  cursor: not-allowed;
}

/* Sections */
.sections {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.section {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  padding: 18px;
}
.section h3 {
  margin: 0 0 12px;
  font-size: 0.92rem;
  font-weight: 650;
}
.section-hint {
  margin: -8px 0 12px;
  font-size: 0.8rem;
  color: var(--text-dim);
}
.field-hint.span-2 {
  margin-top: -6px;
}

/* Presets */
.presets {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.preset {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 10px;
  align-items: center;
  text-align: start;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.preset:hover {
  border-color: color-mix(in srgb, var(--accent-blue) 45%, var(--card-border));
}
.preset.active {
  border-color: var(--accent-blue);
  background: var(--active-tint);
}
.preset-swatch {
  grid-row: 1 / 3;
  width: 30px;
  height: 20px;
  border-radius: 5px;
}
.preset-title {
  font-weight: 650;
  font-size: 0.85rem;
}
.preset-hint {
  font-size: 0.74rem;
  color: var(--text-dim);
  line-height: 1.35;
}

/* Toggle rows */
.toggle-list {
  display: flex;
  flex-direction: column;
}
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 0;
  border-top: 1px solid var(--divider);
  cursor: pointer;
}
.toggle-list > .toggle-row:first-child {
  border-top: 0;
  padding-top: 2px;
}
.toggle-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.toggle-title {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text);
}
.toggle-hint {
  font-size: 0.78rem;
  color: var(--text-dim);
  line-height: 1.4;
}
.switch {
  appearance: none;
  flex: none;
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-dimmer) 45%, transparent);
  position: relative;
  cursor: pointer;
  margin: 0;
  transition: background 0.15s;
}
.switch::after {
  content: '';
  position: absolute;
  top: 3px;
  inset-inline-start: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.3);
  transition: inset-inline-start 0.15s;
}
.switch:checked {
  background: var(--accent-blue);
}
.switch:checked::after {
  inset-inline-start: 19px;
}
.switch:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.switch:disabled,
fieldset:disabled .toggle-row {
  cursor: default;
}
fieldset:disabled .switch {
  opacity: 0.6;
}

.nested {
  margin: 0 0 12px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  border: 1px solid var(--divider);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.nested-toggle {
  padding-inline-start: 14px;
  border-inline-start: 2px solid var(--card-border);
  border-top: 0;
  margin-bottom: 4px;
}
.nested-label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dimmer);
}
.credit-block .nested-label:not(:first-child) {
  margin-top: 6px;
}
.time-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.affix {
  position: relative;
  display: flex;
}
.affix .admin-input {
  padding-inline-end: 52px;
}
.suffix {
  position: absolute;
  inset-inline-end: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--text-dimmer);
  pointer-events: none;
}
.routing {
  margin-top: 4px;
  border-top: 1px solid var(--divider);
  padding-top: 10px;
}
.routing summary {
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--accent-blue);
}
.routing .field-hint {
  margin: 8px 0 10px;
}
.routing-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Appearance */
.swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.swatch {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  transition: transform 0.1s;
}
.swatch:hover:not(:disabled) {
  transform: scale(1.08);
}
.swatch.selected {
  border-color: var(--card-bg);
  box-shadow: 0 0 0 2px var(--accent-blue);
}
.swatch:disabled {
  cursor: default;
  opacity: 0.6;
}
.swatch-auto {
  width: auto;
  height: 34px;
  border-radius: 999px;
  padding: 0 14px;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 600;
  background: var(--panel-bg);
  color: var(--text-dim);
  border: 1px solid var(--card-border);
}
.swatch-auto.selected {
  color: var(--accent-blue);
}
.logo-row {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--divider);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.logo-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.logo-box {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-sm);
  border: 1px dashed var(--card-border);
  background: var(--panel-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dimmer);
  overflow: hidden;
}
.logo-box img {
  max-width: 80%;
  max-height: 80%;
  object-fit: contain;
}
.logo-box svg {
  width: 20px;
  height: 20px;
}
.file-btn {
  position: relative;
  overflow: hidden;
}
.file-btn input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.file-btn.disabled {
  opacity: 0.5;
  pointer-events: none;
}

/* ---------- Responsive ---------- */
@media (max-width: 900px) {
  .type-row {
    grid-template-columns: auto 1fr auto;
  }
  .chips {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
@media (max-width: 640px) {
  .editor-head,
  .editor-body,
  .editor-foot {
    padding-inline: 16px;
  }
  .presets,
  .grid-3 {
    grid-template-columns: minmax(0, 1fr);
  }
  .time-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
.withdrawal-methods {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.method-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 10px;
}
.method-row.off {
  opacity: 0.65;
}
.method-head {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.method-head .field-hint {
  margin-inline-start: auto;
}
</style>
