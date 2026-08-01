// Loose E.164-ish check: optional leading +, 7-15 digits. Applied after
// normalizePhoneNumber, so by validation time an Iranian number is already
// in +98 form regardless of how it was typed.
export const PHONE_NUMBER_REGEX = /^\+?[1-9]\d{6,14}$/;

// Iranian mobile numbers are commonly typed in local form (leading 0, e.g.
// "09122215309") as well as E.164 ("+989122215309") — both must resolve to
// the same account, since phone numbers are looked up by exact match. Only
// this one local-prefix case is rewritten; every other input (including
// already-E.164 numbers, and other countries') passes through unchanged.
const IRAN_LOCAL_MOBILE_REGEX = /^0(9\d{9})$/;

export function normalizePhoneNumber(raw: string): string {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  const match = trimmed.match(IRAN_LOCAL_MOBILE_REGEX);
  return match ? `+98${match[1]}` : trimmed;
}
