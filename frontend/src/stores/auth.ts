import { defineStore } from 'pinia';

const TOKEN_KEY = 'packeta_access_token';
const ROLE_KEY = 'packeta_role';
const EMAIL_KEY = 'packeta_email';
const PERMISSIONS_KEY = 'packeta_permissions';
const HAS_PANEL_ROLE_KEY = 'packeta_has_panel_role';
const AVATAR_URL_KEY = 'packeta_avatar_url';

function readPermissions(): string[] {
  try {
    const raw = localStorage.getItem(PERMISSIONS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: localStorage.getItem(TOKEN_KEY) as string | null,
    role: localStorage.getItem(ROLE_KEY) as string | null,
    email: localStorage.getItem(EMAIL_KEY) as string | null,
    permissions: readPermissions(),
    // Whether the account has a PanelRole assigned at all — distinct from
    // permissions being empty. A customer with no role keeps full access to
    // customer actions (see canCustomerAction); a customer WITH a role but
    // 0 permissions granted is fully locked out. Persisted so this survives
    // a page reload without waiting on the /users/me refresh.
    hasPanelRole: localStorage.getItem(HAS_PANEL_ROLE_KEY) === '1',
    avatarUrl: localStorage.getItem(AVATAR_URL_KEY) as string | null,
  }),
  getters: {
    isAuthenticated: (state) => !!state.accessToken,
    isAdmin: (state) => state.role === 'ADMIN' || state.role === 'SUPER_ADMIN',
    isSuperAdmin: (state) => state.role === 'SUPER_ADMIN',
    // SUPER_ADMIN bypasses the section system entirely, same as the
    // backend's SectionGuard — mirror that here so the nav/router agree
    // with what the API will actually allow.
    hasSection: (state) => (section: string) =>
      state.role === 'SUPER_ADMIN' || state.permissions.includes(section),
    // Mirrors the backend's CustomerActionGuard: no role assigned means
    // full access (default before this system existed); a role assigned
    // means the action must be explicitly granted.
    canCustomerAction: (state) => (action: string) =>
      !state.hasPanelRole || state.permissions.includes(action),
  },
  actions: {
    setToken(token: string) {
      this.accessToken = token;
      localStorage.setItem(TOKEN_KEY, token);
    },
    setRole(role: string) {
      this.role = role;
      localStorage.setItem(ROLE_KEY, role);
    },
    setEmail(email: string) {
      this.email = email;
      localStorage.setItem(EMAIL_KEY, email);
    },
    setPermissions(permissions: string[] | null) {
      this.permissions = permissions ?? [];
      this.hasPanelRole = permissions !== null;
      localStorage.setItem(PERMISSIONS_KEY, JSON.stringify(this.permissions));
      localStorage.setItem(HAS_PANEL_ROLE_KEY, this.hasPanelRole ? '1' : '0');
    },
    setAvatarUrl(url: string | null) {
      this.avatarUrl = url;
      if (url) {
        localStorage.setItem(AVATAR_URL_KEY, url);
      } else {
        localStorage.removeItem(AVATAR_URL_KEY);
      }
    },
    logout() {
      this.accessToken = null;
      this.role = null;
      this.email = null;
      this.permissions = [];
      this.hasPanelRole = false;
      this.avatarUrl = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(ROLE_KEY);
      localStorage.removeItem(EMAIL_KEY);
      localStorage.removeItem(PERMISSIONS_KEY);
      localStorage.removeItem(HAS_PANEL_ROLE_KEY);
      localStorage.removeItem(AVATAR_URL_KEY);
    },
  },
});
