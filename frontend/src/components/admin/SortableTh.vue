<script setup lang="ts">
defineProps<{
  label: string;
  colKey: string;
  activeKey: string | null;
  dir: 'asc' | 'desc';
}>();

const emit = defineEmits<{ sort: [key: string] }>();
</script>

<template>
  <th class="sortable-th" @click="emit('sort', colKey)">
    <span class="sortable-th-inner">
      {{ label }}
      <span class="sort-arrows" :class="{ active: activeKey === colKey }">
        <svg v-if="activeKey === colKey && dir === 'asc'" viewBox="0 0 10 6" width="9" height="6">
          <path d="M1 5 L5 1 L9 5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <svg v-else-if="activeKey === colKey && dir === 'desc'" viewBox="0 0 10 6" width="9" height="6">
          <path d="M1 1 L5 5 L9 1" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <svg v-else viewBox="0 0 10 10" width="9" height="10">
          <path d="M1 4 L5 1 L9 4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M1 6 L5 9 L9 6" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    </span>
  </th>
</template>

<style scoped>
.sortable-th {
  cursor: pointer;
  user-select: none;
}
.sortable-th:hover {
  color: var(--text-dim);
}
.sortable-th-inner {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.sort-arrows {
  display: inline-flex;
  color: var(--text-dimmer);
  opacity: 0.6;
}
.sort-arrows.active {
  color: var(--accent-lime);
  opacity: 1;
}
</style>
