import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys, useClearAllNotifications } from './hooks';

/**
 * spec-WI-065 §3: `useClearAllNotifications` mirrors
 * `useMarkAllNotificationsRead` exactly — calls `api.notifications.clearAll()`
 * with no arguments and, on success, invalidates BOTH the notifications list
 * and unread-count queries (never optimistic). Follows the
 * `wi056-clear-notification-invalidation.test.tsx` precedent: a
 * production-matching `staleTime` (30s) so a missing invalidation call would
 * leave the seeded cache entry valid/fresh instead of accidentally passing due
 * to RTL's usual `staleTime: 0` default.
 */

vi.mock('./api', () => ({
  api: {
    notifications: {
      clearAll: vi.fn(),
    },
  },
}));

// eslint-disable-next-line import/first -- must follow the vi.mock('./api', ...) call above
import { api } from './api';

describe('WI-065 — useClearAllNotifications invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeClient(): QueryClient {
    return new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: false } },
    });
  }

  function wrapperFor(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
  }

  it('calls api.notifications.clearAll with no arguments', async () => {
    const queryClient = makeClient();
    vi.mocked(api.notifications.clearAll).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useClearAllNotifications(), {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      result.current.mutate();
    });

    await waitFor(() => expect(api.notifications.clearAll).toHaveBeenCalledWith());
  });

  it('onSuccess invalidates both the notifications list and unread-count caches', async () => {
    const queryClient = makeClient();
    queryClient.setQueryData(queryKeys.notifications, { pages: [], pageParams: [] });
    queryClient.setQueryData(queryKeys.unreadCount, { count: 3 });
    vi.mocked(api.notifications.clearAll).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useClearAllNotifications(), {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      result.current.mutate();
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.notifications)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.unreadCount)?.isInvalidated).toBe(true);
    });
  });
});
