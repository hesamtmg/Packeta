<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../api/client';
import { formatAmount } from '../utils/currency';
import { formatDateTime } from '../utils/date';
import type { RailSettlement, SettlementRailType, Wallet } from '../stores/wallet';
import { availableRails, feeSummary } from '../utils/withdrawalMethods';

// Lets a merchant manage how their wallet is paid out:
//   - Instant rails (Pol Pay, direct bank transfer) settle synchronously,
//     right after each purchase completes — no schedule to configure.
//   - Scheduled rails (Paya, Satna) are swept by the backend scheduler at the
//     merchant's own times (Tehran time), else the rail's built-in default.
//   - The IBAN split decides where each payout goes (percentages = 100).
//   - Only the rails the super admin enabled on this wallet type are offered,
//     each labeled with its per-payout fee (see utils/withdrawalMethods.ts).
// Mirrors backend/src/rail-settlements/rail-schedule.ts.
const props = defineProps<{ wallet: Wallet }>();
const emit = defineEmits<{ updated: [wallet: Wallet] }>();
const { t } = useI18n();

const ALL_INSTANT_RAILS: SettlementRailType[] = ['POL_PAY', 'BANK_TRANSFER'];
const ALL_SCHEDULED_RAILS: SettlementRailType[] = ['PAYA', 'SATNA'];
const enabledRails = computed(() => availableRails(props.wallet.walletType));
const INSTANT_RAILS = computed(() => ALL_INSTANT_RAILS.filter((r) => enabledRails.value.includes(r)));
const SCHEDULED_RAILS = computed(() => ALL_SCHEDULED_RAILS.filter((r) => enabledRails.value.includes(r)));
function railFee(rail: SettlementRailType): string | null {
  return feeSummary(props.wallet.walletType, rail);
}
const DEFAULT_TIMES: Partial<Record<SettlementRailType, string[]>> = {
  PAYA: ['09:00', '11:00', '13:00', '15:00'],
  SATNA: ['08:30', '10:30', '12:30', '14:30'],
};
const IBAN_REGEX = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;

interface AccountRow {
  iban: string;
  label: string;
  percent: string;
}

const railType = ref<SettlementRailType | ''>('');
const times = ref<string[]>([]);
const accounts = ref<AccountRow[]>([]);
const saving = ref(false);
const error = ref('');
const saved = ref(false);

function resetFromWallet(w: Wallet) {
  railType.value = w.railType ?? '';
  times.value = [...(w.railScheduleTimes ?? [])];
  accounts.value = (w.settlementAccounts ?? []).map((a) => ({
    iban: a.iban,
    label: a.label ?? '',
    percent: String(Number(a.percent)),
  }));
}
watch(() => props.wallet, resetFromWallet, { immediate: true });

const isScheduled = computed(() => !!railType.value && ALL_SCHEDULED_RAILS.includes(railType.value));
const isInstant = computed(() => !!railType.value && ALL_INSTANT_RAILS.includes(railType.value));
const defaultTimes = computed(() => (railType.value ? DEFAULT_TIMES[railType.value] ?? [] : []));
const effectiveTimes = computed(() => {
  const own = times.value.filter(Boolean);
  return [...new Set(own.length ? own : defaultTimes.value)].sort();
});

// Next sweep window, compared against the current Tehran wall-clock time
// (the scheduler runs on Tehran time — see backend common/tehran-time.ts).
const nextRun = computed(() => {
  if (!isScheduled.value || !effectiveTimes.value.length) return null;
  const now = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  const later = effectiveTimes.value.find((time) => time > now);
  return later ? { time: later, tomorrow: false } : { time: effectiveTimes.value[0], tomorrow: true };
});

const percentTotal = computed(() =>
  accounts.value.reduce((sum, row) => sum + (Number(row.percent) || 0), 0),
);
const hadAccounts = computed(() => (props.wallet.settlementAccounts?.length ?? 0) > 0);

