// Phone-only accounts (signed up via phone+OTP, never set an email) still
// need a value in the `email` column — so much of the app resolves
// counterparties by email (transfers, purchases, restriction lists) that
// making it nullable would ripple everywhere. Instead they get a
// deterministic, never-shown placeholder in this reserved domain.
const SYNTHETIC_EMAIL_DOMAIN = '@phone.internal';

export function syntheticEmailForPhone(phoneNumber: string): string {
  return `phone-${phoneNumber.replace(/[^0-9]/g, '')}${SYNTHETIC_EMAIL_DOMAIN}`;
}

export function isSyntheticPhoneEmail(email: string): boolean {
  return email.endsWith(SYNTHETIC_EMAIL_DOMAIN);
}

// Prefer showing a phone-only account's actual phone number over its
// internal placeholder email anywhere a human-facing "who is this" string
// is needed (e.g. the merchant name shown to a customer at checkout). An
// account with a real email keeps showing that, even if it also has a
// phone number on file, to avoid changing today's display for existing
// email-registered users.
export function displayIdentity(user: {
  email: string;
  phoneNumber: string | null;
}): string {
  if (isSyntheticPhoneEmail(user.email)) {
    return user.phoneNumber ?? user.email;
  }
  return user.email;
}
