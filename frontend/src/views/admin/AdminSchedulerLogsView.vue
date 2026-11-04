<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { formatDate } from '../../utils/date';
import { formatRelative, formatTime } from '../../utils/adminFormat';
import { useListControls } from '../../composables/useListControls';
import AdminLayout from '../../components/admin/AdminLayout.vue';
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

const outcomeFilter = ref<'' | 'ok' | 'failed'>('');
const actionFilter = ref('');
const filteredLogs = computed(() =>
  logs.value.filter(
    (log) =>
      (!actionFilter.value || log.action === actionFilter.value) &&
      (!outcomeFilter.value || (outcomeFilter.value === 'ok') === log.success),
  ),
);
const actionCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const log of logs.value) counts.set(log.action, (counts.get(log.action) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
});
const failures = computed(() => logs.value.filter((l) => !l.success).length);
const successRate = computed(() =>
  logs.value.length ? Math.round(((logs.value.length - failures.value) / logs.value.length) * 100) : null,
);
const lastRun = computed(() =>
  logs.value.reduce<string | null>((latest, l) => (!latest || l.createdAt > latest ? l.createdAt : latest), null),
);

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
} = useListControls(filteredLogs, {
  searchFields: (log) => [actionLabel(log.action), log.metadata ? JSON.stringify(log.metadata) : null],
  sortAccessors: {
    action: (log) => actionLabel(log.action).toLowerCase(),
    when: (log) => new Date(log.createdAt).getTime(),
  },
  defaultSort: { key: 'when', dir: 'desc' },
  pageSize: 25,
});

