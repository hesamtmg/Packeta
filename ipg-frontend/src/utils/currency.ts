import { i18n } from '../i18n';
import { amountToWords } from './number-to-words';

export interface CurrencyInfo {
  code: string;
  symbol: string;
  symbolPosition: 'PREFIX' | 'SUFFIX';
  decimalPlaces: number;
}

// The traditional Rial sign (U+FDFC), rendered in Noto Nastaliq Urdu — see
// the @font-face split in App.vue, matching the panel's own treatment
// (frontend/src/utils/currency.ts).
const NASTALIQ_RIAL_MARK = '﷼';

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

// Swaps Western 0-9 for Persian numerals — everything else (grouping
// commas, a decimal point, a minus sign) passes through untouched.
function toPersianDigits(value: string): string {
  return value.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

function groupThousands(formatted: string): string {
  const [intPart, fracPart] = formatted.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fracPart ? `${grouped}.${fracPart}` : grouped;
}

// amount is in the currency's minor units, matching Packeta's own ledger.
export function formatAmount(amount: string | number, currency: CurrencyInfo): string {
  const value = Number(amount) / 10 ** currency.decimalPlaces;
  const formatted = value.toFixed(currency.decimalPlaces);
  const locale = (i18n.global.locale as unknown as { value: string }).value;

  if (locale === 'fa') {
    const symbol = currency.code === 'IRR' ? NASTALIQ_RIAL_MARK : currency.symbol;
    const grouped = toPersianDigits(groupThousands(formatted));
    return currency.symbolPosition === 'PREFIX' ? `${symbol}${grouped}` : `${grouped} ${symbol}`;
  }

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
