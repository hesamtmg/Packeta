<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { amountStep, toMinorUnits } from '../../utils/currency';
import type { Wallet, WalletOptionsInput } from '../../stores/wallet';
import AmountInput from '../AmountInput.vue';

// Admin edit of an existing wallet (PATCH /admin/wallets/:id) — the same
// per-wallet fields the owner can edit on their own dashboard, minus the
// payout rail/settlement split (those stay with the merchant). Only fields
// that actually changed are sent, so untouched values are never rewritten.
const props = defineProps<{ wallet: Wallet }>();
const emit = defineEmits<{ saved: [wallet: Wallet]; cancel: [] }>();

const { t } = useI18n();

const currency = computed(() => props.wallet.walletType.currency);
const purchaseIn = computed(() => props.wallet.walletType.allowPurchaseIn);
const hasVirtual = computed(() => props.wallet.walletType.hasVirtualBalance);
const step = computed(() => amountStep(currency.value));

function toMajor(minor: string | null): string {
  if (minor === null || minor === '') return '';
  return String(Number(minor) / 10 ** currency.value.decimalPlaces);
}
function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const form = ref(initialForm());
function initialForm() {
  const w = props.wallet;
  return {
    name: w.name ?? '',
    nationalCode: w.nationalCode ?? '',
    minTransactionAmount: toMajor(w.minTransactionAmount),
    maxTransactionAmount: toMajor(w.maxTransactionAmount),
    restrictedCounterparties: (w.restrictedCounterparties ?? []).join(', '),
    virtualAmount: toMajor(w.virtualAmount),
    purchaseTimeoutSeconds: w.purchaseTimeoutSeconds ? String(w.purchaseTimeoutSeconds) : '',
    terminalId: w.terminalId ?? '',
    acceptorCode: w.acceptorCode ?? '',
    storeName: w.storeName ?? '',
    storeSite: w.storeSite ?? '',
    callbackUrl: w.callbackUrl ?? '',
    allowedIps: (w.allowedIps ?? []).join(', '),
    category: w.category ?? '',
    subCategory: w.subCategory ?? '',
  };
}
watch(
  () => props.wallet,
  () => {
    form.value = initialForm();
  },
);

const busy = ref(false);
const error = ref('');

function buildPatch(): WalletOptionsInput {
  const before = initialForm();
  const f = form.value;
  const patch: WalletOptionsInput = {};
  const text = ['name', 'nationalCode'] as const;
  for (const key of text) {
    if (f[key].trim() !== before[key]) patch[key] = f[key].trim();
  }
  if (f.restrictedCounterparties !== before.restrictedCounterparties) {
    patch.restrictedCounterparties = parseList(f.restrictedCounterparties);
  }
  if (f.minTransactionAmount && f.minTransactionAmount !== before.minTransactionAmount) {
    patch.minTransactionAmount = toMinorUnits(f.minTransactionAmount, currency.value);
  }
  if (f.maxTransactionAmount && f.maxTransactionAmount !== before.maxTransactionAmount) {
    patch.maxTransactionAmount = toMinorUnits(f.maxTransactionAmount, currency.value);
  }
  if (hasVirtual.value && f.virtualAmount !== '' && f.virtualAmount !== before.virtualAmount) {
    patch.virtualAmount = toMinorUnits(f.virtualAmount, currency.value);
  }
  if (purchaseIn.value) {
    if (f.purchaseTimeoutSeconds && f.purchaseTimeoutSeconds !== before.purchaseTimeoutSeconds) {
      patch.purchaseTimeoutSeconds = Number(f.purchaseTimeoutSeconds);
    }
    const merchantText = [
      'terminalId',
      'acceptorCode',
      'storeName',
      'storeSite',
      'callbackUrl',
      'category',
      'subCategory',
    ] as const;
    for (const key of merchantText) {
      if (f[key].trim() !== before[key]) patch[key] = f[key].trim();
    }
    if (f.allowedIps !== before.allowedIps) {
      patch.allowedIps = parseList(f.allowedIps);
    }
  }
  return patch;
}

