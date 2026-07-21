import { describe, expect, it, vi, beforeEach } from 'vitest';

// WI-063 (web-only spec) widened the shared api-client's
// `expenses.usedCategories` signature from `(groupId: string)` to a scope
// object `{ groupId: string } | { friendId: string }`. Mobile's own
// `useUsedCategories(groupId)` hook (apps/mobile/src/lib/hooks.ts) got a
// one-line mechanical compile-fix to call
// `api.expenses.usedCategories({ groupId: groupId! })` instead of the old
// `api.expenses.usedCategories(groupId)`.
//
// This is exactly the kind of change `pnpm typecheck` alone would NOT catch
// a wrong-key mistake for: `{ friendId: groupId! }` also satisfies the
// `{ groupId } | { friendId }` union type, so a copy-paste slip (passing the
// group id under the wrong key) would compile cleanly and only fail at
// runtime (querying the wrong scope, or — worse — silently succeeding
// against a same-shaped-but-wrong-semantics friend query). No existing
// mobile test exercised this call shape (categoryPickerNarrowing.test.ts is
// pure-logic and never touches the hook; wi032-used-categories-invalidation.test.ts
// only covers `invalidateForExpenseChange`, a separate function). This test
// closes that gap per the test-stage brief's point 3.
//
// Technique: mock `@tanstack/react-query`'s `useQuery` to capture the config
// object (queryFn/enabled), so `useUsedCategories` can be called as a plain
// function without a React/RN render harness (see agent-memory
// feedback_hooks-testable-via-vi-mock.md, same technique as
// wi054b-restore-expense.test.ts).

const usedCategoriesMock = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    expenses: {
      usedCategories: (...args: unknown[]) => usedCategoriesMock(...args),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ status: 'authed' }),
}));

let capturedConfig: { queryFn: () => unknown; enabled: boolean } | undefined;

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: (config: typeof capturedConfig) => {
      capturedConfig = config;
      return { data: undefined, isLoading: true, isError: false };
    },
  };
});

beforeEach(() => {
  usedCategoriesMock.mockReset();
  capturedConfig = undefined;
});

describe('useUsedCategories mobile compile-fix (WI-063) — scope-object call shape', () => {
  it('calls api.expenses.usedCategories({ groupId }) — not { friendId } — for the given groupId', async () => {
    const { useUsedCategories } = await import('@/lib/hooks');
    usedCategoriesMock.mockResolvedValue({ categories: ['FOOD_DRINK'] });

    useUsedCategories('group-1');
    await capturedConfig!.queryFn();

    expect(usedCategoriesMock).toHaveBeenCalledTimes(1);
    expect(usedCategoriesMock).toHaveBeenCalledWith({ groupId: 'group-1' });
    // Explicitly not the friendId shape — the union type would compile
    // either way, so this is the load-bearing runtime assertion.
    expect(usedCategoriesMock).not.toHaveBeenCalledWith({ friendId: 'group-1' });
  });

  it('is disabled (enabled: false) when groupId is undefined, matching pre-WI-063 non-group behavior', async () => {
    const { useUsedCategories } = await import('@/lib/hooks');

    useUsedCategories(undefined);

    expect(capturedConfig!.enabled).toBe(false);
  });
});
