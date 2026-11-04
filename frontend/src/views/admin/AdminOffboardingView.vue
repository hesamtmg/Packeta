<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest, ApiError, postMultipart } from '../../api/client';
import { formatAmount, type CurrencyInfo } from '../../utils/currency';
import { displayIdentity } from '../../utils/identity';
import AdminLayout from '../../components/admin/AdminLayout.vue';
import RepositoryAbsorbForm from '../../components/admin/RepositoryAbsorbForm.vue';
import { initials } from '../../utils/adminFormat';

interface CreditWalletSummary {
  id: string;
  balance: string;
  walletType: { name: string; code: string; currency: CurrencyInfo };
  virtualAmount: string | null;
  blockedAt: string | null;
  closedAt: string | null;
  repositoryWalletId: string | null;
  outstandingTotal: string;
  outstandingCount: number;
}

interface Candidate {
  id: string;
  email: string;
  phoneNumber: string | null;
  creditWallets: CreditWalletSummary[];
}

const { t } = useI18n();
const identifier = ref('');
const candidate = ref<Candidate | null>(null);
const searchError = ref('');
const searchBusy = ref(false);
const searched = ref(false);

const busyWalletId = ref<string | null>(null);
const openRepositoryId = ref<string | null>(null);
const repositoryDescription = ref<Record<string, string>>({});
const repositoryDocument = ref<Record<string, File | undefined>>({});
const actionError = ref<Record<string, string>>({});
const actionMessage = ref<Record<string, string>>({});

function owes(wallet: CreditWalletSummary): boolean {
  return BigInt(wallet.outstandingTotal) > 0n;
}

const summary = computed(() => {
  const c = candidate.value;
  if (!c) return null;
  const open = c.creditWallets.filter((w) => !w.closedAt);
  return {
    open: open.length,
    owing: open.filter(owes).length,
    ready: open.length > 0 && open.every((w) => !owes(w)),
    done: c.creditWallets.length > 0 && open.length === 0,
  };
});

function walletStatus(w: CreditWalletSummary): { label: string; cls: string } {
  if (w.closedAt) return { label: t('admin.offboarding.statusClosed'), cls: 'st-closed' };
  if (w.blockedAt) return { label: t('admin.offboarding.statusBlocked'), cls: 'st-blocked' };
  return { label: t('admin.offboarding.statusActive'), cls: 'st-active' };
}

async function search() {
  if (!identifier.value.trim()) return;
  searchError.value = '';
  searchBusy.value = true;
  searched.value = true;
  candidate.value = null;
  try {
    candidate.value = await apiRequest<Candidate>(
      `/admin/offboarding/lookup?identifier=${encodeURIComponent(identifier.value.trim())}`,
    );
  } catch (err) {
    searchError.value = err instanceof ApiError ? err.message : t('admin.offboarding.searchFailed');
  } finally {
    searchBusy.value = false;
  }
}

function toggleRepositoryForm(walletId: string) {
  openRepositoryId.value = openRepositoryId.value === walletId ? null : walletId;
}

function onRepositoryFileChange(walletId: string, event: Event) {
  const input = event.target as HTMLInputElement;
  repositoryDocument.value[walletId] = input.files?.[0];
}

// Unlike every other admin action here, this one intentionally does NOT go
// through apiRequest first — the customer is meant to complete this charge,
// and admins very likely aren't logged into Packeta as that customer, so
// there's nothing useful to show them here first. Mirrors the overdue-queue
// collection flow's own ZarinPal redirect.
async function collectZarinpal(wallet: CreditWalletSummary) {
  actionError.value[wallet.id] = '';
  actionMessage.value[wallet.id] = '';
  busyWalletId.value = wallet.id;
  try {
    const result = await apiRequest<{ redirectUrl: string }>(
      `/admin/offboarding/${wallet.id}/collect/zarinpal`,
      { method: 'POST', idempotent: true },
    );
    window.location.href = result.redirectUrl;
  } catch (err) {
    actionError.value[wallet.id] = err instanceof ApiError ? err.message : t('admin.offboarding.collectFailed');
    busyWalletId.value = null;
  }
}

