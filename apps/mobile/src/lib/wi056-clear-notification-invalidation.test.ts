import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

// Mock the RN-native-backed modules hooks.ts transitively imports
// (expo-secure-store via @/lib/api) so the module graph can be collected by
// vitest's plain-node environment — mirrors wi032-used-categories-invalidation.test.ts
// / apps/mobile agent-memory gap_mobile-no-render-harness.md.
vi.mock('@/lib/api', () => ({
  api: { notifications: { clear: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() } },
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ status: 'authed' }),
}));

// Tests written from spec-WI-056 §4 ("Both clients should invalidate the
// notifications list + unread-count queries on success") before
// `invalidateForNotificationChange` existed in hooks.ts.

describe('invalidateForNotificationChange (WI-056)', () => {
  it('invalidates both the notifications list and unread-count queries', async () => {
    const { invalidateForNotificationChange, queryKeys } = await import('@/lib/hooks');
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    queryClient.setQueryData(queryKeys.notifications, { pages: [], pageParams: [] });
    queryClient.setQueryData(queryKeys.unreadCount, { count: 3 });

    invalidateForNotificationChange(queryClient);

    expect(queryClient.getQueryState(queryKeys.notifications)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.unreadCount)?.isInvalidated).toBe(true);
  });
});
