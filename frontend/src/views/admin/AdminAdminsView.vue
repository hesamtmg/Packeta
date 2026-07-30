<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import type { AdminUser } from '../../types/admin';
import AdminLayout from '../../components/admin/AdminLayout.vue';

const { t } = useI18n();
const auth = useAuthStore();
const users = ref<AdminUser[]>([]);
const error = ref('');
const busy = ref(false);
const promoteUserId = ref('');

const admins = computed(() => users.value.filter((u) => u.role === 'ADMIN'));
const customers = computed(() => users.value.filter((u) => u.role === 'USER'));

async function load() {
  error.value = '';
  try {
    users.value = await apiRequest<AdminUser[]>('/admin/users');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.admins.loadFailed');
  }
}

async function promote() {
  if (!promoteUserId.value) return;
  error.value = '';
  busy.value = true;
  try {
    await apiRequest(`/admin/users/${promoteUserId.value}/role`, {
      method: 'PATCH',
      body: { role: 'ADMIN' },
    });
    promoteUserId.value = '';
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.admins.promoteFailed');
  } finally {
    busy.value = false;
  }
}

async function demote(user: AdminUser) {
  error.value = '';
  busy.value = true;
  try {
    await apiRequest(`/admin/users/${user.id}/role`, {
      method: 'PATCH',
      body: { role: 'USER' },
    });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.admins.demoteFailed');
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.admins.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <div class="admin-card">
      <h2>{{ t('admin.admins.promoteHeading') }}</h2>
      <div class="promote-row">
        <select v-model="promoteUserId" class="admin-input">
          <option value="" disabled>{{ t('admin.admins.chooseCustomer') }}</option>
          <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.email }}</option>
        </select>
        <button class="admin-btn admin-btn-primary" :disabled="busy || !promoteUserId" @click="promote">
          {{ t('admin.admins.promoteButton') }}
        </button>
      </div>
    </div>

    <div class="admin-card">
      <h2>{{ t('admin.admins.adminsHeading', { count: admins.length }) }}</h2>
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t('admin.admins.tableEmail') }}</th>
            <th>{{ t('admin.admins.tableSince') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in admins" :key="a.id">
            <td>{{ a.email }}</td>
            <td>{{ new Date(a.createdAt).toLocaleDateString() }}</td>
            <td>
              <button
                v-if="a.email !== auth.email"
                class="admin-btn admin-btn-danger"
                :disabled="busy"
                @click="demote(a)"
              >
                {{ t('admin.admins.demote') }}
              </button>
              <span v-else class="you-badge">{{ t('admin.admins.you') }}</span>
            </td>
          </tr>
          <tr v-if="!admins.length"><td colspan="3">{{ t('admin.admins.noAdmins') }}</td></tr>
        </tbody>
      </table>
    </div>
  </AdminLayout>
</template>

<style scoped>
.promote-row {
  display: flex;
  gap: 10px;
}
.promote-row select {
  flex: 1;
}
.you-badge {
  font-size: 0.75rem;
  color: var(--text-dimmer);
}
</style>
