import { describe, expect, it } from 'vitest';
import {
  computeNets,
  computePairwiseBalances,
  netsForUser,
  suggestSettlements,
  type LedgerExpense,
  type LedgerSettlement,
} from '../src/balances';

const A = 'user_a';
const B = 'user_b';
const C = 'user_c';

const dinner: LedgerExpense = {
  currency: 'USD',
  payers: [{ userId: A, amount: 3000 }],
  splits: [
    { userId: A, amount: 1000 },
    { userId: B, amount: 1000 },
    { userId: C, amount: 1000 },
  ],
};

describe('computeNets', () => {
  it('net = paid - owed', () => {
    const nets = computeNets([dinner], []);
    const usd = nets.get('USD')!;
    expect(usd.get(A)).toBe(2000);
    expect(usd.get(B)).toBe(-1000);
    expect(usd.get(C)).toBe(-1000);
  });

  it('is zero-sum per currency', () => {
    const expenses: LedgerExpense[] = [
      dinner,
      {
        currency: 'USD',
        payers: [
          { userId: B, amount: 500 },
          { userId: C, amount: 700 },
        ],
        splits: [
          { userId: A, amount: 400 },
          { userId: B, amount: 400 },
          { userId: C, amount: 400 },
        ],
      },
      {
        currency: 'EUR',
        payers: [{ userId: C, amount: 900 }],
        splits: [
          { userId: A, amount: 450 },
          { userId: B, amount: 450 },
        ],
      },
    ];
    const settlements: LedgerSettlement[] = [{ currency: 'USD', fromUserId: B, toUserId: A, amount: 300 }];
    const nets = computeNets(expenses, settlements);
    for (const [, perUser] of nets) {
      const sum = [...perUser.values()].reduce((a, b) => a + b, 0);
      expect(sum).toBe(0);
    }
  });

  it('settlements move nets toward zero', () => {
    const nets = computeNets([dinner], [{ currency: 'USD', fromUserId: B, toUserId: A, amount: 1000 }]);
    const usd = nets.get('USD')!;
    expect(usd.get(A)).toBe(1000);
    expect(usd.get(B)).toBe(0);
  });

  it('keeps currencies separate', () => {
    const nets = computeNets(
      [dinner, { currency: 'EUR', payers: [{ userId: B, amount: 200 }], splits: [{ userId: A, amount: 200 }] }],
      [],
    );
    expect(nets.get('USD')!.get(B)).toBe(-1000);
    expect(nets.get('EUR')!.get(B)).toBe(200);
  });
});

describe('computePairwiseBalances', () => {
  it('tracks exact who-owes-whom', () => {
    const pairwise = computePairwiseBalances([dinner], []);
    expect(pairwise).toEqual([
      { currency: 'USD', fromUserId: B, toUserId: A, amount: 1000 },
      { currency: 'USD', fromUserId: C, toUserId: A, amount: 1000 },
    ]);
  });

  it('a settlement pays down the pairwise debt', () => {
    const pairwise = computePairwiseBalances(
      [dinner],
      [{ currency: 'USD', fromUserId: B, toUserId: A, amount: 600 }],
    );
    expect(pairwise).toContainEqual({ currency: 'USD', fromUserId: B, toUserId: A, amount: 400 });
  });

  it('overpaying flips the direction', () => {
    const pairwise = computePairwiseBalances(
      [dinner],
      [{ currency: 'USD', fromUserId: B, toUserId: A, amount: 1500 }],
    );
    expect(pairwise).toContainEqual({ currency: 'USD', fromUserId: A, toUserId: B, amount: 500 });
  });

  it('nets opposing debts between the same pair', () => {
    const back: LedgerExpense = {
      currency: 'USD',
      payers: [{ userId: B, amount: 800 }],
      splits: [
        { userId: A, amount: 400 },
        { userId: B, amount: 400 },
      ],
    };
    const pairwise = computePairwiseBalances([dinner, back], []);
    // B owed A 1000, A owes B 400 -> B owes A 600
    expect(pairwise).toContainEqual({ currency: 'USD', fromUserId: B, toUserId: A, amount: 600 });
  });
});

describe('suggestSettlements', () => {
  it('suggestions settle all nets', () => {
    const expenses: LedgerExpense[] = [
      dinner,
      {
        currency: 'USD',
        payers: [{ userId: B, amount: 1200 }],
        splits: [
          { userId: A, amount: 400 },
          { userId: B, amount: 400 },
          { userId: C, amount: 400 },
        ],
      },
    ];
    const nets = computeNets(expenses, []);
    const suggestions = suggestSettlements(nets);
    const finals = new Map<string, number>();
    for (const [, perUser] of nets) for (const [u, v] of perUser) finals.set(u, (finals.get(u) ?? 0) + v);
    for (const s of suggestions) {
      finals.set(s.fromUserId, (finals.get(s.fromUserId) ?? 0) + s.amount);
      finals.set(s.toUserId, (finals.get(s.toUserId) ?? 0) - s.amount);
    }
    for (const v of finals.values()) expect(v).toBe(0);
  });

  it('suggests per currency independently', () => {
    const nets = computeNets(
      [
        dinner,
        { currency: 'EUR', payers: [{ userId: B, amount: 300 }], splits: [{ userId: C, amount: 300 }] },
      ],
      [],
    );
    const suggestions = suggestSettlements(nets);
    expect(suggestions.some((s) => s.currency === 'USD')).toBe(true);
    expect(suggestions.some((s) => s.currency === 'EUR')).toBe(true);
  });
});

describe('netsForUser', () => {
  it('lists non-zero currency positions', () => {
    const nets = computeNets(
      [dinner, { currency: 'EUR', payers: [{ userId: A, amount: 300 }], splits: [{ userId: B, amount: 300 }] }],
      [],
    );
    expect(netsForUser(nets, A)).toEqual([
      { currency: 'EUR', amount: 300 },
      { currency: 'USD', amount: 2000 },
    ]);
  });

  it('drops zeros', () => {
    const nets = computeNets([dinner], [{ currency: 'USD', fromUserId: B, toUserId: A, amount: 1000 }]);
    expect(netsForUser(nets, B)).toEqual([]);
  });
});

