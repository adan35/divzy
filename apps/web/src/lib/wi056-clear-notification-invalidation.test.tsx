import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys, useClearNotification } from './hooks';

/**
 * spec-WI-056 §4: clearing a notification must invalidate/refetch BOTH the
 * notifications list query and the unread-count query, mirroring
 * `useMarkNotificationRead`'s existing invalidation pattern — clearing an
 * unread notification also changes the count per the backend.
 *
 * Follows the `wi032-used-categories-invalidation.test.tsx` precedent: a
 * production-matching `staleTime` (30s) so a missing invalidation call
 * would leave the seeded cache entry valid/fresh instead of accidentally
 * passing due to RTL's usual `staleTime: 0` default.
 */

vi.mock('./api', () => ({
  api: {
    notifications: {
      clear: vi.fn(),
    },
  },
}));

// eslint-disable-next-line import/first -- must follow the vi.mock('./api', ...) call above
import { api } from './api';

describe('WI-056 — useClearNotification invalidation', () => {
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

  it('calls api.notifications.clear with the notification id', async () => {
    const queryClient = makeClient();
    vi.mocked(api.notifications.clear).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useClearNotification(), {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      result.current.mutate('notif-1');
    });

    await waitFor(() => expect(api.notifications.clear).toHaveBeenCalledWith('notif-1'));
  });

  it('onSuccess invalidates both the notifications list and unread-count caches', async () => {
    const queryClient = makeClient();
    queryClient.setQueryData(queryKeys.notifications, { pages: [], pageParams: [] });
    queryClient.setQueryData(queryKeys.unreadCount, { count: 2 });
    vi.mocked(api.notifications.clear).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useClearNotification(), {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      result.current.mutate('notif-1');
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.notifications)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.unreadCount)?.isInvalidated).toBe(true);
    });
  });
});