async function onSubmit() {
  error.value = '';
  const patch = buildPatch();
  if (!Object.keys(patch).length) {
    error.value = t('admin.walletDetail.nothingToSave');
    return;
  }
  busy.value = true;
  try {
    const updated = await apiRequest<Wallet>(`/admin/wallets/${props.wallet.id}`, {
      method: 'PATCH',
      body: patch,
    });
    emit('saved', updated);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.walletDetail.saveFailed');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="wallet-edit" @submit.prevent="onSubmit">
    <h2>{{ t('admin.walletDetail.editHeading') }}</h2>
    <p class="hint">{{ t('admin.walletDetail.editHint') }}</p>

    <div class="grid">
      <label class="field">
        {{ t('walletDetail.name') }}
        <input v-model="form.name" type="text" maxlength="100" class="admin-input" />
      </label>
      <label class="field">
        {{ t('walletDetail.nationalCode') }}
        <input v-model="form.nationalCode" type="text" inputmode="numeric" pattern="\d{10}" maxlength="10" class="admin-input" />
      </label>
      <label class="field">
        {{ t('walletDetail.minTransactionAmount') }}
        <AmountInput v-model="form.minTransactionAmount" :currency="currency" min="0" :step="step" class="admin-input" />
      </label>
      <label class="field">
        {{ t('walletDetail.maxTransactionAmount') }}
        <AmountInput v-model="form.maxTransactionAmount" :currency="currency" min="0" :step="step" class="admin-input" />
      </label>
      <label v-if="hasVirtual" class="field">
        {{ t('walletDetail.virtualAmount') }}
        <AmountInput v-model="form.virtualAmount" :currency="currency" min="0" :step="step" class="admin-input" />
      </label>
      <label class="field wide">
        {{ t('walletDetail.restrictedCounterparties') }}
        <input v-model="form.restrictedCounterparties" type="text" class="admin-input" :placeholder="t('admin.walletDetail.listHint')" />
      </label>

      <template v-if="purchaseIn">
        <label class="field">
          {{ t('walletDetail.terminalId') }}
          <input v-model="form.terminalId" type="text" maxlength="100" class="admin-input" />
        </label>
        <label class="field">
          {{ t('walletDetail.acceptorCode') }}
          <input v-model="form.acceptorCode" type="text" maxlength="100" class="admin-input" />
        </label>
        <label class="field">
          {{ t('walletDetail.storeName') }}
          <input v-model="form.storeName" type="text" maxlength="150" class="admin-input" />
        </label>
        <label class="field">
          {{ t('walletDetail.storeSite') }}
          <input v-model="form.storeSite" type="url" maxlength="500" class="admin-input" />
        </label>
        <label class="field">
          {{ t('walletDetail.callbackUrl') }}
          <input v-model="form.callbackUrl" type="url" maxlength="500" class="admin-input" placeholder="https://" />
        </label>
        <label class="field">
          {{ t('walletDetail.purchaseTimeoutSeconds') }}
          <input v-model="form.purchaseTimeoutSeconds" type="number" min="30" class="admin-input" />
        </label>
        <label class="field">
          {{ t('walletDetail.category') }}
          <input v-model="form.category" type="text" maxlength="100" class="admin-input" />
        </label>
        <label class="field">
          {{ t('admin.walletDetail.subCategory') }}
          <input v-model="form.subCategory" type="text" maxlength="100" class="admin-input" />
        </label>
        <label class="field wide">
          {{ t('walletDetail.allowedIps') }}
          <input v-model="form.allowedIps" type="text" class="admin-input" :placeholder="t('admin.walletDetail.listHint')" />
        </label>
      </template>
    </div>

    <p v-if="error" class="admin-error">{{ error }}</p>
    <div class="actions">
      <button type="button" class="admin-btn admin-btn-ghost" :disabled="busy" @click="emit('cancel')">{{ t('admin.walletDetail.cancel') }}</button>
      <button type="submit" class="admin-btn admin-btn-primary" :disabled="busy">{{ t('admin.walletDetail.save') }}</button>
    </div>
  </form>
</template>

<style scoped>
.wallet-edit {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wallet-edit h2 {
  margin: 0;
  font-size: 1rem;
}
.hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-dim);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-dim);
  min-width: 0;
}
.field.wide {
  grid-column: 1 / -1;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
