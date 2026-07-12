'use client';

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { UserDto } from '@divzy/shared';

export type AuthStatus = 'loading' | 'authed' | 'guest';

export interface AuthState {
  user: UserDto | null;
  /** Access token lives in memory only; the refresh token is an httpOnly cookie. */
  accessToken: string | null;
  status: AuthStatus;
  setAuth: (user: UserDto, accessToken: string) => void;
  setUser: (user: UserDto) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: 'loading',
  setAuth: (user, accessToken) => set({ user, accessToken, status: 'authed' }),
  setUser: (user) => set({ user }),
  clear: () => set({ user: null, accessToken: null, status: 'guest' }),
}));

let bootPromise: Promise<void> | null = null;

/**
 * Silent session restore: exchange the httpOnly refresh cookie for a fresh
 * access token. Runs once per page load (React strict-mode safe).
 */
export function initAuth(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    try {
      // Deferred import breaks the module cycle with lib/api.ts.
      const { api } = await import('./api');
      const res = await api.auth.refresh();
      useAuthStore.getState().setAuth(res.user, res.accessToken);
    } catch {
      useAuthStore.getState().clear();
    }
  })();
  return bootPromise;
}

/** Convenience selector for components that only need user + status. */
export function useAuth(): { user: UserDto | null; status: AuthStatus } {
  return useAuthStore(
    useShallow((s) => ({ user: s.user, status: s.status })),
  );
}
