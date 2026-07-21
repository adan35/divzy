import { describe, expect, it, vi } from 'vitest';

// query-persist.ts imports RN-native-backed modules (AsyncStorage, expo-constants)
// that cannot resolve under vitest's plain-node environment (see apps/mobile
// agent-memory mobile_no_component_test_harness.md) — mock them the same way
// wi056-clear-notification-invalidation.test.ts mocks '@/lib/api'.
const removeItem = vi.fn().mockResolvedValue(undefined);
const getItem = vi.fn().mockResolvedValue(null);
const setItem = vi.fn().mockResolvedValue(undefined);

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem, removeItem },
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '1.2.3' } },
}));

// Tests written from spec-WI-067 §6.1 / §8 ("verify query-persist.ts config
// (maxAge/buster/persister) ... by unit test") before query-persist.ts existed.

describe('query-persist (WI-067 §6.1)', () => {
  it('persistMaxAge is exactly 24h in ms', async () => {
    const { persistMaxAge } = await import('./query-persist');
    expect(persistMaxAge).toBe(86_400_000);
  });

  it('persistBuster is sourced from expo-constants app version', async () => {
    const { persistBuster } = await import('./query-persist');
    expect(persistBuster).toBe('1.2.3');
  });

  it('queryPersister.removeClient() deletes the persisted entry via AsyncStorage.removeItem', async () => {
    const { queryPersister } = await import('./query-persist');
    await queryPersister.removeClient();
    expect(removeItem).toHaveBeenCalledTimes(1);
    expect(removeItem).toHaveBeenCalledWith('REACT_QUERY_OFFLINE_CACHE');
  });
});

describe('query-persist (WI-067 §6.1) — fallback buster', () => {
  it("falls back to '0' when Constants.expoConfig has no version", async () => {
    vi.resetModules();
    vi.doMock('expo-constants', () => ({ default: { expoConfig: {} } }));
    vi.doMock('@react-native-async-storage/async-storage', () => ({
      default: { getItem, setItem, removeItem },
    }));
    const { persistBuster } = await import('./query-persist');
    expect(persistBuster).toBe('0');
  });
});

/**
 * Regression tests for WI-076: without a `shouldDehydrateQuery` filter, the
 * persist client re-serializes the ENTIRE query cache to AsyncStorage on
 * every cache event, not just an allowlisted slice. `shouldPersistQuery`
 * gates that down to a handful of small, long-lived reference queries.
 */
describe('shouldPersistQuery (WI-076)', () => {
  function successQuery(rootKey: unknown) {
    return { queryKey: [rootKey], state: { status: 'success' } } as never;
  }

  it('persists allowlisted root keys (me, groups, friends, balance, notification-preferences)', async () => {
    const { shouldPersistQuery } = await import('./query-persist');
    for (const key of ['me', 'groups', 'friends', 'balance', 'notification-preferences']) {
      expect(shouldPersistQuery(successQuery(key))).toBe(true);
    }
  });

  it('does not persist high-churn query families (expenses, activity, settlements, analytics)', async () => {
    const { shouldPersistQuery } = await import('./query-persist');
    for (const key of ['expenses', 'expense', 'activity', 'settlements', 'settlement', 'analytics', 'unread-count', 'notifications']) {
      expect(shouldPersistQuery(successQuery(key))).toBe(false);
    }
  });

  it('does not persist a non-success (pending/error) allowlisted query', async () => {
    const { shouldPersistQuery } = await import('./query-persist');
    const pendingGroups = { queryKey: ['groups'], state: { status: 'pending' } } as never;
    expect(shouldPersistQuery(pendingGroups)).toBe(false);
  });
});
