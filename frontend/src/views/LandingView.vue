<script setup lang="ts">
import { useI18n } from 'vue-i18n';
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
</script>

<template>
  <div class="customer-theme landing-page">
    <!-- Nav -->
    <header class="landing-nav">
      <div class="landing-nav-inner">
        <div class="brand">
          <span class="brand-mark">P</span>
          <span class="brand-name">Packeta</span>
        </div>
        <nav class="landing-nav-links">
          <a href="#features">{{ t('landing.nav.features') }}</a>
          <a href="#accounting">{{ t('landing.nav.accounting') }}</a>
          <a href="#payments">{{ t('landing.nav.payments') }}</a>
          <a href="#security">{{ t('landing.nav.security') }}</a>
        </nav>
        <div class="landing-nav-actions">
          <LanguageSwitcher />
          <router-link :to="{ name: 'login' }" class="admin-btn admin-btn-ghost">
            {{ t('landing.nav.login') }}
          </router-link>
          <router-link :to="{ name: 'signup' }" class="admin-btn admin-btn-primary">
            {{ t('landing.nav.getStarted') }}
          </router-link>
        </div>
      </div>
    </header>

    <!-- Hero -->
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">{{ t('landing.hero.eyebrow') }}</span>
        <h1>{{ t('landing.hero.title') }}</h1>
        <p class="hero-sub">{{ t('landing.hero.subtitle') }}</p>
        <div class="hero-ctas">
          <router-link :to="{ name: 'signup' }" class="admin-btn admin-btn-primary hero-btn">
            {{ t('landing.hero.ctaPrimary') }}
          </router-link>
          <router-link :to="{ name: 'login' }" class="admin-btn admin-btn-ghost hero-btn">
            {{ t('landing.hero.ctaSecondary') }}
          </router-link>
        </div>
      </div>
      <div class="hero-visual" aria-hidden="true">
        <div class="wallet-stack">
          <div class="wallet-card wc-buy">
            <span class="wc-label">{{ t('landing.hero.mockBuy') }}</span>
            <span class="wc-amount">$1,240.50</span>
          </div>
          <div class="wallet-card wc-credit">
            <span class="wc-label">{{ t('landing.hero.mockCredit') }}</span>
            <span class="wc-amount">-$312.00</span>
          </div>
          <div class="wallet-card wc-sell">
            <span class="wc-label">{{ t('landing.hero.mockSell') }}</span>
            <span class="wc-amount">$8,905.00</span>
          </div>
          <div class="wallet-card wc-gift">
            <span class="wc-label">{{ t('landing.hero.mockGift') }}</span>
            <span class="wc-amount">$50.00</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Stats -->
    <section class="stats-strip">
      <div class="stat-tile">
        <span class="stat-value">4</span>
        <span class="stat-label">{{ t('landing.stats.wallets') }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-value">2+</span>
        <span class="stat-label">{{ t('landing.stats.currencies') }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-value">4</span>
        <span class="stat-label">{{ t('landing.stats.rails') }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-value">100%</span>
        <span class="stat-label">{{ t('landing.stats.ledger') }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-value">3</span>
        <span class="stat-label">{{ t('landing.stats.sweeps') }}</span>
      </div>
    </section>

    <!-- Feature grid -->
    <section id="features" class="section">
      <div class="section-head">
        <h2>{{ t('landing.features.heading') }}</h2>
        <p>{{ t('landing.features.subheading') }}</p>
      </div>
      <div class="feature-grid">
        <div v-for="card in featureCards" :key="card.key" class="admin-card feature-card" :class="`accent-${card.accent}`">
          <span class="feature-icon" v-html="iconSvg(card.icon)" />
          <h3>{{ t(`landing.features.${card.key}.title`) }}</h3>
          <p>{{ t(`landing.features.${card.key}.desc`) }}</p>
        </div>
      </div>
    </section>

    <!-- GL accounting deep dive -->
    <section id="accounting" class="section deep-dive accent-band-blue">
      <div class="deep-dive-copy">
        <span class="eyebrow">{{ t('landing.gl.eyebrow') }}</span>
        <h2>{{ t('landing.gl.title') }}</h2>
        <p>{{ t('landing.gl.body') }}</p>
        <ul class="point-list">
          <li>
            <strong>{{ t('landing.gl.point1.title') }}</strong>
            <span>{{ t('landing.gl.point1.desc') }}</span>
          </li>
          <li>
            <strong>{{ t('landing.gl.point2.title') }}</strong>
            <span>{{ t('landing.gl.point2.desc') }}</span>
          </li>
          <li>
            <strong>{{ t('landing.gl.point3.title') }}</strong>
            <span>{{ t('landing.gl.point3.desc') }}</span>
          </li>
        </ul>
      </div>
      <div class="deep-dive-visual admin-card ledger-mock">
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
    </section>

    <!-- Credit wallet deep dive -->
    <section class="section deep-dive reverse accent-band-orange">
      <div class="deep-dive-copy">
        <span class="eyebrow">{{ t('landing.credit.eyebrow') }}</span>
        <h2>{{ t('landing.credit.title') }}</h2>
        <p>{{ t('landing.credit.body') }}</p>
        <ul class="point-list">
          <li>
            <strong>{{ t('landing.credit.point1.title') }}</strong>
            <span>{{ t('landing.credit.point1.desc') }}</span>
          </li>
          <li>
            <strong>{{ t('landing.credit.point2.title') }}</strong>
            <span>{{ t('landing.credit.point2.desc') }}</span>
          </li>
          <li>
            <strong>{{ t('landing.credit.point3.title') }}</strong>
            <span>{{ t('landing.credit.point3.desc') }}</span>
          </li>
          <li>
            <strong>{{ t('landing.credit.point4.title') }}</strong>
            <span>{{ t('landing.credit.point4.desc') }}</span>
          </li>
        </ul>
      </div>
      <div class="deep-dive-visual admin-card installment-mock">
        <div class="installment-row" v-for="n in 3" :key="n">
          <span class="inst-dot" :class="{ done: n < 3, current: n === 3 }" />
          <div class="inst-info">
            <span class="inst-title">{{ t('landing.credit.installment', { n }) }}</span>
            <span class="inst-sub" v-if="n < 3">{{ t('landing.credit.paid') }}</span>
            <span class="inst-sub current" v-else>{{ t('landing.credit.dueSoon') }}</span>
          </div>
          <span class="inst-amount">$41.30</span>
        </div>
      </div>
    </section>

    <!-- Auto-withdrawal deep dive -->
    <section id="payments" class="section deep-dive accent-band-lime">
      <div class="deep-dive-copy">
        <span class="eyebrow">{{ t('landing.withdrawal.eyebrow') }}</span>
        <h2>{{ t('landing.withdrawal.title') }}</h2>
        <p>{{ t('landing.withdrawal.body') }}</p>
        <ul class="point-list">
          <li>
            <strong>{{ t('landing.withdrawal.point1.title') }}</strong>
            <span>{{ t('landing.withdrawal.point1.desc') }}</span>
          </li>
          <li>
            <strong>{{ t('landing.withdrawal.point2.title') }}</strong>
            <span>{{ t('landing.withdrawal.point2.desc') }}</span>
          </li>
          <li>
            <strong>{{ t('landing.withdrawal.point3.title') }}</strong>
            <span>{{ t('landing.withdrawal.point3.desc') }}</span>
          </li>
          <li>
            <strong>{{ t('landing.withdrawal.point4.title') }}</strong>
            <span>{{ t('landing.withdrawal.point4.desc') }}</span>
          </li>
        </ul>
      </div>
      <div class="deep-dive-visual admin-card split-mock">
        <div class="split-bar">
          <span class="split-seg seg-1" style="width: 60%">60%</span>
          <span class="split-seg seg-2" style="width: 40%">40%</span>
        </div>
        <div class="split-legend">
          <span><i class="dot seg-1" />{{ t('landing.withdrawal.iban1') }}</span>
          <span><i class="dot seg-2" />{{ t('landing.withdrawal.iban2') }}</span>
        </div>
        <div class="rail-tags">
          <span class="rail-tag">POL Pay</span>
          <span class="rail-tag">PAYA</span>
          <span class="rail-tag">SATNA</span>
          <span class="rail-tag">{{ t('landing.withdrawal.bankTransfer') }}</span>
        </div>
      </div>
    </section>

    <!-- IPG payment gateway deep dive -->
    <section class="section deep-dive reverse accent-band-blue">
      <div class="deep-dive-copy">
        <span class="eyebrow">{{ t('landing.gateway.eyebrow') }}</span>
        <h2>{{ t('landing.gateway.title') }}</h2>
        <p>{{ t('landing.gateway.body') }}</p>
        <p class="note">{{ t('landing.gateway.note') }}</p>
      </div>
      <div class="deep-dive-visual flow-mock">
        <div class="flow-step">
          <span class="flow-num">1</span>
          <strong>{{ t('landing.gateway.step1.title') }}</strong>
          <span>{{ t('landing.gateway.step1.desc') }}</span>
        </div>
        <div class="flow-arrow">&rarr;</div>
        <div class="flow-step">
          <span class="flow-num">2</span>
          <strong>{{ t('landing.gateway.step2.title') }}</strong>
          <span>{{ t('landing.gateway.step2.desc') }}</span>
        </div>
        <div class="flow-arrow">&rarr;</div>
        <div class="flow-step">
          <span class="flow-num">3</span>
          <strong>{{ t('landing.gateway.step3.title') }}</strong>
          <span>{{ t('landing.gateway.step3.desc') }}</span>
        </div>
        <div class="flow-arrow">&rarr;</div>
        <div class="flow-step">
          <span class="flow-num">4</span>
          <strong>{{ t('landing.gateway.step4.title') }}</strong>
          <span>{{ t('landing.gateway.step4.desc') }}</span>
        </div>
      </div>
    </section>

    <!-- Widget / SDK deep dive -->
    <section class="section deep-dive accent-band-orange">
      <div class="deep-dive-copy">
        <span class="eyebrow">{{ t('landing.widget.eyebrow') }}</span>
        <h2>{{ t('landing.widget.title') }}</h2>
        <p>{{ t('landing.widget.body') }}</p>
        <ul class="point-list">
          <li>
            <strong>{{ t('landing.widget.point1.title') }}</strong>
            <span>{{ t('landing.widget.point1.desc') }}</span>
          </li>
          <li>
            <strong>{{ t('landing.widget.point2.title') }}</strong>
            <span>{{ t('landing.widget.point2.desc') }}</span>
          </li>
          <li>
            <strong>{{ t('landing.widget.point3.title') }}</strong>
            <span>{{ t('landing.widget.point3.desc') }}</span>
          </li>
        </ul>
      </div>
      <div class="deep-dive-visual admin-card code-mock" dir="ltr">
        <div class="code-dots"><i /><i /><i /></div>
        <pre><code>&lt;script src="https://pay.packeta.app/packeta.js"&gt;&lt;/script&gt;

&lt;button data-packeta-pay
        data-amount="250000"
        data-currency="IRR"&gt;
  Pay with Packeta
&lt;/button&gt;</code></pre>
      </div>
    </section>

    <!-- Admin command center -->
    <section class="section admin-showcase">
      <div class="section-head">
        <span class="eyebrow">{{ t('landing.admin.eyebrow') }}</span>
        <h2>{{ t('landing.admin.title') }}</h2>
        <p>{{ t('landing.admin.body') }}</p>
      </div>
      <div class="admin-pill-grid">
        <span v-for="item in adminItems" :key="item" class="admin-pill">
          {{ t(`adminNav.${item}`) }}
        </span>
      </div>
    </section>

    <!-- Security -->
    <section id="security" class="section security-band">
      <div class="section-head">
        <span class="eyebrow">{{ t('landing.security.eyebrow') }}</span>
        <h2>{{ t('landing.security.title') }}</h2>
      </div>
      <div class="security-grid">
        <div class="security-item">
          <strong>{{ t('landing.security.point1.title') }}</strong>
          <span>{{ t('landing.security.point1.desc') }}</span>
        </div>
        <div class="security-item">
          <strong>{{ t('landing.security.point2.title') }}</strong>
          <span>{{ t('landing.security.point2.desc') }}</span>
        </div>
        <div class="security-item">
          <strong>{{ t('landing.security.point3.title') }}</strong>
          <span>{{ t('landing.security.point3.desc') }}</span>
        </div>
        <div class="security-item">
          <strong>{{ t('landing.security.point4.title') }}</strong>
          <span>{{ t('landing.security.point4.desc') }}</span>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="cta-band">
      <h2>{{ t('landing.cta.title') }}</h2>
      <p>{{ t('landing.cta.subtitle') }}</p>
      <div class="hero-ctas">
        <router-link :to="{ name: 'signup' }" class="admin-btn admin-btn-primary hero-btn">
          {{ t('landing.cta.primary') }}
        </router-link>
        <router-link :to="{ name: 'login' }" class="admin-btn admin-btn-ghost hero-btn">
          {{ t('landing.cta.secondary') }}
        </router-link>
      </div>
    </section>

    <footer class="landing-footer">
      <div class="brand">
        <span class="brand-mark small">P</span>
        <span class="brand-name">Packeta</span>
      </div>
      <p>{{ t('landing.footer.tagline') }}</p>
      <p class="rights">{{ t('landing.footer.rights', { year: new Date().getFullYear() }) }}</p>
    </footer>
  </div>
</template>

<style scoped>
.landing-page {
  padding: 0;
  overflow-x: hidden;
}

/* --- Nav --- */
.landing-nav {
  position: sticky;
  top: 0;
  z-index: 5;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--card-border);
}
.landing-nav-inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 14px 24px;
  display: flex;
  align-items: center;
  gap: 24px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 1.05rem;
}
.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--brand-gradient);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  box-shadow: var(--shadow-btn);
  flex-shrink: 0;
}
.brand-mark.small {
  width: 26px;
  height: 26px;
  font-size: 0.85rem;
}
.landing-nav-links {
  display: flex;
  gap: 20px;
  flex: 1;
}
.landing-nav-links a {
  color: var(--text-dim);
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 600;
}
.landing-nav-links a:hover {
  color: var(--accent-blue);
}
.landing-nav-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.landing-nav-actions .admin-btn {
  padding: 8px 16px;
  font-size: 0.85rem;
}

