import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@divzy/api-client';
import type { RegisterInput, UserDto } from '@divzy/shared';
import {
  api,
  clearStoredTokens,
  getStoredRefreshToken,
  onAuthEvent,
  setStoredTokens,
} from './api';

export type AuthStatus = 'loading' | 'authed' | 'guest';

export interface AuthContextValue {
  user: UserDto | null;
  status: AuthStatus;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
  /** Keep the cached profile in sync after PATCH /users/me. */
  setUser: (user: UserDto) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUserState] = useState<UserDto | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  // Silent session restore: stored refresh token -> rotate -> load profile.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const refreshToken = await getStoredRefreshToken();
      if (!refreshToken) {
        if (!cancelled) {
          setUserState(null);
          setStatus('guest');
        }
        return;
      }
      let refreshed;
      try {
        refreshed = await api.auth.refresh(refreshToken);
      } catch (err) {
        // Rejected token -> wipe it. Network failure -> keep it for next launch.
        if (err instanceof ApiError) {
          await clearStoredTokens().catch(() => undefined);
        }
        if (!cancelled) {
          setUserState(null);
          setStatus('guest');
        }
        return;
      }
      await setStoredTokens(refreshed.accessToken, refreshed.refreshToken).catch(() => undefined);
      let me = refreshed.user;
      try {
        me = await api.auth.me();
      } catch {
        // The refresh response already carries a fresh profile.
      }
      if (!cancelled) {
        setUserState(me);
        setStatus('authed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The HTTP client failed a refresh-and-retry — the session is gone.
  useEffect(
    () =>
      onAuthEvent('unauthorized', () => {
        setUserState(null);
        setStatus('guest');
        queryClient.clear();
      }),
    [queryClient],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await api.auth.login({ email, password });
      await setStoredTokens(res.accessToken, res.refreshToken);
      queryClient.clear();
      setUserState(res.user);
      setStatus('authed');
    },
    [queryClient],
  );

  const signUp = useCallback(
    async (input: RegisterInput) => {
      const res = await api.auth.register(input);
      await setStoredTokens(res.accessToken, res.refreshToken);
      queryClient.clear();
      setUserState(res.user);
      setStatus('authed');
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    const refreshToken = await getStoredRefreshToken();
    try {
      await api.auth.logout(refreshToken ?? undefined);
    } catch {
      // Revoking an already-dead token is fine — always log out locally.
    }
    await clearStoredTokens();
    setUserState(null);
    setStatus('guest');
    queryClient.clear();
  }, [queryClient]);

  const setUser = useCallback((next: UserDto) => {
    setUserState(next);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, signIn, signUp, signOut, setUser }),
    [user, status, signIn, signUp, signOut, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
