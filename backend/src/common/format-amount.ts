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

// The traditional Rial sign (U+FDFC) — rendered in Noto Nastaliq Urdu by
// both frontends' own @font-face split, matching how a real Iranian payment
// page presents Rial amounts, rather than the ASCII "IRR" code.
const NASTALIQ_RIAL_MARK = '﷼';

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

function toPersianDigits(value: string): string {
  return value.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

function groupThousands(formatted: string): string {
  const [intPart, fracPart] = formatted.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fracPart ? `${grouped}.${fracPart}` : grouped;
}

// Farsi-styled variant of formatAmount — Nastaliq Rial mark for IRR, grouped
// thousands, Persian numerals throughout, so a Farsi-language charge reads
// as fully Farsi rather than just Farsi text around Western digits. Baked
// here rather than left to the client for the same reason displayAmountWords
// is: the sandbox IPG has no currency table of its own to recompute this
// from later.
export function formatAmountFarsi(
  amount: string | number,
  currency: Currency,
): string {
  const value = Number(amount) / 10 ** currency.decimalPlaces;
  const formatted = value.toFixed(currency.decimalPlaces);
  const symbol = currency.code === 'IRR' ? NASTALIQ_RIAL_MARK : currency.symbol;
  const grouped = toPersianDigits(groupThousands(formatted));
  return currency.symbolPosition === 'PREFIX'
    ? `${symbol}${grouped}`
    : `${grouped} ${symbol}`;
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
