<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

type Granularity = 'hour' | 'day' | 'week';

const props = defineProps<{
  transactions: { createdAt: string }[];
}>();

const { t } = useI18n();
const granularity = ref<Granularity>('hour');

// Hour zooms into the last day, day into the last two weeks, week into the
// last two months — each step "zooms out" to a coarser, longer window.
const BUCKET_COUNTS: Record<Granularity, number> = { hour: 24, day: 14, week: 8 };
const BUCKET_MS: Record<Granularity, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

const buckets = computed(() => {
  const count = BUCKET_COUNTS[granularity.value];
  const bucketMs = BUCKET_MS[granularity.value];
  const now = Date.now();
  // Round the window end up to the next bucket boundary so the most recent
  // bar represents a full bucket instead of visibly shrinking mid-bucket.
  const end = Math.ceil(now / bucketMs) * bucketMs;
  const counts = new Array(count).fill(0);
  for (const tx of props.transactions) {
    const time = new Date(tx.createdAt).getTime();
    const diff = end - time;
    if (diff < 0) continue;
    const idx = count - 1 - Math.floor(diff / bucketMs);
    if (idx >= 0 && idx < count) counts[idx] += 1;
  }
  return counts.map((value, i) => {
    const start = new Date(end - (count - i) * bucketMs);
    const bucketEnd = new Date(start.getTime() + bucketMs);
    return { value, start, end: bucketEnd };
  });
});

const maxValue = computed(() => Math.max(...buckets.value.map((b) => b.value), 1));
const total = computed(() => buckets.value.reduce((sum, b) => sum + b.value, 0));

function bucketLabel(bucket: { start: Date; end: Date }): string {
  if (granularity.value === 'hour') {
    return bucket.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (granularity.value === 'week') {
    return `${bucket.start.toLocaleDateString()} – ${bucket.end.toLocaleDateString()}`;
  }
  return bucket.start.toLocaleDateString();
}

// Sparse x-axis labels — every bar would be unreadable at 24 hourly bars.
function showAxisLabel(index: number): boolean {
  const count = buckets.value.length;
  const step = granularity.value === 'hour' ? 4 : granularity.value === 'day' ? 2 : 1;
  return index === count - 1 || index % step === 0;
}
</script>

<template>
  <div class="activity-chart">
    <div class="activity-chart-head">
      <span class="activity-chart-total">{{ t('dashboard.activity.count', { count: total }) }}</span>
      <div class="activity-chart-zoom">
        <button
          v-for="g in (['hour', 'day', 'week'] as const)"
          :key="g"
          type="button"
          class="zoom-btn"
          :class="{ active: granularity === g }"
          @click="granularity = g"
        >
          {{ t(`dashboard.activity.${g}`) }}
        </button>
      </div>
    </div>

    <div v-if="total > 0" class="activity-chart-bars">
      <div
        v-for="(b, i) in buckets"
        :key="i"
        class="activity-bar-col"
        :title="`${bucketLabel(b)} — ${b.value}`"
      >
        <div class="activity-bar" :class="{ 'has-value': b.value > 0 }" :style="{ height: `${(b.value / maxValue) * 100}%` }" />
        <span class="activity-bar-axis">{{ showAxisLabel(i) ? bucketLabel(b) : '' }}</span>
      </div>
    </div>
    <p v-else class="activity-chart-empty">{{ t('dashboard.activity.empty') }}</p>
  </div>
</template>

<style scoped>
.activity-chart {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.activity-chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.activity-chart-total {
  font-size: 0.82rem;
  color: var(--text-dim);
  font-weight: 600;
}
.activity-chart-zoom {
  display: flex;
  gap: 4px;
  background: var(--panel-bg, rgba(127, 127, 127, 0.08));
  border-radius: 999px;
  padding: 3px;
}
.zoom-btn {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 0.72rem;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  cursor: pointer;
  font-family: inherit;
}
.zoom-btn.active {
  background: var(--card-bg, #fff);
  color: var(--accent-blue);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}
.activity-chart-bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 90px;
}
.activity-bar-col {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}
.activity-bar {
  width: 100%;
  min-height: 2px;
  border-radius: 3px 3px 1px 1px;
  background: var(--divider);
  transition: background 150ms ease;
}
.activity-bar.has-value {
  background: var(--accent-blue);
}
.activity-bar-col:hover .activity-bar {
  background: var(--accent-orange-soft, var(--accent-blue));
}
.activity-bar-axis {
  font-size: 0.6rem;
  color: var(--text-dimmer);
  white-space: nowrap;
  height: 12px;
}
.activity-chart-empty {
  color: var(--text-dim);
  font-size: 0.85rem;
  padding: 20px 0;
  text-align: center;
}
</style>
