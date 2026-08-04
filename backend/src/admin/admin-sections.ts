// The panel sections a regular ADMIN's access can be scoped to — mirrors
// the admin nav items in AdminLayout.vue minus "dashboard" (always visible
// to any admin/super-admin, backed by its own ungated summary endpoint) and
// "reports" is included since it reads the same wallet/transaction data as
// the wallets/transactions sections. SUPER_ADMIN bypasses this system
// entirely (see SectionGuard) — it only constrains regular ADMIN accounts.
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

export function isAdminSection(value: string): value is AdminSection {
  return (ADMIN_SECTIONS as readonly string[]).includes(value);
}