async function collectRepository(wallet: CreditWalletSummary) {
  actionError.value[wallet.id] = '';
  actionMessage.value[wallet.id] = '';
  const description = repositoryDescription.value[wallet.id]?.trim();
  if (!description) {
    actionError.value[wallet.id] = t('admin.offboarding.repositoryDescriptionRequired');
    return;
  }
  busyWalletId.value = wallet.id;
  try {
    await postMultipart(
      `/admin/offboarding/${wallet.id}/collect/repository`,
      { description, document: repositoryDocument.value[wallet.id] },
      { idempotent: true },
    );
    actionMessage.value[wallet.id] = t('admin.offboarding.collectSuccess');
    repositoryDescription.value[wallet.id] = '';
    repositoryDocument.value[wallet.id] = undefined;
    openRepositoryId.value = null;
    await search();
  } catch (err) {
    actionError.value[wallet.id] = err instanceof ApiError ? err.message : t('admin.offboarding.collectFailed');
  } finally {
    busyWalletId.value = null;
  }
}

async function closeWallet(wallet: CreditWalletSummary) {
  if (!window.confirm(t('admin.offboarding.closeConfirm'))) return;
  actionError.value[wallet.id] = '';
  actionMessage.value[wallet.id] = '';
  busyWalletId.value = wallet.id;
  try {
    const result = await apiRequest<{ walletId: string; reclaimed: string }>(
      `/admin/offboarding/${wallet.id}/close`,
      { method: 'POST', idempotent: true },
    );
    actionMessage.value[wallet.id] = t('admin.offboarding.closeSuccess', {
      amount: formatAmount(result.reclaimed, wallet.walletType.currency),
    });
    await search();
  } catch (err) {
    actionError.value[wallet.id] = err instanceof ApiError ? err.message : t('admin.offboarding.closeFailed');
  } finally {
    busyWalletId.value = null;
  }
}
</script>

