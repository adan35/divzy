// Test-stage white-box coverage — apps/mobile/src/lib/convertedBalance.ts.
//
// Code-aware cases targeting collectUnresolvedCurrencies' dedupe-by-first-
// occurrence branch and its "settled members contribute nothing" branch —
// the WI-002 mobile trigger signal feeding the group Balances tab's
// manual-rate prompt.
import { describe, expect, it } from 'vitest';
import { collectUnresolvedCurrencies } from './convertedBalance';
import type { GroupBalancesDto } from '@divzy/shared';

function member(
  id: string,
  convertedNet?: { amount: number; unresolved: { currency: string; amount: number }[] },
): GroupBalancesDto['members'][number] {
  return {
    user: { id, name: id, avatarColor: '#000' },
    balances: convertedNet ? [{ currency: 'x', amount: 1 }] : [],
    ...(convertedNet ? { convertedNet } : {}),
  } as GroupBalancesDto['members'][number];
}

describe('WB — collectUnresolvedCurrencies dedupe branch', () => {
  it('keeps only the first occurrence when two members share an unresolved currency', () => {
    const members = [
      member('m1', { amount: 0, unresolved: [{ currency: 'AUD', amount: 500 }] }),
      member('m2', { amount: 0, unresolved: [{ currency: 'AUD', amount: 9999 }] }),
    ];
    expect(collectUnresolvedCurrencies(members)).toEqual([{ currency: 'AUD', amount: 500 }]);
  });

  it('a settled member (no convertedNet field at all) contributes nothing', () => {
    const members = [
      member('m1'), // settled — balances: [], no convertedNet key
      member('m2', { amount: 0, unresolved: [{ currency: 'NZD', amount: 200 }] }),
    ];
    expect(collectUnresolvedCurrencies(members)).toEqual([{ currency: 'NZD', amount: 200 }]);
  });

  it('returns an empty array when every member is fully converted or settled', () => {
    const members = [member('m1'), member('m2', { amount: 100, unresolved: [] })];
    expect(collectUnresolvedCurrencies(members)).toEqual([]);
  });
});
