<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Wallet } from '../stores/wallet';

// Groups the fields a merchant needs when wiring their store up to Packeta
// (terminal/acceptor identifiers, callback URL, IP allowlist) into one card,
// each with a copy button, instead of scattering them through the generic
// wallet details list.
const props = defineProps<{ wallet: Wallet }>();
const { t } = useI18n();

interface Row {
  key: string;
  label: string;
  value: string;
  mono: boolean;
  href?: string;
}

const rows = computed<Row[]>(() => {
  const w = props.wallet;
  const list: Row[] = [];
  if (w.storeName) list.push({ key: 'storeName', label: t('walletDetail.storeName'), value: w.storeName, mono: false });
  if (w.storeSite) {
    const href = /^https?:\/\//i.test(w.storeSite) ? w.storeSite : `https://${w.storeSite}`;
    list.push({ key: 'storeSite', label: t('walletDetail.storeSite'), value: w.storeSite, mono: true, href });
  }
  if (w.terminalId) list.push({ key: 'terminalId', label: t('walletDetail.terminalId'), value: w.terminalId, mono: true });
  if (w.acceptorCode) list.push({ key: 'acceptorCode', label: t('walletDetail.acceptorCode'), value: w.acceptorCode, mono: true });
  if (w.callbackUrl) list.push({ key: 'callbackUrl', label: t('walletDetail.callbackUrl'), value: w.callbackUrl, mono: true });
  if (w.allowedIps?.length) {
    list.push({ key: 'allowedIps', label: t('walletDetail.allowedIps'), value: w.allowedIps.join(', '), mono: true });
  }
  return list;
});

const copiedKey = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copy(row: Row) {
  try {
    await navigator.clipboard.writeText(row.value);
    copiedKey.value = row.key;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copiedKey.value = null), 2000);
  } catch {
    // Clipboard API unavailable (e.g. insecure context) — the value is still
    // visible and selectable, so this is a silent no-op.
  }
}
</script>

<template>
  <div class="merchant-card">
    <h3>{{ t('walletDetail.merchant.heading') }}</h3>
    <p class="merchant-hint">{{ t('walletDetail.merchant.hint') }}</p>

    <p v-if="!rows.length" class="merchant-hint">{{ t('walletDetail.merchant.empty') }}</p>

    <ul v-else class="merchant-rows">
      <li v-for="row in rows" :key="row.key">
        <span class="merchant-label">{{ row.label }}</span>
        <span class="merchant-value" :class="{ mono: row.mono }">
          <a v-if="row.href" :href="row.href" target="_blank" rel="noopener noreferrer">{{ row.value }}</a>
          <template v-else>{{ row.value }}</template>
        </span>
        <button type="button" class="admin-btn admin-btn-ghost merchant-copy" @click="copy(row)">
          {{ copiedKey === row.key ? t('walletDetail.merchant.copied') : t('walletDetail.merchant.copy') }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.merchant-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  padding-top: 14px;
  border-top: 1px solid var(--card-border);
}
.merchant-card h3 {
  margin: 0;
  font-size: 0.95rem;
}
.merchant-hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-dimmer);
}
.merchant-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.merchant-rows li {
  display: grid;
  grid-template-columns: minmax(110px, auto) 1fr auto;
  align-items: center;
  gap: 0.4rem 1rem;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--input-bg, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--card-border);
}
.merchant-label {
  color: var(--text-dimmer);
  font-size: 0.82rem;
}
.merchant-value {
  min-width: 0;
  word-break: break-all;
}
.mono {
  font-family: monospace;
  font-size: 0.82rem;
  color: var(--text-dim);
}
.merchant-copy {
  padding: 4px 10px;
  font-size: 0.75rem;
}
@media (max-width: 520px) {
  .merchant-rows li {
    grid-template-columns: 1fr auto;
  }
  .merchant-label {
    grid-column: 1 / -1;
  }
}
</style>
