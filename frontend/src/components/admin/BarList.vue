<script setup lang="ts">
// Ranked horizontal bars for a categorical breakdown (magnitude, one hue).
// Values are always printed beside each bar in text ink, so the bar colour
// never carries meaning on its own; the optional `dot` class gives a row an
// identity marker (e.g. a transaction type's colour) next to its label.
defineProps<{
  rows: { label: string; count: number; pct: number; dot?: string; share?: number }[];
  emptyLabel: string;
}>();
</script>

<template>
  <ul v-if="rows.length" class="bars">
    <li v-for="row in rows" :key="row.label" class="bar-row" :title="`${row.label}: ${row.count}`">
      <span class="bar-label">
        <span v-if="row.dot" class="bar-dot" :class="row.dot" />
        <span class="bar-text">{{ row.label }}</span>
      </span>
      <span class="bar-track"><span class="bar-fill" :style="{ width: `${Math.max(row.pct, 2)}%` }" /></span>
      <span class="bar-value">
        {{ row.count.toLocaleString() }}
        <span v-if="row.share !== undefined" class="bar-share">{{ row.share }}%</span>
      </span>
    </li>
  </ul>
  <p v-else class="bars-empty">{{ emptyLabel }}</p>
</template>

<style scoped>
.bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bar-row {
  display: grid;
  grid-template-columns: minmax(90px, 160px) 1fr auto;
  align-items: center;
  gap: 12px;
  font-size: 0.85rem;
}
.bar-label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--text);
}
.bar-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bar-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  background: var(--text-dimmer);
}
.bar-track {
  height: 8px;
  border-radius: 999px;
  background: var(--panel-bg);
  overflow: hidden;
}
.bar-fill {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--chart-1);
}
.bar-value {
  min-width: 56px;
  text-align: end;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.bar-share {
  margin-inline-start: 4px;
  font-size: 0.74rem;
  font-weight: 500;
  color: var(--text-dimmer);
}
.bars-empty {
  margin: 0;
  color: var(--text-dimmer);
  font-size: 0.85rem;
}
</style>
