import { describe, expect, it } from 'vitest';
import type { FriendDto } from '@divzy/shared';
import { applyFriendsFilter, friendsFilterEmptyMessage } from './friendsListFilter';

// Tests written from spec-WI-037 (Friends page balance-direction filter)
// before friendsListFilter.ts exists. Pins: filter runs over the NATIVE
// `balancesNative` field (never `balancesConverted`), and a mixed-currency
// friend matches BOTH `youOwe` and `owedYou` (the explicit mixed-currency AC).

function friend(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: { id: 'u1', name: 'Alex', avatarColor: '#000' },
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    balancesByGroup: [],
    lastActivityAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('applyFriendsFilter', () => {
  it('default "none" returns every friend', () => {
    const friends = [friend({ user: { id: 'a', name: 'A', avatarColor: '#000' } })];
    expect(applyFriendsFilter(friends, 'none')).toEqual(friends);
  });

  it('"outstanding" keeps only friends with a nonempty native balance', () => {
    const owes = friend({
      user: { id: 'a', name: 'A', avatarColor: '#000' },
      balancesNative: [{ currency: 'USD', amount: 500 }],
    });
    const settled = friend({ user: { id: 'b', name: 'B', avatarColor: '#000' } });
    expect(applyFriendsFilter([owes, settled], 'outstanding')).toEqual([owes]);
  });

  it('"youOwe" keeps only friends with a negative native amount', () => {
    const youOwe = friend({
      user: { id: 'a', name: 'A', avatarColor: '#000' },
      balancesNative: [{ currency: 'USD', amount: -500 }],
    });
    const owedYou = friend({
      user: { id: 'b', name: 'B', avatarColor: '#000' },
      balancesNative: [{ currency: 'USD', amount: 500 }],
    });
    expect(applyFriendsFilter([youOwe, owedYou], 'youOwe')).toEqual([youOwe]);
  });

  it('"owedYou" keeps only friends with a positive native amount', () => {
    const youOwe = friend({
      user: { id: 'a', name: 'A', avatarColor: '#000' },
      balancesNative: [{ currency: 'USD', amount: -500 }],
    });
    const owedYou = friend({
      user: { id: 'b', name: 'B', avatarColor: '#000' },
      balancesNative: [{ currency: 'USD', amount: 500 }],
    });
    expect(applyFriendsFilter([youOwe, owedYou], 'owedYou')).toEqual([owedYou]);
  });

  it('a mixed-currency friend appears under both youOwe and owedYou filters', () => {
    const mixed = friend({
      balancesNative: [
        { currency: 'USD', amount: -500 },
        { currency: 'EUR', amount: 300 },
      ],
    });
    expect(applyFriendsFilter([mixed], 'youOwe')).toEqual([mixed]);
    expect(applyFriendsFilter([mixed], 'owedYou')).toEqual([mixed]);
  });
});

describe('friendsFilterEmptyMessage', () => {
  it('gives a per-filter friendly message', () => {
    expect(friendsFilterEmptyMessage('youOwe')).toMatch(/owe/i);
    expect(friendsFilterEmptyMessage('owedYou')).toMatch(/owe/i);
    expect(friendsFilterEmptyMessage('outstanding')).toMatch(/outstanding/i);
    expect(friendsFilterEmptyMessage('none')).toBeTruthy();
  });
});
