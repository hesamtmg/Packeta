<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError } from '../../api/client';
import { formatDateTime } from '../../utils/date';
import AdminLayout from '../../components/admin/AdminLayout.vue';

type Provider = 'ZARINPAL' | 'SADAD';

interface ProviderStatus {
  provider: Provider;
  configured: boolean;
  configurationError: string | null;
  sandbox: boolean;
}

interface GatewaySetting {
  activeProvider: Provider;
  updatedAt: string | null;
  updatedByUserId: string | null;
  providers: ProviderStatus[];
}

const { t } = useI18n();
const setting = ref<GatewaySetting | null>(null);
const selected = ref<Provider>('ZARINPAL');
const error = ref('');
const success = ref('');
const busy = ref(false);

async function load() {
  error.value = '';
  try {
    setting.value = await apiRequest<GatewaySetting>('/admin/payment-gateway');
    selected.value = setting.value.activeProvider;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.paymentGateway.loadFailed');
  }
}

async function save() {
  if (!setting.value || selected.value === setting.value.activeProvider) return;
  error.value = '';
  success.value = '';
  busy.value = true;
  try {
    setting.value = await apiRequest<GatewaySetting>('/admin/payment-gateway', {
      method: 'PUT',
      body: { provider: selected.value },
    });
    selected.value = setting.value.activeProvider;
    success.value = t('admin.paymentGateway.saved', { provider: providerName(selected.value) });
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('admin.paymentGateway.saveFailed');
  } finally {
    busy.value = false;
  }
}

function providerName(provider: Provider): string {
  return t(`admin.paymentGateway.providers.${provider}.name`);
}

onMounted(load);
</script>

<template>
  <AdminLayout :title="t('admin.paymentGateway.title')">
    <p v-if="error" class="admin-error">{{ error }}</p>
    <p v-if="success" class="admin-success">{{ success }}</p>

    <section v-if="setting" class="admin-card">
      <div class="admin-card-head">
        <div>
          <h2>{{ t('admin.paymentGateway.heading') }}</h2>
          <p class="admin-card-sub">{{ t('admin.paymentGateway.description') }}</p>
        </div>
      </div>

      <div class="providers" role="radiogroup">
        <label
          v-for="p in setting.providers"
          :key="p.provider"
          class="provider"
          :class="{ selected: selected === p.provider, disabled: !p.configured }"
        >
          <input
            v-model="selected"
            type="radio"
            name="provider"
            :value="p.provider"
            :disabled="!p.configured || busy"
          />
          <span class="provider-body">
            <span class="provider-title">
              {{ providerName(p.provider) }}
              <span v-if="setting.activeProvider === p.provider" class="admin-badge admin-badge-success">{{ t('admin.paymentGateway.active') }}</span>
              <span v-if="p.sandbox" class="admin-badge admin-badge-warning">{{ t('admin.paymentGateway.sandbox') }}</span>
              <span v-if="!p.configured" class="admin-badge admin-badge-danger">{{ t('admin.paymentGateway.notConfigured') }}</span>
            </span>
            <span class="provider-desc">{{ t(`admin.paymentGateway.providers.${p.provider}.description`) }}</span>
            <span v-if="p.configurationError" class="provider-error">{{ p.configurationError }}</span>
          </span>
        </label>
      </div>

      <p class="hint">{{ t('admin.paymentGateway.inFlightHint') }}</p>

      <div class="actions">
        <span v-if="setting.updatedAt" class="updated">{{ t('admin.paymentGateway.lastChanged', { when: formatDateTime(setting.updatedAt) }) }}</span>
        <button
          type="button"
          class="admin-btn admin-btn-primary"
          :disabled="busy || selected === setting.activeProvider"
          @click="save"
        >
          {{ busy ? t('admin.paymentGateway.saving') : t('admin.paymentGateway.save') }}
        </button>
      </div>
    </section>
  </AdminLayout>
</template>

<style scoped>
.providers {
  display: grid;
  gap: 12px;
}
.provider {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px 16px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.provider.selected {
  border-color: var(--accent, #4f46e5);
  box-shadow: 0 0 0 1px var(--accent, #4f46e5);
}
.provider.disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.provider input {
  margin-top: 4px;
}
.provider-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.provider-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--text);
}
.provider-desc,
.hint,
.updated {
  font-size: 0.85rem;
  color: var(--text-dim);
}
.provider-error {
  font-size: 0.8rem;
  color: var(--accent-red);
  overflow-wrap: anywhere;
}
.hint {
  margin: 14px 0 0;
}
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
  flex-wrap: wrap;
}
</style>
