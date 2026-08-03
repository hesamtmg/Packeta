<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { useWalletStore, type Installment } from '../stores/wallet';
import { ApiError } from '../api/client';
import { formatAmount } from '../utils/currency';
import AppLayout from '../components/AppLayout.vue';

const wallet = useWalletStore();
const route = useRoute();
const { t } = useI18n();

const walletId = computed(() => route.params.walletId as string);
const installments = ref<Installment[]>([]);
const loadError = ref('');
const payBusy = ref<string | null>(null);
const payError = ref('');
const expandedMonths = ref<Set<string>>(new Set());

const thisWallet = computed(() => wallet.wallets.find((w) => w.id === walletId.value) ?? null);

const statusRank: Record<Installment['status'], number> = { OVERDUE: 2, PENDING: 1, PAID: 0 };

// Installments due in the same calendar month can come from different
// billing periods (see backend InstallmentsService.generateDue — each month
// generates a fresh installmentCount batch, so two batches' due dates can
// land in the same month) — grouped into one row here, with each
// installment's own detail (and merchant spend) available on expand.
const monthGroups = computed(() => {
  const byMonth = new Map<string, Installment[]>();
  for (const i of installments.value) {
    const monthKey = i.dueDate.slice(0, 7);
    const list = byMonth.get(monthKey);
    if (list) list.push(i);
    else byMonth.set(monthKey, [i]);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, group]) => {
      const sorted = [...group].sort((a, b) => a.deadlineDate.localeCompare(b.deadlineDate));
      const totalAmount = sorted
        .reduce((sum, i) => sum + BigInt(i.amount), 0n)
        .toString();
      const worstStatus = sorted.reduce(
        (worst, i) => (statusRank[i.status] > statusRank[worst] ? i.status : worst),
        sorted[0].status,
      );
      return { monthKey, installments: sorted, totalAmount, worstStatus };
    });
});

function installmentStatusLabel(status: Installment['status']): string {
  if (status === 'PAID') return t('dashboard.installments.statusPaid');
  if (status === 'OVERDUE') return t('dashboard.installments.statusOverdue');
  return t('dashboard.installments.statusPending');
}

function toggleExpand(monthKey: string) {
  if (expandedMonths.value.has(monthKey)) expandedMonths.value.delete(monthKey);
  else expandedMonths.value.add(monthKey);
  // Trigger reactivity — Set mutations aren't tracked by Vue on their own.
  expandedMonths.value = new Set(expandedMonths.value);
}

async function load() {
  loadError.value = '';
  try {
    if (!wallet.wallets.length) await wallet.fetchWallets();
    installments.value = await wallet.fetchInstallmentsForWallet(walletId.value);
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : t('dashboard.actions.error');
  }
}

async function onPayInstallment(installment: Installment) {
  payError.value = '';
  payBusy.value = installment.id;
  try {
    const result = await wallet.payInstallment(installment.id);
    window.location.href = result.redirectUrl;
  } catch (err) {
    payError.value = err instanceof ApiError ? err.message : t('dashboard.actions.error');
    payBusy.value = null;
  }
}

onMounted(load);
</script>

<template>
  <AppLayout :title="t('dashboard.installments.title')">
    <router-link :to="{ name: 'dashboard' }" class="back-link">{{ t('nav.backToWallet') }}</router-link>

    <p v-if="loadError" class="admin-error">{{ loadError }}</p>

    <div class="admin-card">
      <h2 v-if="thisWallet">{{ thisWallet.walletType.name }} · {{ thisWallet.walletType.currency.code }}</h2>
      <p class="hint">{{ t('dashboard.installments.hint') }}</p>

      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t('dashboard.installments.month') }}</th>
            <th>{{ t('dashboard.installments.amount') }}</th>
            <th>{{ t('dashboard.installments.status') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="group in monthGroups" :key="group.monthKey">
            <tr>
              <td>{{ group.monthKey }}</td>
              <td>{{ thisWallet ? formatAmount(group.totalAmount, thisWallet.walletType.currency) : group.totalAmount }}</td>
              <td>
                <span class="admin-badge" :class="`installment-status-${group.worstStatus.toLowerCase()}`">{{ installmentStatusLabel(group.worstStatus) }}</span>
              </td>
              <td class="installment-actions">
                <button
                  v-if="group.installments.length === 1 && group.installments[0].status !== 'PAID'"
                  type="button"
                  class="admin-btn admin-btn-primary"
                  :disabled="payBusy === group.installments[0].id"
                  @click="onPayInstallment(group.installments[0])"
                >
                  {{ t('dashboard.installments.pay') }}
                </button>
                <button type="button" class="admin-btn" @click="toggleExpand(group.monthKey)">
                  {{ expandedMonths.has(group.monthKey) ? t('dashboard.installments.hideDetails') : t('dashboard.installments.details') }}
                </button>
              </td>
            </tr>
            <tr v-if="expandedMonths.has(group.monthKey)" class="installment-detail-row">
              <td colspan="4">
                <p v-if="group.installments.length > 1" class="hint">
                  {{ t('dashboard.installments.installmentCount', { count: group.installments.length }) }}
                </p>
                <div v-for="i in group.installments" :key="i.id" class="installment-detail-card">
                  <div class="installment-detail-header">
                    <span>#{{ i.sequenceNumber }}</span>
                    <span>{{ t('dashboard.installments.dueDate') }}: {{ i.dueDate }}</span>
                    <span>{{ t('dashboard.installments.deadlineDate') }}: {{ i.deadlineDate }}</span>
                    <span>{{ thisWallet ? formatAmount(i.amount, thisWallet.walletType.currency) : i.amount }}</span>
                    <span class="admin-badge" :class="`installment-status-${i.status.toLowerCase()}`">{{ installmentStatusLabel(i.status) }}</span>
                    <button
                      v-if="i.status !== 'PAID'"
                      type="button"
                      class="admin-btn admin-btn-primary"
                      :disabled="payBusy === i.id"
                      @click="onPayInstallment(i)"
                    >
                      {{ t('dashboard.installments.pay') }}
                    </button>
                  </div>
                  <div class="installment-spend">
                    <h4>{{ t('dashboard.installments.spentAt') }}</h4>
                    <p v-if="!i.spendBreakdown.length" class="hint">{{ t('dashboard.installments.noSpend') }}</p>
                    <ul v-else>
                      <li v-for="s in i.spendBreakdown" :key="s.purchaseId">
                        <span>{{ s.merchantName }}</span>
                        <span>{{ thisWallet ? formatAmount(s.amount, thisWallet.walletType.currency) : s.amount }}</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="!monthGroups.length"><td colspan="4">{{ t('dashboard.installments.none') }}</td></tr>
        </tbody>
      </table>
      <p v-if="payError" class="admin-error">{{ payError }}</p>
    </div>
  </AppLayout>
</template>

<style scoped>
.back-link {
  display: inline-block;
  margin-bottom: 14px;
  color: var(--text-dim);
  font-size: 0.85rem;
}

.installment-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.installment-detail-row td {
  background: var(--bg-subtle, rgba(127, 127, 127, 0.06));
  padding: 12px 16px;
}

.installment-detail-card {
  padding: 10px 0;
  border-bottom: 1px solid var(--border, rgba(127, 127, 127, 0.2));
}

.installment-detail-card:last-child {
  border-bottom: none;
}

.installment-detail-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  font-size: 0.9rem;
}

.installment-spend {
  margin-top: 8px;
}

.installment-spend h4 {
  margin: 0 0 4px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-dim);
}

.installment-spend ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.installment-spend li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 0;
  font-size: 0.85rem;
}
</style>
