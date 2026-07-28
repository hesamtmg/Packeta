<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { apiRequest, ApiError } from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import type { AdminUser } from '../../types/admin';
import AdminLayout from '../../components/admin/AdminLayout.vue';

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
    error.value = err instanceof ApiError ? err.message : 'Failed to load admins';
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
    error.value = err instanceof ApiError ? err.message : 'Promote failed';
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
    error.value = err instanceof ApiError ? err.message : 'Demote failed';
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout title="Admins">
    <p v-if="error" class="admin-error">{{ error }}</p>

    <div class="admin-card">
      <h2>Promote a customer</h2>
      <div class="promote-row">
        <select v-model="promoteUserId" class="admin-input">
          <option value="" disabled>Choose a customer…</option>
          <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.email }}</option>
        </select>
        <button class="admin-btn admin-btn-primary" :disabled="busy || !promoteUserId" @click="promote">
          Promote to admin
        </button>
      </div>
    </div>

    <div class="admin-card">
      <h2>Admins ({{ admins.length }})</h2>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Admin since</th>
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
                Demote
              </button>
              <span v-else class="you-badge">You</span>
            </td>
          </tr>
          <tr v-if="!admins.length"><td colspan="3">No admins found.</td></tr>
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
