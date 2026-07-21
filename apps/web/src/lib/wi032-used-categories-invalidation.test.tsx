import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ExpenseDto, PublicUserDto } from '@divzy/shared';
import {
  invalidateForExpenseChange,
  queryKeys,
  useCreateExpense,
  useDeleteExpense,
  useUpdateExpense,
} from './hooks';

/**
 * Regression test for defect-WI-032-D1: `invalidateForExpenseChange` must
 * invalidate the `usedCategories` cache so the narrowed category picker
 * (WI-032) doesn't stay stale for up to 30s (the real app's global
 * `staleTime`, `apps/web/src/app/providers.tsx`) after a mutation that
 * changes which categories are "used" in a group.
 *
 * WI-063 (D6) widened this to an *unconditional* broad-prefix invalidation
 * (`['usedCategories']`) that fires on every expense change, not only when
 * `groupId` is present — covering the newly-added friend-scoped cache
 * entries too. See `wi063-friend-scoped-used-categories.test.tsx` for the
 * friend-scope-specific coverage; this file keeps the original group-scope
 * regression coverage, updated for the scope-object `queryKeys.usedCategories`
 * signature.
 *
 * A plain "reopen the editor and see it refetch" RTL test does NOT catch
 * this bug class: `expense-editor.test.tsx`'s WI-032 block mocks `@/lib/hooks`
 * entirely, and this repo's other RTL conventions build a fresh per-test
 * `QueryClient` that defaults `staleTime` to 0 — every query looks
 * "refetchable" on remount regardless of whether it was ever actually
 * invalidated, silently masking a missing invalidation call. These tests
 * instead assert the invalidation itself: directly via an
 * `invalidateQueries` spy, and via real cache state
 * (`getQueryState(...).isInvalidated`) after each real mutation hook's real
 * `onSuccess`, using a `staleTime` that matches production so a missing
 * invalidation call would leave the seeded cache entry valid/fresh.
 */

vi.mock('./api', () => ({
  api: {
    expenses: {
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      usedCategories: vi.fn(),
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

describe('WI-032-D1 / WI-063-D6 regression — invalidateForExpenseChange', () => {
  it('invalidates the broad usedCategories prefix for a group expense', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateForExpenseChange(queryClient, 'group-1');

    expect(spy).toHaveBeenCalledWith({ queryKey: ['usedCategories'] });
  });

  it('WI-063: still invalidates the broad usedCategories prefix for a non-group expense (no groupId) — D6 unconditional', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateForExpenseChange(queryClient, undefined);

    expect(spy).toHaveBeenCalledWith({ queryKey: ['usedCategories'] });
  });
});

describe('WI-032-D1 regression — real mutation hooks refresh the used-categories cache', () => {
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

  function seedUsedCategories(queryClient: QueryClient, groupId: string) {
    queryClient.setQueryData(queryKeys.usedCategories({ groupId }), { categories: ['GROCERIES'] });
  }

  it('useCreateExpense onSuccess invalidates the created expense\'s group usedCategories cache', async () => {
    const queryClient = makeClient();
    seedUsedCategories(queryClient, 'group-1');
    vi.mocked(api.expenses.create).mockResolvedValue(makeGroupExpense());

    const { result } = renderHook(() => useCreateExpense(), { wrapper: wrapperFor(queryClient) });

    await act(async () => {
      result.current.mutate({} as never);
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryState(queryKeys.usedCategories({ groupId: 'group-1' }))?.isInvalidated,
      ).toBe(true);
    });
  });

  it('useUpdateExpense onSuccess invalidates the updated expense\'s group usedCategories cache', async () => {
    const queryClient = makeClient();
    seedUsedCategories(queryClient, 'group-1');
    vi.mocked(api.expenses.update).mockResolvedValue(makeGroupExpense());

    const { result } = renderHook(() => useUpdateExpense(), { wrapper: wrapperFor(queryClient) });

    await act(async () => {
      result.current.mutate({ expenseId: 'exp-1', input: {} as never });
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryState(queryKeys.usedCategories({ groupId: 'group-1' }))?.isInvalidated,
      ).toBe(true);
    });
  });

  it('useDeleteExpense onSuccess invalidates the deleted expense\'s group usedCategories cache', async () => {
    const queryClient = makeClient();
    seedUsedCategories(queryClient, 'group-1');
    vi.mocked(api.expenses.remove).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useDeleteExpense(), { wrapper: wrapperFor(queryClient) });

    await act(async () => {
      result.current.mutate({ expenseId: 'exp-1', groupId: 'group-1' });
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryState(queryKeys.usedCategories({ groupId: 'group-1' }))?.isInvalidated,
      ).toBe(true);
    });
  });
});
