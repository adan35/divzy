import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ExpenseDto, PublicUserDto } from '@divzy/shared';
import { queryKeys, useRestoreExpense } from './hooks';

/**
 * WI-054b: `useRestoreExpense` must be wired into the same
 * `invalidateForExpenseChange` fan-out `useDeleteExpense`/`useUpdateExpense`
 * already use, or every other expense-list/balance/activity surface that
 * displays a restored expense goes stale for up to the app's real 30s
 * `staleTime` (`apps/web/src/app/providers.tsx`). Per this domain's own
 * memory (wholesale-mocked-hooks-file-needs-separate-invalidation-tests),
 * `expense-detail.test.tsx` mocks `@/lib/hooks` wholesale, so it can never
 * catch a missing invalidation call — this file imports the real, unmocked
 * hook (mocking only `./api`) with a production-matching `staleTime`.
 */

vi.mock('./api', () => ({
  api: {
    expenses: {
      restore: vi.fn(),
    },
  },
}));

// eslint-disable-next-line import/first -- must follow the vi.mock('./api', ...) call above
import { api } from './api';

const mePublic: PublicUserDto = { id: 'me', name: 'Me', avatarColor: '#111111' };

function makeGroupExpense(overrides: Partial<ExpenseDto> = {}): ExpenseDto {
  return {
    id: 'exp-1',
    groupId: 'group-1',
    group: { id: 'group-1', name: 'Roommates', emoji: '🏠', currency: 'PKR' },
    description: 'Movie night',
    amount: 1600,
    currency: 'PKR',
    category: 'ENTERTAINMENT',
    date: '2026-07-01T00:00:00.000Z',
    splitType: 'EQUAL',
    notes: null,
    receiptUrl: null,
    payers: [{ user: mePublic, amount: 1600 }],
    splits: [{ user: mePublic, amount: 1600, shares: null, percentBps: null, adjustment: null }],
    items: [],
    createdBy: mePublic,
    updatedBy: null,
    commentCount: 0,
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('WI-054b — useRestoreExpense invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Mirrors the real app's global staleTime (apps/web/src/app/providers.tsx:36), not RTL's usual staleTime: 0. */
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

  it('onSuccess invalidates the expense-list, group, group-balances and activity caches (the surfaces the restored expense re-enters)', async () => {
    const queryClient = makeClient();
    queryClient.setQueryData(queryKeys.expenses({ groupId: 'group-1' }), { items: [] });
    queryClient.setQueryData(queryKeys.groupBalances('group-1'), {});
    queryClient.setQueryData(queryKeys.activity('group-1'), []);
    vi.mocked(api.expenses.restore).mockResolvedValue(makeGroupExpense());

    const { result } = renderHook(() => useRestoreExpense(), { wrapper: wrapperFor(queryClient) });

    await act(async () => {
      result.current.mutate({ expenseId: 'exp-1', groupId: 'group-1' });
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryState(queryKeys.expenses({ groupId: 'group-1' }))?.isInvalidated,
      ).toBe(true);
      expect(queryClient.getQueryState(queryKeys.groupBalances('group-1'))?.isInvalidated).toBe(
        true,
      );
      expect(queryClient.getQueryState(queryKeys.activity('group-1'))?.isInvalidated).toBe(true);
    });
  });

  it('onSuccess invalidates the restored expense\'s own detail cache', async () => {
    const queryClient = makeClient();
    queryClient.setQueryData(queryKeys.expense('exp-1'), makeGroupExpense({ deletedAt: '2026-07-18T00:00:00.000Z' }));
    vi.mocked(api.expenses.restore).mockResolvedValue(makeGroupExpense());

    const { result } = renderHook(() => useRestoreExpense(), { wrapper: wrapperFor(queryClient) });

    await act(async () => {
      result.current.mutate({ expenseId: 'exp-1', groupId: 'group-1' });
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.expense('exp-1'))?.isInvalidated).toBe(true);
    });
  });

  it('falls back to the returned DTO\'s own groupId when the mutation variables omit one', async () => {
    const queryClient = makeClient();
    queryClient.setQueryData(queryKeys.groupBalances('group-2'), {});
    vi.mocked(api.expenses.restore).mockResolvedValue(makeGroupExpense({ groupId: 'group-2' }));

    const { result } = renderHook(() => useRestoreExpense(), { wrapper: wrapperFor(queryClient) });

    await act(async () => {
      result.current.mutate({ expenseId: 'exp-1' });
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.groupBalances('group-2'))?.isInvalidated).toBe(
        true,
      );
    });
  });

  it('calls api.expenses.restore with the given expenseId', async () => {
    const queryClient = makeClient();
    vi.mocked(api.expenses.restore).mockResolvedValue(makeGroupExpense());

    const { result } = renderHook(() => useRestoreExpense(), { wrapper: wrapperFor(queryClient) });

    await act(async () => {
      result.current.mutate({ expenseId: 'exp-1', groupId: 'group-1' });
    });

    await waitFor(() => {
      expect(api.expenses.restore).toHaveBeenCalledWith('exp-1');
    });
  });
});
