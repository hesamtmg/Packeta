<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { amountStep, toMinorUnits, type CurrencyInfo } from '../../utils/currency';
import { useAuthStore } from '../../stores/auth';
import AdminLayout from '../../components/admin/AdminLayout.vue';

const { t } = useI18n();
const auth = useAuthStore();

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
  supportsAutoWithdraw: boolean;
  autoWithdrawTimes: string[] | null;
  allowPurchaseOut: boolean;
  allowPurchaseIn: boolean;
  depositable: boolean;
  // Whether a new self-service signup automatically gets a wallet of this
  // type. Multiple starter types can be checked at once; none checked means
  // no wallet is auto-created at signup.
  isStarterType: boolean;
  // Whether wallets of this type may carry a manually-set virtual balance at
  // creation (e.g. a REPOSITORY wallet's funding pool).
  hasVirtualBalance: boolean;
  // Hides wallets of this type from a customer's own wallets/transactions
  // lists — the admin panel is unaffected.
  hiddenFromCustomer: boolean;
  // Wallet-viewing widget feature (see sdk/js/wallet-widget.js) — only
  // meaningful on MERCHANT-code types, enforced server-side.
  allowWidget: boolean;
  widgetRequiresOtp: boolean;
  // Credit-line / installment fields (repository/credit wallet feature) —
  // shared billing rules for every wallet of this type.
  installmentDate: number | null;
  paymentDeadlineDate: number | null;
  // Percentage (0-100, up to 3 decimals), not a currency amount — see
  // InstallmentsService. feePercent applies once per installment at
  // generation, penaltyPercentPerDay accrues once for every day an
  // installment stays unpaid past its deadline.
  feePercent: string | null;
  penaltyPercentPerDay: string | null;
  unblockFee: string | null;
  installmentCount: number | null;
  // How many days an installment may sit OVERDUE (accruing
  // penaltyPercentPerDay) before the wallet is actually blocked and the
  // admin notified — see backend InstallmentsService.applyOverduePenalties.
  // Missing the deadline alone no longer blocks immediately.
  overdueDaysBeforeBlock: number | null;
  // Where an installment repayment's fee/penalty/unblock-fee slices are
  // routed instead of the credit wallet's own backing repository — each
  // must be an existing MERCHANT_REPOSITORY-type wallet in this type's
  // currency (see backend WalletTypesService.validateSubRepository). Null
  // leaves that slice on the main repository, same as before this feature.
  feeRepositoryWalletId: string | null;
  penaltyRepositoryWalletId: string | null;
  unblockFeeRepositoryWalletId: string | null;
  // UI-only: whether the credit-line fields section is expanded for this
  // card — not sent to the backend, mirrors the supportsAutoWithdraw ->
  // autoWithdrawTimes visibility pattern. Defaults to expanded when the type
  // already has any credit-line field set.
  enableCreditLine?: boolean;
}

function hasCreditLineFields(type: {
  installmentDate: number | null;
  paymentDeadlineDate: number | null;
  feePercent: string | null;
  penaltyPercentPerDay: string | null;
  unblockFee: string | null;
  installmentCount: number | null;
  overdueDaysBeforeBlock: number | null;
  feeRepositoryWalletId?: string | null;
  penaltyRepositoryWalletId?: string | null;
  unblockFeeRepositoryWalletId?: string | null;
}): boolean {
  return (
    type.installmentDate != null ||
    type.paymentDeadlineDate != null ||
    type.feePercent != null ||
    type.penaltyPercentPerDay != null ||
    type.unblockFee != null ||
    type.installmentCount != null ||
    type.overdueDaysBeforeBlock != null ||
    type.feeRepositoryWalletId != null ||
    type.penaltyRepositoryWalletId != null ||
    type.unblockFeeRepositoryWalletId != null
  );
}

const types = ref<WalletType[]>([]);
const currencies = ref<CurrencyInfo[]>([]);
const error = ref('');
const busy = ref(false);

// The seeded built-in codes (see backend WalletTypeCode) — surfaced as
// datalist suggestions so an admin creating a type sees REPOSITORY/CREDIT/
// etc. rather than having to know the exact string to type. Still free text
// underneath, since a custom code (e.g. a one-off promo type) is valid too.
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

