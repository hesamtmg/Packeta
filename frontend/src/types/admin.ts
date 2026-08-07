import type { CurrencyInfo } from '../utils/currency';
import { walletDisplayName } from '../utils/wallet-name';

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
  'offboarding',
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

// Mirrors backend/src/admin/admin-sections.ts's CUSTOMER_ACTIONS — the
// customer-facing dashboard actions a USER's assigned PanelRole can be
// scoped to. Uses the same PanelRole entity as ADMIN_SECTIONS, just applied
// to customer accounts instead of admins. "purchaseAction" (not "purchase")
// to avoid colliding with ADMIN_SECTIONS's "purchase" (Create Charge).
export const CUSTOMER_ACTIONS = [
  'addWallet',
  'deposit',
  'withdraw',
  'transfer',
  'purchaseAction',
] as const;

export type CustomerAction = (typeof CUSTOMER_ACTIONS)[number];

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
  name: string | null;
  balance: string;
  walletType: AdminWalletType;
  createdAt: string;
  closedAt: string | null;
  ownerId: string;
  ownerEmail: string;
  ownerPhoneNumber: string | null;
}

export type AdminTransactionType =
  | 'DEPOSIT'
  | 'WITHDRAW'
  | 'TRANSFER'
  | 'ADJUSTMENT'
  | 'PURCHASE'
  | 'VIRTUAL';

export type AdminTransactionStatus = 'PENDING' | 'COMPLETED' | 'REVERSED';

export interface AdminTransaction {
  id: string;
  type: AdminTransactionType;
  status: AdminTransactionStatus;
  fromWalletId: string | null;
  toWalletId: string | null;
  amount: string;
  note: string | null;
  createdAt: string;
  // Present on the API response but only meaningful for grouping a single
  // customer-facing action's sub-legs back together — see
  // utils/txCluster.ts and AdminTransactionsView's "Group related" toggle.
  idempotencyKey?: string;
  relatedTransactionId?: string | null;
  relatedPurchaseId?: string | null;
  completesPurchaseId?: string | null;
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

// "<wallet name or type> (<currency>)" for a transaction's from/to side, or
// null when the wallet id is absent (DEPOSIT has no fromWallet; WITHDRAW has
// no toWallet — money entering/leaving the system) or not in the given
// lookup. Prefers the wallet's own custom name over its type's name.
export function partyWalletLabel(
  walletId: string | null,
  wallets: Map<string, AdminWallet>,
): string | null {
  if (!walletId) return null;
  const w = wallets.get(walletId);
  return w ? `${walletDisplayName(w)} (${w.walletType.currency.code})` : null;
}

export function partyOwner(
  walletId: string | null,
  wallets: Map<string, AdminWallet>,
): { email: string; phoneNumber: string | null } | null {
  if (!walletId) return null;
  const w = wallets.get(walletId);
  return w ? { email: w.ownerEmail, phoneNumber: w.ownerPhoneNumber } : null;
}

// Badge color per transaction type — matched by a same-named CSS class in
// admin-theme.css (.tx-type-deposit, .tx-type-withdraw, ...).
export function transactionTypeClass(type: AdminTransactionType): string {
  return `tx-type-${type.toLowerCase()}`;
}

// Badge color per transaction status (.tx-status-pending, ...).
export function transactionStatusClass(status: AdminTransactionStatus): string {
  return `tx-status-${status.toLowerCase()}`;
}
