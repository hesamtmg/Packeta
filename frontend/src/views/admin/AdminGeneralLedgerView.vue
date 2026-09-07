<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { formatAmount, type CurrencyInfo } from '../../utils/currency';
import { formatDateTime } from '../../utils/date';
import AdminLayout from '../../components/admin/AdminLayout.vue';

const { t } = useI18n();

interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE';
  currencyCode: string;
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

const trialBalance = ref<TrialBalanceRow[]>([]);
const currencies = ref<CurrencyInfo[]>([]);
const error = ref('');

// Which account's ledger is currently expanded (one at a time), plus its
// fetched rows and per-row loading/error state — a plain object keyed by
// accountId rather than a Map, so Vue's reactivity tracks it without extra
// wiring.
const expandedAccountId = ref<string | null>(null);
const ledgersByAccount = reactive<Record<string, AccountLedgerRow[]>>({});
const ledgerError = ref('');
const ledgerLoading = ref(false);

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

function money(amount: string, currencyCode: string): string {
  return formatAmount(amount, currencyFor(currencyCode));
}

async function load() {
  error.value = '';
  try {
    const [balance, loadedCurrencies] = await Promise.all([
      apiRequest<TrialBalanceRow[]>('/admin/gl/trial-balance'),
      apiRequest<CurrencyInfo[]>('/currencies'),
    ]);
    trialBalance.value = balance;
    currencies.value = loadedCurrencies;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.generalLedger.loadFailed');
  }
}

async function toggleLedger(row: TrialBalanceRow) {
  if (expandedAccountId.value === row.accountId) {
    expandedAccountId.value = null;
    return;
  }
  expandedAccountId.value = row.accountId;
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

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.generalLedger.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <div class="admin-card">
      <h2>{{ t('admin.generalLedger.trialBalanceHeading') }}</h2>
      <div class="table-scroll">
        <table class="admin-table">
          <thead>
            <tr>
              <th>{{ t('admin.generalLedger.tableCode') }}</th>
              <th>{{ t('admin.generalLedger.tableType') }}</th>
              <th>{{ t('admin.generalLedger.tableCurrency') }}</th>
              <th>{{ t('admin.generalLedger.tableDebit') }}</th>
              <th>{{ t('admin.generalLedger.tableCredit') }}</th>
              <th>{{ t('admin.generalLedger.tableNet') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in trialBalance" :key="row.accountId">
              <tr>
                <td>
                  <div>{{ row.name }}</div>
                  <div class="mono">{{ row.code }}</div>
                </td>
                <td><span class="admin-badge">{{ row.type }}</span></td>
                <td>{{ row.currencyCode }}</td>
                <td>{{ money(row.debit, row.currencyCode) }}</td>
                <td>{{ money(row.credit, row.currencyCode) }}</td>
                <td :class="{ negative: BigInt(row.net) < 0n }">
                  {{ money(row.net, row.currencyCode) }}
                </td>
                <td>
                  <button type="button" class="admin-btn admin-btn-ghost" @click="toggleLedger(row)">
                    {{
                      expandedAccountId === row.accountId
                        ? t('admin.generalLedger.hideLedger')
                        : t('admin.generalLedger.viewLedger')
                    }}
                  </button>
                </td>
              </tr>
              <tr v-if="expandedAccountId === row.accountId">
                <td colspan="7" class="ledger-cell">
                  <h3>{{ t('admin.generalLedger.ledgerHeading', { name: row.name }) }}</h3>
                  <p v-if="ledgerError" class="admin-error">{{ ledgerError }}</p>
                  <p v-else-if="ledgerLoading && !ledgersByAccount[row.accountId]">…</p>
                  <table v-else class="admin-table nested">
                    <thead>
                      <tr>
                        <th>{{ t('admin.generalLedger.colDirection') }}</th>
                        <th>{{ t('admin.generalLedger.colAmount') }}</th>
                        <th>{{ t('admin.generalLedger.colDescription') }}</th>
                        <th>{{ t('admin.generalLedger.colTransaction') }}</th>
                        <th>{{ t('admin.generalLedger.colWhen') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="posting in ledgersByAccount[row.accountId]" :key="posting.postingId">
                        <td>
                          <span
                            class="admin-badge"
                            :class="posting.direction === 'DEBIT' ? 'debit' : 'credit'"
                          >
                            {{ posting.direction }}
                          </span>
                        </td>
                        <td>{{ money(posting.amount, row.currencyCode) }}</td>
                        <td>
                          {{ posting.description }}
                          <span v-if="posting.reversalOfId" class="admin-badge reversal">
                            {{ t('admin.transactionDetail.glReversalOf') }}
                          </span>
                        </td>
                        <td class="mono">
                          <router-link
                            :to="{ name: 'admin-transaction-detail', params: { id: posting.transactionId } }"
                          >
                            {{ posting.transactionId }}
                          </router-link>
                        </td>
                        <td>{{ formatDateTime(posting.createdAt) }}</td>
                      </tr>
                      <tr v-if="!ledgersByAccount[row.accountId]?.length">
                        <td colspan="5">{{ t('admin.generalLedger.ledgerNone') }}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </AdminLayout>
</template>

<style scoped>
h2 {
  margin: 0 0 14px;
}
.mono {
  font-family: monospace;
  font-size: 0.78rem;
  color: var(--text-dim);
}
.negative {
  color: var(--accent-red);
}
.ledger-cell {
  background: var(--input-bg, rgba(255, 255, 255, 0.03));
}
.ledger-cell h3 {
  margin: 4px 0 10px;
  font-size: 0.95rem;
}
.admin-table.nested {
  margin: 0;
}
.admin-badge.debit {
  background: rgba(255, 107, 107, 0.15);
  color: var(--accent-red);
}
.admin-badge.credit {
  background: rgba(122, 162, 255, 0.15);
  color: var(--accent-blue);
}
.admin-badge.reversal {
  margin-inline-start: 6px;
  background: rgba(216, 255, 92, 0.15);
  color: var(--accent-lime);
}
</style>
