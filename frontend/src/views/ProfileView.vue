<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError, API_URL, postMultipart } from '../api/client';
import { useAuthStore } from '../stores/auth';
import AppLayout from '../components/AppLayout.vue';

interface Me {
  id: string;
  email: string;
  phoneNumber: string | null;
  name: string | null;
  nationalCode: string | null;
  avatarUrl: string | null;
}

const { t } = useI18n();
const auth = useAuthStore();

const me = ref<Me | null>(null);
const initials = computed(() => (auth.email ?? '?').slice(0, 1).toUpperCase());
const avatarSrc = computed(() => (me.value?.avatarUrl ? `${API_URL}${me.value.avatarUrl}` : null));

const name = ref('');
const nationalCode = ref('');
const profileBusy = ref(false);
const profileError = ref('');
const profileSuccess = ref('');

const phoneNumber = ref('');
const phoneBusy = ref(false);
const phoneError = ref('');
const phoneSuccess = ref('');

const avatarFile = ref<File | undefined>(undefined);
const avatarBusy = ref(false);
const avatarError = ref('');

onMounted(async () => {
  try {
    const result = await apiRequest<Me>('/users/me');
    me.value = result;
    name.value = result.name ?? '';
    nationalCode.value = result.nationalCode ?? '';
    phoneNumber.value = result.phoneNumber ?? '';
    auth.setAvatarUrl(result.avatarUrl ?? null);
  } catch (err) {
    profileError.value = err instanceof ApiError ? err.message : t('profile.loadError');
  }
});

async function onSaveProfile() {
  profileError.value = '';
  profileSuccess.value = '';
  profileBusy.value = true;
  try {
    const result = await apiRequest<{ id: string; name: string | null; nationalCode: string | null }>(
      '/users/me/profile',
      { method: 'PATCH', body: { name: name.value, nationalCode: nationalCode.value } },
    );
    if (me.value) {
      me.value.name = result.name;
      me.value.nationalCode = result.nationalCode;
    }
    profileSuccess.value = t('profile.saved');
  } catch (err) {
    profileError.value = err instanceof ApiError ? err.message : t('profile.saveError');
  } finally {
    profileBusy.value = false;
  }
}

async function onSavePhoneNumber() {
  phoneError.value = '';
  phoneSuccess.value = '';
  phoneBusy.value = true;
  try {
    const result = await apiRequest<{ id: string; phoneNumber: string }>('/users/me/phone-number', {
      method: 'PATCH',
      body: { phoneNumber: phoneNumber.value },
    });
    if (me.value) {
      me.value.phoneNumber = result.phoneNumber;
    }
    phoneSuccess.value = t('profile.phone.saved');
  } catch (err) {
    phoneError.value = err instanceof ApiError ? err.message : t('profile.phone.error');
  } finally {
    phoneBusy.value = false;
  }
}

function onAvatarFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  avatarFile.value = input.files?.[0];
}

async function onUploadAvatar() {
  if (!avatarFile.value) return;
  avatarError.value = '';
  avatarBusy.value = true;
  try {
    const result = await postMultipart<{ avatarUrl: string }>('/users/me/avatar', {
      avatar: avatarFile.value,
    });
    if (me.value) {
      me.value.avatarUrl = result.avatarUrl;
    }
    auth.setAvatarUrl(result.avatarUrl);
    avatarFile.value = undefined;
  } catch (err) {
    avatarError.value = err instanceof ApiError ? err.message : t('profile.avatar.error');
  } finally {
    avatarBusy.value = false;
  }
}
</script>

<template>
  <AppLayout :title="t('profile.title')">
    <div class="admin-grid admin-grid-2">
      <div class="admin-card">
        <h2>{{ t('profile.avatar.title') }}</h2>
        <div class="avatar-row">
          <img v-if="avatarSrc" :src="avatarSrc" class="avatar-preview" :alt="t('profile.avatar.title')" />
          <div v-else class="admin-avatar avatar-preview-fallback">{{ initials }}</div>
          <div class="avatar-upload">
            <input type="file" accept="image/png,image/jpeg,image/webp" @change="onAvatarFileChange" />
            <button
              type="button"
              class="admin-btn admin-btn-primary"
              :disabled="!avatarFile || avatarBusy"
              @click="onUploadAvatar"
            >
              {{ t('profile.avatar.upload') }}
            </button>
          </div>
        </div>
        <p v-if="avatarError" class="admin-error">{{ avatarError }}</p>
      </div>

      <div class="admin-card">
        <h2>{{ t('profile.details.title') }}</h2>
        <p class="hint">{{ t('profile.details.hint') }}</p>
        <form class="profile-form" @submit.prevent="onSaveProfile">
          <input
            v-model="name"
            type="text"
            :placeholder="t('profile.details.namePlaceholder')"
            class="admin-input"
            maxlength="255"
          />
          <input
            v-model="nationalCode"
            type="text"
            inputmode="numeric"
            :placeholder="t('profile.details.nationalCodePlaceholder')"
            class="admin-input"
            maxlength="10"
          />
          <button type="submit" class="admin-btn admin-btn-primary" :disabled="profileBusy">
            {{ t('profile.details.save') }}
          </button>
        </form>
        <p v-if="profileError" class="admin-error">{{ profileError }}</p>
        <p v-if="profileSuccess" class="profile-success">{{ profileSuccess }}</p>
      </div>

      <div class="admin-card">
        <h2>{{ t('profile.phone.title') }}</h2>
        <p class="hint">{{ t('profile.phone.hint') }}</p>
        <form class="profile-form" @submit.prevent="onSavePhoneNumber">
          <input
            v-model="phoneNumber"
            type="tel"
            :placeholder="t('profile.phone.placeholder')"
            class="admin-input"
            required
          />
          <button type="submit" class="admin-btn admin-btn-primary" :disabled="phoneBusy">
            {{ t('profile.phone.save') }}
          </button>
        </form>
        <p v-if="me?.phoneNumber" class="hint">{{ t('profile.phone.current', { phone: me.phoneNumber }) }}</p>
        <p v-if="phoneError" class="admin-error">{{ phoneError }}</p>
        <p v-if="phoneSuccess" class="profile-success">{{ phoneSuccess }}</p>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped>
.profile-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 10px 0;
}
.profile-success {
  color: var(--accent-lime);
  font-size: 0.85rem;
}
.avatar-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 10px 0;
}
.avatar-preview {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  object-fit: cover;
}
.avatar-preview-fallback {
  width: 72px;
  height: 72px;
  font-size: 1.4rem;
}
.avatar-upload {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