<template>
  <AdminLayout :title="t('admin.offboarding.title')">
    <section class="admin-card search-card">
      <div class="search-intro">
        <span class="intro-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg></span>
        <div>
          <h2>{{ t('admin.offboarding.searchHeading') }}</h2>
          <p class="admin-card-sub">{{ t('admin.offboarding.searchHint') }}</p>
        </div>
      </div>
      <form class="search-row" @submit.prevent="search">
        <label class="admin-search search-input">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input v-model="identifier" type="text" class="admin-input" :placeholder="t('admin.offboarding.searchPlaceholder')" required />
        </label>
        <button type="submit" class="admin-btn admin-btn-primary" :disabled="searchBusy">{{ t('admin.offboarding.searchButton') }}</button>
      </form>
      <ol class="process">
        <li><span class="p-n">1</span>{{ t('admin.offboarding.process1') }}</li>
        <li><span class="p-n">2</span>{{ t('admin.offboarding.process2') }}</li>
        <li><span class="p-n">3</span>{{ t('admin.offboarding.process3') }}</li>
      </ol>
      <p v-if="searchError" class="admin-error">{{ searchError }}</p>
    </section>

    <template v-if="candidate && summary">
      <section class="admin-card profile">
        <div class="person">
          <span class="avatar avatar-lg">{{ initials(displayIdentity(candidate)) }}</span>
          <span class="person-text">
            <span class="profile-name">{{ displayIdentity(candidate) }}</span>
            <span class="person-sub">{{ candidate.phoneNumber && candidate.phoneNumber !== displayIdentity(candidate) ? candidate.phoneNumber : candidate.email }}</span>
          </span>
        </div>
        <div class="profile-status" :class="summary.done ? 'ps-done' : summary.ready ? 'ps-ready' : summary.owing ? 'ps-owing' : 'ps-none'">
          <template v-if="!candidate.creditWallets.length">{{ t('admin.offboarding.noCreditWallets') }}</template>
          <template v-else-if="summary.done">{{ t('admin.offboarding.allClosed') }}</template>
          <template v-else-if="summary.owing">{{ t('admin.offboarding.owingSummary', { count: summary.owing }) }}</template>
          <template v-else>{{ t('admin.offboarding.readySummary', { count: summary.open }) }}</template>
        </div>
      </section>

      <div class="credit-wallets">
        <article v-for="wallet in candidate.creditWallets" :key="wallet.id" class="admin-card cw" :class="{ closed: wallet.closedAt }">
          <header class="cw-head">
            <span class="cw-title">{{ wallet.walletType.name }} <span class="cur">{{ wallet.walletType.currency.code }}</span></span>
            <span class="admin-badge" :class="walletStatus(wallet).cls"><span class="status-dot" />{{ walletStatus(wallet).label }}</span>
          </header>
          <span class="cw-id">#{{ wallet.id.slice(0, 8) }}</span>

          <div class="cw-stats">
            <div class="cw-stat">
              <span class="mini-label">{{ t('admin.offboarding.outstandingDebt') }}</span>
              <span class="cw-value" :class="{ owes: owes(wallet) }">{{ formatAmount(wallet.outstandingTotal, wallet.walletType.currency) }}</span>
              <span v-if="wallet.outstandingCount" class="cw-sub">{{ t('admin.offboarding.installmentsLeft', { count: wallet.outstandingCount }) }}</span>
            </div>
            <div class="cw-stat">
              <span class="mini-label">{{ t('admin.offboarding.remainingCeiling') }}</span>
              <span class="cw-value">{{ formatAmount(wallet.virtualAmount ?? '0', wallet.walletType.currency) }}</span>
              <span class="cw-sub">{{ t('admin.offboarding.reclaimedOnClose') }}</span>
            </div>
          </div>

          <p v-if="actionError[wallet.id]" class="admin-error">{{ actionError[wallet.id] }}</p>
          <p v-if="actionMessage[wallet.id]" class="admin-success">{{ actionMessage[wallet.id] }}</p>

          <ol v-if="!wallet.closedAt" class="checklist">
            <li class="check-step" :class="owes(wallet) ? 'current' : 'done'">
              <span class="check-mark">
                <svg v-if="!owes(wallet)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                <span v-else>1</span>
              </span>
              <div class="check-body">
                <span class="check-title">{{ t('admin.offboarding.stepSettle') }}</span>
                <template v-if="owes(wallet)">
                  <span class="check-hint">{{ t('admin.offboarding.collectFirstHint') }}</span>
                  <div class="action-buttons">
                    <button type="button" class="admin-btn admin-btn-primary admin-btn-sm" :disabled="busyWalletId === wallet.id" @click="collectZarinpal(wallet)">{{ t('admin.offboarding.actionZarinpal') }}</button>
                    <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" :class="{ active: openRepositoryId === wallet.id }" :disabled="busyWalletId === wallet.id" @click="toggleRepositoryForm(wallet.id)">{{ t('admin.offboarding.actionRepository') }}</button>
                  </div>
                  <RepositoryAbsorbForm
                    v-if="openRepositoryId === wallet.id"
                    v-model:description="repositoryDescription[wallet.id]"
                    :placeholder="t('admin.offboarding.repositoryDescriptionPlaceholder')"
                    :submit-label="t('admin.offboarding.repositorySubmit')"
                    :cancel-label="t('admin.installments.cancel')"
                    :attach-label="t('admin.installments.attachDocument')"
                    :busy="busyWalletId === wallet.id"
                    @file="repositoryDocument[wallet.id] = $event"
                    @submit="collectRepository(wallet)"
                    @cancel="openRepositoryId = null"
                  />
                </template>
                <span v-else class="check-hint">{{ t('admin.offboarding.noDebt') }}</span>
              </div>
            </li>
            <li class="check-step" :class="owes(wallet) ? 'locked' : 'current'">
              <span class="check-mark"><span>2</span></span>
              <div class="check-body">
                <span class="check-title">{{ t('admin.offboarding.stepClose') }}</span>
                <span class="check-hint">{{ t('admin.offboarding.closeHint') }}</span>
                <div class="action-buttons">
                  <button type="button" class="admin-btn admin-btn-danger admin-btn-sm" :disabled="owes(wallet) || busyWalletId === wallet.id" @click="closeWallet(wallet)">{{ t('admin.offboarding.closeButton') }}</button>
                </div>
              </div>
            </li>
          </ol>
          <p v-else class="closed-note">{{ t('admin.offboarding.closedNote') }}</p>
        </article>
      </div>
    </template>

    <div v-else-if="searched && !searchBusy && !searchError" class="admin-card empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      {{ t('admin.offboarding.notFound') }}
    </div>
  </AdminLayout>
