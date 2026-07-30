// Generic structural IBAN check (2-letter country + 2 check digits + up to
// 30 alphanumerics) — not a real checksum/registry validation, matching the
// sandbox nature of the rest of this system.
export const IBAN_REGEX = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
