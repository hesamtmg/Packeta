<script lang="ts">
export type AuthMethod = 'phone' | 'email';
</script>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const model = defineModel<AuthMethod>({ required: true });
const { t } = useI18n();

const tabs: { id: AuthMethod; label: string }[] = [
  { id: 'phone', label: 'auth.methodPhone' },
  { id: 'email', label: 'auth.methodEmail' },
];

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  model.value = model.value === 'phone' ? 'email' : 'phone';
  (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-tab="${model.value}"]`)?.focus();
}
</script>

<template>
  <div class="method-tabs" role="tablist" :aria-label="t('auth.methodLabel')" @keydown="onKeydown">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      role="tab"
      class="method-tab"
      :class="{ active: model === tab.id }"
      :data-tab="tab.id"
      :aria-selected="model === tab.id"
      :tabindex="model === tab.id ? 0 : -1"
      @click="model = tab.id"
    >
      <svg v-if="tab.id === 'phone'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
        <path d="M11 18h2" />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="M3.5 6.5l8.5 6 8.5-6" />
      </svg>
      {{ t(tab.label) }}
      <span v-if="tab.id === 'phone'" class="method-badge">{{ t('auth.recommended') }}</span>
    </button>
  </div>
</template>

<style scoped>
.method-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: var(--panel-bg);
  border: 1px solid var(--card-border);
}
.method-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  padding: 6px 8px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  white-space: nowrap;
}
.method-tab svg {
  width: 16px;
  height: 16px;
  flex: none;
}
.method-tab:hover {
  color: var(--text);
}
.method-tab.active {
  background: var(--card-bg);
  color: var(--accent-blue);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 2px 8px -4px rgba(15, 23, 42, 0.15);
}
.method-tab:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.method-badge {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 999px;
  color: var(--accent-lime);
  background: var(--badge-tint-lime);
}
@media (max-width: 380px) {
  .method-badge {
    display: none;
  }
}
</style>
