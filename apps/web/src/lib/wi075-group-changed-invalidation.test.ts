import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateForGroupChangedEvent, queryKeys } from './hooks';

/**
 * Regression test for WI-075: the `group:changed` socket event carries a
 * `kind` (`'expense' | 'settlement' | 'member' | 'group'`) that the client
 * previously discarded, always running the broad expense/settlement
 * invalidator regardless of what actually changed. That meant a teammate
 * renaming a group, or joining/leaving one, triggered a full-app refetch
 * (expenses, settlements, balances, friends, activity, analytics) for every
 * other online member — this asserts `kind` now gates which invalidator runs.
 */
describe('invalidateForGroupChangedEvent (WI-075)', () => {
  it('routes expense/settlement kinds through the broad invalidator', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateForGroupChangedEvent(queryClient, { groupId: 'group-1', kind: 'expense' });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.friends });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['analytics'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['activity'] });

    spy.mockClear();
    invalidateForGroupChangedEvent(queryClient, { groupId: 'group-1', kind: 'settlement' });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.friends });
  });

  it('routes member/group kinds through the narrow invalidator only', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateForGroupChangedEvent(queryClient, { groupId: 'group-1', kind: 'member' });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.groups });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.group('group-1') });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.groupBalances('group-1') });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: queryKeys.friends });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['analytics'] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['activity'] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['expenses'] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['settlements'] });

    spy.mockClear();
    invalidateForGroupChangedEvent(queryClient, { groupId: 'group-1', kind: 'group' });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.groups });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: queryKeys.friends });
  });
});
