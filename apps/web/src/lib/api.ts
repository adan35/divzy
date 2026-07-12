'use client';

import { createDivzyClient } from '@divzy/api-client';
import { useAuthStore } from './auth-store';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Routes a logged-out user may stay on without being bounced to /login. */
const AUTH_PATHS = ['/login', '/register', '/join'];

function onAuthPage(): boolean {
  if (typeof window === 'undefined') return true;
  const path = window.location.pathname;
  return AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * The single shared API client. Access token comes from the in-memory auth
 * store; on a 401 the client silently refreshes via the httpOnly cookie and
 * retries once, otherwise the user is logged out.
 */
export const api = createDivzyClient({
  baseUrl: BASE_URL,
  credentials: 'include',
  getAccessToken: () => useAuthStore.getState().accessToken,
  refresh: async () => {
    try {
      const res = await api.auth.refresh();
      useAuthStore.getState().setAuth(res.user, res.accessToken);
      return true;
    } catch {
      return false;
    }
  },
  onUnauthorized: () => {
    useAuthStore.getState().clear();
    if (typeof window !== 'undefined' && !onAuthPage()) {
      window.location.assign('/login');
    }
  },
});

/**
 * Absolute URL for API-served assets (receipt uploads return relative paths
 * like "/uploads/receipts/abc.jpg").
 */
export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
