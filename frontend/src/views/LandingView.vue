<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CARD_THEME_OPTIONS } from '../utils/cardTheme';
import LanguageSwitcher from '../components/LanguageSwitcher.vue';
import '../styles/admin-theme.css';
import '../styles/customer-theme.css';

const { t } = useI18n();

// Static, author-controlled SVG path data (no user input ever reaches this) —
// rendered via v-html so the feature grid can stay a plain data loop instead
// of ten near-identical <svg> blocks.
const ICONS: Record<string, string> = {
  wallet:
    '<rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10.5h19"/><circle cx="16.5" cy="14.2" r="1.1" fill="currentColor" stroke="none"/>',
  credit:
    '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 9.5h19M6 14.5h5"/>',
  ledger:
    '<path d="M5 4.5a2 2 0 0 1 2-2h4v17H7a2 2 0 0 1-2-2v-13Z"/><path d="M11 2.5h6a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-6"/><path d="M8 7h1M8 11h1M8 15h1"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5"/><path d="M4.5 9.5V19h15V9.5"/><path d="M9.5 19v-5.5h5V19"/><path d="M2.5 19h19"/>',
  gateway:
    '<path d="M12 2.75 19 6v6c0 4.6-3 7.9-7 9.25-4-1.35-7-4.65-7-9.25V6l7-3.25Z"/><path d="M8.75 12.25l2.1 2.1 4.4-4.4"/>',
  widget:
    '<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="M2.5 8h19"/><path d="M9 13.5h6M9 16.5h3"/>',
  transfer:
    '<path d="M4.5 8h11.5M13 4.5 16 8l-3 3.5"/><path d="M19.5 16H8M11 12.5 8 16l3 3.5"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.4"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.4"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.4"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.4"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5"/><circle cx="12" cy="15.5" r="1.4" fill="currentColor" stroke="none"/>',
  store:
    '<path d="M3.5 9 5 4h14l1.5 5"/><path d="M4 9v11h16V9"/><path d="M3.5 9h17"/><path d="M9.5 20v-5.5h5V20"/>',
  briefcase:
    '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7V5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2"/><path d="M3 12.5h18"/>',
  market:
    '<circle cx="7" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><path d="M2.5 20c0-2.8 2-5 4.5-5s4.5 2.2 4.5 5"/><path d="M12.5 20c0-2.8 2-5 4.5-5s4.5 2.2 4.5 5"/>',
  code: '<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m13.5 5-3 14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5c0-3.6 3.6-6.5 8-6.5s8 2.9 8 6.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  globe:
    '<circle cx="12" cy="12" r="9.25"/><path d="M2.75 12h18.5"/><path d="M12 2.75c2.6 2.5 4 6 4 9.25s-1.4 6.75-4 9.25c-2.6-2.5-4-6-4-9.25s1.4-6.75 4-9.25Z"/>',
};

function iconSvg(name: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;
}

const featureCards = [
  { icon: 'wallet', key: 'wallets', accent: 'blue' },
  { icon: 'credit', key: 'credit', accent: 'orange' },
  { icon: 'ledger', key: 'gl', accent: 'blue' },
  { icon: 'bank', key: 'withdrawal', accent: 'lime' },
  { icon: 'gateway', key: 'gateway', accent: 'blue' },
  { icon: 'widget', key: 'widget', accent: 'orange' },
  { icon: 'transfer', key: 'transfers', accent: 'lime' },
  { icon: 'grid', key: 'admin', accent: 'blue' },
  { icon: 'lock', key: 'security', accent: 'red' },
  { icon: 'globe', key: 'locale', accent: 'orange' },
] as const;

const apiEndpoints = ['signup', 'wallets', 'deposit', 'withdraw', 'transfer', 'charge'] as const;

const adminItems = [
  'dashboard',
  'transactions',
  'wallets',
  'customers',
  'admins',
  'walletTypes',
  'purchase',
  'installments',
  'reports',
  'roles',
  'generalLedger',
  'liveActivity',
  'schedulerLogs',
  'offboarding',
] as const;

const gradient = (key: string) => CARD_THEME_OPTIONS.find((o) => o.key === key)?.gradient ?? '';

// Mock data for the hero's app preview — mirrors the signed-in wallet page.
const mockWallets = [
  { key: 'daily', code: 'IRR', color: 'indigo', amount: '48,250,000', mask: '41F2' },
  { key: 'savings', code: 'IRR', color: 'teal', amount: '125,000,000', mask: '7C19' },
  { key: 'merchant', code: 'IRR', color: 'violet', amount: '9,870,000', mask: '03D8' },
  { key: 'travel', code: 'USD', color: 'amber', amount: '$840.50', mask: '22A6' },
] as const;

const mockBars = [38, 62, 45, 80, 56, 92, 70];

const rails = ['POL Pay', 'PAYA', 'SATNA', 'ZarinPal', 'IBAN', 'REST API'];

const howSteps = [
  { icon: 'user', key: 'step1' },
  { icon: 'wallet', key: 'step2' },
  { icon: 'transfer', key: 'step3' },
] as const;

const useCases = [
  { icon: 'store', key: 'merchants', accent: 'blue' },
  { icon: 'briefcase', key: 'companies', accent: 'orange' },
  { icon: 'market', key: 'marketplaces', accent: 'lime' },
  { icon: 'code', key: 'developers', accent: 'violet' },
] as const;

const faqKeys = ['q1', 'q2', 'q3', 'q4', 'q5'] as const;
const openFaq = ref<string | null>('q1');

const securityIcons = ['lock', 'ledger', 'gateway', 'user'] as const;

