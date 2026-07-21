import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PublicUserDto, SettlementDto } from '@divzy/shared';
import {
  invalidateForExpenseChange,
  queryKeys,
  useDeleteSettlement,
  useSettlement,
} from './hooks';

/**
 * WI-039b — the `SettlementDetailDialog`'s data-fetch plumbing:
 * - a new `['settlement', id]` query key (mirroring `queryKeys.expense`),
 * - a `useSettlement(id, enabled)` hook fetching via `api.settlements.get`,
 * - `invalidateForExpenseChange` also invalidates `['settlement']` so a
 *   delete (via `useDeleteSettlement`, which already calls this helper)
 *   refetches an open detail dialog into its deleted state instead of
 *   leaving it stale (spec-WI-039b §3).
 */

vi.mock('./api', () => ({
  api: {
    settlements: {
      get: vi.fn(),
      remove: vi.fn(),
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
    groupId: null,
    group: null,
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

describe('WI-039b — queryKeys.settlement', () => {
  it('produces a ["settlement", id] key, mirroring queryKeys.expense', () => {
    expect(queryKeys.settlement('settle-1')).toEqual(['settlement', 'settle-1']);
  });
});

describe('WI-039b regression — invalidateForExpenseChange invalidates ["settlement"]', () => {
  it('calls invalidateQueries with the bare ["settlement"] prefix key', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateForExpenseChange(queryClient, null);

    expect(spy).toHaveBeenCalledWith({ queryKey: ['settlement'] });
  });
});

describe('WI-039b — useSettlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function wrapperFor(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
  }

  it('fetches via api.settlements.get and is keyed by queryKeys.settlement(id) when enabled', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const settlement = makeSettlement();
    vi.mocked(api.settlements.get).mockResolvedValue(settlement);

    const { result } = renderHook(() => useSettlement('settle-1', true), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => expect(result.current.data).toEqual(settlement));

    expect(api.settlements.get).toHaveBeenCalledWith('settle-1');
    expect(queryClient.getQueryData(queryKeys.settlement('settle-1'))).toEqual(settlement);
  });

  it('does not fetch when disabled (open=false)', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderHook(() => useSettlement('settle-1', false), {
      wrapper: wrapperFor(queryClient),
    });

    expect(api.settlements.get).not.toHaveBeenCalled();
  });
});

describe('WI-039b regression — useDeleteSettlement refetches an open detail dialog after delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function wrapperFor(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
  }

  /** Mirrors the real app's global staleTime (apps/web/src/app/providers.tsx). */
  function makeClient(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
  }

  it('onSuccess invalidates the settlement detail cache so a deleted settlement refetches', async () => {
    const queryClient = makeClient();
    queryClient.setQueryData(queryKeys.settlement('settle-1'), makeSettlement());
    vi.mocked(api.settlements.remove).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useDeleteSettlement(), { wrapper: wrapperFor(queryClient) });

    await act(async () => {
      result.current.mutate({ settlementId: 'settle-1', groupId: null });
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.settlement('settle-1'))?.isInvalidated).toBe(
        true,
      );
    });
  });
});
