import * as SecureStore from 'expo-secure-store';
import { createDivzyClient } from '@divzy/api-client';

/**
 * API origin. For a physical device set EXPO_PUBLIC_API_URL in .env to your
 * machine's LAN IP (see .env.example).
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

const ACCESS_TOKEN_KEY = 'divzy_at';
const REFRESH_TOKEN_KEY = 'divzy_rt';

// ---------------------------------------------------------------------------
// Tiny auth event emitter — lets the auth context react to client-level 401s
// and lets the socket layer follow access-token rotation.
// ---------------------------------------------------------------------------

export type AuthEventName = 'unauthorized' | 'tokens';

const listeners: Record<AuthEventName, Set<() => void>> = {
  unauthorized: new Set(),
  tokens: new Set(),
};

/** Subscribe to an auth event. Returns an unsubscribe function. */
export function onAuthEvent(event: AuthEventName, listener: () => void): () => void {
  listeners[event].add(listener);
  return () => {
    listeners[event].delete(listener);
  };
}

function emitAuthEvent(event: AuthEventName): void {
  for (const listener of listeners[event]) {
    try {
      listener();
    } catch {
      // One faulty listener must never break the others.
    }
  }
}

// ---------------------------------------------------------------------------
// Token storage — SecureStore for persistence, memory mirror for the sync
// getAccessToken the HTTP client and socket handshake need.
// ---------------------------------------------------------------------------

let accessTokenInMemory: string | null = null;

/** Current access token (memory mirror of SecureStore `divzy_at`). */
export function getAccessToken(): string | null {
  return accessTokenInMemory;
}

export async function setStoredTokens(accessToken: string, refreshToken: string): Promise<void> {
  accessTokenInMemory = accessToken;
  try {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
    ]);
  } finally {
    emitAuthEvent('tokens');
  }
}

export async function clearStoredTokens(): Promise<void> {
  accessTokenInMemory = null;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY).catch(() => undefined),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => undefined),
  ]);
  emitAuthEvent('tokens');
}

export async function getStoredRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Refresh — single-flight so concurrent 401s never race the token rotation
// (a reused rotated token would revoke the whole session server-side).
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  try {
    const refreshToken = await getStoredRefreshToken();
    if (!refreshToken) return false;
    const res = await api.auth.refresh(refreshToken);
    await setStoredTokens(res.accessToken, res.refreshToken);
    return true;
  } catch {
    return false;
  }
}

/** Exchange the stored refresh token for fresh tokens (deduped). */
export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// The single shared API client.
// ---------------------------------------------------------------------------

export const api = createDivzyClient({
  baseUrl: API_BASE_URL,
  credentials: 'omit',
  getAccessToken: () => accessTokenInMemory,
  refresh: () => refreshSession(),
  onUnauthorized: async () => {
    await clearStoredTokens();
    emitAuthEvent('unauthorized');
  },
});

/**
 * Absolute URL for API-served assets (receipt uploads return relative paths
 * like "/uploads/receipts/abc.jpg").
 */
export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