const newType = reactive({
  code: '',
  name: '',
  currencyCode: '',
  allowNegativeBalance: false,
  creditLimit: '',
  allowWithdraw: true,
  allowP2pOut: false,
  allowP2pIn: false,
  supportsAutoWithdraw: false,
  autoWithdrawTimes: ['', '', ''] as string[],
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
  feePercent: '',
  penaltyPercentPerDay: '',
  unblockFee: '',
  installmentCount: '',
  overdueDaysBeforeBlock: '',
  feeRepositoryWalletId: '',
  penaltyRepositoryWalletId: '',
  unblockFeeRepositoryWalletId: '',
});

const newTypeCurrency = computed(
  () => currencies.value.find((c) => c.code === newType.currencyCode) ?? null,
);

function creditLimitDisplay(type: WalletType): string {
  if (!type.creditLimit) return '';
  return (Number(type.creditLimit) / 10 ** type.currency.decimalPlaces).toFixed(
    type.currency.decimalPlaces,
  );
}

function onCreditLimitInput(type: WalletType, event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  type.creditLimit = String(toMinorUnits(raw, type.currency));
}

function moneyFieldDisplay(type: WalletType, field: 'unblockFee'): string {
  const value = type[field];
  if (!value) return '';
  return (Number(value) / 10 ** type.currency.decimalPlaces).toFixed(
    type.currency.decimalPlaces,
  );
}

function onMoneyFieldInput(type: WalletType, field: 'unblockFee', event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  type[field] = raw ? String(toMinorUnits(raw, type.currency)) : null;
}

function onPercentFieldInput(
  type: WalletType,
  field: 'feePercent' | 'penaltyPercentPerDay',
  event: Event,
) {
  const raw = (event.target as HTMLInputElement).value;
  type[field] = raw ? raw : null;
}

// autoWithdrawTimes: 3 fills -> send as-is, 0 fills -> send [] to clear,
// same "empty clears" convention the backend expects.
function autoWithdrawTimesPayload(times: string[] | null): string[] | undefined {
  const filled = (times ?? []).filter(Boolean);
  return filled.length ? (times ?? []) : [];
}

async function loadTypes() {
  error.value = '';
  try {
    const [loaded, loadedCurrencies] = await Promise.all([
      apiRequest<WalletType[]>('/wallet-types'),
      apiRequest<CurrencyInfo[]>('/currencies'),
    ]);
    types.value = loaded.map((type) => ({
      ...type,
      autoWithdrawTimes: type.autoWithdrawTimes ?? ['', '', ''],
      enableCreditLine: hasCreditLineFields(type),
    }));
    currencies.value = loadedCurrencies;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.walletTypes.loadFailed');
  }
}

async function save(type: WalletType) {
  error.value = '';
  busy.value = true;
  try {
    await apiRequest(`/wallet-types/${type.id}`, {
      method: 'PATCH',
      body: {
        name: type.name,
        allowNegativeBalance: type.allowNegativeBalance,
        creditLimit: type.allowNegativeBalance
          ? Number(type.creditLimit ?? 0)
          : undefined,
        allowWithdraw: type.allowWithdraw,
        allowP2pOut: type.allowP2pOut,
        allowP2pIn: type.allowP2pIn,
        supportsAutoWithdraw: type.supportsAutoWithdraw,
        autoWithdrawTimes: autoWithdrawTimesPayload(type.autoWithdrawTimes),
        allowPurchaseOut: type.allowPurchaseOut,
        allowPurchaseIn: type.allowPurchaseIn,
        depositable: type.depositable,
        isStarterType: type.isStarterType,
        hasVirtualBalance: type.hasVirtualBalance,
        hiddenFromCustomer: type.hiddenFromCustomer,
        allowWidget: type.allowWidget,
        widgetRequiresOtp: type.widgetRequiresOtp,
        installmentDate: type.enableCreditLine ? type.installmentDate ?? undefined : undefined,
        paymentDeadlineDate: type.enableCreditLine
          ? type.paymentDeadlineDate ?? undefined
          : undefined,
        feePercent:
          type.enableCreditLine && type.feePercent ? Number(type.feePercent) : undefined,
        penaltyPercentPerDay:
          type.enableCreditLine && type.penaltyPercentPerDay
            ? Number(type.penaltyPercentPerDay)
            : undefined,
        unblockFee:
          type.enableCreditLine && type.unblockFee ? Number(type.unblockFee) : undefined,
        installmentCount: type.enableCreditLine
          ? type.installmentCount ?? undefined
          : undefined,
        overdueDaysBeforeBlock: type.enableCreditLine
          ? type.overdueDaysBeforeBlock ?? undefined
          : undefined,
        feeRepositoryWalletId: type.enableCreditLine
          ? type.feeRepositoryWalletId || undefined
          : undefined,
        penaltyRepositoryWalletId: type.enableCreditLine
          ? type.penaltyRepositoryWalletId || undefined
          : undefined,
        unblockFeeRepositoryWalletId: type.enableCreditLine
          ? type.unblockFeeRepositoryWalletId || undefined
          : undefined,
      },
    });
    await loadTypes();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.walletTypes.saveFailed');
  } finally {
    busy.value = false;
  }
}

