<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { uploadFile, ApiError } from '../../api/client';

const props = defineProps<{
  endpoint: string;
  sampleUrl: string;
  title: string;
  hint: string;
}>();
const emit = defineEmits<{ imported: [] }>();

interface BatchRowError {
  row: number;
  message: string;
}
interface BatchResult {
  totalRows: number;
  created: number;
  errors: BatchRowError[];
}

const { t } = useI18n();
const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const busy = ref(false);
const error = ref('');
const result = ref<BatchResult | null>(null);

function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  selectedFile.value = target.files?.[0] ?? null;
  result.value = null;
  error.value = '';
}

async function onUpload() {
  if (!selectedFile.value) return;
  error.value = '';
  result.value = null;
  busy.value = true;
  try {
    result.value = await uploadFile<BatchResult>(props.endpoint, selectedFile.value);
    selectedFile.value = null;
    if (fileInput.value) fileInput.value.value = '';
    if (result.value.created > 0) emit('imported');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.batchImport.uploadFailed');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="admin-card batch-import">
    <h2>{{ title }}</h2>
    <p class="hint">{{ hint }}</p>
    <a :href="sampleUrl" download class="admin-btn admin-btn-ghost sample-link">
      {{ t('admin.batchImport.downloadSample') }}
    </a>

    <div class="upload-row">
      <input ref="fileInput" type="file" accept=".xlsx" class="admin-input" @change="onFileChange" />
      <button
        type="button"
        class="admin-btn admin-btn-primary"
        :disabled="!selectedFile || busy"
        @click="onUpload"
      >
        {{ t('admin.batchImport.upload') }}
      </button>
    </div>

    <p v-if="error" class="admin-error">{{ error }}</p>

    <div v-if="result" class="result">
      <p class="result-summary">
        {{ t('admin.batchImport.resultSummary', { created: result.created, total: result.totalRows }) }}
      </p>
      <ul v-if="result.errors.length" class="result-errors">
        <li v-for="err in result.errors" :key="err.row">
          {{ t('admin.batchImport.rowError', { row: err.row, message: err.message }) }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.batch-import {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hint {
  color: var(--text-dim);
  font-size: 0.85rem;
  margin: 0;
}
.sample-link {
  align-self: flex-start;
  text-decoration: none;
}
.upload-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.upload-row input[type='file'] {
  flex: 1;
  min-width: 200px;
}
.result {
  border-top: 1px solid var(--card-border);
  padding-top: 10px;
}
.result-summary {
  margin: 0 0 6px;
  font-weight: 600;
}
.result-errors {
  margin: 0;
  padding-inline-start: 18px;
  color: var(--accent-red);
  font-size: 0.82rem;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
