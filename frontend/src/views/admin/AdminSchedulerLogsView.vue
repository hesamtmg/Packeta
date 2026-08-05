<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { formatDateTime } from '../../utils/date';
import { useListControls } from '../../composables/useListControls';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import SortableTh from '../../components/admin/SortableTh.vue';
import ListPagination from '../../components/admin/ListPagination.vue';

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

function actionLabel(action: string): string {
  return t(`admin.schedulerLogs.actions.${action}`, action);
}

const {
  search,
  sortKey,
  sortDir,
  pageItems,
  sorted,
  page,
  pageSize,
  totalPages,
  toggleSort,
  goToPage,
} = useListControls(logs, {
  searchFields: (log) => [actionLabel(log.action), log.metadata ? JSON.stringify(log.metadata) : null],
  sortAccessors: {
    action: (log) => actionLabel(log.action).toLowerCase(),
    when: (log) => new Date(log.createdAt).getTime(),
  },
  defaultSort: { key: 'when', dir: 'desc' },
  pageSize: 25,
});

async function load() {
  error.value = '';
  try {
    logs.value = await apiRequest<SchedulerLogEntry[]>('/admin/scheduler-logs');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.schedulerLogs.loadFailed');
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.schedulerLogs.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <div class="admin-card">
      <div class="filter-row">
        <h2>{{ t('admin.schedulerLogs.recent', { count: sorted.length }) }}</h2>
        <div class="list-controls-row">
          <input v-model="search" class="admin-input" :placeholder="t('admin.schedulerLogs.searchPlaceholder')" />
          <button type="button" class="admin-btn admin-btn-ghost" @click="load">{{ t('admin.schedulerLogs.refresh') }}</button>
        </div>
      </div>
      <table class="admin-table">
        <thead>
          <tr>
            <SortableTh :label="t('admin.schedulerLogs.tableAction')" col-key="action" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
            <th>{{ t('admin.schedulerLogs.tableDetails') }}</th>
            <SortableTh :label="t('admin.schedulerLogs.tableWhen')" col-key="when" :active-key="sortKey" :dir="sortDir" @sort="toggleSort" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in pageItems" :key="log._id">
            <td><span class="admin-badge">{{ actionLabel(log.action) }}</span></td>
            <td class="mono">{{ log.metadata ? JSON.stringify(log.metadata) : '' }}</td>
            <td>{{ formatDateTime(log.createdAt) }}</td>
          </tr>
          <tr v-if="!pageItems.length"><td colspan="3">{{ t('admin.schedulerLogs.none') }}</td></tr>
        </tbody>
      </table>
      <ListPagination
        :page="page"
        :total-pages="totalPages"
        :total="sorted.length"
        :page-size="pageSize"
        @update:page="goToPage"
        @update:page-size="pageSize = $event"
      />
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
  flex-wrap: wrap;
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
