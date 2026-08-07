import { amountToWords } from './number-to-words';

export interface CurrencyInfo {
  code: string;
  symbol: string;
  symbolPosition: 'PREFIX' | 'SUFFIX';
  decimalPlaces: number;
}

// amount is in the currency's minor units, matching Packeta's own ledger.
export function formatAmount(amount: string | number, currency: CurrencyInfo): string {
  const value = Number(amount) / 10 ** currency.decimalPlaces;
  const formatted = value.toFixed(currency.decimalPlaces);
  return currency.symbolPosition === 'PREFIX'
    ? `${currency.symbol}${formatted}`
    : `${formatted} ${currency.symbol}`;
}

// Mirrors backend/src/common/format-amount.ts's CURRENCY_UNIT_WORDS — used
// for amounts this page computes locally from a wallet's own CurrencyInfo
// (a wallet balance), as opposed to a merchant-named charge amount, whose
// words caption is baked server-side into displayAmountWordsEn/Fa since the
// sandbox IPG has no currency table of its own to recompute from.
const CURRENCY_UNIT_WORDS: Record<string, { en: string; fa: string }> = {
  IRR: { en: 'Rial', fa: 'ریال' },
  USD: { en: 'Dollar', fa: 'دلار' },
};

export function formatAmountWords(
  amount: string | number,
  currency: CurrencyInfo,
  locale: 'en' | 'fa',
): string {
  const value = Number(amount) / 10 ** currency.decimalPlaces;
  const words = amountToWords(value, locale);
  const unit = CURRENCY_UNIT_WORDS[currency.code]?.[locale] ?? currency.code;
  return `${words} ${unit}`;
}
