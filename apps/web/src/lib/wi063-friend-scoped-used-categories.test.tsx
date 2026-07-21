import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ExpenseDto, PublicUserDto } from '@divzy/shared';
import { invalidateForExpenseChange, queryKeys, useCreateExpense, useUsedCategories } from './hooks';

/**
 * spec-WI-063: `GET /expenses/used-categories` gains a `friendId` scope
 * alternative to `groupId`. Covers §3.4 (`useUsedCategories` scope-object
 * signature, `queryKeys.usedCategories` scope-object key) and §3.5/D6 (the
 * friend-scope half of the unconditional `usedCategories` invalidation —
 * the group-scope half is covered by `wi032-used-categories-invalidation.test.tsx`).
 */

vi.mock('./api', () => ({
  api: {
    expenses: {
      create: vi.fn(),
      usedCategories: vi.fn(),
    },
  },
}));

// eslint-disable-next-line import/first -- must follow the vi.mock('./api', ...) call above
import { api } from './api';

const mePublic: PublicUserDto = { id: 'me', name: 'Me', avatarColor: '#111111' };
const friend: PublicUserDto = { id: 'friend-1', name: 'Ben', avatarColor: '#222222' };

function makeFriendExpense(overrides: Partial<ExpenseDto> = {}): ExpenseDto {
  return {
    id: 'exp-2',
    groupId: null,
    group: null,
    description: 'Coffee',
    amount: 800,
    currency: 'PKR',
    category: 'FOOD_DRINK',
    date: '2026-07-01T00:00:00.000Z',
    splitType: 'EQUAL',
    notes: null,
    receiptUrl: null,
    payers: [{ user: mePublic, amount: 800 }],
    splits: [
      { user: mePublic, amount: 400, shares: null, percentBps: null, adjustment: null },
      { user: friend, amount: 400, shares: null, percentBps: null, adjustment: null },
    ],
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

describe('WI-063 — queryKeys.usedCategories scope object', () => {
  it('produces distinct keys for group vs. friend scope', () => {
    expect(queryKeys.usedCategories({ groupId: 'group-1' })).not.toEqual(
      queryKeys.usedCategories({ friendId: 'group-1' }),
    );
  });

  it('produces the same key for the same friend scope regardless of an omitted groupId', () => {
    expect(queryKeys.usedCategories({ friendId: 'friend-1' })).toEqual(
      queryKeys.usedCategories({ groupId: undefined, friendId: 'friend-1' }),
    );
  });
});

describe('WI-063 — useUsedCategories accepts a { groupId?, friendId? } scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function wrapperFor(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
  }

  it('calls api.expenses.usedCategories({ friendId }) when scoped by friendId', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(api.expenses.usedCategories).mockResolvedValue({ categories: ['FOOD_DRINK'] });

    renderHook(() => useUsedCategories({ friendId: 'friend-1' }), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => {
      expect(api.expenses.usedCategories).toHaveBeenCalledWith({ friendId: 'friend-1' });
    });
  });

  it('calls api.expenses.usedCategories({ groupId }) when scoped by groupId', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(api.expenses.usedCategories).mockResolvedValue({ categories: ['GROCERIES'] });

    renderHook(() => useUsedCategories({ groupId: 'group-1' }), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => {
      expect(api.expenses.usedCategories).toHaveBeenCalledWith({ groupId: 'group-1' });
    });
  });

  it('is disabled (does not call the API) when neither groupId nor friendId is present', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderHook(() => useUsedCategories({}), { wrapper: wrapperFor(queryClient) });

    expect(api.expenses.usedCategories).not.toHaveBeenCalled();
  });
});

describe('WI-063-D6 regression — friend-scoped usedCategories cache is invalidated on a non-group mutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Mirrors the real app's global staleTime (apps/web/src/app/providers.tsx:36). */
  function makeClient(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
  }

  function wrapperFor(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
  }

  it('useCreateExpense onSuccess invalidates a friend-scoped usedCategories cache entry even though the created expense has no groupId', async () => {
    const queryClient = makeClient();
    queryClient.setQueryData(queryKeys.usedCategories({ friendId: 'friend-1' }), {
      categories: ['FOOD_DRINK'],
    });
    vi.mocked(api.expenses.create).mockResolvedValue(makeFriendExpense());

    const { result } = renderHook(() => useCreateExpense(), { wrapper: wrapperFor(queryClient) });

    await act(async () => {
      result.current.mutate({} as never);
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryState(queryKeys.usedCategories({ friendId: 'friend-1' }))
          ?.isInvalidated,
      ).toBe(true);
    });
  });

  it('invalidateForExpenseChange invalidates a friend-scoped usedCategories cache entry directly (broad prefix)', () => {
    const queryClient = makeClient();
    queryClient.setQueryData(queryKeys.usedCategories({ friendId: 'friend-1' }), {
      categories: ['FOOD_DRINK'],
    });

    invalidateForExpenseChange(queryClient, undefined);

    expect(
      queryClient.getQueryState(queryKeys.usedCategories({ friendId: 'friend-1' }))?.isInvalidated,
    ).toBe(true);
  });
});