function addTime() {
  times.value.push('');
}
function removeTime(index: number) {
  times.value.splice(index, 1);
}
function useDefaults() {
  times.value = [...defaultTimes.value];
}
function addAccount() {
  const remaining = Math.max(0, 100 - percentTotal.value);
  accounts.value.push({ iban: '', label: '', percent: remaining ? String(Math.round(remaining * 1000) / 1000) : '' });
}
function removeAccount(index: number) {
  accounts.value.splice(index, 1);
}
function normalizeIban(row: AccountRow) {
  row.iban = row.iban.replace(/\s+/g, '').toUpperCase();
}

function validate(): string | null {
  if (!railType.value) return t('walletDetail.settlement.errorRail');
  if (isScheduled.value) {
    const filled = times.value.filter(Boolean);
    if (filled.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) return t('walletDetail.settlement.errorTime');
    if (new Set(filled).size !== filled.length) return t('walletDetail.settlement.errorDuplicateTime');
  }
  if (!accounts.value.length) {
    return hadAccounts.value ? t('walletDetail.settlement.errorNoAccounts') : null;
  }
  for (const row of accounts.value) {
    if (!IBAN_REGEX.test(row.iban)) return t('walletDetail.settlement.errorIban', { iban: row.iban || '—' });
    const pct = Number(row.percent);
    if (!(pct > 0 && pct <= 100)) return t('walletDetail.settlement.errorPercent');
  }
  if (Math.abs(percentTotal.value - 100) > 0.001) {
    return t('walletDetail.settlement.errorTotal', { total: percentTotal.value });
  }
  return null;
}

async function save() {
  error.value = '';
  saved.value = false;
  const problem = validate();
  if (problem) {
    error.value = problem;
    return;
  }
  const body: Record<string, unknown> = { railType: railType.value };
  if (isScheduled.value) {
    // An empty list clears the override, falling back to the rail default.
    body.railScheduleTimes = [...new Set(times.value.filter(Boolean))].sort();
  }
  if (accounts.value.length) {
    body.settlementAccounts = accounts.value.map((row) => ({
      iban: row.iban,
      label: row.label.trim() || undefined,
      percent: Number(row.percent),
    }));
  }
  saving.value = true;
  try {
    const updated = await apiRequest<Wallet>(`/wallets/${props.wallet.id}`, { method: 'PATCH', body });
    emit('updated', updated);
    saved.value = true;
    setTimeout(() => (saved.value = false), 2500);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('walletDetail.settlement.saveFailed');
  } finally {
    saving.value = false;
  }
}

// Recent payouts for this wallet.
const history = ref<RailSettlement[]>([]);
const historyError = ref('');
async function loadHistory() {
  historyError.value = '';
  try {
    const rows = await apiRequest<RailSettlement[]>(
      `/rail-settlements?walletId=${encodeURIComponent(props.wallet.id)}`,
    );
    history.value = rows.slice(0, 10);
  } catch (err) {
    historyError.value = err instanceof ApiError ? err.message : t('walletDetail.settlement.historyFailed');
  }
}
onMounted(loadHistory);
</script>

