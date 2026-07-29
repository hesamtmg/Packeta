import { Currency } from '../currencies/entities/currency.entity';

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