</template>

<style scoped>
.search-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.search-intro {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.search-intro h2 {
  margin: 0;
}
.intro-icon {
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 12px;
  background: var(--badge-tint-blue);
  color: var(--accent-blue);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.intro-icon svg {
  width: 20px;
  height: 20px;
}
.search-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.search-input {
  flex: 1;
  min-width: 240px;
}
.process {
  list-style: none;
  margin: 0;
  padding: 12px 0 0;
  border-top: 1px solid var(--divider);
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  font-size: 0.82rem;
  color: var(--text-dim);
}
.process li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.p-n {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--panel-bg);
  border: 1px solid var(--card-border);
  font-size: 0.7rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.profile {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.profile-name {
  font-size: 1.1rem;
  font-weight: 700;
}
.profile-status {
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 0.84rem;
  font-weight: 600;
}
.ps-owing { background: var(--badge-tint-red); color: var(--accent-red); }
.ps-ready { background: var(--badge-tint-blue); color: var(--accent-blue); }
.ps-done { background: var(--badge-tint-lime); color: var(--accent-lime); }
.ps-none { background: var(--panel-bg); color: var(--text-dim); }
.credit-wallets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 22px;
}
.cw {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cw.closed {
  opacity: 0.7;
}
.cw-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.cw-title {
  font-weight: 700;
  font-size: 1rem;
}
.cur {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-dimmer);
  margin-inline-start: 4px;
}
.cw-id {
  margin-top: -10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.72rem;
  color: var(--text-dimmer);
}
.st-active { background: var(--badge-tint-lime); color: var(--accent-lime); }
.st-blocked { background: var(--badge-tint-red); color: var(--accent-red); }
.st-closed { background: var(--badge-tint); color: var(--text-dim); }
.cw-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.cw-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
}
.mini-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dimmer);
}
.cw-value {
  font-size: 1.15rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.cw-value.owes {
  color: var(--accent-red);
}
.cw-sub {
  font-size: 0.76rem;
  color: var(--text-dim);
}
.checklist {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.check-step {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 12px;
  position: relative;
  padding-bottom: 16px;
}
.check-step:first-child::before {
  content: '';
  position: absolute;
  inset-inline-start: 13px;
  top: 30px;
  bottom: 0;
  width: 2px;
  background: var(--divider);
}
.check-step.done:first-child::before {
  background: var(--accent-lime);
}
.check-mark {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.78rem;
  font-weight: 700;
  background: var(--panel-bg);
  border: 2px solid var(--card-border);
  color: var(--text-dimmer);
}
.check-mark svg {
  width: 13px;
  height: 13px;
}
.check-step.done .check-mark {
  background: var(--accent-lime);
  border-color: var(--accent-lime);
  color: #fff;
}
.check-step.current .check-mark {
  background: var(--accent-blue);
  border-color: var(--accent-blue);
  color: #fff;
}
.check-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 3px;
  min-width: 0;
}
.check-title {
  font-weight: 650;
  font-size: 0.9rem;
}
.check-step.locked .check-title {
  color: var(--text-dimmer);
}
.check-hint {
  font-size: 0.8rem;
  color: var(--text-dim);
}
.action-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 2px;
}
.closed-note {
  margin: 0;
  font-size: 0.84rem;
  color: var(--text-dim);
}
@media (max-width: 640px) {
  .credit-wallets {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