<template>
  <div class="settlement-card">
    <h3>{{ t('walletDetail.settlement.heading') }}</h3>
    <p class="hint">{{ t('walletDetail.settlement.hint') }}</p>

    <fieldset class="group">
      <legend>{{ t('walletDetail.settlement.railHeading') }}</legend>
      <p v-if="!enabledRails.length" class="admin-error">{{ t('walletDetail.settlement.noRailsAvailable') }}</p>
      <div v-else class="rail-columns">
        <div v-if="INSTANT_RAILS.length" class="rail-column">
          <span class="rail-mode">{{ t('walletDetail.settlement.instantMode') }}</span>
          <label v-for="rail in INSTANT_RAILS" :key="rail" class="rail-option" :class="{ selected: railType === rail }">
            <input v-model="railType" type="radio" name="rail" :value="rail" />
            <span>
              <strong>{{ t(`dashboard.settlement.rail.${rail}`) }}</strong>
              <small>{{ t('walletDetail.settlement.instantDesc') }}</small>
              <small class="rail-fee">{{ railFee(rail) ? t('walletDetail.settlement.feeLabel', { fee: railFee(rail) }) : t('walletDetail.settlement.noFee') }}</small>
            </span>
          </label>
        </div>
        <div v-if="SCHEDULED_RAILS.length" class="rail-column">
          <span class="rail-mode">{{ t('walletDetail.settlement.scheduledMode') }}</span>
          <label v-for="rail in SCHEDULED_RAILS" :key="rail" class="rail-option" :class="{ selected: railType === rail }">
            <input v-model="railType" type="radio" name="rail" :value="rail" />
            <span>
              <strong>{{ t(`dashboard.settlement.rail.${rail}`) }}</strong>
              <small>{{ t('walletDetail.settlement.scheduledDesc') }}</small>
              <small class="rail-fee">{{ railFee(rail) ? t('walletDetail.settlement.feeLabel', { fee: railFee(rail) }) : t('walletDetail.settlement.noFee') }}</small>
            </span>
          </label>
        </div>
      </div>
    </fieldset>

    <fieldset v-if="isScheduled" class="group">
      <legend>{{ t('walletDetail.settlement.scheduleHeading') }}</legend>
      <p class="hint">
        {{ t('walletDetail.settlement.scheduleHint', { defaults: defaultTimes.join(', ') }) }}
      </p>
      <div class="time-list">
        <div v-for="(_, i) in times" :key="i" class="time-row">
          <input v-model="times[i]" type="time" step="60" class="admin-input" :aria-label="t('walletDetail.settlement.timeLabel')" />
          <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" @click="removeTime(i)">
            {{ t('dashboard.settlement.remove') }}
          </button>
        </div>
      </div>
      <div class="row-actions">
        <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" @click="addTime">
          {{ t('walletDetail.settlement.addTime') }}
        </button>
        <button v-if="!times.length" type="button" class="admin-btn admin-btn-ghost admin-btn-sm" @click="useDefaults">
          {{ t('walletDetail.settlement.customizeDefaults') }}
        </button>
      </div>
      <p v-if="nextRun" class="next-run">
        {{
          nextRun.tomorrow
            ? t('walletDetail.settlement.nextRunTomorrow', { time: nextRun.time })
            : t('walletDetail.settlement.nextRun', { time: nextRun.time })
        }}
      </p>
    </fieldset>
    <p v-else-if="isInstant" class="next-run">{{ t('walletDetail.settlement.instantNote') }}</p>

    <fieldset class="group">
      <legend>{{ t('walletDetail.settlement.accountsHeading') }}</legend>
      <p class="hint">{{ t('walletDetail.settlement.accountsHint') }}</p>
      <div v-for="(row, i) in accounts" :key="i" class="account-row">
        <input
          v-model="row.iban"
          type="text"
          dir="ltr"
          :placeholder="t('dashboard.settlement.ibanPlaceholder')"
          class="admin-input iban"
          @blur="normalizeIban(row)"
        />
        <input v-model="row.label" type="text" :placeholder="t('dashboard.settlement.labelPlaceholder')" class="admin-input" />
        <div class="percent">
          <input v-model="row.percent" type="number" min="0.001" max="100" step="0.001" class="admin-input" :aria-label="t('dashboard.settlement.percent')" />
          <span>%</span>
        </div>
        <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" @click="removeAccount(i)">
          {{ t('dashboard.settlement.remove') }}
        </button>
      </div>
      <div class="row-actions">
        <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" @click="addAccount">
          {{ t('dashboard.settlement.addAccount') }}
        </button>
        <span v-if="accounts.length" class="total" :class="{ bad: Math.abs(percentTotal - 100) > 0.001 }">
          {{ t('walletDetail.settlement.total', { total: Math.round(percentTotal * 1000) / 1000 }) }}
        </span>
      </div>
      <p v-if="!accounts.length" class="hint">{{ t('walletDetail.settlement.noAccounts') }}</p>
    </fieldset>

    <p v-if="error" class="admin-error">{{ error }}</p>
    <div class="row-actions">
      <button type="button" class="admin-btn admin-btn-primary" :disabled="saving" @click="save">
        {{ saving ? t('walletDetail.settlement.saving') : t('walletDetail.settlement.save') }}
      </button>
      <button type="button" class="admin-btn admin-btn-ghost" :disabled="saving" @click="resetFromWallet(wallet)">
        {{ t('walletDetail.settlement.reset') }}
      </button>
      <span v-if="saved" class="saved">{{ t('walletDetail.settlement.saved') }}</span>
    </div>

    <div class="group history">
      <h4>{{ t('walletDetail.settlement.historyHeading') }}</h4>
      <p v-if="historyError" class="admin-error">{{ historyError }}</p>
      <p v-else-if="!history.length" class="hint">{{ t('walletDetail.settlement.historyEmpty') }}</p>
      <ul v-else class="history-list">
        <li v-for="item in history" :key="item.id">
          <span class="history-main">
            <strong>{{ formatAmount(item.amount, wallet.walletType.currency) }}</strong>
            <span class="mono">{{ item.destinationIban ?? t('walletDetail.settlement.noIban') }}</span>
          </span>
          <span class="history-meta">
            {{ t(`dashboard.settlement.rail.${item.railType}`) }} · {{ formatDateTime(item.processedAt ?? item.scheduledFor) }}
            <template v-if="Number(item.feeAmount ?? 0) > 0">
              · {{ t('walletDetail.settlement.historyFee', { amount: formatAmount(item.feeAmount!, wallet.walletType.currency) }) }}
            </template>
          </span>
          <span class="status" :class="item.status.toLowerCase()">{{ t(`walletDetail.settlement.status.${item.status}`) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.settlement-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
  padding-top: 14px;
  border-top: 1px solid var(--card-border);
}
h3 {
  margin: 0;
  font-size: 0.95rem;
}
h4 {
  margin: 0;
  font-size: 0.85rem;
}
.hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-dimmer);
}
.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
}
legend {
  padding: 0 4px;
  font-size: 0.82rem;
  font-weight: 600;
}
.rail-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.rail-column {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rail-mode {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-dimmer);
}
.rail-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.rail-option.selected {
  border-color: var(--accent-blue);
  background: var(--badge-tint-blue, rgba(122, 162, 255, 0.12));
}
.rail-option input {
  margin-top: 3px;
}
.rail-option span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rail-option small {
  color: var(--text-dimmer);
  font-size: 0.75rem;
}
.time-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.time-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.time-row .admin-input {
  width: auto;
}
.row-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.next-run {
  margin: 0;
  font-size: 0.82rem;
  color: var(--accent-blue);
}
.account-row {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1.2fr) 96px auto;
  gap: 6px;
  align-items: center;
}
.account-row .admin-input {
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}
.iban {
  font-family: monospace;
}
.percent {
  display: flex;
  align-items: center;
  gap: 4px;
}
.total {
  font-size: 0.82rem;
  color: var(--accent-lime);
}
.total.bad {
  color: var(--accent-red);
}
.saved {
  font-size: 0.82rem;
  color: var(--accent-lime);
}
.history {
  border-style: dashed;
}
.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.history-list li {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 10px;
  align-items: center;
}
.history-main {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
}
.history-meta {
  grid-column: 1;
  font-size: 0.75rem;
  color: var(--text-dimmer);
}
.status {
  grid-column: 2;
  grid-row: 1 / span 2;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  border-radius: 999px;
  padding: 3px 10px;
}
.status.completed {
  background: var(--badge-tint-blue, rgba(122, 162, 255, 0.15));
  color: var(--accent-blue);
}
.status.pending {
  background: rgba(251, 146, 60, 0.15);
  color: var(--accent-orange);
}
.status.failed {
  background: var(--badge-tint-red, rgba(255, 107, 107, 0.15));
  color: var(--accent-red);
}
.mono {
  font-family: monospace;
  font-size: 0.78rem;
  color: var(--text-dim);
  word-break: break-all;
}
@media (max-width: 560px) {
  .rail-columns {
    grid-template-columns: 1fr;
  }
  .account-row {
    grid-template-columns: minmax(0, 1fr) 96px auto;
  }
  .account-row .iban {
    grid-column: 1 / -1;
  }
}
.rail-fee {
  font-weight: 600;
}
</style>
