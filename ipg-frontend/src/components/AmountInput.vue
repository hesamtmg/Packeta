<script setup lang="ts">
// Drop-in replacement for <input type="number"> on money fields. For a
// Rial (IRR) wallet the field becomes a text input that shows the amount
// with thousands separators while typing ("12,500,000") — long Rial amounts
// are otherwise hard to read. The bound v-model value is always the plain,
// separator-free string ("12500000"), so callers keep passing it straight
// to toMinorUnits(). Any other currency renders a normal number input.
// All other attributes (class, placeholder, min, step, required, ...) fall
// through to the underlying <input>.
import { computed, useAttrs } from 'vue';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  modelValue?: string | number | null;
  // A wallet/charge currency, or just its code. Missing = plain input.
  currency?: { code: string; decimalPlaces?: number } | string | null;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const attrs = useAttrs();

const currencyCode = computed(() =>
  typeof props.currency === 'string' ? props.currency : props.currency?.code,
);
const grouped = computed(() => currencyCode.value === 'IRR');
const decimals = computed(() =>
  props.currency && typeof props.currency === 'object' ? props.currency.decimalPlaces ?? 0 : 0,
);
// Fields without a non-negative `min` (e.g. admin balance adjustments) may
// legitimately take a negative amount.
const allowNegative = computed(() => {
  const min = attrs.min;
  return min === undefined || min === null || min === '' || Number(min) < 0;
});

const PERSIAN_ARABIC_DIGITS = /[۰-۹٠-٩]/g;
function toLatinDigits(value: string): string {
  return value.replace(PERSIAN_ARABIC_DIGITS, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

// Reduces whatever was typed or pasted to a canonical "-1234.5" form.
function normalize(input: string): string {
  let value = toLatinDigits(input).replace(/[٫]/g, '.');
  const negative = allowNegative.value && value.trimStart().startsWith('-');
  value = value.replace(/[^0-9.]/g, '');
  const dot = value.indexOf('.');
  if (dot !== -1) {
    const intPart = value.slice(0, dot);
    const fracPart = value.slice(dot + 1).replace(/\./g, '');
    value = decimals.value > 0 ? `${intPart}.${fracPart.slice(0, decimals.value)}` : intPart;
  }
  return negative ? `-${value}` : value;
}

function format(raw: string): string {
  const negative = raw.startsWith('-');
  const body = negative ? raw.slice(1) : raw;
  const [intPart, fracPart] = body.split('.');
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${groupedInt}${fracPart !== undefined ? `.${fracPart}` : ''}`;
}

const display = computed(() =>
  format(normalize(props.modelValue === null || props.modelValue === undefined ? '' : String(props.modelValue))),
);

// Characters that survive normalize() — used to keep the caret in place
// while separators are inserted/removed around it.
function significantCount(text: string): number {
  return (toLatinDigits(text).match(/[0-9.\-]/g) ?? []).length;
}

function onGroupedInput(event: Event) {
  const el = event.target as HTMLInputElement;
  const caret = el.selectionStart ?? el.value.length;
  const before = significantCount(el.value.slice(0, caret));
  const raw = normalize(el.value);
  const formatted = format(raw);
  el.value = formatted;

  let pos = 0;
  let seen = 0;
  while (pos < formatted.length && seen < before) {
    if (/[0-9.\-]/.test(formatted[pos])) seen += 1;
    pos += 1;
  }
  el.setSelectionRange(pos, pos);
  emit('update:modelValue', raw);
}

function onPlainInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <input
    v-if="grouped"
    v-bind="attrs"
    type="text"
    :inputmode="decimals > 0 ? 'decimal' : 'numeric'"
    autocomplete="off"
    :value="display"
    @input="onGroupedInput"
  />
  <input
    v-else
    v-bind="attrs"
    type="number"
    :value="modelValue ?? ''"
    @input="onPlainInput"
  />
</template>
