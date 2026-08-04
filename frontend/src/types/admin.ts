import type { CurrencyInfo } from '../utils/currency';

// Mirrors backend/src/admin/admin-sections.ts — the panel sections a
// regular ADMIN's access can be scoped to (via an assigned PanelRole).
// SUPER_ADMIN always has every section; "dashboard" isn't in this list
// because it's always visible to any admin/super-admin and isn't
// individually grantable. "roles" is what lets a role's holder create/edit
// panel Roles and assign them to other admins — see AdminAdminsView.vue.
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
  'roles',
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

// The seeded, non-deletable role every fresh ADMIN promotion starts on —
// mirrors backend/src/admin/admin-sections.ts's FULL_ACCESS_ROLE_ID.
export const FULL_ACCESS_ROLE_ID = '00000000-0000-0000-0000-000000000001';

export interface PanelRole {
  id: string;
  name: string;
  permissions: string[];
}

export interface AdminUser {
  id: string;
  email: string;
  phoneNumber: string | null;
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
  panelRole: PanelRole | null;
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
