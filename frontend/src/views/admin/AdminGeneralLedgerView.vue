<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { formatAmount, type CurrencyInfo } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { formatTime } from '../../utils/adminFormat';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import AdminDrawer from '../../components/admin/AdminDrawer.vue';

const { t } = useI18n();

type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE';

interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  currencyCode: string;
  // Minor units as strings; net = debit - credit.
  debit: string;
  credit: string;
  net: string;
}

interface AccountLedgerRow {
  postingId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string;
  journalEntryId: string;
  description: string;
  reversalOfId: string | null;
  transactionId: string;
  createdAt: string;
}

const LEDGER_LIMIT = 100;
const TYPE_ORDER: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE'];

const trialBalance = ref<TrialBalanceRow[]>([]);
const currencies = ref<CurrencyInfo[]>([]);
const loaded = ref(false);
const error = ref('');
const selectedCurrency = ref('');
const hideEmpty = ref(false);

function currencyFor(code: string): CurrencyInfo {
  return (
    currencies.value.find((c) => c.code === code) ?? {
      code,
      symbol: code,
      symbolPosition: 'SUFFIX',
      decimalPlaces: 2,
    }
  );
}

function money(amount: bigint | string, currencyCode: string): string {
  return formatAmount(amount.toString(), currencyFor(currencyCode));
}

const abs = (v: bigint) => (v < 0n ? -v : v);

// A balance shown the way an accountant reads it: an unsigned amount plus
// which side it sits on (Dr = debit balance, Cr = credit balance).
function sideBalance(net: bigint, currencyCode: string): { amount: string; side: 'Dr' | 'Cr' | '' } {
  if (net === 0n) return { amount: money(0n, currencyCode), side: '' };
  return { amount: money(abs(net), currencyCode), side: net > 0n ? 'Dr' : 'Cr' };
}

// Every currency in the chart, the ones with activity first.
const currencyCodes = computed(() => {
  const activity = new Map<string, bigint>();
  for (const row of trialBalance.value) {
    activity.set(row.currencyCode, (activity.get(row.currencyCode) ?? 0n) + BigInt(row.debit) + BigInt(row.credit));
  }
  return [...activity.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).map(([code]) => code);
});

const rowsForCurrency = computed(() =>
  trialBalance.value.filter((row) => row.currencyCode === selectedCurrency.value),
);

const totals = computed(() => {
  let debit = 0n;
  let credit = 0n;
  for (const row of rowsForCurrency.value) {
    debit += BigInt(row.debit);
    credit += BigInt(row.credit);
  }
  return { debit, credit, diff: debit - credit };
});

const isActive = (row: TrialBalanceRow) => row.debit !== '0' || row.credit !== '0';

const groups = computed(() =>
  TYPE_ORDER.map((type) => {
    const all = rowsForCurrency.value.filter((row) => row.type === type);
    const rows = hideEmpty.value ? all.filter(isActive) : all;
    const net = all.reduce((sum, row) => sum + BigInt(row.net), 0n);
    const debit = all.reduce((sum, row) => sum + BigInt(row.debit), 0n);
    const credit = all.reduce((sum, row) => sum + BigInt(row.credit), 0n);
    return { type, rows, net, debit, credit, count: all.length };
  }).filter((g) => g.count > 0),
);

const emptyCount = computed(() => rowsForCurrency.value.filter((row) => !isActive(row)).length);