watch([outcomeFilter, actionFilter], () => goToPage(1));
const loading = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    logs.value = await apiRequest<SchedulerLogEntry[]>('/admin/scheduler-logs');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.schedulerLogs.loadFailed');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.schedulerLogs.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <div class="stat-tiles">
      <div class="stat-tile">
        <span class="stat-tile-label"><span class="stat-icon stat-icon-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></svg></span>{{ t('admin.schedulerLogs.statRuns') }}</span>
        <span class="stat-tile-value">{{ logs.length }}</span>
        <span class="stat-tile-meta">{{ lastRun ? t('admin.schedulerLogs.statLastRun', { when: formatRelative(lastRun) }) : '—' }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label"><span class="stat-icon stat-icon-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>{{ t('admin.schedulerLogs.statSuccess') }}</span>
        <span class="stat-tile-value">{{ successRate === null ? '—' : `${successRate}%` }}</span>
        <span class="stat-tile-meta">{{ t('admin.schedulerLogs.statSuccessMeta', { count: logs.length - failures }) }}</span>
      </div>
      <button type="button" class="stat-tile stat-btn" :class="{ active: outcomeFilter === 'failed' }" @click="outcomeFilter = outcomeFilter === 'failed' ? '' : 'failed'">
        <span class="stat-tile-label"><span class="stat-icon stat-icon-red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17" /></svg></span>{{ t('admin.schedulerLogs.statFailed') }}</span>
        <span class="stat-tile-value">{{ failures }}</span>
        <span class="stat-tile-meta">{{ t('admin.schedulerLogs.statFailedMeta') }}</span>
      </button>
    </div>

    <section class="admin-card">
      <div class="toolbar">
        <h2>{{ t('admin.schedulerLogs.recent', { count: sorted.length }) }}</h2>
        <div class="toolbar-right">
          <div class="segmented">
            <button type="button" :class="{ active: !outcomeFilter }" @click="outcomeFilter = ''">{{ t('admin.transactions.allStatuses') }}</button>
            <button type="button" :class="{ active: outcomeFilter === 'ok' }" @click="outcomeFilter = 'ok'">{{ t('admin.reports.outcomeSuccess') }}</button>
            <button type="button" :class="{ active: outcomeFilter === 'failed' }" @click="outcomeFilter = 'failed'">{{ t('admin.reports.outcomeFailure') }}</button>
          </div>
          <label class="admin-search search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input v-model="search" type="search" class="admin-input" :placeholder="t('admin.schedulerLogs.searchPlaceholder')" />
          </label>
          <button type="button" class="admin-btn admin-btn-ghost" :disabled="loading" @click="load">
            <svg :class="{ spin: loading }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" /></svg>
            {{ t('admin.schedulerLogs.refresh') }}
          </button>
        </div>
      </div>
      <div class="job-chips">
        <button type="button" class="filter-chip" :class="{ active: !actionFilter }" @click="actionFilter = ''">{{ t('admin.schedulerLogs.allJobs') }}</button>
        <button
          v-for="[action, count] in actionCounts"
          :key="action"
          type="button"
          class="filter-chip"
          :class="{ active: actionFilter === action }"
          @click="actionFilter = actionFilter === action ? '' : action"
        >
          {{ actionLabel(action) }} <span class="chip-count">{{ count }}</span>
        </button>
      </div>

      <ol class="runs">
        <template v-for="(log, index) in pageItems" :key="log._id">
          <li v-if="sortKey === 'when' && (index === 0 || formatDate(log.createdAt) !== formatDate(pageItems[index - 1].createdAt))" class="day-head">
            {{ formatDate(log.createdAt) }}
          </li>
          <li class="run" :class="{ failed: !log.success }">
            <span class="outcome" :class="log.success ? 'ok' : 'bad'" :title="log.success ? t('admin.reports.outcomeSuccess') : t('admin.reports.outcomeFailure')">
              <svg v-if="log.success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17" /></svg>
            </span>
            <div class="run-main">
              <div class="run-title">
                <span class="run-job">{{ actionLabel(log.action) }}</span>
                <span v-if="!log.success" class="admin-badge admin-badge-danger">{{ t('admin.reports.outcomeFailure') }}</span>
              </div>
              <div class="details">
                <router-link v-if="walletId(log)" class="detail-chip" :to="{ name: 'admin-wallet-detail', params: { id: walletId(log) } }">
                  {{ t('admin.schedulerLogs.wallet') }} #{{ walletId(log)!.slice(0, 8) }}
                </router-link>
                <router-link v-if="singleTransactionId(log)" class="detail-chip" :to="{ name: 'admin-transaction-detail', params: { id: singleTransactionId(log) } }">
                  {{ t('admin.schedulerLogs.transaction') }} #{{ singleTransactionId(log)!.slice(0, 8) }}
                </router-link>
                <router-link v-for="tx in childTransactions(log)" :key="tx.id" class="detail-chip" :to="{ name: 'admin-transaction-detail', params: { id: tx.id } }">
                  {{ tx.amount }}{{ tx.destinationIban ? ` → ${tx.destinationIban}` : '' }}
                </router-link>
                <router-link v-for="installment in childInstallments(log)" :key="installment.id" class="detail-chip" :to="{ name: 'admin-wallet-detail', params: { id: installment.walletId } }">
                  {{ t('admin.schedulerLogs.installment') }} #{{ installment.sequenceNumber }} · {{ installment.amount }}
                </router-link>
                <span v-for="[key, value] in otherFields(log)" :key="key" class="detail-field"><span class="field-key">{{ key }}</span> {{ value }}</span>
              </div>
            </div>
            <span class="run-time" :title="formatDate(log.createdAt)">
              <span>{{ formatTime(log.createdAt) }}</span>
              <span class="run-rel">{{ formatRelative(log.createdAt) }}</span>
            </span>
          </li>
        </template>
        <li v-if="!pageItems.length" class="empty-state">{{ t('admin.schedulerLogs.none') }}</li>
      </ol>
      <ListPagination
        :page="page"
        :total-pages="totalPages"
        :total="sorted.length"
        :page-size="pageSize"
        @update:page="goToPage"
        @update:page-size="pageSize = $event"
      />
    </section>
  </AdminLayout>
</template>

<style scoped>
.stat-btn {
  font: inherit;
  color: inherit;
  text-align: start;
  cursor: pointer;
}
.stat-btn:hover {
  border-color: color-mix(in srgb, var(--accent-blue) 40%, var(--card-border));
}
.stat-btn.active {
  border-color: var(--accent-blue);
  box-shadow: var(--focus-ring);
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.toolbar h2 {
  margin: 0;
}
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.search-box {
  width: 240px;
  max-width: 100%;
}
.spin {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.job-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 14px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--divider);
}
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  color: var(--text-dim);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.filter-chip:hover {
  color: var(--text);
}
.filter-chip.active {
  background: var(--active-tint);
  border-color: var(--accent-blue);
  color: var(--accent-blue);
}
.chip-count {
  font-size: 0.7rem;
  color: var(--text-dimmer);
}
.runs {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
}
.day-head {
  padding: 14px 4px 6px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dimmer);
}
.run {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: flex-start;
  gap: 14px;
  padding: 12px 10px;
  border-radius: var(--radius-sm);
  border-top: 1px solid var(--divider);
}
.day-head + .run {
  border-top-color: transparent;
}
.run:hover {
  background: var(--hover-tint);
}
.run.failed {
  background: color-mix(in srgb, var(--badge-tint-red) 55%, transparent);
}
.outcome {
  width: 24px;
  height: 24px;
  margin-top: 1px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.outcome svg {
  width: 12px;
  height: 12px;
}
.outcome.ok { background: var(--badge-tint-lime); color: var(--accent-lime); }
.outcome.bad { background: var(--accent-red); color: #fff; }
.run-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.run-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.run-job {
  font-weight: 650;
}
.details {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.detail-chip {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.74rem;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  color: var(--accent-blue);
  text-decoration: none;
  white-space: nowrap;
}
.detail-chip:hover {
  border-color: var(--accent-blue);
}
.detail-field {
  font-size: 0.76rem;
  color: var(--text-dim);
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--panel-bg);
}
.field-key {
  color: var(--text-dimmer);
}
.run-time {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: 0.84rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.run-rel {
  font-size: 0.74rem;
  color: var(--text-dimmer);
}
</style>
