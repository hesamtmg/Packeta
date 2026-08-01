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
}

const types = ref<WalletType[]>([]);
const currencies = ref<CurrencyInfo[]>([]);
const error = ref('');
const busy = ref(false);

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
          <div v-if="auth.isSuperAdmin" class="type-card-actions">
            <button class="admin-btn admin-btn-primary" :disabled="busy" @click="save(wt)">{{ t('admin.walletTypes.save') }}</button>
            <button class="admin-btn admin-btn-danger" :disabled="busy" @click="remove(wt)">{{ t('admin.walletTypes.delete') }}</button>
          </div>
        </article>
      </div>
    </div>

    <form v-if="auth.isSuperAdmin" class="admin-card new-type" @submit.prevent="createType">
      <h2>{{ t('admin.walletTypes.addHeading') }}</h2>
      <label>{{ t('admin.walletTypes.codeLabel') }} <input v-model="newType.code" type="text" class="admin-input" required :placeholder="t('admin.walletTypes.codePlaceholder')" /></label>
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
.time-row {
  display: flex;
  gap: 6px;
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
