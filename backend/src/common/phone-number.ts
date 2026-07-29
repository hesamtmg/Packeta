// Loose E.164-ish check: optional leading +, 7-15 digits.
export const PHONE_NUMBER_REGEX = /^\+?[1-9]\d{6,14}$/;
