// Mirrors frontend/src/utils/cardTheme.ts exactly — the wallet dashboard
// and every paycard here (PayView, the wallet-viewing widget, the "Pay
// with Packeta" widget) must render the same wallet-type the same color.
// Keep the two files in sync; the backend's CARD_COLOR_PRESETS (see
// backend/src/wallet-types/entities/wallet-type.entity.ts) only exists to
// validate cardColor against this same key list.
export interface CardThemeOption {
  key: string;
  label: string;
  gradient: string;
}

export const CARD_THEME_OPTIONS: CardThemeOption[] = [
  // Matches this app's own .paycard default exactly — the fallback so an
  // unconfigured wallet type's card looks identical to the classic blue.
  { key: 'indigo', label: 'Indigo', gradient: 'linear-gradient(135deg, #2f6fed 0%, #1550c9 60%, #103e9e 100%)' },
  { key: 'violet', label: 'Violet', gradient: 'linear-gradient(120deg, #8b5cf6 0%, #d946ef 55%, #f472b6 100%)' },
  { key: 'teal', label: 'Teal', gradient: 'linear-gradient(120deg, #14b8a6 0%, #22c55e 55%, #eab308 100%)' },
  { key: 'amber', label: 'Amber', gradient: 'linear-gradient(120deg, #f97316 0%, #fbbf24 100%)' },
  { key: 'rose', label: 'Rose', gradient: 'linear-gradient(120deg, #fb7185 0%, #f472b6 55%, #fbbf24 100%)' },
];

const CARD_THEME_MAP = new Map(CARD_THEME_OPTIONS.map((o) => [o.key, o.gradient]));
const CLOSED_GRADIENT = 'linear-gradient(120deg, #94a3b8 0%, #64748b 100%)';

// A closed wallet always renders gray regardless of its type's chosen
// color, so a closed card still reads as "closed" at a glance. Otherwise:
// the type's own cardColor if an admin picked one, else a deterministic
// hash of its code so two wallets of the same type always match and
// different types are very likely to differ, with no admin setup required.
export function cardGradient(
  walletType: { code: string; cardColor?: string | null },
  closed: boolean,
): string {
  if (closed) return CLOSED_GRADIENT;
  if (walletType.cardColor) {
    const preset = CARD_THEME_MAP.get(walletType.cardColor);
    if (preset) return preset;
  }
  const key = walletType.code || '';
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return CARD_THEME_OPTIONS[hash % CARD_THEME_OPTIONS.length].gradient;
}
