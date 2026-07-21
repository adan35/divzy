import { describe, expect, it } from 'vitest';
import { matchesBalanceFilter, type BalanceFilter } from '../src/balance-filter';
import type { CurrencyAmount } from '../src/balances';

const empty: CurrencyAmount[] = [];
const youOweOnly: CurrencyAmount[] = [{ currency: 'USD', amount: -1000 }];
const owedYouOnly: CurrencyAmount[] = [{ currency: 'EUR', amount: 500 }];
const mixed: CurrencyAmount[] = [
  { currency: 'USD', amount: -1000 },
  { currency: 'EUR', amount: 500 },
];

describe('matchesBalanceFilter', () => {
  it('none matches everything, including a settled-up (empty) native list', () => {
    expect(matchesBalanceFilter(empty, 'none')).toBe(true);
    expect(matchesBalanceFilter(mixed, 'none')).toBe(true);
  });

  it('outstanding matches any nonempty native list, not an empty one', () => {
    expect(matchesBalanceFilter(empty, 'outstanding')).toBe(false);
    expect(matchesBalanceFilter(youOweOnly, 'outstanding')).toBe(true);
    expect(matchesBalanceFilter(owedYouOnly, 'outstanding')).toBe(true);
  });

  it('youOwe matches when some entry is negative', () => {
    expect(matchesBalanceFilter(youOweOnly, 'youOwe')).toBe(true);
    expect(matchesBalanceFilter(owedYouOnly, 'youOwe')).toBe(false);
    expect(matchesBalanceFilter(empty, 'youOwe')).toBe(false);
  });

  it('owedYou matches when some entry is positive', () => {
    expect(matchesBalanceFilter(owedYouOnly, 'owedYou')).toBe(true);
    expect(matchesBalanceFilter(youOweOnly, 'owedYou')).toBe(false);
    expect(matchesBalanceFilter(empty, 'owedYou')).toBe(false);
  });

  it('a mixed-currency (opposite-sign) native list matches BOTH youOwe and owedYou', () => {
    expect(matchesBalanceFilter(mixed, 'youOwe')).toBe(true);
    expect(matchesBalanceFilter(mixed, 'owedYou')).toBe(true);
    expect(matchesBalanceFilter(mixed, 'outstanding')).toBe(true);
  });

  it('exhaustively handles every BalanceFilter value', () => {
    const all: BalanceFilter[] = ['none', 'outstanding', 'youOwe', 'owedYou'];
    for (const f of all) {
      expect(() => matchesBalanceFilter(empty, f)).not.toThrow();
    }
  });
});
