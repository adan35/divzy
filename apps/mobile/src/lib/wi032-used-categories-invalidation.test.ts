import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

// Mock the RN-native-backed modules hooks.ts transitively imports
// (expo-secure-store via @/lib/api) so the module graph can be collected by
// vitest's plain-node environment — see apps/mobile agent-memory
// feedback_pure-module-must-not-import-lib-hooks.md. `invalidateForExpenseChange`
// itself never calls anything from these mocks; only the module's top-level
// imports need to resolve.
vi.mock('@/lib/api', () => ({
  api: { expenses: { usedCategories: vi.fn() } },
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ status: 'authed' }),
}));

// Tests written from spec-WI-032-3 §1 D3 / §5 ("Invalidation regression, the
// load-bearing one") before the `queryKeys.usedCategories(groupId)`
// invalidation line existed in `invalidateForExpenseChange` — mirrors web's
// wi032-used-categories-invalidation.test.tsx (ported defect-WI-032-D1 fix).

describe('invalidateForExpenseChange — usedCategories (WI-032-3 / ported defect-WI-032-D1)', () => {
  it('invalidates queryKeys.usedCategories(groupId) when a groupId is given', async () => {
    const { invalidateForExpenseChange, queryKeys } = await import('@/lib/hooks');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000 } },
    });
    const groupId = 'group-1';
    queryClient.setQueryData(queryKeys.usedCategories(groupId), { categories: ['FOOD_DRINK'] });

    invalidateForExpenseChange(queryClient, groupId);

    expect(queryClient.getQueryState(queryKeys.usedCategories(groupId))?.isInvalidated).toBe(
      true,
    );
  });

  it('does not touch any usedCategories key for a non-group expense (no groupId)', async () => {
    const { invalidateForExpenseChange, queryKeys } = await import('@/lib/hooks');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000 } },
    });
    const groupId = 'group-1';
    queryClient.setQueryData(queryKeys.usedCategories(groupId), { categories: ['FOOD_DRINK'] });

    invalidateForExpenseChange(queryClient, undefined);

    expect(queryClient.getQueryState(queryKeys.usedCategories(groupId))?.isInvalidated).toBe(
      false,
    );
  });
});