// Fade/slide sections in as they scroll into view. Content is fully
// visible without JS or with reduced motion — the hidden start state only
// applies once `.reveal-ready` is set on the root here.
const root = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
onMounted(() => {
  const el = root.value;
  if (!el || !('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.classList.add('reveal-ready');
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          observer?.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  el.querySelectorAll('.reveal').forEach((node) => observer!.observe(node));
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="root" class="customer-theme landing-page">
    <!-- Nav -->
    <header class="landing-nav">
      <div class="landing-nav-inner">
        <a href="#top" class="brand">
          <span class="brand-mark">P</span>
          <span class="brand-name">Packeta</span>
        </a>
        <nav class="landing-nav-links">
          <a href="#features">{{ t('landing.nav.features') }}</a>
          <a href="#how">{{ t('landing.extra.how.nav') }}</a>
          <a href="#accounting">{{ t('landing.nav.accounting') }}</a>
          <a href="#payments">{{ t('landing.nav.payments') }}</a>
          <a href="#api">{{ t('landing.nav.api') }}</a>
          <a href="#faq">{{ t('landing.extra.faq.nav') }}</a>
        </nav>
        <div class="landing-nav-actions">
          <LanguageSwitcher />
          <router-link :to="{ name: 'login' }" class="admin-btn admin-btn-ghost hide-xs">
            {{ t('landing.nav.login') }}
          </router-link>
          <router-link :to="{ name: 'signup' }" class="admin-btn admin-btn-primary">
            {{ t('landing.nav.getStarted') }}
          </router-link>
        </div>
      </div>
    </header>

    <!-- Hero -->
    <section id="top" class="hero">
      <div class="hero-bg" aria-hidden="true">
        <span class="hero-grid" />
        <span class="orb orb-1" />
        <span class="orb orb-2" />
        <span class="orb orb-3" />
        <svg class="shape shape-ring" viewBox="0 0 200 200"><circle cx="100" cy="100" r="80" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="6 10" /></svg>
        <svg class="shape shape-squiggle" viewBox="0 0 240 60"><path d="M4 30c20-26 40-26 60 0s40 26 60 0 40-26 60 0 40 26 52 8" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" /></svg>
        <svg class="shape shape-plus" viewBox="0 0 40 40"><path d="M20 4v32M4 20h32" stroke="currentColor" stroke-width="5" stroke-linecap="round" /></svg>
        <svg class="shape shape-triangle" viewBox="0 0 60 60"><path d="M30 6l26 46H4z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" /></svg>
        <span class="shape shape-dots" />
      </div>

      <div class="hero-inner">
        <div class="hero-copy">
          <span class="hero-badge">
            <span class="hero-badge-dot" />
            {{ t('landing.extra.heroBadge') }}
          </span>
          <h1>{{ t('landing.hero.title') }}</h1>
          <p class="hero-sub">{{ t('landing.hero.subtitle') }}</p>
          <div class="hero-ctas">
            <router-link :to="{ name: 'signup' }" class="btn-hero btn-hero-primary">
              {{ t('landing.hero.ctaPrimary') }}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flip-rtl"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </router-link>
            <router-link :to="{ name: 'login' }" class="btn-hero btn-hero-ghost">
              {{ t('landing.hero.ctaSecondary') }}
            </router-link>
          </div>
          <ul class="hero-trust">
            <li v-for="n in 3" :key="n">
              <span class="check" v-html="iconSvg('check')" />
              {{ t(`landing.extra.trust${n}`) }}
            </li>
          </ul>
        </div>

        <!-- App preview: a miniature of the redesigned wallet page -->
        <div class="hero-visual" aria-hidden="true">
          <div class="app-window">
            <div class="app-window-bar">
              <i /><i /><i />
              <span class="app-window-url">packeta.ir/dashboard</span>
            </div>
            <div class="app-window-body">
              <div class="mini-banner">
                <div>
                  <span class="mini-eyebrow">{{ t('landing.extra.mock.totalBalance') }}</span>
                  <strong class="mini-total">183,120,000 <small>IRR</small></strong>
                </div>
                <div class="mini-bars">
                  <span v-for="(h, i) in mockBars" :key="i" :style="{ height: `${h}%` }" />
                </div>
              </div>
              <div class="mini-list">
                <div v-for="(w, i) in mockWallets" :key="w.key" class="mini-row" :class="{ selected: i === 0 }">
                  <span class="mini-chip" :style="{ background: gradient(w.color) }">{{ w.code }}</span>
                  <span class="mini-row-main">
                    <span class="mini-row-name">{{ t(`landing.extra.mock.${w.key}`) }}</span>
                    <span class="mini-row-meta">•• {{ w.mask }}</span>
                  </span>
                  <span class="mini-row-amount">{{ w.amount }}</span>
                </div>
              </div>
              <div class="mini-actions">
                <span v-for="a in ['deposit', 'withdraw', 'transfer', 'purchase']" :key="a" class="mini-action">
                  <i />{{ t(`dashboard.actions.${a}.title`) }}
                </span>
              </div>
            </div>
          </div>

          <div class="float-card" :style="{ background: gradient('indigo') }">
            <div class="float-card-top">
              <span class="float-card-chip" />
              <span class="float-card-brand">Packeta</span>
            </div>
            <span class="float-card-number">•••• •••• •••• 41F2</span>
            <div class="float-card-bottom">
              <span>{{ t('landing.extra.mock.daily') }}</span>
              <span>IRR</span>
            </div>
          </div>

          <div class="float-toast">
            <span class="float-toast-icon" v-html="iconSvg('check')" />
            <span class="float-toast-text">
              <strong dir="ltr">+1,850,000 IRR</strong>
              <span>{{ t('landing.extra.mock.received') }}</span>
            </span>
          </div>

          <div class="float-pill">
            <span class="float-pill-dot" />
            {{ t('landing.extra.mock.ledgerBalanced') }}
          </div>
        </div>
      </div>

      <svg class="hero-wave" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 40c180 40 360 50 540 30S900 0 1080 10s300 50 360 60v20H0z" fill="currentColor" />
      </svg>
    </section>

    <!-- Rails strip -->
    <section class="rails-strip reveal">
      <span class="rails-label">{{ t('landing.extra.railsHeading') }}</span>
      <div class="rails-list">
        <span v-for="r in rails" :key="r" class="rails-item">{{ r }}</span>
      </div>
    </section>

    <!-- Stats -->
    <section class="stats-strip reveal">
      <div class="stat">
        <span class="stat-value">4</span>
        <span class="stat-label">{{ t('landing.stats.wallets') }}</span>
      </div>
      <div class="stat">
        <span class="stat-value">2+</span>
        <span class="stat-label">{{ t('landing.stats.currencies') }}</span>
      </div>
      <div class="stat">
        <span class="stat-value">4</span>
        <span class="stat-label">{{ t('landing.stats.rails') }}</span>
      </div>
      <div class="stat">
        <span class="stat-value">100%</span>
        <span class="stat-label">{{ t('landing.stats.ledger') }}</span>
      </div>
      <div class="stat">
        <span class="stat-value">3</span>
        <span class="stat-label">{{ t('landing.stats.sweeps') }}</span>
      </div>
    </section>

    <!-- Feature bento grid -->
    <section id="features" class="section">
      <div class="section-head reveal">
        <span class="eyebrow">{{ t('landing.nav.features') }}</span>
        <h2>{{ t('landing.features.heading') }}</h2>
        <p>{{ t('landing.features.subheading') }}</p>
      </div>
      <div class="bento">
        <div
          v-for="(card, i) in featureCards"
          :key="card.key"
          class="bento-card reveal"
          :class="[`accent-${card.accent}`, { 'bento-wide': i === 0 || i === 4 }]"
          :style="{ transitionDelay: `${(i % 4) * 60}ms` }"
        >
          <span class="feature-icon" v-html="iconSvg(card.icon)" />
          <h3>{{ t(`landing.features.${card.key}.title`) }}</h3>
          <p>{{ t(`landing.features.${card.key}.desc`) }}</p>
          <span class="bento-shape" aria-hidden="true" />
        </div>
      </div>
    </section>

    <!-- How it works -->
    <section id="how" class="section how">
      <div class="section-head reveal">
        <span class="eyebrow">{{ t('landing.extra.how.eyebrow') }}</span>
        <h2>{{ t('landing.extra.how.title') }}</h2>
        <p>{{ t('landing.extra.how.subtitle') }}</p>
      </div>
      <div class="how-steps">
        <svg class="how-line" viewBox="0 0 1000 80" preserveAspectRatio="none" aria-hidden="true">
          <path d="M60 40C250 -10 350 90 500 40S760 -10 940 40" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="8 10" />
        </svg>
        <div v-for="(step, i) in howSteps" :key="step.key" class="how-step reveal" :style="{ transitionDelay: `${i * 90}ms` }">
          <span class="how-icon">
            <span v-html="iconSvg(step.icon)" />
            <span class="how-num">{{ i + 1 }}</span>
          </span>
          <h3>{{ t(`landing.extra.how.${step.key}.title`) }}</h3>
          <p>{{ t(`landing.extra.how.${step.key}.desc`) }}</p>
        </div>
      </div>
    </section>

    <!-- GL accounting deep dive -->
    <section id="accounting" class="section deep-dive">
      <div class="deep-dive-copy reveal">
        <span class="eyebrow">{{ t('landing.gl.eyebrow') }}</span>
        <h2>{{ t('landing.gl.title') }}</h2>
        <p>{{ t('landing.gl.body') }}</p>
        <ul class="point-list">
          <li v-for="n in 3" :key="n">
            <span class="point-check" v-html="iconSvg('check')" />
            <span>
              <strong>{{ t(`landing.gl.point${n}.title`) }}</strong>
              <span>{{ t(`landing.gl.point${n}.desc`) }}</span>
            </span>
          </li>
        </ul>
      </div>
      <div class="deep-dive-visual reveal">
        <span class="visual-blob blob-blue" aria-hidden="true" />
        <span class="visual-dots" aria-hidden="true" />
        <div class="mock-card ledger-mock">
          <div class="mock-card-title">
            <span class="mock-icon" v-html="iconSvg('ledger')" />
            {{ t('landing.extra.mock.journal') }}
            <span class="mock-badge ok">{{ t('landing.gl.balanced') }}</span>
          </div>
          <div class="ledger-mock-row ledger-mock-head">
            <span>{{ t('landing.gl.colAccount') }}</span>
            <span>{{ t('landing.gl.colDebit') }}</span>
            <span>{{ t('landing.gl.colCredit') }}</span>
          </div>
          <div class="ledger-mock-row">
            <span>{{ t('landing.gl.accounts.bank') }}</span>
            <span class="num">12,400.00</span>
            <span class="num muted">&mdash;</span>
          </div>
          <div class="ledger-mock-row">
            <span>{{ t('landing.gl.accounts.wallets') }}</span>
            <span class="num muted">&mdash;</span>
            <span class="num">9,860.00</span>
          </div>
          <div class="ledger-mock-row">
            <span>{{ t('landing.gl.accounts.receivable') }}</span>
            <span class="num">1,230.00</span>
            <span class="num muted">&mdash;</span>
          </div>
          <div class="ledger-mock-row">
            <span>{{ t('landing.gl.accounts.clearing') }}</span>
            <span class="num">340.00</span>
            <span class="num muted">&mdash;</span>
          </div>
          <div class="ledger-mock-row">
            <span>{{ t('landing.gl.accounts.revenue') }}</span>
            <span class="num muted">&mdash;</span>
            <span class="num">110.00</span>
          </div>
          <div class="ledger-mock-row ledger-mock-total">
            <span>{{ t('landing.gl.balanced') }}</span>
            <span class="num">13,970.00</span>
            <span class="num">13,970.00</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Credit wallet deep dive -->
    <section class="section deep-dive reverse">
      <div class="deep-dive-copy reveal">
        <span class="eyebrow eyebrow-orange">{{ t('landing.credit.eyebrow') }}</span>
        <h2>{{ t('landing.credit.title') }}</h2>
        <p>{{ t('landing.credit.body') }}</p>
        <ul class="point-list">
          <li v-for="n in 4" :key="n">
            <span class="point-check orange" v-html="iconSvg('check')" />
            <span>
              <strong>{{ t(`landing.credit.point${n}.title`) }}</strong>
              <span>{{ t(`landing.credit.point${n}.desc`) }}</span>
            </span>
          </li>
        </ul>
      </div>
      <div class="deep-dive-visual reveal">
        <span class="visual-blob blob-orange" aria-hidden="true" />
        <span class="visual-ring" aria-hidden="true" />
        <div class="mock-card installment-mock">
          <div class="mock-card-title">
            <span class="mock-icon orange" v-html="iconSvg('credit')" />
            {{ t('landing.extra.mock.credit') }}
          </div>
          <div class="credit-meter">
            <div class="credit-meter-head">
              <span>{{ t('landing.extra.mock.used') }}</span>
              <strong>$123.90 / $500.00</strong>
            </div>
            <div class="credit-meter-bar"><span style="width: 25%" /></div>
          </div>
          <div v-for="n in 3" :key="n" class="installment-row">
            <span class="inst-dot" :class="{ done: n < 3, current: n === 3 }">
              <span v-if="n < 3" v-html="iconSvg('check')" />
            </span>
            <div class="inst-info">
              <span class="inst-title">{{ t('landing.credit.installment', { n }) }}</span>
              <span v-if="n < 3" class="inst-sub">{{ t('landing.credit.paid') }}</span>
              <span v-else class="inst-sub current">{{ t('landing.credit.dueSoon') }}</span>
            </div>
            <span class="inst-amount">$41.30</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Auto-withdrawal deep dive -->
    <section id="payments" class="section deep-dive">
      <div class="deep-dive-copy reveal">
        <span class="eyebrow eyebrow-green">{{ t('landing.withdrawal.eyebrow') }}</span>
        <h2>{{ t('landing.withdrawal.title') }}</h2>
        <p>{{ t('landing.withdrawal.body') }}</p>
        <ul class="point-list">
          <li v-for="n in 4" :key="n">
            <span class="point-check green" v-html="iconSvg('check')" />
            <span>
              <strong>{{ t(`landing.withdrawal.point${n}.title`) }}</strong>
              <span>{{ t(`landing.withdrawal.point${n}.desc`) }}</span>
            </span>
          </li>
        </ul>
      </div>
      <div class="deep-dive-visual reveal">
        <span class="visual-blob blob-green" aria-hidden="true" />
        <span class="visual-dots" aria-hidden="true" />
        <div class="mock-card split-mock">
          <div class="mock-card-title">
            <span class="mock-icon green" v-html="iconSvg('bank')" />
            {{ t('landing.extra.mock.sweep') }}
            <span class="mock-badge">09:00 · 13:00 · 17:00</span>
          </div>
          <div class="donut-wrap">
            <svg class="donut" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="46" fill="none" stroke="var(--divider)" stroke-width="16" />
              <circle cx="60" cy="60" r="46" fill="none" stroke="#2457d6" stroke-width="16" stroke-dasharray="173.4 289" transform="rotate(-90 60 60)" stroke-linecap="round" />
              <circle cx="60" cy="60" r="46" fill="none" stroke="#16a34a" stroke-width="16" stroke-dasharray="107.6 289" stroke-dashoffset="-181" transform="rotate(-90 60 60)" stroke-linecap="round" />
            </svg>
            <div class="split-legend">
              <span><i class="dot seg-1" />{{ t('landing.withdrawal.iban1') }} <b>60%</b></span>
              <span><i class="dot seg-2" />{{ t('landing.withdrawal.iban2') }} <b>40%</b></span>
            </div>
          </div>
          <div class="rail-tags">
            <span class="rail-tag">POL Pay</span>
            <span class="rail-tag">PAYA</span>
            <span class="rail-tag">SATNA</span>
            <span class="rail-tag">{{ t('landing.withdrawal.bankTransfer') }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- IPG payment gateway -->
    <section class="section gateway-band">
      <span class="band-shape band-shape-1" aria-hidden="true" />
      <span class="band-shape band-shape-2" aria-hidden="true" />
      <div class="section-head reveal light">
        <span class="eyebrow eyebrow-light">{{ t('landing.gateway.eyebrow') }}</span>
        <h2>{{ t('landing.gateway.title') }}</h2>
        <p>{{ t('landing.gateway.body') }}</p>
      </div>
      <div class="flow">
        <div v-for="n in 4" :key="n" class="flow-step reveal" :style="{ transitionDelay: `${(n - 1) * 80}ms` }">
          <span class="flow-num">{{ n }}</span>
          <strong>{{ t(`landing.gateway.step${n}.title`) }}</strong>
          <span>{{ t(`landing.gateway.step${n}.desc`) }}</span>
        </div>
      </div>
      <p class="note reveal">{{ t('landing.gateway.note') }}</p>
    </section>

    <!-- Widget / SDK deep dive -->
    <section class="section deep-dive reverse">
      <div class="deep-dive-copy reveal">
        <span class="eyebrow eyebrow-orange">{{ t('landing.widget.eyebrow') }}</span>
        <h2>{{ t('landing.widget.title') }}</h2>
        <p>{{ t('landing.widget.body') }}</p>
        <ul class="point-list">
          <li v-for="n in 3" :key="n">
            <span class="point-check orange" v-html="iconSvg('check')" />
            <span>
              <strong>{{ t(`landing.widget.point${n}.title`) }}</strong>
              <span>{{ t(`landing.widget.point${n}.desc`) }}</span>
            </span>
          </li>
        </ul>
      </div>
      <div class="deep-dive-visual reveal">
        <span class="visual-blob blob-violet" aria-hidden="true" />
        <div class="code-mock" dir="ltr">
          <div class="code-dots"><i /><i /><i /><span>checkout.html</span></div>
          <pre><code><span class="c-tag">&lt;script</span> <span class="c-attr">src</span>=<span class="c-str">"https://pay.packeta.app/packeta.js"</span><span class="c-tag">&gt;&lt;/script&gt;</span>

<span class="c-tag">&lt;button</span> <span class="c-attr">data-packeta-pay</span>
        <span class="c-attr">data-amount</span>=<span class="c-str">"250000"</span>
        <span class="c-attr">data-currency</span>=<span class="c-str">"IRR"</span><span class="c-tag">&gt;</span>
  Pay with Packeta
<span class="c-tag">&lt;/button&gt;</span></code></pre>
        </div>
        <div class="widget-button-demo">
          <span class="logo-dot">P</span>
          Pay with Packeta
        </div>
      </div>
    </section>

    <!-- Developer API -->
    <section id="api" class="section deep-dive">
      <div class="deep-dive-copy reveal">
        <span class="eyebrow eyebrow-violet">{{ t('landing.api.eyebrow') }}</span>
        <h2>{{ t('landing.api.title') }}</h2>
        <p>{{ t('landing.api.body') }}</p>
        <ul class="point-list">
          <li v-for="n in 3" :key="n">
            <span class="point-check violet" v-html="iconSvg('check')" />
            <span>
              <strong>{{ t(`landing.api.point${n}.title`) }}</strong>
              <span>{{ t(`landing.api.point${n}.desc`) }}</span>
            </span>
          </li>
        </ul>
      </div>
      <div class="deep-dive-visual api-visual-stack reveal">
        <span class="visual-dots" aria-hidden="true" />
        <div class="mock-card api-endpoint-list">
          <div v-for="ep in apiEndpoints" :key="ep" class="api-endpoint-row">
            <span class="api-method" :class="`method-${t(`landing.api.endpoints.${ep}.method`)}`">{{ t(`landing.api.endpoints.${ep}.method`) }}</span>
            <code class="api-path" dir="ltr">{{ t(`landing.api.endpoints.${ep}.path`) }}</code>
            <span class="api-desc">{{ t(`landing.api.endpoints.${ep}.desc`) }}</span>
          </div>
        </div>
        <div class="code-mock code-mock-sm" dir="ltr">
          <pre><code><span class="c-attr">POST</span> /transactions/purchase/charge
<span class="c-dim">Idempotency-Key: 8f14e45f-ceea-4c67</span>
{ <span class="c-str">"amount"</span>: 250000, <span class="c-str">"currencyCode"</span>: <span class="c-str">"IRR"</span> }
<span class="c-dim">&rarr;</span> { <span class="c-str">"transactionId"</span>, <span class="c-str">"redirectUrl"</span>, <span class="c-str">"expiresAt"</span> }</code></pre>
        </div>
      </div>
    </section>

    <!-- Use cases -->
    <section class="section">
      <div class="section-head reveal">
        <span class="eyebrow">{{ t('landing.extra.useCases.eyebrow') }}</span>
        <h2>{{ t('landing.extra.useCases.title') }}</h2>
        <p>{{ t('landing.extra.useCases.subtitle') }}</p>
      </div>
      <div class="use-grid">
        <div
          v-for="(u, i) in useCases"
          :key="u.key"
          class="use-card reveal"
          :class="`accent-${u.accent}`"
          :style="{ transitionDelay: `${i * 70}ms` }"
        >
          <span class="use-shape" aria-hidden="true" />
          <span class="feature-icon" v-html="iconSvg(u.icon)" />
          <h3>{{ t(`landing.extra.useCases.${u.key}.title`) }}</h3>
          <p>{{ t(`landing.extra.useCases.${u.key}.desc`) }}</p>
        </div>
      </div>
    </section>

    <!-- Admin command center -->
    <section class="section admin-showcase">
      <div class="admin-showcase-inner">
        <div class="section-head reveal">
          <span class="eyebrow">{{ t('landing.admin.eyebrow') }}</span>
          <h2>{{ t('landing.admin.title') }}</h2>
          <p>{{ t('landing.admin.body') }}</p>
        </div>
        <div class="admin-mock reveal" aria-hidden="true">
          <div class="admin-mock-side">
            <span class="admin-mock-logo">P</span>
            <span v-for="(item, i) in adminItems.slice(0, 8)" :key="item" class="admin-mock-nav" :class="{ active: i === 2 }">
              <i />{{ t(`adminNav.${item}`) }}
            </span>
          </div>
          <div class="admin-mock-main">
            <div class="admin-mock-tiles">
              <span v-for="n in 4" :key="n" class="admin-mock-tile"><i /><b /></span>
            </div>
            <div v-for="n in 5" :key="n" class="admin-mock-row">
              <span class="mini-chip" :style="{ background: gradient(['indigo', 'teal', 'violet', 'amber', 'rose'][n - 1]) }" />
              <b :style="{ width: `${30 + ((n * 17) % 30)}%` }" />
              <span class="admin-mock-status" :class="{ warn: n === 4 }" />
            </div>
          </div>
        </div>
        <div class="admin-pill-grid reveal">
          <span v-for="item in adminItems" :key="item" class="admin-pill">
            {{ t(`adminNav.${item}`) }}
          </span>
        </div>
      </div>
    </section>

    <!-- Security -->
    <section id="security" class="section">
      <div class="section-head reveal">
        <span class="eyebrow">{{ t('landing.security.eyebrow') }}</span>
        <h2>{{ t('landing.security.title') }}</h2>
      </div>
      <div class="security-grid">
        <div v-for="n in 4" :key="n" class="security-item reveal" :style="{ transitionDelay: `${(n - 1) * 60}ms` }">
          <span class="security-icon" v-html="iconSvg(securityIcons[n - 1])" />
          <strong>{{ t(`landing.security.point${n}.title`) }}</strong>
          <span>{{ t(`landing.security.point${n}.desc`) }}</span>
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section id="faq" class="section faq">
      <div class="section-head reveal">
        <span class="eyebrow">{{ t('landing.extra.faq.eyebrow') }}</span>
        <h2>{{ t('landing.extra.faq.title') }}</h2>
      </div>
      <div class="faq-list reveal">
        <div v-for="q in faqKeys" :key="q" class="faq-item" :class="{ open: openFaq === q }">
          <button type="button" class="faq-q" :aria-expanded="openFaq === q" @click="openFaq = openFaq === q ? null : q">
            {{ t(`landing.extra.faq.${q}.q`) }}
            <span class="faq-toggle" aria-hidden="true" />
          </button>
          <div v-show="openFaq === q" class="faq-a">{{ t(`landing.extra.faq.${q}.a`) }}</div>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="cta-band reveal">
      <span class="cta-shape cta-shape-1" aria-hidden="true" />
      <span class="cta-shape cta-shape-2" aria-hidden="true" />
      <svg class="cta-shape cta-shape-3" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="80" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 8" /></svg>
      <h2>{{ t('landing.cta.title') }}</h2>
      <p>{{ t('landing.cta.subtitle') }}</p>
      <div class="hero-ctas">
        <router-link :to="{ name: 'signup' }" class="btn-hero btn-hero-white">
          {{ t('landing.cta.primary') }}
        </router-link>
        <router-link :to="{ name: 'login' }" class="btn-hero btn-hero-ghost">
          {{ t('landing.cta.secondary') }}
        </router-link>
      </div>
    </section>

    <footer class="landing-footer">
      <div class="footer-inner">
        <div class="footer-brand">
          <span class="brand">
            <span class="brand-mark">P</span>
            <span class="brand-name">Packeta</span>
          </span>
          <p>{{ t('landing.footer.tagline') }}</p>
        </div>
        <div class="footer-col">
          <strong>{{ t('landing.extra.footer.product') }}</strong>
          <a href="#features">{{ t('landing.nav.features') }}</a>
          <a href="#accounting">{{ t('landing.nav.accounting') }}</a>
          <a href="#payments">{{ t('landing.nav.payments') }}</a>
          <a href="#security">{{ t('landing.nav.security') }}</a>
        </div>
        <div class="footer-col">
          <strong>{{ t('landing.extra.footer.developers') }}</strong>
          <a href="#api">{{ t('landing.nav.api') }}</a>
          <a href="#how">{{ t('landing.extra.how.nav') }}</a>
          <a href="#faq">{{ t('landing.extra.faq.nav') }}</a>
        </div>
        <div class="footer-col">
          <strong>{{ t('landing.extra.footer.account') }}</strong>
          <router-link :to="{ name: 'signup' }">{{ t('landing.nav.getStarted') }}</router-link>
          <router-link :to="{ name: 'login' }">{{ t('landing.nav.login') }}</router-link>
        </div>
      </div>
      <div class="footer-bottom">
        <span>{{ t('landing.footer.rights', { year: new Date().getFullYear() }) }}</span>
        <a href="#top" class="back-top">{{ t('landing.extra.footer.backToTop') }} ↑</a>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.landing-page {
  --navy: #0b1638;
  --navy-2: #13245a;
  --violet: #7c3aed;
  --green: #16a34a;
  --orange: #ea580c;
  padding: 0;
  overflow-x: clip;
  background: #f7f9fd;
}
/* The standalone-page blobs from customer-theme.css would sit on top of the
   hero's own decoration — the landing draws its own shapes instead. */
.landing-page::before,
.landing-page::after {
  display: none;
}
a {
  color: inherit;
}

/* ---------- Scroll reveal ---------- */
.reveal-ready .reveal {
  opacity: 0;
  transform: translateY(22px);
  transition: opacity 0.6s ease, transform 0.6s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.reveal-ready .reveal.in {
  opacity: 1;
  transform: none;
}

/* ---------- Nav ---------- */
.landing-nav {
  position: sticky;
  top: 0;
  z-index: 50;
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: saturate(1.5) blur(14px);
  -webkit-backdrop-filter: saturate(1.5) blur(14px);
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
}
.landing-nav-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  gap: 28px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 800;
  font-size: 1.08rem;
  letter-spacing: -0.01em;
  text-decoration: none;
}
.brand-mark {
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
  flex-shrink: 0;
}
.landing-nav-links {
  display: flex;
  gap: 4px;
  flex: 1;
}
.landing-nav-links a {
  color: var(--text-dim);
  text-decoration: none;
  font-size: 0.88rem;
  font-weight: 600;
  padding: 8px 12px;
  border-radius: 8px;
  transition: color 0.15s, background 0.15s;
}
.landing-nav-links a:hover {
  color: var(--accent-blue);
  background: var(--hover-tint);
}
.landing-nav-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-inline-start: auto;
}

/* ---------- Hero ---------- */
.hero {
  position: relative;
  color: #fff;
  background: radial-gradient(1200px 600px at 80% -10%, #2a4fc7 0%, transparent 60%),
    linear-gradient(160deg, #0a1433 0%, #13245a 55%, #1a3fa8 100%);
  padding: 72px 24px 140px;
  overflow: hidden;
  isolation: isolate;
}
.hero-bg {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}
.hero-grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse at 60% 40%, #000 20%, transparent 75%);
  -webkit-mask-image: radial-gradient(ellipse at 60% 40%, #000 20%, transparent 75%);
}
.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.55;
}
.orb-1 {
  width: 420px;
  height: 420px;
  background: #4f8bff;
  top: -120px;
  inset-inline-end: 8%;
  animation: drift 14s ease-in-out infinite alternate;
}
.orb-2 {
  width: 320px;
  height: 320px;
  background: #8b5cf6;
  bottom: -60px;
  inset-inline-start: -80px;
  opacity: 0.4;
  animation: drift 18s ease-in-out infinite alternate-reverse;
}
.orb-3 {
  width: 220px;
  height: 220px;
  background: #22d3ee;
  top: 40%;
  inset-inline-start: 42%;
  opacity: 0.2;
}
.shape {
  position: absolute;
  color: rgba(255, 255, 255, 0.22);
}
.shape-ring {
  width: 180px;
  top: 60px;
  inset-inline-start: -50px;
  animation: spin 40s linear infinite;
}
.shape-squiggle {
  width: 160px;
  top: 34px;
  inset-inline-start: 30%;
  color: rgba(139, 197, 255, 0.45);
}
.shape-plus {
  width: 26px;
  top: 110px;
  inset-inline-start: 46%;
  color: rgba(255, 214, 102, 0.75);
  animation: float 6s ease-in-out infinite;
}
.shape-triangle {
  width: 46px;
  top: 70%;
  inset-inline-end: 4%;
  color: rgba(244, 114, 182, 0.6);
  animation: float 8s ease-in-out infinite reverse;
}
.shape-dots {
  width: 140px;
  height: 100px;
  top: 30px;
  inset-inline-end: 2%;
  background-image: radial-gradient(rgba(255, 255, 255, 0.35) 1.6px, transparent 1.6px);
  background-size: 14px 14px;
}
.hero-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  gap: 56px;
  align-items: center;
}
.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px 6px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.18);
  font-size: 0.8rem;
  font-weight: 600;
  color: #dbe6ff;
  backdrop-filter: blur(6px);
}
.hero-badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 0 4px rgba(74, 222, 128, 0.25);
  animation: pulse-dot 2s ease-in-out infinite;
}
.hero h1 {
  font-size: clamp(2.1rem, 4.6vw, 3.5rem);
  line-height: 1.08;
  letter-spacing: -0.03em;
  margin: 18px 0 18px;
  font-weight: 800;
  background: linear-gradient(180deg, #ffffff 30%, #b9cdff 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero-sub {
  font-size: 1.05rem;
  line-height: 1.7;
  color: rgba(226, 234, 255, 0.85);
  margin: 0 0 28px;
  max-width: 560px;
}
.hero-ctas {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.btn-hero {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 50px;
  padding: 0 24px;
  border-radius: 14px;
  font-weight: 700;
  font-size: 0.95rem;
  text-decoration: none;
  transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
}
.btn-hero svg {
  width: 18px;
  height: 18px;
}
.btn-hero:hover {
  transform: translateY(-2px);
}
.btn-hero-primary {
  background: linear-gradient(135deg, #5b8cff, #2457d6);
  color: #fff;
  box-shadow: 0 14px 30px -12px rgba(91, 140, 255, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}
.btn-hero-ghost {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.22);
}
.btn-hero-ghost:hover {
  background: rgba(255, 255, 255, 0.16);
}
.btn-hero-white {
  background: #fff;
  color: #1a3fa8;
  box-shadow: 0 14px 30px -14px rgba(0, 0, 0, 0.5);
}
[dir='rtl'] .flip-rtl {
  transform: scaleX(-1);
}
.hero-trust {
  list-style: none;
  padding: 0;
  margin: 28px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 10px 22px;
  font-size: 0.85rem;
  color: rgba(226, 234, 255, 0.85);
}
.hero-trust li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.check {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(74, 222, 128, 0.18);
  color: #4ade80;
  flex: none;
}
.check :deep(svg),
.point-check :deep(svg),
.float-toast-icon :deep(svg),
.inst-dot :deep(svg) {
  width: 12px;
  height: 12px;
  stroke-width: 2.6;
}
.hero-wave {
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 100%;
  height: 90px;
  color: #f7f9fd;
}

/* Hero app preview */
.hero-visual {
  position: relative;
  padding: 30px 20px 40px 0;
  perspective: 1400px;
}
.app-window {
  position: relative;
  background: #fff;
  color: var(--text);
  border-radius: 20px;
  box-shadow: 0 40px 80px -30px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.15);
  overflow: hidden;
  transform: rotateY(-8deg) rotateX(4deg);
  transform-origin: center;
  animation: float 9s ease-in-out infinite;
}
[dir='rtl'] .app-window {
  transform: rotateY(8deg) rotateX(4deg);
}
.app-window-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: #f3f5fa;
  border-bottom: 1px solid #e8ecf4;
}
.app-window-bar i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ff5f57;
}
.app-window-bar i:nth-child(2) {
  background: #febc2e;
}
.app-window-bar i:nth-child(3) {
  background: #28c840;
}
.app-window-url {
  margin-inline-start: 12px;
  font-size: 0.7rem;
  color: var(--text-dimmer);
  background: #fff;
  border: 1px solid #e8ecf4;
  border-radius: 6px;
  padding: 2px 10px;
  direction: ltr;
}
.app-window-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mini-banner {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  background: var(--hero-gradient);
  color: #fff;
}
.mini-eyebrow {
  display: block;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.8;
}
.mini-total {
  font-size: 1.35rem;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.mini-total small {
  font-size: 0.65rem;
  opacity: 0.8;
}
.mini-bars {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 40px;
}
.mini-bars span {
  width: 7px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.55);
}
.mini-bars span:last-child {
  background: #fff;
}
.mini-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mini-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  border-radius: 10px;
  border: 1px solid transparent;
}
.mini-row.selected {
  background: rgba(36, 87, 214, 0.07);
  border-color: rgba(36, 87, 214, 0.25);
}
.mini-chip {
  flex: none;
  width: 36px;
  height: 24px;
  border-radius: 6px;
  color: #fff;
  font-size: 0.55rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 0.04em;
}
.mini-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.mini-row-name {
  font-size: 0.76rem;
  font-weight: 600;
}
.mini-row-meta {
  font-size: 0.62rem;
  color: var(--text-dimmer);
  direction: ltr;
  text-align: start;
}
.mini-row-amount {
  font-size: 0.74rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.mini-actions {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.mini-action {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border: 1px solid #e8ecf4;
  border-radius: 10px;
  font-size: 0.6rem;
  font-weight: 600;
}
.mini-action i {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: rgba(36, 87, 214, 0.12);
}
.float-card {
  position: absolute;
  width: 210px;
  aspect-ratio: 1.586;
  bottom: -6px;
  inset-inline-start: -46px;
  border-radius: 14px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  color: #fff;
  box-shadow: 0 24px 40px -18px rgba(0, 0, 0, 0.7), inset 0 0 0 1px rgba(255, 255, 255, 0.15);
  transform: rotate(-8deg);
  animation: float-tilt 7s ease-in-out infinite;
  overflow: hidden;
}
.float-card::before {
  content: '';
  position: absolute;
  inset: -40% -20% auto auto;
  width: 70%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.25), transparent 70%);
}
.float-card-top,
.float-card-bottom {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.66rem;
  font-weight: 700;
}
.float-card-chip {
  width: 26px;
  height: 19px;
  border-radius: 4px;
  background: linear-gradient(135deg, #ffe08a, #e0b44c);
}
.float-card-number {
  position: relative;
  font-size: 0.82rem;
  letter-spacing: 0.1em;
  font-weight: 600;
  direction: ltr;
}
.float-toast {
  position: absolute;
  top: 0;
  inset-inline-end: -14px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #fff;
  color: var(--text);
  border-radius: 14px;
  box-shadow: 0 20px 40px -18px rgba(0, 0, 0, 0.55);
  animation: float 6s ease-in-out infinite reverse;
}
.float-toast-icon {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(22, 163, 74, 0.12);
  color: var(--green);
}
.float-toast-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.float-toast-text strong {
  font-size: 0.82rem;
  color: var(--green);
}
.float-toast-text span {
  font-size: 0.68rem;
  color: var(--text-dim);
}
.float-pill {
  position: absolute;
  bottom: 18px;
  inset-inline-end: 6px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(10, 20, 51, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(8px);
  font-size: 0.72rem;
  font-weight: 600;
  animation: float 7s ease-in-out infinite;
}
.float-pill-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4ade80;
}

/* ---------- Rails + stats ---------- */
.rails-strip {
  max-width: 1100px;
  margin: -40px auto 0;
  position: relative;
  z-index: 2;
  padding: 18px 24px;
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  justify-content: center;
  background: #fff;
  border: 1px solid var(--card-border);
  border-radius: 18px;
  box-shadow: 0 20px 40px -28px rgba(15, 35, 95, 0.4);
}
.rails-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-dimmer);
}
.rails-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 22px;
}
.rails-item {
  font-weight: 800;
  font-size: 0.95rem;
  letter-spacing: -0.01em;
  color: #94a3b8;
  transition: color 0.15s;
}
.rails-item:hover {
  color: var(--accent-blue);
}
.stats-strip {
  max-width: 1100px;
  margin: 40px auto 0;
  padding: 0 24px;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0;
}
.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 4px;
  padding: 8px 12px;
}
.stat + .stat {
  border-inline-start: 1px solid var(--card-border);
}
.stat-value {
  font-size: 2.2rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  background: var(--brand-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  line-height: 1.1;
}
.stat-label {
  font-size: 0.8rem;
  color: var(--text-dim);
  max-width: 160px;
}

/* ---------- Sections ---------- */
.section {
  max-width: 1200px;
  margin: 0 auto;
  padding: 96px 24px 0;
}
.section-head {
  text-align: center;
  max-width: 720px;
  margin: 0 auto 44px;
}
.section-head h2,
.deep-dive-copy h2 {
  font-size: clamp(1.6rem, 3vw, 2.35rem);
  line-height: 1.15;
  letter-spacing: -0.025em;
  margin: 12px 0 14px;
  font-weight: 800;
}
.section-head p,
.deep-dive-copy > p {
  color: var(--text-dim);
  font-size: 1rem;
  line-height: 1.7;
  margin: 0;
}
.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-blue);
  background: var(--badge-tint-blue);
  padding: 5px 12px;
  border-radius: 999px;
}
.eyebrow-orange { color: var(--orange); background: rgba(234, 88, 12, 0.1); }
.eyebrow-green { color: var(--green); background: rgba(22, 163, 74, 0.1); }
.eyebrow-violet { color: var(--violet); background: rgba(124, 58, 237, 0.1); }
.eyebrow-light { color: #dbe6ff; background: rgba(255, 255, 255, 0.12); }

/* Bento features */
.bento {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
.bento-card {
  position: relative;
  overflow: hidden;
  padding: 24px;
  border-radius: 20px;
  background: #fff;
  border: 1px solid var(--card-border);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s, opacity 0.6s ease;
}
.bento-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 24px 40px -28px rgba(15, 35, 95, 0.45);
  border-color: color-mix(in srgb, var(--acc) 35%, var(--card-border));
}
.bento-wide {
  grid-column: span 2;
  background: linear-gradient(135deg, #fff 40%, color-mix(in srgb, var(--acc) 8%, #fff) 100%);
}
.bento-card h3,
.use-card h3 {
  font-size: 1.02rem;
  margin: 16px 0 8px;
  font-weight: 700;
}
.bento-card p,
.use-card p {
  font-size: 0.88rem;
  color: var(--text-dim);
  line-height: 1.6;
  margin: 0;
  position: relative;
}
.bento-shape {
  position: absolute;
  width: 120px;
  height: 120px;
  inset-block-start: -50px;
  inset-inline-end: -50px;
  border-radius: 50%;
  border: 18px solid color-mix(in srgb, var(--acc) 9%, transparent);
  transition: transform 0.4s;
}
.bento-card:hover .bento-shape {
  transform: scale(1.25);
}
.accent-blue { --acc: #2457d6; }
.accent-orange { --acc: #ea580c; }
.accent-lime { --acc: #16a34a; }
.accent-red { --acc: #dc2626; }
.accent-violet { --acc: #7c3aed; }
.feature-icon {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--acc);
  background: color-mix(in srgb, var(--acc) 11%, transparent);
  position: relative;
}
.feature-icon :deep(svg) {
  width: 24px;
  height: 24px;
}

/* How it works */
.how-steps {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 28px;
}
.how-line {
  position: absolute;
  top: 6px;
  left: 8%;
  width: 84%;
  height: 80px;
  color: #c7d4f3;
  z-index: 0;
}
.how-step {
  position: relative;
  text-align: center;
  padding: 0 12px;
}
.how-icon {
  position: relative;
  width: 84px;
  height: 84px;
  margin: 0 auto;
  border-radius: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border: 1px solid var(--card-border);
  box-shadow: 0 20px 34px -22px rgba(36, 87, 214, 0.6);
  color: var(--accent-blue);
  transform: rotate(-4deg);
}
.how-step:nth-child(3) .how-icon {
  transform: rotate(4deg);
}
.how-icon > span:first-child {
  display: inline-flex;
}
.how-icon :deep(svg) {
  width: 34px;
  height: 34px;
}
.how-num {
  position: absolute;
  top: -10px;
  inset-inline-end: -10px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--brand-gradient);
  color: #fff;
  font-weight: 800;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 3px solid #f7f9fd;
}
.how-step h3 {
  margin: 22px 0 8px;
  font-size: 1.1rem;
}
.how-step p {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.9rem;
  line-height: 1.6;
}

/* Deep dives */
.deep-dive {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 64px;
  align-items: center;
}
.deep-dive.reverse .deep-dive-copy {
  order: 2;
}
.point-list {
  list-style: none;
  padding: 0;
  margin: 26px 0 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.point-list li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.point-list li > span:last-child {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.point-list strong {
  font-size: 0.95rem;
}
.point-list li > span:last-child > span {
  font-size: 0.86rem;
  color: var(--text-dim);
  line-height: 1.55;
}
.point-check {
  flex: none;
  width: 24px;
  height: 24px;
  margin-top: 1px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--badge-tint-blue);
  color: var(--accent-blue);
}
.point-check.orange { background: rgba(234, 88, 12, 0.1); color: var(--orange); }
.point-check.green { background: rgba(22, 163, 74, 0.1); color: var(--green); }
.point-check.violet { background: rgba(124, 58, 237, 0.1); color: var(--violet); }

.deep-dive-visual {
  position: relative;
  isolation: isolate;
}
.visual-blob {
  position: absolute;
  inset: -2% 22% 18% -4%;
  z-index: -1;
  border-radius: 42% 58% 63% 37% / 41% 44% 56% 59%;
  filter: blur(2px);
  opacity: 0.9;
  animation: morph 12s ease-in-out infinite alternate;
}
.blob-blue { background: linear-gradient(135deg, #dbe6ff, #c7d7ff); }
.blob-orange { background: linear-gradient(135deg, #ffe4d1, #ffd0b0); }
.blob-green { background: linear-gradient(135deg, #d6f5df, #bfeccc); }
.blob-violet { background: linear-gradient(135deg, #ece3ff, #dccfff); }
.visual-dots {
  position: absolute;
  width: 130px;
  height: 110px;
  z-index: -1;
  inset-block-end: -24px;
  inset-inline-end: -12px;
  background-image: radial-gradient(#b6c4e6 1.8px, transparent 1.8px);
  background-size: 14px 14px;
}
.visual-ring {
  position: absolute;
  width: 140px;
  height: 140px;
  z-index: -1;
  inset-block-start: -30px;
  inset-inline-start: -20px;
  border-radius: 50%;
  border: 2px dashed #fdba74;
  animation: spin 30s linear infinite;
}
.mock-card {
  background: #fff;
  border: 1px solid var(--card-border);
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 30px 60px -36px rgba(15, 35, 95, 0.55);
  margin: 28px;
}
.mock-card-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 0.92rem;
  margin-bottom: 16px;
}
.mock-icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--badge-tint-blue);
  color: var(--accent-blue);
}
.mock-icon :deep(svg) {
  width: 18px;
  height: 18px;
}
.mock-icon.orange { background: rgba(234, 88, 12, 0.1); color: var(--orange); }
.mock-icon.green { background: rgba(22, 163, 74, 0.1); color: var(--green); }
.mock-badge {
  margin-inline-start: auto;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--badge-tint);
  color: var(--text-dim);
  direction: ltr;
}
.mock-badge.ok {
  background: rgba(22, 163, 74, 0.1);
  color: var(--green);
}
.ledger-mock-row {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr;
  gap: 8px;
  padding: 10px 4px;
  font-size: 0.85rem;
  border-bottom: 1px solid var(--divider);
}
.ledger-mock-head {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dimmer);
  font-weight: 700;
  background: var(--panel-bg);
  border-radius: 8px;
  border: none;
  padding-inline: 8px;
}
.ledger-mock-total {
  border-bottom: none;
  font-weight: 700;
  color: var(--green);
}
.num {
  text-align: end;
  font-variant-numeric: tabular-nums;
}
.muted {
  color: var(--text-dimmer);
}
.credit-meter {
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--panel-bg);
  margin-bottom: 10px;
}
.credit-meter-head {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.credit-meter-head strong {
  color: var(--text);
  direction: ltr;
}
.credit-meter-bar {
  height: 8px;
  border-radius: 99px;
  background: #fde3d0;
  overflow: hidden;
}
.credit-meter-bar span {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, #fb923c, #ea580c);
}
.installment-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--divider);
}
.installment-row:last-child {
  border-bottom: none;
}
.inst-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid var(--card-border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.inst-dot.done {
  background: var(--green);
  border-color: var(--green);
  color: #fff;
}
.inst-dot.current {
  border-color: var(--orange);
  box-shadow: 0 0 0 4px rgba(234, 88, 12, 0.15);
}
.inst-info {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.inst-title {
  font-weight: 600;
  font-size: 0.88rem;
}
.inst-sub {
  font-size: 0.76rem;
  color: var(--text-dimmer);
}
.inst-sub.current {
  color: var(--orange);
  font-weight: 600;
}
.inst-amount {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.donut-wrap {
  display: flex;
  align-items: center;
  gap: 22px;
  margin-bottom: 16px;
}
.donut {
  width: 130px;
  height: 130px;
  flex: none;
}
.split-legend {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 0.86rem;
}
.split-legend span {
  display: flex;
  align-items: center;
  gap: 8px;
}
.split-legend b {
  margin-inline-start: auto;
  padding-inline-start: 10px;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}
.dot.seg-1 { background: #2457d6; }
.dot.seg-2 { background: #16a34a; }
.rail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.rail-tag {
  font-size: 0.76rem;
  font-weight: 700;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--card-border);
  background: var(--panel-bg);
}

/* Gateway band */
.gateway-band {
  position: relative;
  max-width: none;
  margin-top: 96px;
  padding: 80px 24px;
  background: linear-gradient(160deg, #0a1433 0%, #13245a 60%, #1a3fa8 100%);
  color: #fff;
  overflow: hidden;
  isolation: isolate;
}
.gateway-band .section-head p {
  color: rgba(226, 234, 255, 0.8);
}
.band-shape {
  position: absolute;
  z-index: -1;
  border-radius: 50%;
}
.band-shape-1 {
  width: 380px;
  height: 380px;
  top: -180px;
  inset-inline-end: -80px;
  background: radial-gradient(circle, rgba(91, 140, 255, 0.45), transparent 70%);
}
.band-shape-2 {
  width: 260px;
  height: 260px;
  bottom: -150px;
  inset-inline-end: 6%;
  border: 2px dashed rgba(255, 255, 255, 0.15);
}
.flow {
  max-width: 1100px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  counter-reset: flow;
}
.flow-step {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 22px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(6px);
}
.flow-step:not(:last-child)::after {
  content: '';
  position: absolute;
  top: 38px;
  inset-inline-end: -16px;
  width: 16px;
  height: 2px;
  background: rgba(255, 255, 255, 0.3);
}
.flow-step span:last-child {
  font-size: 0.85rem;
  color: rgba(226, 234, 255, 0.78);
  line-height: 1.55;
}
.flow-num {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  background: linear-gradient(135deg, #5b8cff, #2457d6);
  box-shadow: 0 8px 18px -8px rgba(91, 140, 255, 0.9);
}
.gateway-band .note {
  max-width: 760px;
  margin: 28px auto 0;
  text-align: center;
  font-size: 0.85rem;
  color: rgba(226, 234, 255, 0.65);
}

/* Code */
.code-mock {
  position: relative;
  background: #0d1530;
  color: #dbe6ff;
  border-radius: 18px;
  padding: 16px 20px 20px;
  margin: 28px;
  box-shadow: 0 30px 60px -30px rgba(10, 20, 51, 0.8);
  overflow-x: auto;
  text-align: left;
}
.code-mock pre {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8rem;
  line-height: 1.7;
}
.code-dots {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
}
.code-dots i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ff5f57;
}
.code-dots i:nth-child(2) { background: #febc2e; }
.code-dots i:nth-child(3) { background: #28c840; }
.code-dots span {
  margin-inline-start: 10px;
  font-size: 0.72rem;
  color: #7f8cb3;
}
.c-tag { color: #7aa2ff; }
.c-attr { color: #f9a8d4; }
.c-str { color: #86efac; }
.c-dim { color: #7f8cb3; }
.widget-button-demo {
  position: absolute;
  bottom: -6px;
  inset-inline-end: 10px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-radius: 14px;
  background: var(--brand-gradient);
  color: #fff;
  font-weight: 700;
  font-size: 0.9rem;
  box-shadow: 0 18px 30px -14px rgba(36, 87, 214, 0.8);
  animation: float 6s ease-in-out infinite;
}
.logo-dot {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: #fff;
  color: #2457d6;
  font-size: 0.75rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.api-visual-stack {
  display: flex;
  flex-direction: column;
}
.api-visual-stack .mock-card {
  margin-bottom: 0;
}
.code-mock-sm {
  margin-top: -18px;
  margin-inline-start: 64px;
}
.api-endpoint-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 9px 0;
  border-bottom: 1px solid var(--divider);
  font-size: 0.8rem;
}
.api-endpoint-row:last-child {
  border-bottom: none;
}
.api-method {
  font-size: 0.66rem;
  font-weight: 800;
  text-align: center;
  padding: 3px 0;
  border-radius: 6px;
  background: rgba(22, 163, 74, 0.1);
  color: var(--green);
}
.method-GET {
  background: var(--badge-tint-blue);
  color: var(--accent-blue);
}
.api-path {
  font-size: 0.76rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.api-desc {
  color: var(--text-dim);
  font-size: 0.76rem;
}

/* Use cases */
.use-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
.use-card {
  position: relative;
  overflow: hidden;
  padding: 26px 22px;
  border-radius: 22px;
  background: #fff;
  border: 1px solid var(--card-border);
  transition: transform 0.2s, box-shadow 0.2s, opacity 0.6s ease;
}
.use-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 24px 40px -28px rgba(15, 35, 95, 0.45);
}
.use-shape {
  position: absolute;
  inset-block-end: -40px;
  inset-inline-end: -40px;
  width: 130px;
  height: 130px;
  border-radius: 34px;
  transform: rotate(24deg);
  background: color-mix(in srgb, var(--acc) 8%, transparent);
}

/* Admin showcase */
.admin-showcase-inner {
  position: relative;
  padding: 56px 40px;
  border-radius: 32px;
  background: linear-gradient(180deg, #eef3ff 0%, #f7f9fd 100%);
  border: 1px solid var(--card-border);
  overflow: hidden;
}
.admin-showcase .section-head {
  margin-bottom: 32px;
}
.admin-mock {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  max-width: 860px;
  margin: 0 auto 32px;
  border-radius: 18px;
  overflow: hidden;
  background: #fff;
  border: 1px solid var(--card-border);
  box-shadow: 0 40px 70px -40px rgba(15, 35, 95, 0.55);
}
.admin-mock-side {
  background: #0f172a;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.admin-mock-logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--brand-gradient);
  color: #fff;
  font-weight: 800;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
}
.admin-mock-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  font-size: 0.7rem;
  color: #aab3c5;
  white-space: nowrap;
  overflow: hidden;
}
.admin-mock-nav i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.2);
  flex: none;
}
.admin-mock-nav.active {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}
.admin-mock-main {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.admin-mock-tiles {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 6px;
}
.admin-mock-tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--card-border);
  border-radius: 10px;
}
.admin-mock-tile i {
  width: 40%;
  height: 6px;
  border-radius: 3px;
  background: #e2e8f0;
}
.admin-mock-tile b {
  width: 70%;
  height: 12px;
  border-radius: 4px;
  background: #cbd5e1;
}
.admin-mock-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 6px;
  border-bottom: 1px solid var(--divider);
}
.admin-mock-row b {
  height: 8px;
  border-radius: 4px;
  background: #e2e8f0;
}
.admin-mock-row .mini-chip {
  width: 30px;
  height: 20px;
}
.admin-mock-status {
  margin-inline-start: auto;
  width: 54px;
  height: 18px;
  border-radius: 999px;
  background: rgba(22, 163, 74, 0.14);
}
.admin-mock-status.warn {
  background: rgba(234, 88, 12, 0.16);
}
.admin-pill-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
.admin-pill {
  font-size: 0.82rem;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--card-border);
  color: var(--text-dim);
}

/* Security */
.security-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
.security-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px 22px;
  border-radius: 20px;
  background: #fff;
  border: 1px solid var(--card-border);
}
.security-item > span:last-child {
  font-size: 0.86rem;
  color: var(--text-dim);
  line-height: 1.6;
}
.security-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #0f172a;
  color: #fff;
  margin-bottom: 6px;
}
.security-icon :deep(svg) {
  width: 22px;
  height: 22px;
}

/* FAQ */
.faq-list {
  max-width: 820px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.faq-item {
  border-radius: 16px;
  background: #fff;
  border: 1px solid var(--card-border);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.faq-item.open {
  border-color: color-mix(in srgb, var(--accent-blue) 40%, var(--card-border));
  box-shadow: 0 16px 30px -24px rgba(36, 87, 214, 0.6);
}
.faq-q {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  background: none;
  border: none;
  font: inherit;
  font-size: 0.98rem;
  font-weight: 700;
  color: var(--text);
  text-align: start;
  cursor: pointer;
}
.faq-toggle {
  position: relative;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--badge-tint-blue);
}
.faq-toggle::before,
.faq-toggle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 12px;
  height: 2px;
  margin: -1px 0 0 -6px;
  background: var(--accent-blue);
  border-radius: 2px;
  transition: transform 0.2s;
}
.faq-toggle::after {
  transform: rotate(90deg);
}
.faq-item.open .faq-toggle::after {
  transform: rotate(0deg);
}
.faq-a {
  padding: 0 22px 20px;
  color: var(--text-dim);
  font-size: 0.92rem;
  line-height: 1.7;
}

/* CTA */
.cta-band {
  position: relative;
  max-width: 1150px;
  margin: 96px auto 0;
  padding: 64px 32px;
  border-radius: 32px;
  text-align: center;
  color: #fff;
  background: linear-gradient(135deg, #1a3fa8 0%, #2457d6 50%, #6d5cff 100%);
  overflow: hidden;
  isolation: isolate;
  box-shadow: 0 40px 70px -40px rgba(36, 87, 214, 0.9);
}
.cta-band h2 {
  font-size: clamp(1.7rem, 3.4vw, 2.5rem);
  letter-spacing: -0.025em;
  margin: 0 0 12px;
  font-weight: 800;
}
.cta-band p {
  color: rgba(235, 241, 255, 0.85);
  margin: 0 auto 28px;
  max-width: 560px;
}
.cta-band .hero-ctas {
  justify-content: center;
}
.cta-shape {
  position: absolute;
  z-index: -1;
}
.cta-shape-1 {
  width: 300px;
  height: 300px;
  border-radius: 50%;
  top: -150px;
  inset-inline-start: -80px;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.25), transparent 70%);
}
.cta-shape-2 {
  width: 140px;
  height: 140px;
  border-radius: 36px;
  bottom: -50px;
  inset-inline-end: 12%;
  transform: rotate(28deg);
  background: rgba(255, 255, 255, 0.1);
}
.cta-shape-3 {
  width: 200px;
  top: -40px;
  inset-inline-end: -40px;
  color: rgba(255, 255, 255, 0.3);
  animation: spin 40s linear infinite;
}

/* Footer */
.landing-footer {
  margin-top: 96px;
  background: #0b1229;
  color: #aab3c5;
}
.footer-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 56px 24px 40px;
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: 32px;
}
.footer-brand .brand {
  color: #fff;
}
.footer-brand p {
  margin: 14px 0 0;
  font-size: 0.88rem;
  max-width: 300px;
  line-height: 1.6;
}
.footer-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 0.88rem;
}
.footer-col strong {
  color: #fff;
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}
.footer-col a {
  text-decoration: none;
  transition: color 0.15s;
}
.footer-col a:hover,
.back-top:hover {
  color: #fff;
}
.footer-bottom {
  max-width: 1152px;
  margin: 0 auto;
  padding: 20px 0 28px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 0.8rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.back-top {
  text-decoration: none;
}

/* ---------- Motion ---------- */
@keyframes float {
  0%, 100% { translate: 0 0; }
  50% { translate: 0 -10px; }
}
@keyframes float-tilt {
  0%, 100% { transform: rotate(-8deg) translateY(0); }
  50% { transform: rotate(-5deg) translateY(-8px); }
}
@keyframes drift {
  to { transform: translate(-40px, 30px) scale(1.1); }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@keyframes morph {
  to { border-radius: 58% 42% 38% 62% / 55% 60% 40% 45%; }
}
@keyframes pulse-dot {
  50% { box-shadow: 0 0 0 7px rgba(74, 222, 128, 0.1); }
}
@media (prefers-reduced-motion: reduce) {
  .landing-page *,
  .landing-page *::before,
  .landing-page *::after {
    animation: none !important;
    transition: none !important;
  }
}

/* ---------- Responsive ---------- */
@media (max-width: 1080px) {
  .landing-nav-links {
    display: none;
  }
  .hero-inner,
  .deep-dive {
    grid-template-columns: minmax(0, 1fr);
    gap: 40px;
  }
  .deep-dive.reverse .deep-dive-copy {
    order: 0;
  }
  .hero {
    padding-top: 56px;
  }
  .hero-visual {
    max-width: 560px;
    margin: 0 auto;
    width: 100%;
  }
  .bento,
  .use-grid,
  .security-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .flow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .flow-step::after {
    display: none;
  }
  .stats-strip {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    row-gap: 20px;
  }
  .stat:nth-child(4) {
    border-inline-start: none;
  }
  .footer-inner {
    grid-template-columns: 1fr 1fr 1fr;
  }
  .footer-brand {
    grid-column: 1 / -1;
  }
}
@media (max-width: 640px) {
  .landing-nav-inner {
    padding: 10px 14px;
    gap: 10px;
  }
  .hide-xs,
  .brand-name {
    display: none;
  }
  .hero {
    padding: 40px 16px 110px;
  }
  .hero-visual {
    padding: 24px 0 56px;
  }
  .float-card {
    width: 150px;
    inset-inline-start: -8px;
    bottom: -46px;
  }
  .shape-ring,
  .shape-plus,
  .shape-dots,
  .shape-squiggle {
    display: none;
  }
  .mini-action {
    font-size: 0.52rem;
  }
  .float-card-number {
    font-size: 0.62rem;
  }
  .float-toast {
    inset-inline-end: -4px;
    top: 4px;
  }
  .float-pill {
    display: none;
  }
  .section {
    padding: 64px 16px 0;
  }
  .rails-strip {
    margin: -40px 16px 0;
  }
  .bento,
  .use-grid,
  .security-grid,
  .flow,
  .how-steps {
    grid-template-columns: minmax(0, 1fr);
  }
  .bento-wide {
    grid-column: auto;
  }
  .how-line {
    display: none;
  }
  .stats-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .stat:nth-child(odd) {
    border-inline-start: none;
  }
  .stat:nth-child(4) {
    border-inline-start: 1px solid var(--card-border);
  }
  .mock-card,
  .code-mock {
    margin: 16px 4px;
  }
  .code-mock-sm {
    margin-inline-start: 4px;
    margin-top: 0;
  }
  .donut-wrap {
    flex-direction: column;
    align-items: stretch;
  }
  .donut {
    align-self: center;
  }
  .api-endpoint-row {
    grid-template-columns: 50px minmax(0, 1fr);
  }
  .api-desc {
    grid-column: 2;
  }
  .admin-showcase-inner {
    padding: 36px 16px;
    border-radius: 24px;
  }
  .admin-mock {
    grid-template-columns: minmax(0, 1fr);
  }
  .admin-mock-side {
    display: none;
  }
  .gateway-band {
    padding: 64px 16px;
  }
  .cta-band {
    margin: 64px 16px 0;
    padding: 48px 20px;
    border-radius: 24px;
  }
  .footer-inner {
    grid-template-columns: 1fr 1fr;
  }
  .footer-bottom {
    margin: 0 16px;
  }
}
</style>
