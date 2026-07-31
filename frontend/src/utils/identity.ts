// Mirrors backend/src/common/synthetic-email.ts: phone-only accounts (signed
// up via phone+OTP, no email ever set) get a never-shown placeholder email
// in this reserved domain so the rest of the app — which resolves people by
// email almost everywhere — never has to special-case a null email. Prefer
// showing the real phone number instead of that placeholder wherever a
// human-facing identity string is needed.
const SYNTHETIC_EMAIL_DOMAIN = '@phone.internal';

export function displayIdentity(user: { email: string; phoneNumber?: string | null }): string {
  if (user.email.endsWith(SYNTHETIC_EMAIL_DOMAIN)) {
    return user.phoneNumber || user.email;
  }
  return user.email;
}
