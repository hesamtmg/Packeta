import { i18n } from '../i18n';

export interface CurrencyInfo {
  code: string;
  symbol: string;
  symbolPosition: 'PREFIX' | 'SUFFIX';
  decimalPlaces: number;
}

// The traditional Rial sign (U+FDFC). admin-theme.css overrides the 'Vazirmatn'
// family for just this one codepoint to render it with Noto Nastaliq Urdu,
// so it keeps its calligraphic form without any per-component font wiring.
const NASTALIQ_RIAL_MARK = '﷼';

function groupThousands(formatted: string): string {
  const [intPart, fracPart] = formatted.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fracPart ? `${grouped}.${fracPart}` : grouped;
}

// amount is in the currency's minor units (matches the backend's ledger).
export function formatAmount(amount: string | number, currency: CurrencyInfo): string {
  const value = Number(amount) / 10 ** currency.decimalPlaces;
  const formatted = value.toFixed(currency.decimalPlaces);
  const locale = (i18n.global.locale as unknown as { value: string }).value;

  if (locale === 'fa') {
    const grouped = groupThousands(formatted);
    const symbol = currency.code === 'IRR' ? NASTALIQ_RIAL_MARK : currency.symbol;
    return currency.symbolPosition === 'PREFIX' ? `${symbol}${grouped}` : `${grouped} ${symbol}`;
  }

  return currency.symbolPosition === 'PREFIX'
    ? `${currency.symbol}${formatted}`
    : `${formatted} ${currency.symbol}`;
}

// Converts a human-entered amount (e.g. "12.50") into the currency's minor
// units (e.g. 1250 for USD, 12 for a 0-decimal currency).
export function toMinorUnits(amount: string, currency: CurrencyInfo): number {
  return Math.round(parseFloat(amount || '0') * 10 ** currency.decimalPlaces);
}

// Input step for an <input type="number"> editing this currency's amounts.
export function amountStep(currency: CurrencyInfo): string {
  return (10 ** -currency.decimalPlaces).toString();
}
