<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '../../utils/date';
import {
  transactionStatusClass,
  transactionTypeClass,
  type AdminTransactionStatus,
  type AdminTransactionType,
} from '../../types/admin';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import MiniLineChart from '../../components/admin/MiniLineChart.vue';
import { useAdminLiveSocket } from '../../composables/useAdminLiveSocket';

const { t } = useI18n();

const {
  connected,
  unauthorized,
  transactions,
  statusChanges,
  walletChanges,
  glPostings,
  settlementActivity,
  installmentActivity,
} = useAdminLiveSocket();

// Raw ledger amounts arrive with no currency attached (an event can span
// wallets in any currency) — grouped-digit display only, not formatAmount's
// currency-aware minor-unit conversion.
function formatRaw(amount: string): string {
  return amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

type FeedTab = 'transactions' | 'wallets' | 'gl' | 'settlement';
const activeTab = ref<FeedTab>('transactions');

// Rolling per-minute event counts for the sparkline — every event pushes its
// own minute bucket forward, so this stays a live "events/min" view rather
// than a historical chart (that's AdminReportsView's job).
const MINUTE_BUCKETS = 30;
const minuteBuckets = ref<number[]>(new Array(MINUTE_BUCKETS).fill(0));
let lastBucketMinute = Math.floor(Date.now() / 60_000);

function tickEvent() {
  const currentMinute = Math.floor(Date.now() / 60_000);
  const shift = currentMinute - lastBucketMinute;
  if (shift > 0) {
    const shifted = minuteBuckets.value.slice(Math.min(shift, MINUTE_BUCKETS));
    minuteBuckets.value = [
      ...new Array(Math.max(MINUTE_BUCKETS - shifted.length, 0)).fill(0),
      ...shifted,
    ];
    lastBucketMinute = currentMinute;
  }
  minuteBuckets.value = [
    ...minuteBuckets.value.slice(0, MINUTE_BUCKETS - 1),
    minuteBuckets.value[MINUTE_BUCKETS - 1] + 1,
  ];
}

// Ticks the sparkline forward once per newly-arrived event, however many
// arrived since the last check — a burst (e.g. a multi-leg GL entry) counts
// every leg, not just "something changed".
const totalEventCount = computed(
  () =>
    transactions.value.length +
    statusChanges.value.length +
    walletChanges.value.length +
    glPostings.value.length +
    settlementActivity.value.length +
    installmentActivity.value.length,
);
let lastSeenTotal = 0;
watch(totalEventCount, (value) => {
  for (let i = 0; i < value - lastSeenTotal; i++) tickEvent();
  lastSeenTotal = value;
});

const eventsPerMinute = computed(() => minuteBuckets.value[minuteBuckets.value.length - 1]);
</script>

<template>
  <AdminLayout :title="t('admin.liveActivity.title')">
    <p v-if="unauthorized" class="admin-error">{{ t('admin.liveActivity.unauthorized') }}</p>

    <div class="kpi-grid">
      <div class="admin-card kpi-card">
        <span class="kpi-value">
          <span class="status-dot" :class="connected ? 'status-dot-live' : 'status-dot-off'" />
          {{ connected ? t('admin.liveActivity.live') : t('admin.liveActivity.reconnecting') }}
        </span>
        <span class="kpi-label">{{ t('admin.liveActivity.connection') }}</span>
      </div>
      <div class="admin-card kpi-card">
        <span class="kpi-value">{{ eventsPerMinute }}</span>
        <span class="kpi-label">{{ t('admin.liveActivity.eventsPerMinute') }}</span>
      </div>
      <div class="admin-card kpi-card">
        <span class="kpi-value">{{ transactions.length }}</span>
        <span class="kpi-label">{{ t('admin.liveActivity.transactionsSeen') }}</span>
      </div>
      <div class="admin-card kpi-card">
        <span class="kpi-value">{{ glPostings.length }}</span>
        <span class="kpi-label">{{ t('admin.liveActivity.glPostingsSeen') }}</span>
      </div>
    </div>

    <div class="admin-card">
      <h2>{{ t('admin.liveActivity.activityHeading') }}</h2>
      <MiniLineChart :data="minuteBuckets" color="#d8ff5c" :height="90" />
    </div>

    <div class="admin-card">
      <div class="feed-tabs">
        <button
          type="button"
          class="feed-tab"
          :class="{ active: activeTab === 'transactions' }"
          @click="activeTab = 'transactions'"
        >
          {{ t('admin.liveActivity.tabTransactions') }} ({{ transactions.length }})
        </button>
        <button
          type="button"
          class="feed-tab"
          :class="{ active: activeTab === 'wallets' }"
          @click="activeTab = 'wallets'"
        >
          {{ t('admin.liveActivity.tabWallets') }} ({{ walletChanges.length }})
        </button>
        <button
          type="button"
          class="feed-tab"
          :class="{ active: activeTab === 'gl' }"
          @click="activeTab = 'gl'"
        >
          {{ t('admin.liveActivity.tabGl') }} ({{ glPostings.length }})
        </button>
        <button
          type="button"
          class="feed-tab"
          :class="{ active: activeTab === 'settlement' }"
          @click="activeTab = 'settlement'"
        >
          {{ t('admin.liveActivity.tabSettlement') }} ({{
            settlementActivity.length + installmentActivity.length
          }})
        </button>
      </div>

      <div v-if="activeTab === 'transactions'" class="table-scroll">
        <table class="admin-table">
          <thead>
            <tr>
              <th>{{ t('admin.liveActivity.tableType') }}</th>
              <th>{{ t('admin.liveActivity.tableStatus') }}</th>
              <th>{{ t('admin.liveActivity.tableAmount') }}</th>
              <th>{{ t('admin.liveActivity.tableWhen') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tx in transactions" :key="tx.id">
              <td>
                <span class="admin-badge" :class="transactionTypeClass(tx.type as AdminTransactionType)">
                  {{ t(`admin.transactions.${tx.type.toLowerCase()}`) }}
                </span>
              </td>
              <td>
                <span class="admin-badge" :class="transactionStatusClass(tx.status as AdminTransactionStatus)">
                  {{ t(`admin.transactions.status${tx.status}`) }}
                </span>
              </td>
              <td>{{ formatRaw(tx.amount) }}</td>
              <td>{{ formatDateTime(tx.createdAt) }}</td>
            </tr>
            <tr v-if="!transactions.length">
              <td colspan="4">{{ t('admin.liveActivity.waiting') }}</td>
            </tr>
          </tbody>
        </table>
        <h3 v-if="statusChanges.length" class="feed-subheading">
          {{ t('admin.liveActivity.statusChangesHeading') }}
        </h3>
        <table v-if="statusChanges.length" class="admin-table">
          <thead>
            <tr>
              <th>{{ t('admin.liveActivity.tableStatus') }}</th>
              <th>{{ t('admin.liveActivity.tableReason') }}</th>
              <th>{{ t('admin.liveActivity.tableWhen') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(change, i) in statusChanges" :key="`${change.id}-${i}`">
              <td>
                <span
                  class="admin-badge"
                  :class="transactionStatusClass(change.status as AdminTransactionStatus)"
                >
                  {{ t(`admin.transactions.status${change.status}`) }}
                </span>
              </td>
              <td>{{ change.reason ?? '—' }}</td>
              <td>{{ formatDateTime(change.updatedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="activeTab === 'wallets'" class="table-scroll">
        <table class="admin-table">
          <thead>
            <tr>
              <th>{{ t('admin.liveActivity.tableWallet') }}</th>
              <th>{{ t('admin.liveActivity.tableDelta') }}</th>
              <th>{{ t('admin.liveActivity.tableDescription') }}</th>
              <th>{{ t('admin.liveActivity.tableWhen') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(change, i) in walletChanges" :key="`${change.walletId}-${i}`">
              <td class="mono">{{ change.walletId.slice(0, 8) }}</td>
              <td :class="change.delta.startsWith('-') ? 'delta-negative' : 'delta-positive'">
                {{ change.delta.startsWith('-') ? '' : '+' }}{{ formatRaw(change.delta) }}
              </td>
              <td>{{ change.description }}</td>
              <td>{{ formatDateTime(change.at) }}</td>
            </tr>
            <tr v-if="!walletChanges.length">
              <td colspan="4">{{ t('admin.liveActivity.waiting') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="activeTab === 'gl'" class="table-scroll">
        <table class="admin-table">
          <thead>
            <tr>
              <th>{{ t('admin.liveActivity.tableDescription') }}</th>
              <th>{{ t('admin.liveActivity.tableLegs') }}</th>
              <th>{{ t('admin.liveActivity.tableWhen') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="posting in glPostings" :key="posting.journalEntryId">
              <td>{{ posting.description }}</td>
              <td>
                <span v-for="(leg, i) in posting.postings" :key="i" class="gl-leg">
                  {{ leg.accountCode }} {{ leg.direction }} {{ formatRaw(leg.amount) }}
                </span>
              </td>
              <td>{{ formatDateTime(posting.at) }}</td>
            </tr>
            <tr v-if="!glPostings.length">
              <td colspan="3">{{ t('admin.liveActivity.waiting') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="table-scroll">
        <table class="admin-table">
          <thead>
            <tr>
              <th>{{ t('admin.liveActivity.tableKind') }}</th>
              <th>{{ t('admin.liveActivity.tableDetail') }}</th>
              <th>{{ t('admin.liveActivity.tableWhen') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(activity, i) in settlementActivity" :key="`settle-${i}`">
              <td>{{ t('admin.liveActivity.kindSettlement') }}</td>
              <td>{{ activity.transactionIds.length }} {{ t('admin.liveActivity.withdrawals') }}</td>
              <td>{{ formatDateTime(activity.at) }}</td>
            </tr>
            <tr v-for="(activity, i) in installmentActivity" :key="`inst-${i}`">
              <td>{{ t(`admin.liveActivity.kind${activity.kind === 'generated' ? 'Generated' : 'Overdue'}`) }}</td>
              <td>{{ activity.count }}</td>
              <td>{{ formatDateTime(activity.at) }}</td>
            </tr>
            <tr v-if="!settlementActivity.length && !installmentActivity.length">
              <td colspan="3">{{ t('admin.liveActivity.waiting') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </AdminLayout>
</template>

<style scoped>
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}
.kpi-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kpi-value {
  font-size: 1.6rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
}
.kpi-label {
  font-size: 0.8rem;
  color: var(--text-dim);
}
.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.status-dot-live {
  background: var(--accent-lime, #d8ff5c);
  box-shadow: 0 0 6px var(--accent-lime, #d8ff5c);
}
.status-dot-off {
  background: var(--accent-red, #ff4d4f);
}
.feed-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.feed-tab {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent;
  color: var(--text-dim);
  font-size: 0.82rem;
  cursor: pointer;
}
.feed-tab.active {
  background: var(--accent-lime, #d8ff5c);
  color: #10130c;
  border-color: transparent;
}
.feed-subheading {
  margin-top: 20px;
  font-size: 0.95rem;
}
.mono {
  font-family: monospace;
  font-size: 0.82rem;
}
.delta-positive {
  color: var(--accent-lime, #d8ff5c);
}
.delta-negative {
  color: var(--accent-red, #ff4d4f);
}
.gl-leg {
  display: inline-block;
  margin-inline-end: 10px;
  font-size: 0.78rem;
  color: var(--text-dim);
}
</style>
