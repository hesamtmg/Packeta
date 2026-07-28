<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    data: number[];
    color?: string;
    height?: number;
  }>(),
  {
    color: '#d8ff5c',
    height: 90,
  },
);

const width = 320;
const gradientId = `chart-fill-${Math.random().toString(36).slice(2)}`;

const points = computed(() => {
  if (props.data.length === 0) return [] as { x: number; y: number }[];
  const max = Math.max(...props.data, 1);
  const min = Math.min(...props.data, 0);
  const range = max - min || 1;
  const stepX = width / Math.max(props.data.length - 1, 1);
  return props.data.map((v, i) => ({
    x: i * stepX,
    y: props.height - ((v - min) / range) * (props.height - 8) - 4,
  }));
});

const linePath = computed(() =>
  points.value.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' '),
);

const areaPath = computed(() => {
  if (points.value.length === 0) return '';
  const last = points.value[points.value.length - 1];
  const first = points.value[0];
  return `${linePath.value} L${last.x},${props.height} L${first.x},${props.height} Z`;
});
</script>

<template>
  <svg :viewBox="`0 0 ${width} ${height}`" preserveAspectRatio="none" class="mini-line-chart">
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="color" stop-opacity="0.35" />
        <stop offset="100%" :stop-color="color" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path :d="areaPath" :fill="`url(#${gradientId})`" stroke="none" />
    <path :d="linePath" fill="none" :stroke="color" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>

<style scoped>
.mini-line-chart {
  width: 100%;
  height: v-bind('`${height}px`');
  display: block;
}
</style>
