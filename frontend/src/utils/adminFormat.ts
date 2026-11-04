import { i18n } from '../i18n';
import type { AdminTransactionType } from '../types/admin';

// Small display helpers shared by the admin list/report pages.

function locale(): 'fa-IR' | 'en-US' {
  return (i18n.global.locale as unknown as { value: string }).value === 'fa' ? 'fa-IR' : 'en-US';
}

export function formatTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
}

// "Nov 4" / "۱۴ آبان" — compact enough for a chart axis.
export function formatShortDay(value: Date): string {
  return value.toLocaleDateString(locale(), { month: 'short', day: 'numeric' });
}

// Relative "3h ago"-style label for feeds; falls back to the date past a week.
export function formatRelative(value: string | Date): string {
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto', style: 'short' });
  if (diff < 60) return rtf.format(-Math.max(0, Math.round(diff)), 'second');
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 7 * 86400) return rtf.format(-Math.round(diff / 86400), 'day');
  return new Date(value).toLocaleDateString(locale());
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Counts per local calendar day for the last `days` days (oldest first).
// Calendar days, not rolling 24h windows, so "today" means today.
export function perDayBuckets(dates: string[], days: number): number[] {
  const buckets = new Array(days).fill(0);
  const todayStart = startOfDay(new Date());
  const dayMs = 86_400_000;
  for (const iso of dates) {
    const diff = Math.round((todayStart - startOfDay(new Date(iso))) / dayMs);
    const idx = days - 1 - diff;
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
}

// Axis/tooltip labels matching perDayBuckets' order.
export function lastDayLabels(days: number): string[] {
  const today = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (days - 1 - i));
    return formatShortDay(d);
  });
}

export function initials(identity: string): string {
  const name = identity.split('@')[0].replace(/[^a-zA-Z؀-ۿ0-9]+/g, ' ').trim();
  const parts = name.split(' ').filter(Boolean);
  if (!parts.length) return '?';
  if (/^\+?\d/.test(identity)) return '#';
  return (parts[0][0] + (parts[1]?.[0] ?? parts[0][1] ?? '')).toUpperCase();
}

export const TX_TYPE_ICONS: Record<AdminTransactionType, string> = {
  DEPOSIT: 'M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14',
  WITHDRAW: 'M12 20V9m0 0l-4.5 4.5M12 9l4.5 4.5M5 4h14',
  TRANSFER: 'M4 8h13m0 0l-3.5-3.5M17 8l-3.5 3.5M20 16H7m0 0l3.5-3.5M7 16l3.5 3.5',
  PURCHASE: 'M5.5 8h13l-1 12h-11l-1-12zM9 8V7a3 3 0 016 0v1',
  ADJUSTMENT: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  VIRTUAL: 'M12 3v5M12 16v5M3 12h5M16 12h5M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5',
};
