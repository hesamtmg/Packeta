import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { apiRequest } from '../api/client';

// Only same-origin, in-app paths are honoured as a post-login destination —
// an absolute URL or protocol-relative "//host" in ?redirect= would turn the
// login page into an open redirect.
export function safeRedirect(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if (value === '/login' || value === '/signup') return null;
  return value;
}

// Shared by login and signup (email and phone alike): store the token,
// hydrate the session from /users/me, then continue to wherever the visitor
// was originally headed (or their dashboard).
export function useCompleteAuth() {
  const auth = useAuthStore();
  const router = useRouter();
  const route = useRoute();

  return async function completeAuth(accessToken: string) {
    auth.setToken(accessToken);
    try {
      const me = await apiRequest<{
        role: string;
        email: string;
        avatarUrl: string | null;
        panelRole: { permissions: string[] } | null;
      }>('/users/me');
      auth.setRole(me.role);
      auth.setEmail(me.email);
      auth.setPermissions(me.panelRole?.permissions ?? null);
      auth.setAvatarUrl(me.avatarUrl ?? null);
    } catch (err) {
      // Don't leave a half-initialised session behind (token but no role),
      // which would let the router treat the visitor as signed in.
      auth.logout();
      throw err;
    }
    await router.replace(safeRedirect(route.query.redirect) ?? { name: 'dashboard' });
  };
}
