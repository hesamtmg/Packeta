import { i18n } from '../i18n';

// fa-IR's default calendar (Persian/Jalali) and numbering system (Persian
// digits) come from the locale itself — no explicit calendar tag needed.
// Mirrors frontend/src/utils/date.ts.
function currentLocale(): 'fa-IR' | 'en-US' {
  const locale = (i18n.global.locale as unknown as { value: string }).value;
  return locale === 'fa' ? 'fa-IR' : 'en-US';
}

// For timestamp values (createdAt, expiresAt, ...) — renders in the
// browser's local timezone.
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
