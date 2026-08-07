import { Currency } from '../currencies/entities/currency.entity';
import { amountToWords } from './amount-to-words';

// amount is in the currency's minor units. Used to build the human-readable
// displayAmount sent to the IPG, since the sandbox gateway has no currency
// table of its own.
export function formatAmount(
  amount: string | number,
  currency: Currency,
): string {
  const value = Number(amount) / 10 ** currency.decimalPlaces;
  const formatted = value.toFixed(currency.decimalPlaces);
  return currency.symbolPosition === 'PREFIX'
    ? `${currency.symbol}${formatted}`
    : `${formatted} ${currency.symbol}`;
}

// The spelled-out currency name that follows the words caption (e.g. "one
// million two hundred thousand Rial" / "یک میلیون و دویست هزار ریال") — not
// every currency this app supports has a natural spoken unit name, so
// unrecognized codes just fall back to their raw code.
const CURRENCY_UNIT_WORDS: Record<string, { en: string; fa: string }> = {
  IRR: { en: 'Rial', fa: 'ریال' },
  USD: { en: 'Dollar', fa: 'دلار' },
};

// Spells out an amount (minor units, same input as formatAmount) in words,
// baked server-side because the sandbox IPG has no currency table of its
// own to recompute this from later — see displayAmount above.
export function formatAmountWords(
  amount: string | number,
  currency: Currency,
  locale: 'en' | 'fa',
): string {
  const value = Number(amount) / 10 ** currency.decimalPlaces;
  const words = amountToWords(value, locale);
  const unit = CURRENCY_UNIT_WORDS[currency.code]?.[locale] ?? currency.code;
  return `${words} ${unit}`;
}
