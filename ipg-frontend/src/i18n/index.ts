import { createI18n } from 'vue-i18n';
import en from './locales/en';
import fa from './locales/fa';

export type AppLocale = 'en' | 'fa';

export const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en, fa },
});

// The customer completing an IPG charge has no account/preference of their
// own here — the merchant picks the language at charge-creation time, so
// this is driven by the charge's own `language` field (see PayView's
// onMounted) rather than a stored user preference. A manual toggle is still
// offered in the nav for cases where no charge language applies, or to
// override it. Farsi reads right-to-left, so the whole document direction
// flips, not just text alignment.
export function setLocale(locale: AppLocale) {
  (i18n.global.locale as { value: AppLocale }).value = locale;
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
}
