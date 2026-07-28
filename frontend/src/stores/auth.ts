import { defineStore } from 'pinia';

const TOKEN_KEY = 'packeta_access_token';
const ROLE_KEY = 'packeta_role';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: localStorage.getItem(TOKEN_KEY) as string | null,
    role: localStorage.getItem(ROLE_KEY) as string | null,
  }),
  getters: {
    isAuthenticated: (state) => !!state.accessToken,
    isAdmin: (state) => state.role === 'ADMIN',
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
    logout() {
      this.accessToken = null;
      this.role = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(ROLE_KEY);
    },
  },
});
