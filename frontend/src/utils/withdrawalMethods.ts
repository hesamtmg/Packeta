import type { SettlementRailType, WalletType, WithdrawalMethod } from '../stores/wallet';
import { formatAmount } from './currency';

export const ALL_RAILS: SettlementRailType[] = ['POL_PAY', 'PAYA', 'SATNA', 'BANK_TRANSFER'];

// Mirrors backend wallet-types/withdrawal-methods.ts: a wallet type with no
// withdrawal methods configured lets merchants pick any rail with no fee;
// a configured type only offers the rails the super admin enabled.
export function availableRails(walletType: Pick<WalletType, 'withdrawalMethods'> | null | undefined): SettlementRailType[] {
  const methods = walletType?.withdrawalMethods;
  if (!methods?.length) return ALL_RAILS;
  return ALL_RAILS.filter((rail) => methods.some((m) => m.railType === rail && m.enabled));
}

export function findMethod(
  walletType: Pick<WalletType, 'withdrawalMethods'> | null | undefined,
  rail: SettlementRailType,
): WithdrawalMethod | null {
  return walletType?.withdrawalMethods?.find((m) => m.railType === rail) ?? null;
}

// "1.5% + IRR 25,000" / "IRR 25,000" / "1.5%" — or null for a free rail.
export function feeSummary(
  walletType: Pick<WalletType, 'withdrawalMethods' | 'currency'>,
  rail: SettlementRailType,
): string | null {
  const method = findMethod(walletType, rail);
  if (!method) return null;
  const parts: string[] = [];
  if (Number(method.feePercent) > 0) parts.push(`${Number(method.feePercent)}%`);
  if (Number(method.fixedFee) > 0) parts.push(formatAmount(method.fixedFee, walletType.currency));
  return parts.length ? parts.join(' + ') : null;
}
