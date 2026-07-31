import { normalizePhoneNumber, PHONE_NUMBER_REGEX } from './phone-number';

describe('normalizePhoneNumber', () => {
  it('rewrites an Iranian local-form mobile number to E.164', () => {
    expect(normalizePhoneNumber('09122215309')).toBe('+989122215309');
  });

  it('leaves an already-E.164 Iranian number unchanged', () => {
    expect(normalizePhoneNumber('+989122215309')).toBe('+989122215309');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizePhoneNumber('  09122215309  ')).toBe('+989122215309');
  });

  it('leaves other countries numbers unchanged', () => {
    expect(normalizePhoneNumber('+15551234567')).toBe('+15551234567');
  });

  it('does not rewrite a leading-zero number that is not the Iranian mobile shape', () => {
    // Doesn't start with 09 — not the 09XXXXXXXXX shape.
    expect(normalizePhoneNumber('012345678')).toBe('012345678');
  });

  it('produces a normalized value that passes the phone number regex', () => {
    expect(PHONE_NUMBER_REGEX.test(normalizePhoneNumber('09122215309'))).toBe(
      true,
    );
  });
});
