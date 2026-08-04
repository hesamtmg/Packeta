import type { CurrencyInfo } from '../utils/currency';

// Mirrors backend/src/admin/admin-sections.ts — the panel sections a
// regular ADMIN's access can be scoped to. SUPER_ADMIN always has every
// section; "dashboard" isn't in this list because it's always visible to
// any admin/super-admin and isn't individually grantable.
export const ADMIN_SECTIONS = [
  'transactions',
  'wallets',
  'customers',
  'admins',
  'walletTypes',
  'purchase',
  'installments',
  'schedulerLogs',
  'reports',
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export interface AdminUser {
  id: string;
  email: string;
  phoneNumber: string | null;
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
  permissions: string[] | null;
  createdAt: string;
}

export interface AdminWalletType {
  id: string;
  code: string;
  name: string;
  currency: CurrencyInfo;
  allowNegativeBalance: boolean;
  creditLimit: string | null;
  allowWithdraw: boolean;
  allowP2pOut: boolean;
  allowP2pIn: boolean;
}

export interface AdminWallet {
  id: string;
  balance: string;
  walletType: AdminWalletType;
  createdAt: string;
  closedAt: string | null;
  ownerId: string;
  ownerEmail: string;
  ownerPhoneNumber: string | null;
}

export interface AdminTransaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER' | 'ADJUSTMENT';
  fromWalletId: string | null;
  toWalletId: string | null;
  amount: string;
  note: string | null;
  createdAt: string;
}

// Builds a walletId -> wallet lookup so transaction rows (which only carry
// fromWalletId/toWalletId) can show owner, type, and currency without a
// second round trip per row.
export function walletLookup(wallets: AdminWallet[]): Map<string, AdminWallet> {
  return new Map(wallets.map((w) => [w.id, w]));
}

export function transactionCurrency(
  tx: AdminTransaction,
  wallets: Map<string, AdminWallet>,
): CurrencyInfo | null {
  const w =
    (tx.fromWalletId && wallets.get(tx.fromWalletId)) ||
    (tx.toWalletId && wallets.get(tx.toWalletId));
  return w ? w.walletType.currency : null;
}
