<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import AdminLayout from '../../components/admin/AdminLayout.vue';

interface SchedulerLogEntry {
  _id: string;
  action: string;
  success: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

const { t } = useI18n();
const logs = ref<SchedulerLogEntry[]>([]);
const error = ref('');

async function load() {
  error.value = '';
  try {
    logs.value = await apiRequest<SchedulerLogEntry[]>('/admin/scheduler-logs');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.schedulerLogs.loadFailed');
  }
}

function actionLabel(action: string): string {
  return t(`admin.schedulerLogs.actions.${action}`, action);
}

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.schedulerLogs.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <div class="admin-card">
      <div class="filter-row">
        <h2>{{ t('admin.schedulerLogs.recent', { count: logs.length }) }}</h2>
        <button type="button" class="admin-btn admin-btn-ghost" @click="load">{{ t('admin.schedulerLogs.refresh') }}</button>
      </div>
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t('admin.schedulerLogs.tableAction') }}</th>
            <th>{{ t('admin.schedulerLogs.tableDetails') }}</th>
            <th>{{ t('admin.schedulerLogs.tableWhen') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in logs" :key="log._id">
            <td><span class="admin-badge">{{ actionLabel(log.action) }}</span></td>
            <td class="mono">{{ log.metadata ? JSON.stringify(log.metadata) : '' }}</td>
            <td>{{ new Date(log.createdAt).toLocaleString() }}</td>
          </tr>
          <tr v-if="!logs.length"><td colspan="3">{{ t('admin.schedulerLogs.none') }}</td></tr>
        </tbody>
      </table>
    </div>
  </AdminLayout>
</template>

<style scoped>
.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 12px;
}
.filter-row h2 {
  margin: 0;
  white-space: nowrap;
}
.mono {
  font-family: monospace;
  font-size: 0.8rem;
  color: var(--text-dim);
}
</style>
