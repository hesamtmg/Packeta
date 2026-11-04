<script setup lang="ts">
import { ref } from 'vue';

// Inline panel for writing a debt off against the backing repository: a
// required justification plus an optional supporting document. Used by the
// overdue-collection queue and the offboarding flow, which own the request.
defineProps<{
  description: string;
  placeholder: string;
  submitLabel: string;
  cancelLabel: string;
  attachLabel: string;
  busy: boolean;
}>();
const emit = defineEmits<{
  'update:description': [value: string];
  file: [file: File | undefined];
  submit: [];
  cancel: [];
}>();

const fileName = ref('');
function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  fileName.value = file?.name ?? '';
  emit('file', file);
}
</script>

<template>
  <div class="absorb">
    <textarea
      class="admin-input absorb-text"
      rows="2"
      :value="description"
      :placeholder="placeholder"
      @input="emit('update:description', ($event.target as HTMLTextAreaElement).value)"
    />
    <div class="absorb-actions">
      <label class="admin-btn admin-btn-ghost admin-btn-sm absorb-file">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.5l-8.5 8.5a5 5 0 01-7-7l9-9a3.5 3.5 0 015 5l-9 9a2 2 0 01-3-3l8.5-8.5" /></svg>
        <span class="absorb-file-name">{{ fileName || attachLabel }}</span>
        <input type="file" @change="onFile" />
      </label>
      <span class="spacer" />
      <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" @click="emit('cancel')">{{ cancelLabel }}</button>
      <button type="button" class="admin-btn admin-btn-primary admin-btn-sm" :disabled="busy" @click="emit('submit')">{{ submitLabel }}</button>
    </div>
  </div>
</template>

<style scoped>
.absorb {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  border: 1px solid var(--divider);
}
.absorb-text {
  width: 100%;
  resize: vertical;
  font-family: inherit;
}
.absorb-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.absorb-file {
  position: relative;
  overflow: hidden;
  max-width: 260px;
}
.absorb-file-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.absorb-file input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
</style>
