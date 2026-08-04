import { i18n } from '../i18n';

// fa-IR's default calendar (Persian/Jalali) and numbering system (Persian
// digits) come from the locale itself — no explicit calendar tag needed.
function currentLocale(): 'fa-IR' | 'en-US' {
  const locale = (i18n.global.locale as unknown as { value: string }).value;
  return locale === 'fa' ? 'fa-IR' : 'en-US';
}

// For timestamp values (createdAt, blockedAt, expiresAt, ...) — renders in
// the browser's local timezone, matching what a plain toLocaleDateString()
// call already did, just locale-aware now.
export function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString(currentLocale());
}

// Same as formatDate but with the time of day too (mirrors toLocaleString()).
export function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(currentLocale());
}

// For pure calendar-date values with no time component (Installment
// .dueDate/.deadlineDate, "YYYY-MM-DD" strings straight from a Postgres
// `date` column) — pinned to UTC so the calendar day never shifts under a
// negative-offset local timezone the way new Date("2026-08-10") would if
// rendered in the browser's own zone.
export function formatCalendarDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(currentLocale(), {
    timeZone: 'UTC',
  });
}

// For a "YYYY-MM" grouping key (WalletInstallmentsView's monthGroups) — a
// month + year label, Persian calendar in Farsi.
export function formatMonth(monthKey: string): string {
  return new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString(currentLocale(), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}
