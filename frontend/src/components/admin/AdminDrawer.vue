<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';

// Right-hand slide-over panel (left-hand in RTL) for drill-downs and editors
// that shouldn't navigate away from a list. Teleported to <body>, so it
// re-applies .admin-theme to keep the design tokens (and dark mode).
const props = defineProps<{
  open: boolean;
  title: string;
  eyebrow?: string;
  closeLabel: string;
  width?: string;
}>();
const emit = defineEmits<{ close: [] }>();

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
}
watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown);
    else window.removeEventListener('keydown', onKeydown);
  },
  { immediate: true },
);
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="admin-theme drawer-layer">
      <div class="drawer-scrim" @click="emit('close')" />
      <aside class="drawer" role="dialog" aria-modal="true" :aria-label="title" :style="width ? { width: `min(${width}, 100%)` } : undefined">
        <header class="drawer-head">
          <div class="drawer-titles">
            <span v-if="eyebrow" class="drawer-eyebrow">{{ eyebrow }}</span>
            <h2>{{ title }}</h2>
            <slot name="subtitle" />
          </div>
          <button type="button" class="admin-icon-btn drawer-close" :aria-label="closeLabel" @click="emit('close')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div class="drawer-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="drawer-foot">
          <slot name="footer" />
        </footer>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.drawer-layer {
  position: fixed;
  inset: 0;
  z-index: 100;
  min-height: 0;
  background: transparent;
}
.drawer-scrim {
  position: absolute;
  inset: 0;
  background: rgba(8, 12, 24, 0.45);
  backdrop-filter: blur(2px);
  animation: drawer-fade 0.15s ease;
}
.drawer {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  width: min(640px, 100%);
  display: flex;
  flex-direction: column;
  background: var(--admin-bg);
  border-inline-start: 1px solid var(--card-border);
  box-shadow: var(--shadow-pop);
  animation: drawer-in 0.2s ease;
}
[dir='rtl'] .drawer {
  animation-name: drawer-in-rtl;
}
@keyframes drawer-fade {
  from { opacity: 0; }
}
@keyframes drawer-in {
  from { transform: translateX(24px); opacity: 0; }
}
@keyframes drawer-in-rtl {
  from { transform: translateX(-24px); opacity: 0; }
}
.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 24px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--card-border);
}
.drawer-titles {
  min-width: 0;
}
.drawer-head h2 {
  margin: 0;
  font-size: 1.15rem;
  letter-spacing: -0.01em;
}
.drawer-eyebrow {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dimmer);
}
.drawer-close svg {
  width: 18px;
  height: 18px;
}
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 28px;
}
.drawer-foot {
  padding: 14px 24px;
  background: var(--card-bg);
  border-top: 1px solid var(--card-border);
}
@media (max-width: 640px) {
  .drawer-head,
  .drawer-body,
  .drawer-foot {
    padding-inline: 16px;
  }
}
</style>
