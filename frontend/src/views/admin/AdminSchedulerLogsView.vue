<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { formatDateTime } from '../../utils/date';
import { useListControls } from '../../composables/useListControls';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import SortableTh from '../../components/admin/SortableTh.vue';
import ListPagination from '../../components/admin/ListPagination.vue';

interface SchedulerLogChildTransaction {
  id: string;
  amount?: string;
  destinationIban?: string | null;
}

interface SchedulerLogChildInstallment {
  id: string;
  walletId?: string;
  amount?: string;
  sequenceNumber?: number;
}

interface SchedulerLogEntry {
  _id: string;
  action: string;
  success: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

const { t } = useI18n();
const logs = ref<SchedulerLogEntry[]>([]);
const error = ref('');

function actionLabel(action: string): string {
  return t(`admin.schedulerLogs.actions.${action}`, action);
}

// The fields every action's metadata renders specially below — everything
// else in a log's metadata falls back to a generic "key: value" chip so a
// new scheduler action never shows up with no detail at all.
const STRUCTURED_KEYS = new Set([
  'walletId',
  'transactionId',
  'transactions',
  'installments',
]);

function childTransactions(log: SchedulerLogEntry): SchedulerLogChildTransaction[] {
  const raw = log.metadata?.transactions;
  return Array.isArray(raw) ? (raw as SchedulerLogChildTransaction[]) : [];
}

function childInstallments(log: SchedulerLogEntry): SchedulerLogChildInstallment[] {
  const raw = log.metadata?.installments;
  return Array.isArray(raw) ? (raw as SchedulerLogChildInstallment[]) : [];
}

function singleTransactionId(log: SchedulerLogEntry): string | null {
  const id = log.metadata?.transactionId;
  return typeof id === 'string' ? id : null;
}

function walletId(log: SchedulerLogEntry): string | null {
  const id = log.metadata?.walletId;
  return typeof id === 'string' ? id : null;
}

// Whatever's left in metadata once the structured fields above are pulled
// out — still shown, just as plain "key: value" text instead of raw JSON.
function otherFields(log: SchedulerLogEntry): [string, string][] {
  if (!log.metadata) return [];
  return Object.entries(log.metadata)
    .filter(([key, value]) => !STRUCTURED_KEYS.has(key) && value !== null && value !== undefined)
    .map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]);
}

const {
  search,
  sortKey,
  sortDir,
  pageItems,
  sorted,
  page,
  pageSize,
  totalPages,
  toggleSort,
  goToPage,
} = useListControls(logs, {
  searchFields: (log) => [actionLabel(log.action), log.metadata ? JSON.stringify(log.metadata) : null],
  sortAccessors: {
    action: (log) => actionLabel(log.action).toLowerCase(),
    when: (log) => new Date(log.createdAt).getTime(),
  },
  defaultSort: { key: 'when', dir: 'desc' },
  pageSize: 25,
});

async function load() {
  error.value = '';
  try {
    logs.value = await apiRequest<SchedulerLogEntry[]>('/admin/scheduler-logs');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.schedulerLogs.loadFailed');
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.schedulerLogs.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <div class="admin-card">
      <div class="filter-row">
        <h2>{{ t('admin.schedulerLogs.recent', { count: sorted.length }) }}</h2>
        <div class="list-controls-row">
          <input v-model="search" class="admin-input" :placeholder="t('admin.schedulerLogs.searchPlaceholder')" />
          <button type="button" class="admin-btn admin-btn-ghost" @click="load">{{ t('admin.schedulerLogs.refresh') }}</button>
        </div>
      </div>
      <div class="table-scroll">
      <table class="admin-table">
        <thead>
          <tr>
            <SortableTh :label="t('admin.schedulerLogs.tableAction')" col-key="action" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
            <th>{{ t('admin.schedulerLogs.tableDetails') }}</th>
            <SortableTh :label="t('admin.schedulerLogs.tableWhen')" col-key="when" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in pageItems" :key="log._id">
            <td><span class="admin-badge">{{ actionLabel(log.action) }}</span></td>
            <td class="details-cell">
              <router-link
                v-if="walletId(log)"
                class="detail-chip"
                :to="{ name: 'admin-wallet-detail', params: { id: walletId(log) } }"
              >
                {{ t('admin.schedulerLogs.wallet') }}
              </router-link>
              <router-link
                v-if="singleTransactionId(log)"
                class="detail-chip"
                :to="{ name: 'admin-transaction-detail', params: { id: singleTransactionId(log) } }"
              >
                {{ t('admin.schedulerLogs.transaction') }}
              </router-link>
              <router-link
                v-for="tx in childTransactions(log)"
                :key="tx.id"
                class="detail-chip"
                :to="{ name: 'admin-transaction-detail', params: { id: tx.id } }"
              >
                {{ tx.amount }}{{ tx.destinationIban ? ` → ${tx.destinationIban}` : '' }}
              </router-link>
              <router-link
                v-for="installment in childInstallments(log)"
                :key="installment.id"
                class="detail-chip"
                :to="{ name: 'admin-wallet-detail', params: { id: installment.walletId } }"
              >
                {{ t('admin.schedulerLogs.installment') }} #{{ installment.sequenceNumber }} — {{ installment.amount }}
              </router-link>
              <span v-for="[key, value] in otherFields(log)" :key="key" class="detail-field">{{ key }}: {{ value }}</span>
              <span v-if="!log.metadata || !Object.keys(log.metadata).length" class="detail-field">{{ t('common.none') }}</span>
            </td>
            <td>{{ formatDateTime(log.createdAt) }}</td>
          </tr>
          <tr v-if="!pageItems.length"><td colspan="3">{{ t('admin.schedulerLogs.none') }}</td></tr>
        </tbody>
      </table>
      </div>
      <ListPagination
        :page="page"
        :total-pages="totalPages"
        :total="sorted.length"
        :page-size="pageSize"
        @update:page="goToPage"
        @update:page-size="pageSize = $event"
      />
    </div>
  </AdminLayout>
</template>

<style scoped>
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
.mono {
  font-family: monospace;
  font-size: 0.8rem;
  color: var(--text-dim);
}
.details-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.detail-chip {
  font-family: monospace;
  font-size: 0.76rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--input-bg, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--card-border);
  color: var(--accent-blue);
  text-decoration: none;
  white-space: nowrap;
}
.detail-chip:hover {
  border-color: var(--accent-blue);
}
.detail-field {
  font-family: monospace;
  font-size: 0.78rem;
  color: var(--text-dim);
  white-space: nowrap;
}
</style>
