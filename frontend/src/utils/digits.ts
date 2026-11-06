// Persian (U+06F0–U+06F9) and Arabic-Indic (U+0660–U+0669) digits are what
// a Farsi keyboard types by default, but the backend only understands ASCII
// 0-9 — a phone number, CAPTCHA answer or OTP typed in Farsi would otherwise
// be rejected as invalid even though it's "correct" to the user.
export function toLatinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

// Mirrors backend/src/common/phone-number.ts so the form can catch a
// malformed number before spending a CAPTCHA on it: spaces/dashes/brackets
// are stripped, a leading "00" becomes "+", and an Iranian local mobile
// ("09…") is rewritten to +98 the same way the server does.
export function normalizePhoneInput(raw: string): string {
  let value = toLatinDigits(raw).trim().replace(/[\s\-().]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  const iranLocal = value.match(/^0(9\d{9})$/);
  return iranLocal ? `+98${iranLocal[1]}` : value;
}

export const PHONE_NUMBER_REGEX = /^\+?[1-9]\d{6,14}$/;

export function isValidPhone(raw: string): boolean {
  return PHONE_NUMBER_REGEX.test(normalizePhoneInput(raw));
}