async function remove(type: WalletType) {
  error.value = '';
  busy.value = true;
  try {
    await apiRequest(`/wallet-types/${type.id}`, { method: 'DELETE' });
    await loadTypes();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.walletTypes.deleteFailed');
  } finally {
    busy.value = false;
  }
}

async function createType() {
  error.value = '';
  busy.value = true;
  try {
    const currency = newTypeCurrency.value;
    await apiRequest('/wallet-types', {
      method: 'POST',
      body: {
        code: newType.code.toUpperCase(),
        name: newType.name,
        currencyCode: newType.currencyCode,
        allowNegativeBalance: newType.allowNegativeBalance,
        creditLimit:
          newType.allowNegativeBalance && currency
            ? toMinorUnits(newType.creditLimit, currency)
            : undefined,
        allowWithdraw: newType.allowWithdraw,
        allowP2pOut: newType.allowP2pOut,
        allowP2pIn: newType.allowP2pIn,
        supportsAutoWithdraw: newType.supportsAutoWithdraw,
        autoWithdrawTimes: autoWithdrawTimesPayload(newType.autoWithdrawTimes),
        allowPurchaseOut: newType.allowPurchaseOut,
        allowPurchaseIn: newType.allowPurchaseIn,
        depositable: newType.depositable,
        isStarterType: newType.isStarterType,
        hasVirtualBalance: newType.hasVirtualBalance,
        hiddenFromCustomer: newType.hiddenFromCustomer,
        allowWidget: newType.allowWidget,
        widgetRequiresOtp: newType.widgetRequiresOtp,
        installmentDate:
          newType.enableCreditLine && newType.installmentDate
            ? Number(newType.installmentDate)
            : undefined,
        paymentDeadlineDate:
          newType.enableCreditLine && newType.paymentDeadlineDate
            ? Number(newType.paymentDeadlineDate)
            : undefined,
        feePercent:
          newType.enableCreditLine && newType.feePercent
            ? Number(newType.feePercent)
            : undefined,
        penaltyPercentPerDay:
          newType.enableCreditLine && newType.penaltyPercentPerDay
            ? Number(newType.penaltyPercentPerDay)
            : undefined,
        unblockFee:
          newType.enableCreditLine && newType.unblockFee && currency
            ? toMinorUnits(newType.unblockFee, currency)
            : undefined,
        installmentCount:
          newType.enableCreditLine && newType.installmentCount
            ? Number(newType.installmentCount)
            : undefined,
        overdueDaysBeforeBlock:
          newType.enableCreditLine && newType.overdueDaysBeforeBlock
            ? Number(newType.overdueDaysBeforeBlock)
            : undefined,
        feeRepositoryWalletId:
          newType.enableCreditLine && newType.feeRepositoryWalletId
            ? newType.feeRepositoryWalletId
            : undefined,
        penaltyRepositoryWalletId:
          newType.enableCreditLine && newType.penaltyRepositoryWalletId
            ? newType.penaltyRepositoryWalletId
            : undefined,
        unblockFeeRepositoryWalletId:
          newType.enableCreditLine && newType.unblockFeeRepositoryWalletId
            ? newType.unblockFeeRepositoryWalletId
            : undefined,
      },
    });
    newType.code = '';
    newType.name = '';
    newType.currencyCode = '';
    newType.allowNegativeBalance = false;
    newType.creditLimit = '';
    newType.allowWithdraw = true;
    newType.allowP2pOut = false;
    newType.allowP2pIn = false;
    newType.supportsAutoWithdraw = false;
    newType.autoWithdrawTimes = ['', '', ''];
    newType.allowPurchaseOut = false;
    newType.allowPurchaseIn = false;
    newType.depositable = true;
    newType.isStarterType = false;
    newType.hasVirtualBalance = false;
    newType.hiddenFromCustomer = false;
    newType.allowWidget = false;
    newType.widgetRequiresOtp = true;
    newType.enableCreditLine = false;
    newType.installmentDate = '';
    newType.paymentDeadlineDate = '';
    newType.feePercent = '';
    newType.penaltyPercentPerDay = '';
    newType.unblockFee = '';
    newType.installmentCount = '';
    newType.overdueDaysBeforeBlock = '';
    newType.feeRepositoryWalletId = '';
    newType.penaltyRepositoryWalletId = '';
    newType.unblockFeeRepositoryWalletId = '';
    await loadTypes();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.walletTypes.createFailed');
  } finally {
    busy.value = false;
  }
}

