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

// Customer-facing actions a regular USER's Panel Role can be scoped to —
// gates the Add Wallet / Deposit / Withdraw / Transfer / Purchase cards on
// the customer dashboard (and the matching API routes). Uses the same
// PanelRole entity/mechanism as ADMIN_SECTIONS but for a different account
// role; a customer with no panelRoleId assigned keeps full access to all
// five (backward-compatible default), see UsersService.setPanelRole.
// "purchaseAction" (not "purchase") — ADMIN_SECTIONS already uses "purchase"
// for the admin's "Create Charge" nav item; reusing that string here would
// make the two unrelated grants indistinguishable in a role's permissions
// array (granting one would visually and functionally grant the other).
export const CUSTOMER_ACTIONS = [
  'addWallet',
  'deposit',
  'withdraw',
  'transfer',
  'purchaseAction',
] as const;

export type CustomerAction = (typeof CUSTOMER_ACTIONS)[number];

export function isCustomerAction(value: string): value is CustomerAction {
  return (CUSTOMER_ACTIONS as readonly string[]).includes(value);
}

export const PANEL_ROLE_PERMISSIONS = [
  ...ADMIN_SECTIONS,
  ...CUSTOMER_ACTIONS,
] as const;

// Fixed ID (not a name lookup) for the seeded "Full Access" panel role — see
// the AddPanelRoles migration and UsersService.setRole's auto-assign on
// promotion. Referencing a fixed ID means a super-admin renaming that role
// doesn't break the lookup; if they delete it instead, the auto-assign
// simply no-ops and leaves panelRoleId null for the next promotion.
export const FULL_ACCESS_ROLE_ID = '00000000-0000-0000-0000-000000000001';
