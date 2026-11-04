<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatRelative, formatTime, TX_TYPE_ICONS } from '../../utils/adminFormat';
import {
  transactionStatusClass,
  transactionTypeClass,
  type AdminTransactionStatus,
  type AdminTransactionType,
} from '../../types/admin';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import TrendChart from '../../components/admin/TrendChart.vue';
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

const minuteLabels = computed(() =>
  minuteBuckets.value.map((_, i) => {
    const ago = MINUTE_BUCKETS - 1 - i;
    return ago === 0 ? t('admin.liveActivity.now') : t('admin.liveActivity.minutesAgo', { count: ago });
  }),
);
const totalLast30 = computed(() => minuteBuckets.value.reduce((a, b) => a + b, 0));

// Re-render relative times ("12s ago") every 10 seconds.
const clock = ref(0);
const timer = window.setInterval(() => (clock.value += 1), 10_000);
onBeforeUnmount(() => window.clearInterval(timer));
function ago(value: string): string {
  void clock.value;
  return formatRelative(value);
}

const tabs = computed(() => [
  { key: 'transactions' as FeedTab, label: t('admin.liveActivity.tabTransactions'), count: transactions.value.length },
  { key: 'wallets' as FeedTab, label: t('admin.liveActivity.tabWallets'), count: walletChanges.value.length },
  { key: 'gl' as FeedTab, label: t('admin.liveActivity.tabGl'), count: glPostings.value.length },
  { key: 'settlement' as FeedTab, label: t('admin.liveActivity.tabSettlement'), count: settlementActivity.value.length + installmentActivity.value.length },
]);

function txIcon(type: string): string {
  return TX_TYPE_ICONS[type as AdminTransactionType] ?? TX_TYPE_ICONS.VIRTUAL;
}

const eventsPerMinute = computed(() => minuteBuckets.value[minuteBuckets.value.length - 1]);
</script>

