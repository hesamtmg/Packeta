<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    page: number;
    totalPages: number;
    total: number;
    pageSize: number;
    pageSizeOptions?: number[];
  }>(),
  {
    pageSizeOptions: () => [10, 25, 50, 100],
  },
);

const emit = defineEmits<{
  'update:page': [page: number];
  'update:pageSize': [size: number];
}>();

const { t } = useI18n();

const rangeStart = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1));
const rangeEnd = computed(() => Math.min(props.page * props.pageSize, props.total));
</script>

<template>
  <div class="list-pagination">
    <div class="list-pagination-info">
      <span>{{ t('common.pagination.showing', { start: rangeStart, end: rangeEnd, total }) }}</span>
      <select
        class="admin-input page-size-select"
        :value="pageSize"
        @change="emit('update:pageSize', Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="size in pageSizeOptions" :key="size" :value="size">
          {{ t('common.pagination.perPage', { size }) }}
        </option>
      </select>
    </div>
    <div class="list-pagination-nav">
      <button
        type="button"
        class="admin-btn admin-btn-ghost nav-btn"
        :disabled="page <= 1"
        @click="emit('update:page', page - 1)"
      >
        {{ t('common.pagination.prev') }}
      </button>
      <span class="page-indicator">{{ t('common.pagination.page', { page, pages: totalPages }) }}</span>
      <button
        type="button"
        class="admin-btn admin-btn-ghost nav-btn"
        :disabled="page >= totalPages"
        @click="emit('update:page', page + 1)"
      >
        {{ t('common.pagination.next') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.list-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--divider);
}
.list-pagination-info {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-dim);
  font-size: 0.82rem;
}
.page-size-select {
  padding: 5px 10px;
  font-size: 0.8rem;
}
.list-pagination-nav {
  display: flex;
  align-items: center;
  gap: 10px;
}
.nav-btn {
  padding: 6px 14px;
  font-size: 0.8rem;
}
.page-indicator {
  color: var(--text-dim);
  font-size: 0.82rem;
  white-space: nowrap;
}
</style>
