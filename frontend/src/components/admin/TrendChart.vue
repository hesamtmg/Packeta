<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

// Single-series area/line chart with a recessive grid, a y-axis, sparse x
// labels and a crosshair + tooltip on hover. One series, so no legend — the
// card title names it. Colour comes from --chart-1 (validated for both
// themes), never from a per-call prop.
const props = withDefaults(
  defineProps<{
    data: number[];
    // One label per point (e.g. a date); shown on the x-axis and tooltip.
    labels: string[];
    height?: number;
    // Noun for the tooltip value, e.g. "transactions".
    unit?: string;
  }>(),
  { height: 180, unit: '' },
);

const root = ref<HTMLDivElement | null>(null);
const width = ref(600);
let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!root.value) return;
  width.value = root.value.clientWidth || 600;
  observer = new ResizeObserver(([entry]) => {
    width.value = Math.max(200, entry.contentRect.width);
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

const PAD = { top: 10, right: 8, bottom: 24, left: 34 };
const gradientId = `trend-${Math.random().toString(36).slice(2)}`;

// Four gridline steps of a "nice" whole number (1, 2, 5 × 10^n), so the axis
// reads 0/5/10/15/20 rather than fractional values for count data.
const step = computed(() => {
  const raw = Math.max(1, ...props.data) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= raw) ?? 10 * pow;
  return Math.max(1, Math.ceil(nice));
});
const yMax = computed(() => step.value * 4);
const ticks = computed(() => [0, 1, 2, 3, 4].map((i) => i * step.value));

const plotW = computed(() => width.value - PAD.left - PAD.right);
const plotH = computed(() => props.height - PAD.top - PAD.bottom);
const x = (i: number) => PAD.left + (props.data.length <= 1 ? 0 : (i / (props.data.length - 1)) * plotW.value);
const y = (v: number) => PAD.top + plotH.value - (v / yMax.value) * plotH.value;

const linePath = computed(() => props.data.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' '));
const areaPath = computed(() =>
  props.data.length
    ? `${linePath.value} L${x(props.data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`
    : '',
);

// First, middle and last labels — enough to orient without crowding.
const xLabels = computed(() => {
  const n = props.data.length;
  if (!n) return [];
  const idx = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  return idx.map((i) => ({ i, text: props.labels[i] ?? '' }));
});

const hover = ref<number | null>(null);
function onMove(event: MouseEvent) {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  const px = event.clientX - rect.left;
  const n = props.data.length;
  if (!n) return;
  const i = Math.round(((px - PAD.left) / plotW.value) * (n - 1));
  hover.value = Math.min(n - 1, Math.max(0, i));
}
const tooltipLeft = computed(() => {
  if (hover.value === null) return 0;
  return Math.min(Math.max(x(hover.value), 70), width.value - 70);
});
</script>

<template>
  <div ref="root" class="trend">
    <svg :width="width" :height="height" role="img" @mousemove="onMove" @mouseleave="hover = null">
      <defs>
        <linearGradient :id="gradientId" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="var(--chart-1)" stop-opacity="0.18" />
          <stop offset="100%" stop-color="var(--chart-1)" stop-opacity="0" />
        </linearGradient>
      </defs>
      <g v-for="tick in ticks" :key="tick">
        <line :x1="PAD.left" :x2="width - PAD.right" :y1="y(tick)" :y2="y(tick)" class="grid" />
        <text :x="PAD.left - 8" :y="y(tick) + 4" class="axis" text-anchor="end">{{ tick }}</text>
      </g>
      <text
        v-for="l in xLabels"
        :key="l.i"
        :x="x(l.i)"
        :y="height - 6"
        class="axis"
        :text-anchor="l.i === 0 ? 'start' : l.i === data.length - 1 ? 'end' : 'middle'"
      >{{ l.text }}</text>
      <path :d="areaPath" :fill="`url(#${gradientId})`" />
      <path :d="linePath" class="line" />
      <template v-if="hover !== null">
        <line :x1="x(hover)" :x2="x(hover)" :y1="PAD.top" :y2="y(0)" class="crosshair" />
        <circle :cx="x(hover)" :cy="y(data[hover])" r="5" class="dot" />
      </template>
    </svg>
    <div v-if="hover !== null" class="tip" :style="{ left: `${tooltipLeft}px` }">
      <span class="tip-label">{{ labels[hover] }}</span>
      <span class="tip-value">{{ data[hover].toLocaleString() }} <span class="tip-unit">{{ unit }}</span></span>
    </div>
  </div>
</template>

<style scoped>
.trend {
  position: relative;
  width: 100%;
}
svg {
  display: block;
  overflow: visible;
}
.grid {
  stroke: var(--chart-grid);
  stroke-width: 1;
}
.axis {
  font-size: 10.5px;
  fill: var(--text-dimmer);
  font-variant-numeric: tabular-nums;
}
.line {
  fill: none;
  stroke: var(--chart-1);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.crosshair {
  stroke: var(--text-dimmer);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
.dot {
  fill: var(--chart-1);
  stroke: var(--card-bg);
  stroke-width: 2;
}
.tip {
  position: absolute;
  top: -6px;
  transform: translate(-50%, -100%);
  background: var(--text);
  color: var(--card-bg);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 0.76rem;
  display: flex;
  flex-direction: column;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: var(--shadow-pop);
}
.tip-label {
  opacity: 0.75;
}
.tip-value {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.tip-unit {
  font-weight: 500;
  opacity: 0.8;
}
</style>
