import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// auth.tsx transitively imports RN-native-backed modules (expo-secure-store
// via ./api, AsyncStorage/expo-constants via ./query-persist) that cannot
// resolve under vitest's plain-node environment — mock them the same way
// wi056-clear-notification-invalidation.test.ts mocks '@/lib/api'.
vi.mock('./api', () => ({
  api: { auth: { login: vi.fn(), register: vi.fn(), logout: vi.fn(), refresh: vi.fn(), me: vi.fn() } },
  clearStoredTokens: vi.fn(),
  getStoredRefreshToken: vi.fn(),
  onAuthEvent: vi.fn(),
  setStoredTokens: vi.fn(),
}));

const removeClient = vi.fn().mockResolvedValue(undefined);
vi.mock('./query-persist', () => ({
  queryPersister: { removeClient },
}));

// Tests written from spec-WI-067 §6.5 ("at each of these three points, also
// call queryPersister.removeClient()") before resetQueryCache existed in
// auth.tsx — asserts the pairing the spec says "can never drift".

describe('resetQueryCache (WI-067 §6.5)', () => {
  beforeEach(() => {
    removeClient.mockClear();
    removeClient.mockResolvedValue(undefined);
  });

  it('clears the in-memory query cache', async () => {
    const { resetQueryCache } = await import('./auth');
    const queryClient = new QueryClient();
    const clearSpy = vi.spyOn(queryClient, 'clear');

    resetQueryCache(queryClient);

    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('also removes the persisted AsyncStorage client', async () => {
    const { resetQueryCache } = await import('./auth');
    const queryClient = new QueryClient();

    resetQueryCache(queryClient);

    expect(removeClient).toHaveBeenCalledTimes(1);
  });

  it('does not throw or reject if removeClient() rejects (fire-and-forget)', async () => {
    removeClient.mockRejectedValueOnce(new Error('disk full'));
    const { resetQueryCache } = await import('./auth');
    const queryClient = new QueryClient();

    expect(() => resetQueryCache(queryClient)).not.toThrow();
  });
});
