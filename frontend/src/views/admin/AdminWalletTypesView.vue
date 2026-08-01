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
  // Whether wallets of this type may carry a manually-set virtual balance at
  // creation (e.g. a REPOSITORY wallet's funding pool).
  hasVirtualBalance: boolean;
  // Credit-line / installment fields (repository/credit wallet feature) —
  // shared billing rules for every wallet of this type.
  installmentDate: number | null;
  paymentDeadlineDate: number | null;
  fee: string | null;
  penalty: string | null;
  unblockFee: string | null;
  installmentCount: number | null;
  // UI-only: whether the credit-line fields section is expanded for this
  // card — not sent to the backend, mirrors the supportsAutoWithdraw ->
  // autoWithdrawTimes visibility pattern. Defaults to expanded when the type
  // already has any credit-line field set.
  enableCreditLine?: boolean;
}

function hasCreditLineFields(type: {
  installmentDate: number | null;
  paymentDeadlineDate: number | null;
  fee: string | null;
  penalty: string | null;
  unblockFee: string | null;
  installmentCount: number | null;
}): boolean {
  return (
    type.installmentDate != null ||
    type.paymentDeadlineDate != null ||
    type.fee != null ||
    type.penalty != null ||
    type.unblockFee != null ||
    type.installmentCount != null
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
const KNOWN_WALLET_TYPE_CODES = ['BUY', 'SELL', 'CREDIT', 'GIFT', 'MERCHANT', 'REPOSITORY'];

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
  hasVirtualBalance: false,
  enableCreditLine: false,
  installmentDate: '',
  paymentDeadlineDate: '',
  fee: '',
  penalty: '',
  unblockFee: '',
  installmentCount: '',
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

function moneyFieldDisplay(type: WalletType, field: 'fee' | 'penalty' | 'unblockFee'): string {
  const value = type[field];
  if (!value) return '';
  return (Number(value) / 10 ** type.currency.decimalPlaces).toFixed(
    type.currency.decimalPlaces,
  );
}

function onMoneyFieldInput(
  type: WalletType,
  field: 'fee' | 'penalty' | 'unblockFee',
  event: Event,
) {
  const raw = (event.target as HTMLInputElement).value;
  type[field] = raw ? String(toMinorUnits(raw, type.currency)) : null;
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
        hasVirtualBalance: type.hasVirtualBalance,
        installmentDate: type.enableCreditLine ? type.installmentDate ?? undefined : undefined,
        paymentDeadlineDate: type.enableCreditLine
          ? type.paymentDeadlineDate ?? undefined
          : undefined,
        fee: type.enableCreditLine && type.fee ? Number(type.fee) : undefined,
        penalty: type.enableCreditLine && type.penalty ? Number(type.penalty) : undefined,
        unblockFee:
          type.enableCreditLine && type.unblockFee ? Number(type.unblockFee) : undefined,
        installmentCount: type.enableCreditLine
          ? type.installmentCount ?? undefined
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
        hasVirtualBalance: newType.hasVirtualBalance,
        installmentDate:
          newType.enableCreditLine && newType.installmentDate
            ? Number(newType.installmentDate)
            : undefined,
        paymentDeadlineDate:
          newType.enableCreditLine && newType.paymentDeadlineDate
            ? Number(newType.paymentDeadlineDate)
            : undefined,
        fee:
          newType.enableCreditLine && newType.fee && currency
            ? toMinorUnits(newType.fee, currency)
            : undefined,
        penalty:
          newType.enableCreditLine && newType.penalty && currency
            ? toMinorUnits(newType.penalty, currency)
            : undefined,
        unblockFee:
          newType.enableCreditLine && newType.unblockFee && currency
            ? toMinorUnits(newType.unblockFee, currency)
            : undefined,
        installmentCount:
          newType.enableCreditLine && newType.installmentCount
            ? Number(newType.installmentCount)
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
    newType.hasVirtualBalance = false;
    newType.enableCreditLine = false;
    newType.installmentDate = '';
    newType.paymentDeadlineDate = '';
    newType.fee = '';
    newType.penalty = '';
    newType.unblockFee = '';
    newType.installmentCount = '';
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
          <label class="checkbox-label"><input v-model="wt.hasVirtualBalance" type="checkbox" :disabled="!auth.isSuperAdmin" /> {{ t('admin.walletTypes.hasVirtualBalanceLabel') }}</label>

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
              {{ t('admin.walletTypes.feeLabel', { code: wt.currency.code }) }}
              <input :value="moneyFieldDisplay(wt, 'fee')" type="number" min="0" :step="amountStep(wt.currency)" class="admin-input" :disabled="!auth.isSuperAdmin" @input="onMoneyFieldInput(wt, 'fee', $event)" />
            </label>
            <label>
              {{ t('admin.walletTypes.penaltyLabel', { code: wt.currency.code }) }}
              <input :value="moneyFieldDisplay(wt, 'penalty')" type="number" min="0" :step="amountStep(wt.currency)" class="admin-input" :disabled="!auth.isSuperAdmin" @input="onMoneyFieldInput(wt, 'penalty', $event)" />
            </label>
            <label>
              {{ t('admin.walletTypes.unblockFeeLabel', { code: wt.currency.code }) }}
              <input :value="moneyFieldDisplay(wt, 'unblockFee')" type="number" min="0" :step="amountStep(wt.currency)" class="admin-input" :disabled="!auth.isSuperAdmin" @input="onMoneyFieldInput(wt, 'unblockFee', $event)" />
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
      <label class="checkbox-label"><input v-model="newType.hasVirtualBalance" type="checkbox" /> {{ t('admin.walletTypes.hasVirtualBalanceLabel') }}</label>

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
          {{ t('admin.walletTypes.feeLabel', { code: newType.currencyCode || '…' }) }}
          <input v-model="newType.fee" type="number" min="0" :step="newTypeCurrency ? amountStep(newTypeCurrency) : '0.01'" class="admin-input" />
        </label>
        <label>
          {{ t('admin.walletTypes.penaltyLabel', { code: newType.currencyCode || '…' }) }}
          <input v-model="newType.penalty" type="number" min="0" :step="newTypeCurrency ? amountStep(newTypeCurrency) : '0.01'" class="admin-input" />
        </label>
        <label>
          {{ t('admin.walletTypes.unblockFeeLabel', { code: newType.currencyCode || '…' }) }}
          <input v-model="newType.unblockFee" type="number" min="0" :step="newTypeCurrency ? amountStep(newTypeCurrency) : '0.01'" class="admin-input" />
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
