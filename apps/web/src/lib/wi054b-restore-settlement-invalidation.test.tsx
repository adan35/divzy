import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PublicUserDto, SettlementDto } from '@divzy/shared';
import { queryKeys, useRestoreSettlement } from './hooks';

/**
 * WI-054b: `useRestoreSettlement` must invalidate the same
 * `invalidateForExpenseChange` fan-out `useDeleteSettlement`/`useCreateSettlement`
 * already use, PLUS an explicit `queryKeys.settlement(id)` invalidation — the
 * load-bearing call that refetches an open `SettlementDetailDialog` out of
 * its deleted state and into the active one after Restore (spec-WI-054b
 * §4.1). Mirrors `wi054b-restore-invalidation.test.tsx`'s expense-side
 * pattern: import the real, unmocked hook (mocking only `./api`) with a
 * production-matching `staleTime`, since a wholesale `@/lib/hooks` mock
 * (as `settlement-detail.test.tsx` uses) can never catch a missing
 * invalidation call.
 */

vi.mock('./api', () => ({
  api: {
    settlements: {
      restore: vi.fn(),
    },
  },
}));

// eslint-disable-next-line import/first -- must follow the vi.mock('./api', ...) call above
import { api } from './api';

const mePublic: PublicUserDto = { id: 'me', name: 'Me', avatarColor: '#111111' };
const ana: PublicUserDto = { id: 'ana', name: 'Ana', avatarColor: '#222222' };

function makeSettlement(overrides: Partial<SettlementDto> = {}): SettlementDto {
  return {
    id: 'settle-1',
    groupId: 'group-1',
    group: { id: 'group-1', name: 'Roommates', emoji: '🏠' },
    from: ana,
    to: mePublic,
    amount: 1500,
    currency: 'PKR',
    method: 'BANK_TRANSFER',
    note: null,
    proofUrl: null,
    date: '2026-07-10T00:00:00.000Z',
    createdBy: mePublic,
    deletedAt: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('WI-054b — useRestoreSettlement invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Mirrors the real app's global staleTime (apps/web/src/app/providers.tsx). */
  function makeClient(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
  }

  function wrapperFor(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
  }

  it('calls api.settlements.restore with the given settlementId', async () => {
    const queryClient = makeClient();
    vi.mocked(api.settlements.restore).mockResolvedValue(makeSettlement());

    const { result } = renderHook(() => useRestoreSettlement(), {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      result.current.mutate({ settlementId: 'settle-1', groupId: 'group-1' });
    });

    await waitFor(() => {
      expect(api.settlements.restore).toHaveBeenCalledWith('settle-1');
    });
  });

  it('onSuccess invalidates the group-balances, activity and settlements-list caches', async () => {
    const queryClient = makeClient();
    queryClient.setQueryData(queryKeys.groupBalances('group-1'), {});
    queryClient.setQueryData(queryKeys.activity('group-1'), []);
    queryClient.setQueryData(queryKeys.settlements({ groupId: 'group-1' }), { items: [] });
    vi.mocked(api.settlements.restore).mockResolvedValue(makeSettlement());

    const { result } = renderHook(() => useRestoreSettlement(), {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      result.current.mutate({ settlementId: 'settle-1', groupId: 'group-1' });
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.groupBalances('group-1'))?.isInvalidated).toBe(
        true,
      );
      expect(queryClient.getQueryState(queryKeys.activity('group-1'))?.isInvalidated).toBe(true);
      expect(
        queryClient.getQueryState(queryKeys.settlements({ groupId: 'group-1' }))?.isInvalidated,
      ).toBe(true);
    });
  });

  it('onSuccess invalidates the restored settlement\'s own detail cache — load-bearing for the "no dead state" AC', async () => {
    const queryClient = makeClient();
    queryClient.setQueryData(
      queryKeys.settlement('settle-1'),
      makeSettlement({ deletedAt: '2026-07-18T00:00:00.000Z' }),
    );
    vi.mocked(api.settlements.restore).mockResolvedValue(makeSettlement());

    const { result } = renderHook(() => useRestoreSettlement(), {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      result.current.mutate({ settlementId: 'settle-1', groupId: 'group-1' });
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.settlement('settle-1'))?.isInvalidated).toBe(
        true,
      );
    });
  });

  it("falls back to the returned DTO's own groupId when the mutation variables omit one", async () => {
    const queryClient = makeClient();
    queryClient.setQueryData(queryKeys.groupBalances('group-2'), {});
    vi.mocked(api.settlements.restore).mockResolvedValue(makeSettlement({ groupId: 'group-2' }));

    const { result } = renderHook(() => useRestoreSettlement(), {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      result.current.mutate({ settlementId: 'settle-1' });
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.groupBalances('group-2'))?.isInvalidated).toBe(
        true,
      );
    });
  });
});
