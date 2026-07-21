import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUsedCategories } from './hooks';

/**
 * spec-WI-064 §3.4: `useUsedCategories` gains an explicit `unscoped` opt-in
 * so the previously-excluded "All expenses" mount can also narrow its pill
 * row, while the editor's non-group case (which passes no `options`) stays
 * disabled and keeps showing all categories.
 */

vi.mock('./api', () => ({
  api: {
    expenses: {
      usedCategories: vi.fn(),
    },
  },
}));

// eslint-disable-next-line import/first -- must follow the vi.mock('./api', ...) call above
import { api } from './api';

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('WI-064 — useUsedCategories({ unscoped: true }) opt-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when neither groupId nor friendId is present and no options are passed (default, unchanged editor behaviour)', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderHook(() => useUsedCategories({}), { wrapper: wrapperFor(queryClient) });

    expect(api.expenses.usedCategories).not.toHaveBeenCalled();
  });

  it('is enabled and calls api.expenses.usedCategories({}) when scope is empty but unscoped: true is passed', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(api.expenses.usedCategories).mockResolvedValue({ categories: ['FOOD_DRINK'] });

    renderHook(() => useUsedCategories({}, { unscoped: true }), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => {
      expect(api.expenses.usedCategories).toHaveBeenCalledWith({});
    });
  });

  it('unscoped: true is ignored when a groupId is present — still scoped by groupId', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(api.expenses.usedCategories).mockResolvedValue({ categories: ['GROCERIES'] });

    renderHook(() => useUsedCategories({ groupId: 'group-1' }, { unscoped: true }), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => {
      expect(api.expenses.usedCategories).toHaveBeenCalledWith({ groupId: 'group-1' });
    });
  });
});
