export interface CurrencyInfo {
  code: string;
  symbol: string;
  symbolPosition: 'PREFIX' | 'SUFFIX';
  decimalPlaces: number;
}

// amount is in the currency's minor units (matches the backend's ledger).
export function formatAmount(amount: string | number, currency: CurrencyInfo): string {
  const value = Number(amount) / 10 ** currency.decimalPlaces;
  const formatted = value.toFixed(currency.decimalPlaces);
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
