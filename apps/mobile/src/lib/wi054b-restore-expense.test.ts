import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// WI-054b — mobile restore (undelete) mutation hook.
//
// `useRestoreExpense` (like `useDeleteExpense`/`useCreateExpense`/
// `useUpdateExpense`) is a real React hook, so it can't be exercised via
// `renderHook` — this repo has no RN component-test harness (see agent-memory
// feedback_no-rn-component-harness.md). Instead we mock '@tanstack/react-query'
// itself: `useMutation` is replaced with a stub that just captures the config
// object it was given (mutationFn/onSuccess), and `useQueryClient` returns a
// real `QueryClient` we control. That lets us call `useRestoreExpense()` as a
// plain function (no React render needed, since every React/RN-native import
// it touches is mocked) and then invoke the captured `mutationFn`/`onSuccess`
// directly — proving (a) it calls `api.expenses.restore` with the expenseId,
// and (b) it wires into the same `invalidateForExpenseChange` fan-out
// `useDeleteExpense` uses, so this repeats WI-032's "new hook not wired into
// invalidation" defect class does not ship again for restore.
//
// See agent-memory feedback_hooks-testable-via-vi-mock.md for the underlying
// "mock @/lib/api + @/lib/auth first, then import hooks.ts" technique this
// extends to also mock react-query's own hooks.

const restoreMock = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    expenses: {
      restore: (...args: unknown[]) => restoreMock(...args),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ status: 'authed' }),
}));

let capturedConfig:
  | {
      mutationFn: (variables: { expenseId: string; groupId?: string | null }) => unknown;
      onSuccess: (
        expense: { id: string; groupId?: string | null },
        variables: { expenseId: string; groupId?: string | null },
      ) => void;
    }
  | undefined;
let capturedQueryClient: QueryClient | undefined;

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useMutation: (config: typeof capturedConfig) => {
      capturedConfig = config;
      return { mutate: vi.fn(), isPending: false };
    },
    useQueryClient: () => capturedQueryClient,
  };
});

beforeEach(() => {
  restoreMock.mockReset();
  capturedConfig = undefined;
});

describe('useRestoreExpense (WI-054b)', () => {
  it('mutationFn calls api.expenses.restore with the expenseId', async () => {
    const { useRestoreExpense } = await import('@/lib/hooks');
    capturedQueryClient = new QueryClient();
    restoreMock.mockResolvedValue({ id: 'exp-1', groupId: null });

    useRestoreExpense();
    await capturedConfig!.mutationFn({ expenseId: 'exp-1', groupId: null });

    expect(restoreMock).toHaveBeenCalledTimes(1);
    expect(restoreMock).toHaveBeenCalledWith('exp-1');
  });

  it('onSuccess wires into invalidateForExpenseChange (expenses/balance/friends/activity/analytics/group-balances go stale)', async () => {
    const { useRestoreExpense, queryKeys } = await import('@/lib/hooks');
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    capturedQueryClient = queryClient;

    const groupId = 'group-1';
    queryClient.setQueryData(queryKeys.expenses({}), { items: [] });
    queryClient.setQueryData(queryKeys.balance, {});
    queryClient.setQueryData(queryKeys.friends, []);
    queryClient.setQueryData(queryKeys.group(groupId), { id: groupId });
    queryClient.setQueryData(queryKeys.groupBalances(groupId), {});
    queryClient.setQueryData(queryKeys.usedCategories(groupId), { categories: [] });

    useRestoreExpense();
    capturedConfig!.onSuccess(
      { id: 'exp-1', groupId },
      { expenseId: 'exp-1', groupId },
    );

    expect(queryClient.getQueryState(queryKeys.expenses({}))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.balance)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.friends)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.group(groupId))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.groupBalances(groupId))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.usedCategories(groupId))?.isInvalidated).toBe(true);
  });

  it("onSuccess also invalidates this expense's own detail key (queryKeys.expense(id))", async () => {
    const { useRestoreExpense, queryKeys } = await import('@/lib/hooks');
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    capturedQueryClient = queryClient;
    queryClient.setQueryData(queryKeys.expense('exp-9'), { id: 'exp-9' });

    useRestoreExpense();
    capturedConfig!.onSuccess({ id: 'exp-9', groupId: null }, { expenseId: 'exp-9', groupId: null });

    expect(queryClient.getQueryState(queryKeys.expense('exp-9'))?.isInvalidated).toBe(true);
  });

  it('falls back to the returned expense.groupId when variables.groupId is not supplied (non-group restore of a group expense)', async () => {
    const { useRestoreExpense, queryKeys } = await import('@/lib/hooks');
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    capturedQueryClient = queryClient;
    const groupId = 'group-5';
    queryClient.setQueryData(queryKeys.group(groupId), { id: groupId });

    useRestoreExpense();
    capturedConfig!.onSuccess({ id: 'exp-2', groupId }, { expenseId: 'exp-2' });

    expect(queryClient.getQueryState(queryKeys.group(groupId))?.isInvalidated).toBe(true);
  });
});
