import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateQuery, type Query } from '@tanstack/react-query';
import Constants from 'expo-constants';

/**
 * Shared AsyncStorage-backed persister singleton (spec-WI-067 §6.1). Reachable
 * from both `app/_layout.tsx` (configures `PersistQueryClientProvider`) and
 * `src/lib/auth.tsx` (wipes the persisted entry on logout/account-switch, §6.5).
 */
export const queryPersister = createAsyncStoragePersister({ storage: AsyncStorage });

/** App version, read at runtime — a new build busts any older persisted cache. */
export const persistBuster = Constants.expoConfig?.version ?? '0';

/** Persisted cache older than this is discarded on restore (S5). */
export const persistMaxAge = 24 * 60 * 60 * 1000;

/**
 * WI-076 — only small, long-lived reference data persists to AsyncStorage on
 * every cache event. Without a `shouldDehydrateQuery` filter, the persist
 * client re-serializes the ENTIRE query cache (expenses, activity,
 * settlements, analytics — everything) on every `added`/`updated`/`removed`
 * cache event, not just on a throttled interval. Paired with any broad
 * invalidation elsewhere (WI-075), that became a feedback loop: more
 * invalidation -> more refetches -> more full-cache dehydration passes -> the
 * mechanism by which adding persistence made the app slower, not faster.
 * Everything NOT in this allowlist still works exactly as before WI-067 —
 * in-memory only, refetched on mount per its own staleTime.
 */
export const PERSISTED_QUERY_ROOT_KEYS: readonly string[] = [
  'me',
  'groups',
  'friends',
  'balance',
  'notification-preferences',
];

export function shouldPersistQuery(query: Query): boolean {
  const rootKey = query.queryKey[0];
  return (
    typeof rootKey === 'string' &&
    PERSISTED_QUERY_ROOT_KEYS.includes(rootKey) &&
    defaultShouldDehydrateQuery(query)
  );
}
