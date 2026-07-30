import { createI18n } from 'vue-i18n';
import en from './locales/en';
import fa from './locales/fa';

export type AppLocale = 'en' | 'fa';

const STORAGE_KEY = 'packeta-locale';

function detectInitialLocale(): AppLocale {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'fa' ? 'fa' : 'en';
}

const initialLocale = detectInitialLocale();

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'en',
  messages: { en, fa },
});

// Farsi reads right-to-left — the whole document direction (not just text
// alignment) needs to flip, so this is applied globally rather than left to
// each component's own styling.
export function setLocale(locale: AppLocale) {
  (i18n.global.locale as { value: AppLocale }).value = locale;
  localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
}

setLocale(initialLocale);
