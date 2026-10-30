<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { setLocale } from '../i18n';

const { locale, t } = useI18n();

const isFa = computed(() => locale.value === 'fa');

function toggle() {
  setLocale(isFa.value ? 'en' : 'fa');
}
</script>

<template>
  <button type="button" class="lang-switch" :title="t('common.toggleLanguage')" @click="toggle">
    {{ isFa ? 'EN' : 'فارسی' }}
  </button>
</template>

<style scoped>
.lang-switch {
  border: 1px solid var(--card-border);
  background: var(--card-bg, transparent);
  color: var(--text);
  border-radius: 10px;
  min-height: 38px;
  padding: 0 12px;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.lang-switch:hover {
  background: var(--hover-tint, rgba(255, 255, 255, 0.06));
  border-color: var(--accent-blue);
}
</style>