/* --- Hero --- */
.hero {
  max-width: 1180px;
  margin: 0 auto;
  padding: 64px 24px 40px;
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 40px;
  align-items: center;
}
.eyebrow {
  display: inline-block;
  background: var(--badge-tint);
  color: var(--accent-blue);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  margin-bottom: 16px;
}
.hero-copy h1 {
  font-size: 2.6rem;
  line-height: 1.15;
  margin: 0 0 16px;
}
.hero-sub {
  font-size: 1.05rem;
  color: var(--text-dim);
  max-width: 560px;
  margin: 0 0 28px;
}
.hero-ctas {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.hero-btn {
  padding: 12px 22px;
  font-size: 0.95rem;
}
.hero-visual {
  display: flex;
  justify-content: center;
}
.wallet-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  max-width: 320px;
}
.wallet-card {
  border-radius: var(--radius-md);
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #fff;
  box-shadow: var(--shadow-card);
}
.wc-buy {
  background: var(--brand-gradient);
}
.wc-credit {
  background: linear-gradient(135deg, #f0a94f, #b45309);
  align-self: flex-end;
  width: 88%;
}
.wc-sell {
  background: linear-gradient(135deg, #4fd18f, #15803d);
  width: 94%;
}
.wc-gift {
  background: linear-gradient(135deg, #94a3b8, #64748b);
  align-self: flex-end;
  width: 80%;
}
.wc-label {
  font-size: 0.75rem;
  opacity: 0.85;
  font-weight: 600;
}
.wc-amount {
  font-size: 1.35rem;
  font-weight: 700;
}

/* --- Stats --- */
.stats-strip {
  max-width: 1180px;
  margin: 0 auto;
  padding: 8px 24px 48px;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
}
.stat-tile {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  padding: 20px;
  text-align: center;
  box-shadow: var(--shadow-card);
}
.stat-value {
  display: block;
  font-size: 1.7rem;
  font-weight: 800;
  color: var(--accent-blue);
}
.stat-label {
  display: block;
  font-size: 0.78rem;
  color: var(--text-dim);
  margin-top: 4px;
}

/* --- Generic section --- */
.section {
  max-width: 1180px;
  margin: 0 auto;
  padding: 56px 24px;
}
.section-head {
  text-align: center;
  max-width: 680px;
  margin: 0 auto 36px;
}
.section-head h2 {
  font-size: 1.9rem;
  margin: 8px 0 10px;
}
.section-head p {
  color: var(--text-dim);
  font-size: 1rem;
}

/* --- Feature grid --- */
.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}
.feature-card {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.feature-card h3 {
  margin: 0;
  font-size: 1.05rem;
}
.feature-card p {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.88rem;
  line-height: 1.5;
}
.feature-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.feature-icon svg {
  width: 22px;
  height: 22px;
}
.accent-blue .feature-icon {
  background: var(--badge-tint-blue);
  color: var(--accent-blue);
}
.accent-orange .feature-icon {
  background: rgba(180, 83, 9, 0.12);
  color: var(--accent-orange);
}
.accent-lime .feature-icon {
  background: var(--badge-tint-lime);
  color: var(--accent-lime);
}
.accent-red .feature-icon {
  background: var(--badge-tint-red);
  color: var(--accent-red);
}

/* --- Deep dive rows --- */
.deep-dive {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
  align-items: center;
  border-radius: var(--radius-lg);
  padding: 48px;
}
.deep-dive.reverse {
  direction: ltr;
}
.deep-dive.reverse .deep-dive-copy {
  order: 2;
}
.deep-dive.reverse .deep-dive-visual {
  order: 1;
}
.accent-band-blue {
  background: linear-gradient(180deg, rgba(21, 80, 201, 0.06), transparent);
}
.accent-band-orange {
  background: linear-gradient(180deg, rgba(180, 83, 9, 0.07), transparent);
}
.accent-band-lime {
  background: linear-gradient(180deg, rgba(21, 128, 61, 0.06), transparent);
}
.deep-dive-copy h2 {
  font-size: 1.8rem;
  margin: 8px 0 12px;
}
.deep-dive-copy > p {
  color: var(--text-dim);
  margin: 0 0 18px;
  line-height: 1.6;
}
.deep-dive-copy .note {
  font-size: 0.85rem;
  color: var(--text-dimmer);
  font-style: italic;
}
.point-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.point-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-inline-start: 3px solid var(--accent-blue);
  padding-inline-start: 12px;
}
.point-list li strong {
  font-size: 0.95rem;
}
.point-list li span {
  font-size: 0.85rem;
  color: var(--text-dim);
}
.deep-dive-visual {
  min-height: 100px;
}

/* Ledger mock */
.ledger-mock {
  padding: 20px;
  font-size: 0.85rem;
}
.ledger-mock-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  padding: 9px 4px;
  border-bottom: 1px solid var(--card-border);
}
.ledger-mock-row .num {
  text-align: end;
  font-variant-numeric: tabular-nums;
}
.ledger-mock-row .muted {
  color: var(--text-dimmer);
}
.ledger-mock-head {
  color: var(--text-dim);
  font-weight: 600;
  font-size: 0.78rem;
  text-transform: uppercase;
}
.ledger-mock-total {
  border-bottom: none;
  font-weight: 700;
  color: var(--accent-blue);
}

/* Installment mock */
.installment-mock {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.installment-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--card-border);
}
.installment-row:last-child {
  border-bottom: none;
}
.inst-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--card-border);
  flex-shrink: 0;
}
.inst-dot.done {
  background: var(--accent-lime);
}
.inst-dot.current {
  background: var(--accent-orange);
}
.inst-info {
  display: flex;
  flex-direction: column;
  flex: 1;
}
.inst-title {
  font-size: 0.9rem;
  font-weight: 600;
}
.inst-sub {
  font-size: 0.78rem;
  color: var(--text-dim);
}
.inst-sub.current {
  color: var(--accent-orange);
}
.inst-amount {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* Split mock */
.split-mock {
  padding: 24px;
}
.split-bar {
  display: flex;
  height: 34px;
  border-radius: 10px;
  overflow: hidden;
  font-size: 0.78rem;
  color: #fff;
  font-weight: 700;
}
.split-seg {
  display: flex;
  align-items: center;
  justify-content: center;
}
.seg-1 {
  background: var(--accent-blue);
}
.seg-2 {
  background: var(--accent-lime);
}
.split-legend {
  display: flex;
  gap: 18px;
  margin-top: 14px;
  font-size: 0.82rem;
  color: var(--text-dim);
}
.split-legend span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.rail-tags {
  display: flex;
  gap: 8px;
  margin-top: 18px;
  flex-wrap: wrap;
}
.rail-tag {
  background: var(--badge-tint);
  color: var(--accent-blue);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 0.75rem;
  font-weight: 700;
}

/* Flow mock */
.flow-mock {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
}
.flow-step {
  flex: 1;
  min-width: 130px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: var(--shadow-card);
}
.flow-num {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--brand-gradient);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.flow-step strong {
  font-size: 0.88rem;
}
.flow-step span {
  font-size: 0.76rem;
  color: var(--text-dim);
  line-height: 1.4;
}
.flow-arrow {
  align-self: center;
  color: var(--text-dimmer);
  font-size: 1.2rem;
}

/* Code mock */
.code-mock {
  padding: 0;
  overflow: hidden;
  background: #14213d;
  color: #dbe4ff;
}
.code-dots {
  display: flex;
  gap: 6px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.06);
}
.code-dots i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
}
.code-mock pre {
  margin: 0;
  padding: 20px;
  font-size: 0.8rem;
  line-height: 1.6;
  overflow-x: auto;
}
.code-mock code {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

/* Admin showcase */
.admin-showcase {
  text-align: center;
}
.admin-pill-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  max-width: 820px;
  margin: 0 auto;
}
.admin-pill {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text);
  box-shadow: var(--shadow-card);
}