loadTypes();
</script>

<template>
  <AdminLayout :title="t('admin.walletTypes.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>
    <p v-if="!auth.isSuperAdmin" class="hint">{{ t('admin.walletTypes.readOnlyHint') }}</p>

    <div class="admin-card">
      <h2>{{ t('admin.walletTypes.typesHeading', { count: types.length }) }}</h2>
      <div class="types">
        <article v-for="wt in types" :key="wt.id" class="type-card">
          <span class="code">{{ wt.code }} · {{ wt.currency.code }}</span>
          <label>{{ t('admin.walletTypes.nameLabel') }} <input v-model="wt.name" type="text" class="admin-input" :disabled="!auth.isSuperAdmin" /></label>
          <label class="checkbox-label">
            <input v-model="wt.allowNegativeBalance" type="checkbox" :disabled="!auth.isSuperAdmin" />
            {{ t('admin.walletTypes.allowNegativeLabel') }}
          </label>
          <label v-if="wt.allowNegativeBalance">
            {{ t('admin.walletTypes.creditLimitLabel', { code: wt.currency.code }) }}
            <input
              :value="creditLimitDisplay(wt)"
              type="number"
              :step="amountStep(wt.currency)"
              class="admin-input"
              :disabled="!auth.isSuperAdmin"
              @input="onCreditLimitInput(wt, $event)"
            />
          </label>
          <label class="checkbox-label"><input v-model="wt.allowWithdraw" type="checkbox" :disabled="!auth.isSuperAdmin" /> {{ t('admin.walletTypes.allowWithdrawLabel') }}</label>
          <label class="checkbox-label"><input v-model="wt.allowP2pOut" type="checkbox" :disabled="!auth.isSuperAdmin" /> {{ t('admin.walletTypes.canSendLabel') }}</label>
          <label class="checkbox-label"><input v-model="wt.allowP2pIn" type="checkbox" :disabled="!auth.isSuperAdmin" /> {{ t('admin.walletTypes.canReceiveLabel') }}</label>
          <label class="checkbox-label"><input v-model="wt.supportsAutoWithdraw" type="checkbox" :disabled="!auth.isSuperAdmin" /> {{ t('admin.walletTypes.autoWithdrawLabel') }}</label>
          <label v-if="wt.supportsAutoWithdraw">
            {{ t('admin.walletTypes.autoWithdrawTimesLabel') }}
            <div class="time-row">
              <input v-model="wt.autoWithdrawTimes![0]" type="time" class="admin-input" :disabled="!auth.isSuperAdmin" />
              <input v-model="wt.autoWithdrawTimes![1]" type="time" class="admin-input" :disabled="!auth.isSuperAdmin" />
              <input v-model="wt.autoWithdrawTimes![2]" type="time" class="admin-input" :disabled="!auth.isSuperAdmin" />
            </div>
          </label>
          <label class="checkbox-label"><input v-model="wt.allowPurchaseOut" type="checkbox" :disabled="!auth.isSuperAdmin" /> {{ t('admin.walletTypes.canPurchaseLabel') }}</label>
          <label class="checkbox-label"><input v-model="wt.allowPurchaseIn" type="checkbox" :disabled="!auth.isSuperAdmin" /> {{ t('admin.walletTypes.canReceivePurchaseLabel') }}</label>
          <label class="checkbox-label"><input v-model="wt.depositable" type="checkbox" :disabled="!auth.isSuperAdmin" /> {{ t('admin.walletTypes.depositableLabel') }}</label>
          <label class="checkbox-label"><input v-model="wt.isStarterType" type="checkbox" :disabled="!auth.isSuperAdmin" /> {{ t('admin.walletTypes.isStarterTypeLabel') }}</label>
          <label class="checkbox-label"><input v-model="wt.hasVirtualBalance" type="checkbox" :disabled="!auth.isSuperAdmin" /> {{ t('admin.walletTypes.hasVirtualBalanceLabel') }}</label>
          <label class="checkbox-label"><input v-model="wt.hiddenFromCustomer" type="checkbox" :disabled="!auth.isSuperAdmin" /> {{ t('admin.walletTypes.hiddenFromCustomerLabel') }}</label>
          <label class="checkbox-label"><input v-model="wt.allowWidget" type="checkbox" :disabled="!auth.isSuperAdmin" /> {{ t('admin.walletTypes.allowWidgetLabel') }}</label>
          <label v-if="wt.allowWidget" class="checkbox-label"><input v-model="wt.widgetRequiresOtp" type="checkbox" :disabled="!auth.isSuperAdmin" /> {{ t('admin.walletTypes.widgetRequiresOtpLabel') }}</label>

          <span class="section-label">{{ t('admin.walletTypes.creditLineHeading') }}</span>
          <label class="checkbox-label">
            <input v-model="wt.enableCreditLine" type="checkbox" :disabled="!auth.isSuperAdmin" />
            {{ t('admin.walletTypes.enableCreditLineLabel') }}
          </label>
          <template v-if="wt.enableCreditLine">
            <label>
              {{ t('admin.walletTypes.installmentDateLabel') }}
              <input v-model.number="wt.installmentDate" type="number" min="1" max="31" class="admin-input" :disabled="!auth.isSuperAdmin" />
            </label>
            <label>
              {{ t('admin.walletTypes.paymentDeadlineDateLabel') }}
              <input v-model.number="wt.paymentDeadlineDate" type="number" min="1" max="31" class="admin-input" :disabled="!auth.isSuperAdmin" />
            </label>
            <label>
              {{ t('admin.walletTypes.installmentCountLabel') }}
              <input v-model.number="wt.installmentCount" type="number" min="1" class="admin-input" :disabled="!auth.isSuperAdmin" />
            </label>
            <label>
              {{ t('admin.walletTypes.feeLabel') }}
              <input :value="wt.feePercent ?? ''" type="number" min="0" max="100" step="0.001" class="admin-input" :disabled="!auth.isSuperAdmin" @input="onPercentFieldInput(wt, 'feePercent', $event)" />
            </label>
            <label>
              {{ t('admin.walletTypes.penaltyLabel') }}
              <input :value="wt.penaltyPercentPerDay ?? ''" type="number" min="0" max="100" step="0.001" class="admin-input" :disabled="!auth.isSuperAdmin" @input="onPercentFieldInput(wt, 'penaltyPercentPerDay', $event)" />
            </label>
            <label>
              {{ t('admin.walletTypes.unblockFeeLabel', { code: wt.currency.code }) }}
              <input :value="moneyFieldDisplay(wt, 'unblockFee')" type="number" min="0" :step="amountStep(wt.currency)" class="admin-input" :disabled="!auth.isSuperAdmin" @input="onMoneyFieldInput(wt, 'unblockFee', $event)" />
            </label>
            <label>
              {{ t('admin.walletTypes.overdueDaysBeforeBlockLabel') }}
              <input v-model.number="wt.overdueDaysBeforeBlock" type="number" min="1" class="admin-input" :disabled="!auth.isSuperAdmin" />
            </label>
            <label>
              {{ t('admin.walletTypes.feeRepositoryWalletIdLabel') }}
              <input v-model="wt.feeRepositoryWalletId" type="text" class="admin-input" :placeholder="t('admin.walletTypes.repositoryWalletIdPlaceholder')" :disabled="!auth.isSuperAdmin" />
            </label>
            <label>
              {{ t('admin.walletTypes.penaltyRepositoryWalletIdLabel') }}
              <input v-model="wt.penaltyRepositoryWalletId" type="text" class="admin-input" :placeholder="t('admin.walletTypes.repositoryWalletIdPlaceholder')" :disabled="!auth.isSuperAdmin" />
            </label>
            <label>
              {{ t('admin.walletTypes.unblockFeeRepositoryWalletIdLabel') }}
              <input v-model="wt.unblockFeeRepositoryWalletId" type="text" class="admin-input" :placeholder="t('admin.walletTypes.repositoryWalletIdPlaceholder')" :disabled="!auth.isSuperAdmin" />
            </label>
          </template>

          <div v-if="auth.isSuperAdmin" class="type-card-actions">
            <button class="admin-btn admin-btn-primary" :disabled="busy" @click="save(wt)">{{ t('admin.walletTypes.save') }}</button>
            <button class="admin-btn admin-btn-danger" :disabled="busy" @click="remove(wt)">{{ t('admin.walletTypes.delete') }}</button>
          </div>
        </article>
      </div>
    </div>

    <form v-if="auth.isSuperAdmin" class="admin-card new-type" @submit.prevent="createType">
      <h2>{{ t('admin.walletTypes.addHeading') }}</h2>
      <label>
        {{ t('admin.walletTypes.codeLabel') }}
        <input
          v-model="newType.code"
          type="text"
          class="admin-input"
          required
          list="wallet-type-codes"
          :placeholder="t('admin.walletTypes.codePlaceholder')"
        />
        <datalist id="wallet-type-codes">
          <option v-for="code in KNOWN_WALLET_TYPE_CODES" :key="code" :value="code" />
        </datalist>
      </label>
      <label>{{ t('admin.walletTypes.nameLabel') }} <input v-model="newType.name" type="text" class="admin-input" required /></label>
      <label>
        {{ t('admin.walletTypes.currencyLabel') }}
        <select v-model="newType.currencyCode" class="admin-input" required>
          <option value="" disabled>{{ t('admin.walletTypes.chooseCurrency') }}</option>
          <option v-for="c in currencies" :key="c.code" :value="c.code">
            {{ c.code }}
          </option>
        </select>
      </label>
      <label class="checkbox-label">
        <input v-model="newType.allowNegativeBalance" type="checkbox" />
        {{ t('admin.walletTypes.allowNegativeLabel') }}
      </label>
      <label v-if="newType.allowNegativeBalance">
        {{ t('admin.walletTypes.creditLimitLabel', { code: newType.currencyCode || '…' }) }}
        <input
          v-model="newType.creditLimit"
          type="number"
          class="admin-input"
          :step="newTypeCurrency ? amountStep(newTypeCurrency) : '0.01'"
          required
        />
      </label>
      <label class="checkbox-label"><input v-model="newType.allowWithdraw" type="checkbox" /> {{ t('admin.walletTypes.allowWithdrawLabel') }}</label>
      <label class="checkbox-label"><input v-model="newType.allowP2pOut" type="checkbox" /> {{ t('admin.walletTypes.canSendLabel') }}</label>
      <label class="checkbox-label"><input v-model="newType.allowP2pIn" type="checkbox" /> {{ t('admin.walletTypes.canReceiveLabel') }}</label>
      <label class="checkbox-label"><input v-model="newType.supportsAutoWithdraw" type="checkbox" /> {{ t('admin.walletTypes.autoWithdrawLabel') }}</label>
      <label v-if="newType.supportsAutoWithdraw">
        {{ t('admin.walletTypes.autoWithdrawTimesLabel') }}
        <div class="time-row">
          <input v-model="newType.autoWithdrawTimes[0]" type="time" class="admin-input" />
          <input v-model="newType.autoWithdrawTimes[1]" type="time" class="admin-input" />
          <input v-model="newType.autoWithdrawTimes[2]" type="time" class="admin-input" />
        </div>
      </label>
      <label class="checkbox-label"><input v-model="newType.allowPurchaseOut" type="checkbox" /> {{ t('admin.walletTypes.canPurchaseLabel') }}</label>
      <label class="checkbox-label"><input v-model="newType.allowPurchaseIn" type="checkbox" /> {{ t('admin.walletTypes.canReceivePurchaseLabel') }}</label>
      <label class="checkbox-label"><input v-model="newType.depositable" type="checkbox" /> {{ t('admin.walletTypes.depositableLabel') }}</label>
      <label class="checkbox-label"><input v-model="newType.isStarterType" type="checkbox" /> {{ t('admin.walletTypes.isStarterTypeLabel') }}</label>
      <label class="checkbox-label"><input v-model="newType.hasVirtualBalance" type="checkbox" /> {{ t('admin.walletTypes.hasVirtualBalanceLabel') }}</label>
      <label class="checkbox-label"><input v-model="newType.hiddenFromCustomer" type="checkbox" /> {{ t('admin.walletTypes.hiddenFromCustomerLabel') }}</label>
      <label class="checkbox-label"><input v-model="newType.allowWidget" type="checkbox" /> {{ t('admin.walletTypes.allowWidgetLabel') }}</label>
      <label v-if="newType.allowWidget" class="checkbox-label"><input v-model="newType.widgetRequiresOtp" type="checkbox" /> {{ t('admin.walletTypes.widgetRequiresOtpLabel') }}</label>

      <span class="section-label">{{ t('admin.walletTypes.creditLineHeading') }}</span>
      <label class="checkbox-label">
        <input v-model="newType.enableCreditLine" type="checkbox" />
        {{ t('admin.walletTypes.enableCreditLineLabel') }}
      </label>
      <template v-if="newType.enableCreditLine">
        <label>
          {{ t('admin.walletTypes.installmentDateLabel') }}
          <input v-model="newType.installmentDate" type="number" min="1" max="31" class="admin-input" />
        </label>
        <label>
          {{ t('admin.walletTypes.paymentDeadlineDateLabel') }}
          <input v-model="newType.paymentDeadlineDate" type="number" min="1" max="31" class="admin-input" />
        </label>
        <label>
          {{ t('admin.walletTypes.installmentCountLabel') }}
          <input v-model="newType.installmentCount" type="number" min="1" class="admin-input" />
        </label>
        <label>
          {{ t('admin.walletTypes.feeLabel') }}
          <input v-model="newType.feePercent" type="number" min="0" max="100" step="0.001" class="admin-input" />
        </label>
        <label>
          {{ t('admin.walletTypes.penaltyLabel') }}
          <input v-model="newType.penaltyPercentPerDay" type="number" min="0" max="100" step="0.001" class="admin-input" />
        </label>
        <label>
          {{ t('admin.walletTypes.unblockFeeLabel', { code: newType.currencyCode || '…' }) }}
          <input v-model="newType.unblockFee" type="number" min="0" :step="newTypeCurrency ? amountStep(newTypeCurrency) : '0.01'" class="admin-input" />
        </label>
        <label>
          {{ t('admin.walletTypes.overdueDaysBeforeBlockLabel') }}
          <input v-model="newType.overdueDaysBeforeBlock" type="number" min="1" class="admin-input" />
        </label>
        <label>
          {{ t('admin.walletTypes.feeRepositoryWalletIdLabel') }}
          <input v-model="newType.feeRepositoryWalletId" type="text" class="admin-input" :placeholder="t('admin.walletTypes.repositoryWalletIdPlaceholder')" />
        </label>
        <label>
          {{ t('admin.walletTypes.penaltyRepositoryWalletIdLabel') }}
          <input v-model="newType.penaltyRepositoryWalletId" type="text" class="admin-input" :placeholder="t('admin.walletTypes.repositoryWalletIdPlaceholder')" />
        </label>
        <label>
          {{ t('admin.walletTypes.unblockFeeRepositoryWalletIdLabel') }}
          <input v-model="newType.unblockFeeRepositoryWalletId" type="text" class="admin-input" :placeholder="t('admin.walletTypes.repositoryWalletIdPlaceholder')" />
        </label>
      </template>

      <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">{{ t('admin.walletTypes.create') }}</button>
    </form>
  </AdminLayout>
</template>

<style scoped>
.types {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}
.type-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
  padding: 14px;
}
.code {
  font-size: 0.72rem;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.type-card label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.85rem;
  color: var(--text-dim);
}
.checkbox-label {
  flex-direction: row !important;
  align-items: center;
  gap: 8px !important;
}
.section-label {
  font-size: 0.72rem;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-top: 4px;
  border-top: 1px solid var(--card-border);
  padding-top: 10px;
}
.time-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.time-row .admin-input {
  flex: 1;
}
.type-card-actions {
  display: flex;
  gap: 8px;
}
.new-type {
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.new-type label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.85rem;
  color: var(--text-dim);
}
</style>
