// The panel sections a regular ADMIN's access can be scoped to — mirrors
// the admin nav items in AdminLayout.vue minus "dashboard" (always visible
// to any admin/super-admin, backed by its own ungated summary endpoint) and
// "reports" is included since it reads the same wallet/transaction data as
// the wallets/transactions sections. SUPER_ADMIN bypasses this system
// entirely (see SectionGuard) — it only constrains regular ADMIN accounts.
// "roles" is distinct from "admins": "admins" just lets you view the panel
// users list and their wallets, "roles" lets you create/edit/delete panel
// Roles and assign one to any regular ADMIN — see PanelRolesService.
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

export function isAdminSection(value: string): value is AdminSection {
  return (ADMIN_SECTIONS as readonly string[]).includes(value);
}

// Fixed ID (not a name lookup) for the seeded "Full Access" panel role — see
// the AddPanelRoles migration and UsersService.setRole's auto-assign on
// promotion. Referencing a fixed ID means a super-admin renaming that role
// doesn't break the lookup; if they delete it instead, the auto-assign
// simply no-ops and leaves panelRoleId null for the next promotion.
export const FULL_ACCESS_ROLE_ID = '00000000-0000-0000-0000-000000000001';
