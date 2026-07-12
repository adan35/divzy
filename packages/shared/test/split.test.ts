import { describe, expect, it } from 'vitest';
import { computePairwiseDebts, computeSplits, SplitError } from '../src/split';

const A = 'user_aaaaaaaa';
const B = 'user_bbbbbbbb';
const C = 'user_cccccccc';

function total(splits: Array<{ amount: number }>) {
  return splits.reduce((acc, s) => acc + s.amount, 0);
}

describe('computeSplits EQUAL', () => {
  it('splits evenly', () => {
    const splits = computeSplits({
      splitType: 'EQUAL',
      amount: 3000,
      participants: [{ userId: A }, { userId: B }, { userId: C }],
    });
    expect(splits).toEqual([
      { userId: A, amount: 1000 },
      { userId: B, amount: 1000 },
      { userId: C, amount: 1000 },
    ]);
  });

  it('handles indivisible totals exactly', () => {
    const splits = computeSplits({
      splitType: 'EQUAL',
      amount: 100,
      participants: [{ userId: A }, { userId: B }, { userId: C }],
    });
    expect(total(splits)).toBe(100);
    expect(splits.map((s) => s.amount).sort()).toEqual([33, 33, 34]);
  });
});

describe('computeSplits EXACT', () => {
  it('uses given amounts', () => {
    const splits = computeSplits({
      splitType: 'EXACT',
      amount: 500,
      participants: [
        { userId: A, amount: 100 },
        { userId: B, amount: 400 },
      ],
    });
    expect(total(splits)).toBe(500);
  });

  it('rejects sum mismatch', () => {
    expect(() =>
      computeSplits({
        splitType: 'EXACT',
        amount: 500,
        participants: [
          { userId: A, amount: 100 },
          { userId: B, amount: 100 },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'EXACT_SUM_MISMATCH' }));
  });

  it('rejects missing amounts', () => {
    expect(() =>
      computeSplits({ splitType: 'EXACT', amount: 500, participants: [{ userId: A }] }),
    ).toThrowError(expect.objectContaining({ code: 'EXACT_AMOUNT_REQUIRED' }));
  });
});

describe('computeSplits PERCENT', () => {
  it('allocates by basis points, exactly', () => {
    const splits = computeSplits({
      splitType: 'PERCENT',
      amount: 1000,
      participants: [
        { userId: A, percentBps: 3333 },
        { userId: B, percentBps: 3333 },
        { userId: C, percentBps: 3334 },
      ],
    });
    expect(total(splits)).toBe(1000);
  });

  it('rejects percentages that do not total 100%', () => {
    expect(() =>
      computeSplits({
        splitType: 'PERCENT',
        amount: 1000,
        participants: [
          { userId: A, percentBps: 5000 },
          { userId: B, percentBps: 4000 },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'PERCENT_SUM_MISMATCH' }));
  });
});

describe('computeSplits SHARES', () => {
  it('allocates by shares', () => {
    const splits = computeSplits({
      splitType: 'SHARES',
      amount: 900,
      participants: [
        { userId: A, shares: 2 },
        { userId: B, shares: 1 },
      ],
    });
    expect(splits).toEqual([
      { userId: A, amount: 600 },
      { userId: B, amount: 300 },
    ]);
  });

  it('allows zero-share participants', () => {
    const splits = computeSplits({
      splitType: 'SHARES',
      amount: 900,
      participants: [
        { userId: A, shares: 3 },
        { userId: B, shares: 0 },
      ],
    });
    expect(splits[1]!.amount).toBe(0);
    expect(total(splits)).toBe(900);
  });

  it('rejects all-zero shares', () => {
    expect(() =>
      computeSplits({
        splitType: 'SHARES',
        amount: 900,
        participants: [
          { userId: A, shares: 0 },
          { userId: B, shares: 0 },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'SHARES_SUM_ZERO' }));
  });
});

describe('computeSplits ADJUSTMENT', () => {
  it('applies adjustments on top of an equal base', () => {
    // 1000 total, A pays 200 extra => base 800 split equally (400/400), A owes 600, B owes 400
    const splits = computeSplits({
      splitType: 'ADJUSTMENT',
      amount: 1000,
      participants: [
        { userId: A, adjustment: 200 },
        { userId: B },
      ],
    });
    expect(splits).toEqual([
      { userId: A, amount: 600 },
      { userId: B, amount: 400 },
    ]);
  });

  it('supports negative adjustments', () => {
    const splits = computeSplits({
      splitType: 'ADJUSTMENT',
      amount: 1000,
      participants: [
        { userId: A, adjustment: -100 },
        { userId: B },
      ],
    });
    expect(total(splits)).toBe(1000);
    expect(splits[0]!.amount).toBe(450);
    expect(splits[1]!.amount).toBe(550);
  });

  it('rejects adjustments that exceed the total', () => {
    expect(() =>
      computeSplits({
        splitType: 'ADJUSTMENT',
        amount: 100,
        participants: [
          { userId: A, adjustment: 200 },
          { userId: B },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'ADJUSTMENT_EXCEEDS_TOTAL' }));
  });

  it('rejects negative resulting shares', () => {
    // base = 100 - (-500) = 600 -> 300 each; A owes 300 - 500 = -200 -> invalid
    expect(() =>
      computeSplits({
        splitType: 'ADJUSTMENT',
        amount: 100,
        participants: [
          { userId: A, adjustment: -500 },
          { userId: B },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'NEGATIVE_SHARE' }));
  });
});

describe('computeSplits ITEMIZED', () => {
  it('splits items among their participants and fees proportionally', () => {
    // items: 600 (A+B), 300 (A). fee = 100. subtotals: A=600, B=300.
    // fee split by subtotal: A ~67, B ~33.
    const splits = computeSplits({
      splitType: 'ITEMIZED',
      amount: 1000,
      participants: [{ userId: A }, { userId: B }],
      items: [
        { name: 'Pasta', amount: 600, participantIds: [A, B] },
        { name: 'Wine', amount: 300, participantIds: [A] },
      ],
    });
    expect(total(splits)).toBe(1000);
    expect(splits[0]!.amount).toBeGreaterThan(splits[1]!.amount);
    expect(splits[0]!.amount + splits[1]!.amount).toBe(1000);
  });

  it('rejects items exceeding the total', () => {
    expect(() =>
      computeSplits({
        splitType: 'ITEMIZED',
        amount: 100,
        participants: [{ userId: A }],
        items: [{ name: 'X', amount: 200, participantIds: [A] }],
      }),
    ).toThrowError(expect.objectContaining({ code: 'ITEMS_EXCEED_TOTAL' }));
  });

  it('rejects unknown item participants', () => {
    expect(() =>
      computeSplits({
        splitType: 'ITEMIZED',
        amount: 100,
        participants: [{ userId: A }],
        items: [{ name: 'X', amount: 100, participantIds: [B] }],
      }),
    ).toThrowError(expect.objectContaining({ code: 'ITEM_PARTICIPANT_UNKNOWN' }));
  });

  it('requires items', () => {
    expect(() =>
      computeSplits({ splitType: 'ITEMIZED', amount: 100, participants: [{ userId: A }] }),
    ).toThrowError(expect.objectContaining({ code: 'ITEMS_REQUIRED' }));
  });
});

describe('computeSplits shared validation', () => {
  it('rejects empty participants', () => {
    expect(() => computeSplits({ splitType: 'EQUAL', amount: 100, participants: [] })).toThrow(
      SplitError,
    );
  });
  it('rejects duplicates', () => {
    expect(() =>
      computeSplits({ splitType: 'EQUAL', amount: 100, participants: [{ userId: A }, { userId: A }] }),
    ).toThrowError(expect.objectContaining({ code: 'DUPLICATE_PARTICIPANT' }));
  });
  it('rejects non-positive amounts', () => {
    expect(() => computeSplits({ splitType: 'EQUAL', amount: 0, participants: [{ userId: A }] })).toThrow(
      SplitError,
    );
    expect(() => computeSplits({ splitType: 'EQUAL', amount: -5, participants: [{ userId: A }] })).toThrow(
      SplitError,
    );
  });
});

describe('computePairwiseDebts', () => {
  it('single payer: everyone owes the payer their share', () => {
    const debts = computePairwiseDebts(
      [{ userId: A, amount: 300 }],
      [
        { userId: A, amount: 100 },
        { userId: B, amount: 100 },
        { userId: C, amount: 100 },
      ],
    );
    expect(debts).toEqual([
      { fromUserId: B, toUserId: A, amount: 100 },
      { fromUserId: C, toUserId: A, amount: 100 },
    ]);
  });

  it('multi payer: shares are split across payers proportionally', () => {
    const debts = computePairwiseDebts(
      [
        { userId: A, amount: 200 },
        { userId: B, amount: 100 },
      ],
      [
        { userId: A, amount: 100 },
        { userId: B, amount: 100 },
        { userId: C, amount: 100 },
      ],
    );
    // C owes A ~67 and B ~33; A owes B ~33 for A's own share portion covered by B, etc.
    const totalDebt = debts.reduce((acc, d) => acc + d.amount, 0);
    // total owed to payers = shares of non-self coverage; sanity: every entry positive, no self-debt
    expect(debts.every((d) => d.amount > 0 && d.fromUserId !== d.toUserId)).toBe(true);
    const cOwes = debts.filter((d) => d.fromUserId === C).reduce((a, d) => a + d.amount, 0);
    expect(cOwes).toBe(100);
    expect(totalDebt).toBeGreaterThan(0);
  });

  it('payer with a split owes nothing to themself', () => {
    const debts = computePairwiseDebts(
      [{ userId: A, amount: 200 }],
      [
        { userId: A, amount: 100 },
        { userId: B, amount: 100 },
      ],
    );
    expect(debts).toEqual([{ fromUserId: B, toUserId: A, amount: 100 }]);
  });

  it('returns empty when there are no payers', () => {
    expect(computePairwiseDebts([], [{ userId: A, amount: 100 }])).toEqual([]);
  });
});