async function load() {
  error.value = '';
  try {
    const [balance, loadedCurrencies] = await Promise.all([
      apiRequest<TrialBalanceRow[]>('/admin/gl/trial-balance'),
      apiRequest<CurrencyInfo[]>('/currencies'),
    ]);
    trialBalance.value = balance;
    currencies.value = loadedCurrencies;
    if (!selectedCurrency.value || !currencyCodes.value.includes(selectedCurrency.value)) {
      selectedCurrency.value = currencyCodes.value[0] ?? '';
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.generalLedger.loadFailed');
  } finally {
    loaded.value = true;
  }
}

// ---- Account drill-down -------------------------------------------------------
const openAccount = ref<TrialBalanceRow | null>(null);
const ledgersByAccount = reactive<Record<string, AccountLedgerRow[]>>({});
const ledgerError = ref('');
const ledgerLoading = ref(false);

async function showLedger(row: TrialBalanceRow) {
  openAccount.value = row;
  ledgerError.value = '';
  if (ledgersByAccount[row.accountId]) return;
  ledgerLoading.value = true;
  try {
    ledgersByAccount[row.accountId] = await apiRequest<AccountLedgerRow[]>(
      `/admin/gl/accounts/${row.accountId}/ledger`,
    );
  } catch (err) {
    ledgerError.value =
      err instanceof ApiError ? err.message : t('admin.generalLedger.ledgerLoadFailed');
  } finally {
    ledgerLoading.value = false;
  }
}

// Postings come newest first, so walking down from the account's current net
// gives the balance right after each posting — correct even though only the
// latest LEDGER_LIMIT postings are fetched.
const ledgerRows = computed(() => {
  const account = openAccount.value;
  if (!account) return [];
  const postings = ledgersByAccount[account.accountId] ?? [];
  let balance = BigInt(account.net);
  return postings.map((p) => {
    const after = balance;
    const effect = p.direction === 'DEBIT' ? BigInt(p.amount) : -BigInt(p.amount);
    balance -= effect;
    return { ...p, after };
  });
});


const TYPE_ICONS: Record<AccountType, string> = {
  ASSET: 'M4 10h16M6 10v8M10 10v8M14 10v8M18 10v8M3 20h18M12 3l9 5H3l9-5z',
  LIABILITY: 'M6 4h12v16l-3-2-3 2-3-2-3 2V4zM9 9h6M9 13h4',
  EQUITY: 'M12 3a9 9 0 109 9h-9V3zM15 3.5A9 9 0 0120.5 9H15V3.5z',
  REVENUE: 'M4 17l5-5 4 4 7-8M14 8h6v6',
};

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.generalLedger.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <!-- Currency + balance check -->
    <section class="admin-card overview">
      <div class="overview-head">
        <div>
          <h2>{{ t('admin.generalLedger.trialBalanceHeading') }}</h2>
          <p class="admin-card-sub">{{ t('admin.generalLedger.subtitle') }}</p>
        </div>
        <div v-if="currencyCodes.length > 1" class="segmented" role="tablist">
          <button
            v-for="code in currencyCodes"
            :key="code"
            type="button"
            role="tab"
            :aria-selected="selectedCurrency === code"
            :class="{ active: selectedCurrency === code }"
            @click="selectedCurrency = code"
          >{{ code }}</button>
        </div>
      </div>

      <div v-if="selectedCurrency" class="check-row">
        <div class="check" :class="totals.diff === 0n ? 'ok' : 'bad'">
          <span class="check-icon">
            <svg v-if="totals.diff === 0n" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v6M12 17h.01" /></svg>
          </span>
          <span class="check-text">
            <strong>{{ totals.diff === 0n ? t('admin.generalLedger.balanced') : t('admin.generalLedger.outOfBalance', { amount: money(abs(totals.diff), selectedCurrency) }) }}</strong>
            <span>{{ t('admin.generalLedger.checkHint') }}</span>
          </span>
        </div>
        <div class="total">
          <span class="total-label">{{ t('admin.generalLedger.totalDebits') }}</span>
          <span class="total-value">{{ money(totals.debit, selectedCurrency) }}</span>
        </div>
        <div class="total">
          <span class="total-label">{{ t('admin.generalLedger.totalCredits') }}</span>
          <span class="total-value">{{ money(totals.credit, selectedCurrency) }}</span>
        </div>
      </div>

      <div v-if="selectedCurrency" class="type-tiles">
        <div v-for="g in groups" :key="g.type" class="type-tile">
          <span class="type-tile-icon" :class="`tone-${g.type.toLowerCase()}`">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path :d="TYPE_ICONS[g.type]" /></svg>
          </span>
          <span class="type-tile-text">
            <span class="type-tile-label">{{ t(`admin.generalLedger.type${g.type}`) }}</span>
            <span class="type-tile-value">
              {{ sideBalance(g.net, selectedCurrency).amount }}
              <span v-if="sideBalance(g.net, selectedCurrency).side" class="side">{{ sideBalance(g.net, selectedCurrency).side }}</span>
            </span>
          </span>
        </div>
      </div>
    </section>

    <!-- Accounts -->
    <section class="admin-card">
      <div class="admin-card-head">
        <h2>{{ t('admin.generalLedger.accountsHeading', { count: rowsForCurrency.length }) }}</h2>
        <label v-if="emptyCount" class="hide-empty">
          <input v-model="hideEmpty" type="checkbox" class="switch" />
          {{ t('admin.generalLedger.hideEmpty', { count: emptyCount }) }}
        </label>
      </div>

      <div class="table-scroll">
        <table class="admin-table gl-table">
          <thead>
            <tr>
              <th>{{ t('admin.generalLedger.tableCode') }}</th>
              <th class="num">{{ t('admin.generalLedger.tableDebit') }}</th>
              <th class="num">{{ t('admin.generalLedger.tableCredit') }}</th>
              <th class="num">{{ t('admin.generalLedger.balanceCol') }}</th>
              <th class="chev-col" />
            </tr>
          </thead>
          <tbody v-for="g in groups" :key="g.type">
            <tr class="group-row">
              <td colspan="5">
                <span class="group-dot" :class="`tone-${g.type.toLowerCase()}`" />
                {{ t(`admin.generalLedger.type${g.type}`) }}
                <span class="group-count">{{ g.count }}</span>
              </td>
            </tr>
            <tr
              v-for="row in g.rows"
              :key="row.accountId"
              class="account-row"
              :class="{ inactive: !isActive(row) }"
              data-shot="ledger-toggle"
              tabindex="0"
              @click="showLedger(row)"
              @keydown.enter="showLedger(row)"
            >
              <td>
                <span class="acct-name">{{ row.name }}</span>
                <span class="acct-code">{{ row.code }}</span>
              </td>
              <td class="num">{{ row.debit === '0' ? '—' : money(row.debit, row.currencyCode) }}</td>
              <td class="num">{{ row.credit === '0' ? '—' : money(row.credit, row.currencyCode) }}</td>
              <td class="num balance">
                <template v-if="isActive(row)">
                  {{ sideBalance(BigInt(row.net), row.currencyCode).amount }}
                  <span v-if="sideBalance(BigInt(row.net), row.currencyCode).side" class="side">{{ sideBalance(BigInt(row.net), row.currencyCode).side }}</span>
                </template>
                <span v-else class="no-activity">{{ t('admin.generalLedger.noActivity') }}</span>
              </td>
              <td class="chev-col">
                <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </td>
            </tr>
            <tr class="subtotal-row">
              <td>{{ t('admin.generalLedger.subtotal') }}</td>
              <td class="num">{{ money(g.debit, selectedCurrency) }}</td>
              <td class="num">{{ money(g.credit, selectedCurrency) }}</td>
              <td class="num">
                {{ sideBalance(g.net, selectedCurrency).amount }}
                <span v-if="sideBalance(g.net, selectedCurrency).side" class="side">{{ sideBalance(g.net, selectedCurrency).side }}</span>
              </td>
              <td />
            </tr>
          </tbody>
          <tfoot v-if="groups.length">
            <tr class="total-row">
              <td>{{ t('admin.generalLedger.total') }}</td>
              <td class="num">{{ money(totals.debit, selectedCurrency) }}</td>
              <td class="num">{{ money(totals.credit, selectedCurrency) }}</td>
              <td class="num">
                <span class="admin-badge" :class="totals.diff === 0n ? 'admin-badge-success' : 'admin-badge-danger'">
                  {{ totals.diff === 0n ? t('admin.generalLedger.balanced') : money(abs(totals.diff), selectedCurrency) }}
                </span>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
        <div v-if="loaded && !groups.length" class="empty-state">{{ t('admin.generalLedger.empty') }}</div>
      </div>
    </section>

    <!-- Postings drawer -->
    <AdminDrawer
      :open="!!openAccount"
      :title="openAccount?.name ?? ''"
      :eyebrow="openAccount ? `${openAccount.code} · ${openAccount.currencyCode} · ${t(`admin.generalLedger.type${openAccount.type}`)}` : ''"
      :close-label="t('admin.generalLedger.close')"
      width="760px"
      @close="openAccount = null"
    >
      <template v-if="openAccount">
        <div class="acct-summary">
          <div class="acct-stat main">
            <span class="total-label">{{ t('admin.generalLedger.netBalance') }}</span>
            <span class="acct-stat-value">
              {{ sideBalance(BigInt(openAccount.net), openAccount.currencyCode).amount }}
              <span v-if="sideBalance(BigInt(openAccount.net), openAccount.currencyCode).side" class="side">{{ sideBalance(BigInt(openAccount.net), openAccount.currencyCode).side }}</span>
            </span>
          </div>
          <div class="acct-stat">
            <span class="total-label">{{ t('admin.generalLedger.tableDebit') }}</span>
            <span class="acct-stat-sub">{{ money(openAccount.debit, openAccount.currencyCode) }}</span>
          </div>
          <div class="acct-stat">
            <span class="total-label">{{ t('admin.generalLedger.tableCredit') }}</span>
            <span class="acct-stat-sub">{{ money(openAccount.credit, openAccount.currencyCode) }}</span>
          </div>
        </div>

        <div class="postings-card">
          <div class="postings-head">
            <h3>{{ t('admin.generalLedger.postingsHeading') }}</h3>
            <span class="admin-card-sub">{{ t('admin.generalLedger.ledgerSub', { count: LEDGER_LIMIT }) }}</span>
          </div>
          <p v-if="ledgerError" class="admin-error">{{ ledgerError }}</p>
          <div v-else-if="ledgerLoading && !ledgersByAccount[openAccount.accountId]" class="loading">
            <span v-for="i in 5" :key="i" class="skeleton" />
          </div>
          <div v-else-if="!ledgerRows.length" class="empty-state">{{ t('admin.generalLedger.ledgerNone') }}</div>
          <div v-else class="table-scroll">
            <table class="admin-table postings-table">
              <thead>
                <tr>
                  <th>{{ t('admin.generalLedger.colWhen') }}</th>
                  <th>{{ t('admin.generalLedger.colDescription') }}</th>
                  <th class="num">{{ t('admin.generalLedger.colDebit') }}</th>
                  <th class="num">{{ t('admin.generalLedger.colCredit') }}</th>
                  <th class="num">{{ t('admin.generalLedger.colBalance') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in ledgerRows" :key="p.postingId">
                  <td class="when">
                    <span>{{ formatDate(p.createdAt) }}</span>
                    <span class="dim">{{ formatTime(p.createdAt) }}</span>
                  </td>
                  <td class="desc">
                    <span class="desc-text">
                      {{ p.description }}
                      <span v-if="p.reversalOfId" class="admin-badge admin-badge-warning rev">{{ t('admin.generalLedger.reversal') }}</span>
                    </span>
                    <router-link class="tx-link" :to="{ name: 'admin-transaction-detail', params: { id: p.transactionId } }" :title="p.transactionId">
                      #{{ p.transactionId.slice(0, 8) }}
                    </router-link>
                  </td>
                  <td class="num dr">{{ p.direction === 'DEBIT' ? money(p.amount, openAccount.currencyCode) : '' }}</td>
                  <td class="num cr">{{ p.direction === 'CREDIT' ? money(p.amount, openAccount.currencyCode) : '' }}</td>
                  <td class="num running">
                    {{ sideBalance(p.after, openAccount.currencyCode).amount }}
                    <span v-if="sideBalance(p.after, openAccount.currencyCode).side" class="side">{{ sideBalance(p.after, openAccount.currencyCode).side }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </AdminDrawer>
  </AdminLayout>
</template>

<style scoped>
/* Overview */
.overview {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.overview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.overview-head h2 {
  margin: 0;
}
.check-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.check {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--radius-sm);
  border: 1px solid;
}
.check.ok {
  background: var(--badge-tint-lime);
  border-color: color-mix(in srgb, var(--accent-lime) 25%, transparent);
  color: var(--accent-lime);
}
.check.bad {
  background: var(--badge-tint-red);
  border-color: color-mix(in srgb, var(--accent-red) 25%, transparent);
  color: var(--accent-red);
}
.check-icon {
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 50%;
  background: currentColor;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.check-icon svg {
  width: 18px;
  height: 18px;
  color: var(--card-bg);
}
.check-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.check-text strong {
  font-size: 0.95rem;
}
.check-text span {
  font-size: 0.78rem;
  color: var(--text-dim);
}
.total {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 14px 16px;
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  border: 1px solid var(--divider);
  min-width: 0;
}
.total-label {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dimmer);
}
.total-value {
  font-size: 1.1rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.type-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
}
.type-tile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--card-border);
  min-width: 0;
}
.type-tile-icon {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.type-tile-icon svg {
  width: 17px;
  height: 17px;
}
.type-tile-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.type-tile-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-dim);
}
.type-tile-value {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tone-asset { background: var(--badge-tint-blue); color: var(--accent-blue); }
.tone-liability { background: var(--badge-tint-orange); color: var(--accent-orange); }
.tone-equity { background: color-mix(in srgb, var(--accent-violet) 12%, transparent); color: var(--accent-violet); }
.tone-revenue { background: var(--badge-tint-lime); color: var(--accent-lime); }
.side {
  display: inline-block;
  margin-inline-start: 4px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--text-dimmer);
  vertical-align: middle;
}

/* Accounts table */
.hide-empty {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-dim);
  cursor: pointer;
}
.gl-table th.num {
  text-align: end;
}
.gl-table td.num {
  font-variant-numeric: tabular-nums;
}
.chev-col {
  width: 36px;
}
.group-row td {
  padding: 18px 14px 8px;
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dim);
  border-bottom: 1px solid var(--card-border);
}
.gl-table tbody tr.group-row:hover,
.gl-table tbody tr.subtotal-row:hover {
  background: transparent;
}
.group-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-inline-end: 6px;
  background: currentColor;
}
.group-dot.tone-asset { background: var(--accent-blue); }
.group-dot.tone-liability { background: var(--accent-orange); }
.group-dot.tone-equity { background: var(--accent-violet); }
.group-dot.tone-revenue { background: var(--accent-lime); }
.group-count {
  margin-inline-start: 6px;
  font-weight: 600;
  color: var(--text-dimmer);
}
.account-row {
  cursor: pointer;
}
.account-row:focus-visible {
  outline: none;
  box-shadow: inset var(--focus-ring);
}
.acct-name {
  display: block;
  font-weight: 600;
}
.acct-code {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.72rem;
  color: var(--text-dimmer);
}
.account-row.inactive .acct-name,
.account-row.inactive td.num {
  color: var(--text-dimmer);
}
.balance {
  font-weight: 650;
}
.no-activity {
  font-size: 0.78rem;
  font-weight: 500;
  font-style: italic;
}
.chev {
  width: 16px;
  height: 16px;
  color: var(--text-dimmer);
  display: block;
}
[dir='rtl'] .chev {
  transform: scaleX(-1);
}
.account-row:hover .chev {
  color: var(--accent-blue);
}
.subtotal-row td {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-dim);
  background: var(--panel-bg);
  padding-block: 9px;
}
.total-row td {
  font-weight: 700;
  padding: 14px;
  border-top: 2px solid var(--card-border);
  font-variant-numeric: tabular-nums;
}