/* Security */
.security-band {
  background: rgba(20, 33, 61, 0.03);
  border-radius: var(--radius-lg);
}
.security-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
  max-width: 820px;
  margin: 0 auto;
}
.security-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  padding: 18px 20px;
  box-shadow: var(--shadow-card);
}
.security-item strong {
  font-size: 0.95rem;
}
.security-item span {
  font-size: 0.85rem;
  color: var(--text-dim);
}

/* CTA */
.cta-band {
  max-width: 780px;
  margin: 0 auto;
  padding: 60px 24px;
  text-align: center;
}
.cta-band h2 {
  font-size: 2rem;
  margin: 0 0 12px;
}
.cta-band p {
  color: var(--text-dim);
  margin: 0 0 26px;
}
.cta-band .hero-ctas {
  justify-content: center;
}

/* Footer */
.landing-footer {
  border-top: 1px solid var(--card-border);
  padding: 32px 24px 48px;
  text-align: center;
  color: var(--text-dim);
  font-size: 0.85rem;
}
.landing-footer .brand {
  justify-content: center;
  margin-bottom: 10px;
}
.landing-footer .rights {
  color: var(--text-dimmer);
  font-size: 0.78rem;
  margin-top: 4px;
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
    padding-top: 40px;
  }
  .stats-strip {
    grid-template-columns: repeat(2, 1fr);
  }
  .feature-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .deep-dive {
    grid-template-columns: 1fr;
    padding: 32px 24px;
  }
  .deep-dive.reverse .deep-dive-copy,
  .deep-dive.reverse .deep-dive-visual {
    order: initial;
  }
  .security-grid {
    grid-template-columns: 1fr;
  }
  .landing-nav-links {
    display: none;
  }
}

@media (max-width: 560px) {
  .stats-strip {
    grid-template-columns: repeat(2, 1fr);
  }
  .feature-grid {
    grid-template-columns: 1fr;
  }
  .hero-copy h1 {
    font-size: 2rem;
  }
}
</style>