<template>
  <AdminLayout :title="t('admin.liveActivity.title')">
    <p v-if="unauthorized" class="admin-error">{{ t('admin.liveActivity.unauthorized') }}</p>

    <div class="stat-tiles">
      <div class="stat-tile conn" :class="connected ? 'is-live' : 'is-off'">
        <span class="stat-tile-label">{{ t('admin.liveActivity.connection') }}</span>
        <span class="stat-tile-value conn-value">
          <span class="pulse" />
          {{ connected ? t('admin.liveActivity.live') : t('admin.liveActivity.reconnecting') }}
        </span>
        <span class="stat-tile-meta">{{ connected ? t('admin.liveActivity.streaming') : t('admin.liveActivity.retrying') }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label">{{ t('admin.liveActivity.eventsPerMinute') }}</span>
        <span class="stat-tile-value">{{ eventsPerMinute }}</span>
        <span class="stat-tile-meta">{{ t('admin.liveActivity.last30Total', { count: totalLast30 }) }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label">{{ t('admin.liveActivity.transactionsSeen') }}</span>
        <span class="stat-tile-value">{{ transactions.length }}</span>
        <span class="stat-tile-meta">{{ t('admin.liveActivity.statusChangesCount', { count: statusChanges.length }) }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label">{{ t('admin.liveActivity.glPostingsSeen') }}</span>
        <span class="stat-tile-value">{{ glPostings.length }}</span>
        <span class="stat-tile-meta">{{ t('admin.liveActivity.sinceOpened') }}</span>
      </div>
    </div>

    <section class="admin-card">
      <div class="admin-card-head">
        <div>
          <h2>{{ t('admin.liveActivity.activityHeading') }}</h2>
          <p class="admin-card-sub">{{ t('admin.liveActivity.chartHint') }}</p>
        </div>
      </div>
      <TrendChart :data="minuteBuckets" :labels="minuteLabels" :unit="t('admin.liveActivity.events')" :height="160" />
    </section>

    <section class="admin-card">
      <div class="feed-head">
        <div class="segmented" role="tablist">
          <button v-for="tab in tabs" :key="tab.key" type="button" role="tab" :aria-selected="activeTab === tab.key" :class="{ active: activeTab === tab.key }" @click="activeTab = tab.key">
            {{ tab.label }} <span class="count">{{ tab.count }}</span>
          </button>
        </div>
      </div>

      <!-- Transactions -->
      <template v-if="activeTab === 'transactions'">
        <TransitionGroup tag="ul" name="feed" class="feed">
          <li v-for="tx in transactions" :key="tx.id" class="feed-item">
            <span class="type-icon" :class="transactionTypeClass(tx.type as AdminTransactionType)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="txIcon(tx.type)" /></svg>
            </span>
            <span class="feed-main">
              <span class="feed-title">
                {{ t(`admin.transactions.${tx.type.toLowerCase()}`) }}
                <span class="admin-badge" :class="transactionStatusClass(tx.status as AdminTransactionStatus)">{{ t(`admin.transactions.status${tx.status}`) }}</span>
              </span>
              <router-link class="feed-sub mono" :to="{ name: 'admin-transaction-detail', params: { id: tx.id } }">#{{ tx.id.slice(0, 8) }}</router-link>
            </span>
            <span class="feed-amount">{{ formatRaw(tx.amount) }}</span>
            <span class="feed-time" :title="formatTime(tx.createdAt)">{{ ago(tx.createdAt) }}</span>
          </li>
        </TransitionGroup>
        <div v-if="!transactions.length" class="waiting"><span class="pulse" />{{ t('admin.liveActivity.waiting') }}</div>

        <template v-if="statusChanges.length">
          <span class="group-label status-head">{{ t('admin.liveActivity.statusChangesHeading') }}</span>
          <ul class="feed">
            <li v-for="(change, i) in statusChanges" :key="`${change.id}-${i}`" class="feed-item compact">
              <span class="admin-badge" :class="transactionStatusClass(change.status as AdminTransactionStatus)">{{ t(`admin.transactions.status${change.status}`) }}</span>
              <span class="feed-main"><span class="feed-title light">{{ change.reason ?? '—' }}</span></span>
              <router-link class="feed-sub mono" :to="{ name: 'admin-transaction-detail', params: { id: change.id } }">#{{ change.id.slice(0, 8) }}</router-link>
              <span class="feed-time">{{ ago(change.updatedAt) }}</span>
            </li>
          </ul>
        </template>
      </template>

      <!-- Wallet balance changes -->
      <template v-else-if="activeTab === 'wallets'">
        <TransitionGroup tag="ul" name="feed" class="feed">
          <li v-for="(change, i) in walletChanges" :key="`${change.walletId}-${change.transactionId}-${i}`" class="feed-item">
            <span class="delta-icon" :class="change.delta.startsWith('-') ? 'neg' : 'pos'">{{ change.delta.startsWith('-') ? '−' : '+' }}</span>
            <span class="feed-main">
              <span class="feed-title">{{ change.description }}</span>
              <router-link class="feed-sub mono" :to="{ name: 'admin-wallet-detail', params: { id: change.walletId } }">{{ t('admin.liveActivity.tableWallet') }} #{{ change.walletId.slice(0, 8) }}</router-link>
            </span>
            <span class="feed-amount" :class="change.delta.startsWith('-') ? 'neg' : 'pos'">{{ change.delta.startsWith('-') ? '' : '+' }}{{ formatRaw(change.delta) }}</span>
            <span class="feed-time">{{ ago(change.at) }}</span>
          </li>
        </TransitionGroup>
        <div v-if="!walletChanges.length" class="waiting"><span class="pulse" />{{ t('admin.liveActivity.waiting') }}</div>
      </template>

      <!-- GL postings -->
      <template v-else-if="activeTab === 'gl'">
        <TransitionGroup tag="ul" name="feed" class="feed">
          <li v-for="posting in glPostings" :key="posting.journalEntryId" class="feed-item gl-item">
            <span class="type-icon stat-icon-blue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h3" /></svg>
            </span>
            <span class="feed-main">
              <span class="feed-title">{{ posting.description }}</span>
              <span class="legs">
                <span v-for="(leg, i) in posting.postings" :key="i" class="leg" :class="leg.direction === 'DEBIT' ? 'dr' : 'cr'">
                  <span class="leg-side">{{ leg.direction === 'DEBIT' ? 'Dr' : 'Cr' }}</span>
                  <span class="leg-acct">{{ leg.accountCode }}</span>
                  <span class="leg-amt">{{ formatRaw(leg.amount) }}</span>
                </span>
              </span>
            </span>
            <span class="feed-time">{{ ago(posting.at) }}</span>
          </li>
        </TransitionGroup>
        <div v-if="!glPostings.length" class="waiting"><span class="pulse" />{{ t('admin.liveActivity.waiting') }}</div>
      </template>

      <!-- Settlement & installments -->
      <template v-else>
        <ul class="feed">
          <li v-for="(activity, i) in settlementActivity" :key="`settle-${i}`" class="feed-item">
            <span class="type-icon stat-icon-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10h16M6 10v8M10 10v8M14 10v8M18 10v8M3 20h18M12 3l9 5H3l9-5z" /></svg></span>
            <span class="feed-main">
              <span class="feed-title">{{ t('admin.liveActivity.kindSettlement') }}</span>
              <span class="feed-sub">{{ activity.transactionIds.length }} {{ t('admin.liveActivity.withdrawals') }}<template v-if="activity.railType"> · {{ activity.railType }}</template></span>
            </span>
            <span class="feed-time">{{ ago(activity.at) }}</span>
          </li>
          <li v-for="(activity, i) in installmentActivity" :key="`inst-${i}`" class="feed-item">
            <span class="type-icon" :class="activity.kind === 'generated' ? 'stat-icon-blue' : 'stat-icon-red'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg></span>
            <span class="feed-main">
              <span class="feed-title">{{ t(`admin.liveActivity.kind${activity.kind === 'generated' ? 'Generated' : 'Overdue'}`) }}</span>
              <span class="feed-sub">{{ t('admin.liveActivity.installmentsCount', { count: activity.count }) }}</span>
            </span>
            <span class="feed-time">{{ ago(activity.at) }}</span>
          </li>
        </ul>
        <div v-if="!settlementActivity.length && !installmentActivity.length" class="waiting"><span class="pulse" />{{ t('admin.liveActivity.waiting') }}</div>
      </template>
    </section>
  </AdminLayout>
</template>

<style scoped>
.conn-value {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pulse {
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: 50%;
  background: var(--text-dimmer);
}
.is-live .pulse,
.waiting .pulse {
  background: var(--accent-lime);
  animation: pulse 1.6s ease-out infinite;
}
.is-live {
  border-color: color-mix(in srgb, var(--accent-lime) 35%, var(--card-border));
}
.is-live .conn-value {
  color: var(--accent-lime);
}
.is-off .pulse {
  background: var(--accent-orange);
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-lime) 55%, transparent); }
  100% { box-shadow: 0 0 0 10px transparent; }
}
.feed-head {
  margin-bottom: 10px;
  overflow-x: auto;
}
.feed {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 560px;
  overflow-y: auto;
}
.feed-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto 80px;
  align-items: center;
  gap: 14px;
  padding: 10px 6px;
  border-bottom: 1px solid var(--divider);
}
.feed-item.compact {
  grid-template-columns: auto minmax(0, 1fr) auto 80px;
  padding-block: 8px;
}
.gl-item {
  grid-template-columns: auto minmax(0, 1fr) 80px;
  align-items: flex-start;
}
.feed-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.feed-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.88rem;
}
.feed-title.light {
  font-weight: 500;
}
.feed-sub {
  font-size: 0.76rem;
  color: var(--text-dimmer);
  text-decoration: none;
}
a.feed-sub:hover {
  color: var(--accent-blue);
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.feed-amount {
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.feed-amount.pos { color: var(--accent-lime); }
.feed-amount.neg { color: var(--accent-red); }
.feed-time {
  font-size: 0.76rem;
  color: var(--text-dimmer);
  text-align: end;
  white-space: nowrap;
}
.delta-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1.1rem;
}
.delta-icon.pos { background: var(--badge-tint-lime); color: var(--accent-lime); }
.delta-icon.neg { background: var(--badge-tint-red); color: var(--accent-red); }
.legs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.leg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.74rem;
  padding: 2px 8px 2px 2px;
  border-radius: 999px;
  background: var(--panel-bg);
  border: 1px solid var(--divider);
}
.leg-side {
  font-weight: 700;
  font-size: 0.66rem;
  padding: 1px 6px;
  border-radius: 999px;
}
.leg.dr .leg-side { background: var(--badge-tint-blue); color: var(--accent-blue); }
.leg.cr .leg-side { background: var(--badge-tint-orange); color: var(--accent-orange); }
.leg-acct {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--text-dim);
}
.leg-amt {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.status-head {
  margin-top: 20px;
}
.waiting {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 36px 0;
  color: var(--text-dim);
  font-size: 0.88rem;
}
.feed-enter-active {
  transition: background 1.2s ease, transform 0.25s ease, opacity 0.25s ease;
}
.feed-enter-from {
  opacity: 0;
  transform: translateY(-6px);
  background: var(--active-tint);
}
@media (max-width: 640px) {
  .feed-item {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
  .feed-time {
    display: none;
  }
}
</style>