/* Drawer content */
.acct-summary {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}
.acct-stat {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 14px 16px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  min-width: 0;
}
.acct-stat-value {
  font-size: 1.3rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.acct-stat-sub {
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.postings-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  padding: 16px;
}
.postings-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.postings-head h3 {
  margin: 0;
  font-size: 0.95rem;
}
.postings-table {
  font-size: 0.84rem;
}
.postings-table th.num {
  text-align: end;
}
.postings-table td {
  padding: 10px 12px;
  vertical-align: top;
}
.when {
  white-space: nowrap;
}
.when span {
  display: block;
}
.dim {
  font-size: 0.74rem;
  color: var(--text-dimmer);
}
.desc {
  min-width: 180px;
}
.desc-text {
  display: block;
}
.rev {
  margin-inline-start: 6px;
  padding: 1px 7px;
  font-size: 0.66rem;
}
.tx-link {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.72rem;
  color: var(--text-dimmer);
  text-decoration: none;
}
.tx-link:hover {
  color: var(--accent-blue);
  text-decoration: underline;
}
.dr,
.cr {
  font-weight: 600;
}
.running {
  color: var(--text-dim);
}
.loading {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.skeleton {
  height: 34px;
  border-radius: 8px;
  background: linear-gradient(90deg, var(--panel-bg) 25%, var(--divider) 50%, var(--panel-bg) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite linear;
}
@keyframes shimmer {
  to { background-position: -200% 0; }
}

@media (max-width: 900px) {
  .check-row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .check {
    grid-column: 1 / -1;
  }
}
@media (max-width: 640px) {
  .total-value {
    font-size: 0.95rem;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .acct-summary {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
