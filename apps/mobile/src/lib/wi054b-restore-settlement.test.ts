import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// WI-054b — mobile restore (undelete) mutation hook for settlements.
//
// `useRestoreSettlement` (like `useDeleteSettlement`/`useCreateSettlement`)
// is a real React hook, so it can't be exercised via `renderHook` — this
// repo has no RN component-test harness. Mirrors
// `wi054b-restore-expense.test.ts`'s technique exactly: mock
// '@tanstack/react-query' itself so `useMutation` just captures the config
// object it was given (mutationFn/onSuccess), and `useQueryClient` returns a
// real `QueryClient` we control. That lets us call `useRestoreSettlement()`
// as a plain function (no React render needed) and then invoke the captured
// `mutationFn`/`onSuccess` directly — proving (a) it calls
// `api.settlements.restore` with the settlementId, and (b) it wires into
// the same `invalidateForExpenseChange` fan-out `useDeleteSettlement` uses,
// PLUS the settlement's own detail key (`queryKeys.settlement(id)`) —
// load-bearing per spec §4.1 so an open settlement-detail screen refetches
// into the active state instead of showing dead/stale data.

const restoreMock = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    settlements: {
      restore: (...args: unknown[]) => restoreMock(...args),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ status: 'authed' }),
}));

let capturedConfig:
  | {
      mutationFn: (variables: { settlementId: string; groupId?: string | null }) => unknown;
      onSuccess: (
        settlement: { id: string; groupId?: string | null },
        variables: { settlementId: string; groupId?: string | null },
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

describe('useRestoreSettlement (WI-054b)', () => {
  it('mutationFn calls api.settlements.restore with the settlementId', async () => {
    const { useRestoreSettlement } = await import('@/lib/hooks');
    capturedQueryClient = new QueryClient();
    restoreMock.mockResolvedValue({ id: 'settle-1', groupId: null });

    useRestoreSettlement();
    await capturedConfig!.mutationFn({ settlementId: 'settle-1', groupId: null });

    expect(restoreMock).toHaveBeenCalledTimes(1);
    expect(restoreMock).toHaveBeenCalledWith('settle-1');
  });

  it('onSuccess wires into invalidateForExpenseChange (settlements/balance/friends/activity go stale)', async () => {
    const { useRestoreSettlement, queryKeys } = await import('@/lib/hooks');
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    capturedQueryClient = queryClient;

    const groupId = 'group-1';
    queryClient.setQueryData(queryKeys.settlements({}), { pages: [], pageParams: [] });
    queryClient.setQueryData(queryKeys.balance, {});
    queryClient.setQueryData(queryKeys.friends, []);
    queryClient.setQueryData(queryKeys.group(groupId), { id: groupId });
    queryClient.setQueryData(queryKeys.groupBalances(groupId), {});

    useRestoreSettlement();
    capturedConfig!.onSuccess({ id: 'settle-1', groupId }, { settlementId: 'settle-1', groupId });

    expect(queryClient.getQueryState(queryKeys.settlements({}))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.balance)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.friends)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.group(groupId))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.groupBalances(groupId))?.isInvalidated).toBe(true);
  });

  it("onSuccess also invalidates this settlement's own detail key (queryKeys.settlement(id)) — load-bearing for the open-detail-screen refetch", async () => {
    const { useRestoreSettlement, queryKeys } = await import('@/lib/hooks');
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    capturedQueryClient = queryClient;
    queryClient.setQueryData(queryKeys.settlement('settle-9'), { id: 'settle-9' });

    useRestoreSettlement();
    capturedConfig!.onSuccess(
      { id: 'settle-9', groupId: null },
      { settlementId: 'settle-9', groupId: null },
    );

    expect(queryClient.getQueryState(queryKeys.settlement('settle-9'))?.isInvalidated).toBe(true);
  });

  it('falls back to the returned settlement.groupId when variables.groupId is not supplied', async () => {
    const { useRestoreSettlement, queryKeys } = await import('@/lib/hooks');
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    capturedQueryClient = queryClient;
    const groupId = 'group-5';
    queryClient.setQueryData(queryKeys.group(groupId), { id: groupId });

    useRestoreSettlement();
    capturedConfig!.onSuccess({ id: 'settle-2', groupId }, { settlementId: 'settle-2' });

    expect(queryClient.getQueryState(queryKeys.group(groupId))?.isInvalidated).toBe(true);
  });
});
