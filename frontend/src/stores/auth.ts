import { defineStore } from 'pinia';

const TOKEN_KEY = 'packeta_access_token';
const ROLE_KEY = 'packeta_role';
const EMAIL_KEY = 'packeta_email';
const PERMISSIONS_KEY = 'packeta_permissions';

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
      localStorage.setItem(PERMISSIONS_KEY, JSON.stringify(this.permissions));
    },
    logout() {
      this.accessToken = null;
      this.role = null;
      this.email = null;
      this.permissions = [];
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(ROLE_KEY);
      localStorage.removeItem(EMAIL_KEY);
      localStorage.removeItem(PERMISSIONS_KEY);
    },
  },
});
