<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import LanguageSwitcher from './LanguageSwitcher.vue';
import '../styles/admin-theme.css';
import '../styles/customer-theme.css';

defineProps<{ title: string; subtitle: string }>();
const { t } = useI18n();

const features = ['wallets', 'payments', 'security'] as const;
</script>

<template>
  <div class="customer-theme auth-shell">
    <aside class="auth-aside">
      <router-link :to="{ name: 'landing' }" class="auth-brand auth-brand-light">
        <span class="auth-brand-mark">P</span>
        <span class="auth-brand-name">Packeta</span>
      </router-link>

      <div class="auth-aside-body">
        <h2>{{ t('auth.aside.title') }}</h2>
        <p>{{ t('auth.aside.subtitle') }}</p>
        <ul class="auth-features">
          <li v-for="key in features" :key="key">
            <span class="auth-feature-icon" aria-hidden="true">
              <svg v-if="key === 'wallets'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="6" width="18" height="13" rx="2.5" />
                <path d="M3 10h18M16 14.5h2" />
              </svg>
              <svg v-else-if="key === 'payments'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 7h11l-3-3M17 17H6l3 3" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </span>
            <span>
              <strong>{{ t(`auth.aside.${key}.title`) }}</strong>
              <small>{{ t(`auth.aside.${key}.desc`) }}</small>
            </span>
          </li>
        </ul>
      </div>

      <p class="auth-aside-foot">{{ t('landing.footer.rights', { year: new Date().getFullYear() }) }}</p>
    </aside>

    <main class="auth-main">
      <header class="auth-topbar">
        <router-link :to="{ name: 'landing' }" class="auth-brand auth-brand-compact">
          <span class="auth-brand-mark">P</span>
          <span class="auth-brand-name">Packeta</span>
        </router-link>
        <router-link :to="{ name: 'landing' }" class="auth-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {{ t('auth.backHome') }}
        </router-link>
        <LanguageSwitcher class="auth-lang" />
      </header>

      <section class="auth-card admin-card">
        <div class="auth-head">
          <h1>{{ title }}</h1>
          <p>{{ subtitle }}</p>
        </div>
        <slot />
      </section>

      <footer class="auth-footer">
        <slot name="footer" />
      </footer>
    </main>
  </div>
</template>

<style scoped>
.auth-shell {
  display: grid;
  grid-template-columns: minmax(360px, 44%) 1fr;
  min-height: 100vh;
  padding: 0 !important;
  background: var(--admin-bg);
  color: var(--text);
}

/* ---------- Brand panel ---------- */
.auth-aside {
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 32px;
  padding: 40px 48px;
  background: var(--hero-gradient);
  color: #fff;
  overflow: hidden;
  isolation: isolate;
}
.auth-aside::before,
.auth-aside::after {
  content: '';
  position: absolute;
  z-index: -1;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
}
.auth-aside::before {
  width: 420px;
  height: 420px;
  top: -140px;
  inset-inline-end: -160px;
}
.auth-aside::after {
  width: 300px;
  height: 300px;
  bottom: -120px;
  inset-inline-start: -90px;
}
.auth-aside-body {
  max-width: 420px;
}
.auth-aside h2 {
  margin: 0 0 12px;
  font-size: 2rem;
  line-height: 1.2;
  letter-spacing: -0.02em;
}
.auth-aside-body > p {
  margin: 0 0 32px;
  color: rgba(255, 255, 255, 0.82);
  line-height: 1.6;
}
.auth-features {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.auth-features li {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.auth-features strong {
  display: block;
  font-size: 0.95rem;
  margin-bottom: 2px;
}
.auth-features small {
  display: block;
  font-size: 0.84rem;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.75);
}
.auth-feature-icon {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.auth-feature-icon svg {
  width: 19px;
  height: 19px;
}
.auth-aside-foot {
  margin: 0;
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.6);
}

/* ---------- Brand mark ---------- */
.auth-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 800;
  font-size: 1.08rem;
  text-decoration: none;
  color: var(--text);
}
.auth-brand-light {
  color: #fff;
  align-self: flex-start;
}
.auth-brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--brand-gradient);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  box-shadow: 0 6px 16px -6px rgba(36, 87, 214, 0.75);
}
.auth-brand-light .auth-brand-mark {
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.3);
  box-shadow: none;
}

/* ---------- Form side ---------- */
.auth-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 24px 32px;
  min-width: 0;
}
.auth-topbar {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
}
.auth-brand-compact {
  display: none;
}
.auth-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-dim);
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 8px 10px 8px 6px;
  border-radius: 8px;
}
.auth-back:hover {
  color: var(--accent-blue);
  background: var(--hover-tint);
}
.auth-back svg {
  width: 16px;
  height: 16px;
}
[dir='rtl'] .auth-back svg {
  transform: scaleX(-1);
}
.auth-lang {
  margin-inline-start: auto;
}
.auth-card {
  width: 100%;
  max-width: 420px;
  margin: auto 0;
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  box-shadow: var(--shadow-pop);
}
.auth-head h1 {
  margin: 0 0 6px;
  font-size: 1.6rem;
  letter-spacing: -0.01em;
}
.auth-head p {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.9rem;
  line-height: 1.5;
}
.auth-footer {
  margin-top: 20px;
  font-size: 0.88rem;
  color: var(--text-dim);
  text-align: center;
}

@media (max-width: 900px) {
  .auth-shell {
    grid-template-columns: 1fr;
  }
  .auth-aside {
    display: none;
  }
  .auth-brand-compact {
    display: inline-flex;
  }
  .auth-back {
    display: none;
  }
}
@media (max-width: 480px) {
  .auth-main {
    padding: 16px 16px 24px;
  }
  .auth-card {
    padding: 24px 20px;
    margin-top: 24px;
  }
}
</style>
