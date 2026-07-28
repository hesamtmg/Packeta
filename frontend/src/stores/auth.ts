import { defineStore } from 'pinia';

const STORAGE_KEY = 'packeta_access_token';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: localStorage.getItem(STORAGE_KEY) as string | null,
  }),
  getters: {
    isAuthenticated: (state) => !!state.accessToken,
  },
  actions: {
    setToken(token: string) {
      this.accessToken = token;
      localStorage.setItem(STORAGE_KEY, token);
    },
    logout() {
      this.accessToken = null;
      localStorage.removeItem(STORAGE_KEY);
    },
  },
});
