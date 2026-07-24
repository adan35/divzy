import { describe, expect, it } from 'vitest';
import {
  computeNets,
  computePairwiseBalances,
  computePairwiseBalancesByGroup,
  netsForUser,
  suggestSettlements,
  type GroupAttributedPairwiseDebt,
  type LedgerExpense,
  type LedgerSettlement,
  type PairwiseDebt,
} from '../src/balances';

// 'user_ana' < 'user_bob' < 'user_sam' lexicographically — matches the spec's
// worked-example assumption (ana is the low userId in the Ana/Sam pair).
const ANA = 'user_ana';
const BOB = 'user_bob';
const SAM = 'user_sam';

/** Expense where `payer` fronted the full `amount` and `debtor`'s share is all of it. */
const expense = (
  currency: string,
  payer: string,
  debtor: string,
  amount: number,
  groupId?: string | null,
): LedgerExpense => ({
  currency,
  payers: [{ userId: payer, amount }],
  splits: [{ userId: debtor, amount }],
  ...(groupId !== undefined ? { groupId } : {}),
});

const settlement = (
  currency: string,
  fromUserId: string,
  toUserId: string,
  amount: number,
  groupId?: string | null,
): LedgerSettlement => ({
  currency,
  fromUserId,
  toUserId,
  amount,
  ...(groupId !== undefined ? { groupId } : {}),
});

/** Signed amount in the engine's low→high-positive convention (positive = low owes high). */
const signed = (d: PairwiseDebt): number =>
  (d.fromUserId < d.toUserId ? 1 : -1) * d.amount;

/** Aggregate a pairwise-debt list into `${currency}|${low}|${high}` -> signed. */
const collapseToSignedMap = (debts: PairwiseDebt[]): Record<string, number> => {
  const map = new Map<string, number>();
  for (const d of debts) {
    const [low, high] = d.fromUserId < d.toUserId
      ? [d.fromUserId, d.toUserId]
      : [d.toUserId, d.fromUserId];
    const key = `${d.currency}|${low}|${high}`;
    map.set(key, (map.get(key) ?? 0) + signed(d));
  }
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
};

/** Deterministic PRNG (mulberry32) so the property test is reproducible. */
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('computePairwiseBalancesByGroup', () => {
  it('splits a pair ledger across two groups plus a direct settlement into three independent buckets (story worked example)', () => {
    // trip1: expenses leave Sam owing Ana PKR 300.
    // roommates1: expenses leave Ana owing Sam PKR 175.
    // direct (null): Ana paid Sam PKR 50 — with no prior direct debt the bucket
    // flips, per the byte-identical bump semantics of the collapsed engine
    // (spec §1.2 + §1.4 reconciliation pin the direction; §1.3's table row for
    // the null bucket reads the settlement row, not the resulting debt).
    const expenses = [
      expense('PKR', ANA, SAM, 300, 'trip1'),
      expense('PKR', SAM, ANA, 175, 'roommates1'),
    ];
    const settlements = [settlement('PKR', ANA, SAM, 50, null)];
    expect(computePairwiseBalancesByGroup(expenses, settlements)).toEqual([
      { currency: 'PKR', groupId: null, fromUserId: SAM, toUserId: ANA, amount: 50 },
      { currency: 'PKR', groupId: 'roommates1', fromUserId: ANA, toUserId: SAM, amount: 175 },
      { currency: 'PKR', groupId: 'trip1', fromUserId: SAM, toUserId: ANA, amount: 300 },
    ]);
  });

  it('a settlement recorded in one group pays down only that group own bucket', () => {
    const expenses = [
      expense('PKR', ANA, SAM, 300, 'trip1'),
      expense('PKR', SAM, ANA, 175, 'roommates1'),
    ];
    const direct = [settlement('PKR', ANA, SAM, 50, null)];
    const before = computePairwiseBalancesByGroup(expenses, direct);

    const after = computePairwiseBalancesByGroup(expenses, [
      ...direct,
      settlement('PKR', SAM, ANA, 300, 'trip1'),
    ]);

    // trip1 nets to zero and is dropped entirely; every other bucket untouched.
    expect(after.some((d) => d.groupId === 'trip1')).toBe(false);
    expect(after).toEqual(before.filter((d) => d.groupId !== 'trip1'));
    expect(after).toContainEqual({
      currency: 'PKR', groupId: 'roommates1', fromUserId: ANA, toUserId: SAM, amount: 175,
    });
    expect(after).toContainEqual({
      currency: 'PKR', groupId: null, fromUserId: SAM, toUserId: ANA, amount: 50,
    });
  });

  it('drops a bucket that nets to exactly zero within its own group', () => {
    const result = computePairwiseBalancesByGroup(
      [expense('PKR', ANA, SAM, 300, 'trip1')],
      [settlement('PKR', SAM, ANA, 300, 'trip1')],
    );
    expect(result).toEqual([]);
  });

  it('drops zeros at bucket granularity — never nets across buckets before dropping', () => {
    // Opposing equal debts in two different groups: the collapsed engine nets
    // these to zero and emits nothing; the bucketed engine must keep BOTH.
    const result = computePairwiseBalancesByGroup(
      [
        expense('PKR', ANA, SAM, 300, 'trip1'),
        expense('PKR', SAM, ANA, 300, 'roommates1'),
      ],
      [],
    );
    expect(computePairwiseBalances(
      [
        expense('PKR', ANA, SAM, 300, 'trip1'),
        expense('PKR', SAM, ANA, 300, 'roommates1'),
      ],
      [],
    )).toEqual([]); // sanity: collapsed really does net to zero
    expect(result).toEqual([
      { currency: 'PKR', groupId: 'roommates1', fromUserId: ANA, toUserId: SAM, amount: 300 },
      { currency: 'PKR', groupId: 'trip1', fromUserId: SAM, toUserId: ANA, amount: 300 },
    ]);
  });

  it('overpaying within one group flips only that group own bucket direction', () => {
    const result = computePairwiseBalancesByGroup(
      [
        expense('PKR', ANA, SAM, 1000, 'trip1'),
        expense('PKR', SAM, ANA, 175, 'roommates1'),
      ],
      [settlement('PKR', SAM, ANA, 1500, 'trip1')],
    );
    // trip1 flips to Ana owing Sam 500; roommates1 is completely unaffected.
    expect(result).toEqual([
      { currency: 'PKR', groupId: 'roommates1', fromUserId: ANA, toUserId: SAM, amount: 175 },
      { currency: 'PKR', groupId: 'trip1', fromUserId: ANA, toUserId: SAM, amount: 500 },
    ]);
  });

  it('treats undefined and absent groupId identically to null, and never emits undefined', () => {
    const withUndefined: LedgerSettlement = {
      currency: 'PKR', fromUserId: SAM, toUserId: ANA, amount: 40, groupId: undefined,
    };
    const absentGroupId: LedgerExpense = {
      currency: 'PKR',
      payers: [{ userId: ANA, amount: 100 }],
      splits: [{ userId: SAM, amount: 100 }],
    };
    const result = computePairwiseBalancesByGroup(
      [absentGroupId, expense('PKR', ANA, SAM, 25, null)],
      [withUndefined],
    );
    // Sam owed Ana 100 (absent) + 25 (null) = 125 in the null bucket; Sam's
    // undefined-groupId settlement of 40 pays down the same bucket.
    expect(result).toEqual([
      { currency: 'PKR', groupId: null, fromUserId: SAM, toUserId: ANA, amount: 85 },
    ]);
    for (const d of result) expect(d.groupId).not.toBeUndefined();
  });

  it('never redistributes direct activity into a group bucket (ADR-009 native buckets)', () => {
    // Sole-shared-group case: ADR-009's waterfall would fold the direct
    // settlement into roommates1 for the group Balances tab — this capability
    // must show each bucket's native truth instead.
    const result = computePairwiseBalancesByGroup(
      [expense('PKR', ANA, SAM, 200, 'roommates1')],
      [settlement('PKR', SAM, ANA, 200, null)],
    );
    expect(result).toEqual([
      { currency: 'PKR', groupId: null, fromUserId: ANA, toUserId: SAM, amount: 200 },
      { currency: 'PKR', groupId: 'roommates1', fromUserId: SAM, toUserId: ANA, amount: 200 },
    ]);
  });

  it('sorts currency ASC, then groupId null-first then ASC, then fromUserId, then toUserId', () => {
    const result = computePairwiseBalancesByGroup(
      [
        expense('PKR', ANA, SAM, 10, 'trip1'),
        expense('EUR', ANA, SAM, 20, 'beta'),
        expense('EUR', ANA, SAM, 30, null),
        expense('EUR', ANA, SAM, 40, 'alpha'),
        expense('EUR', ANA, BOB, 50, 'alpha'),
        expense('PKR', ANA, SAM, 60, null),
      ],
      [],
    );
    expect(result.map((d) => [d.currency, d.groupId, d.fromUserId, d.toUserId, d.amount])).toEqual([
      ['EUR', null, SAM, ANA, 30],
      ['EUR', 'alpha', BOB, ANA, 50],
      ['EUR', 'alpha', SAM, ANA, 40],
      ['EUR', 'beta', SAM, ANA, 20],
      ['PKR', null, SAM, ANA, 60],
      ['PKR', 'trip1', SAM, ANA, 10],
    ]);
  });

  it('is deterministic regardless of input array order', () => {
    const expenses = [
      expense('PKR', ANA, SAM, 300, 'trip1'),
      expense('USD', SAM, BOB, 120, null),
      expense('PKR', SAM, ANA, 175, 'roommates1'),
      expense('EUR', BOB, ANA, 90, 'trip1'),
      expense('USD', ANA, SAM, 45, 'g2'),
    ];
    const settlements = [
      settlement('PKR', SAM, ANA, 100, 'trip1'),
      settlement('USD', BOB, SAM, 20, null),
      settlement('EUR', ANA, BOB, 90, null),
      settlement('PKR', ANA, SAM, 50, null),
    ];
    const forward = computePairwiseBalancesByGroup(expenses, settlements);
    const reversed = computePairwiseBalancesByGroup(
      [...expenses].reverse(),
      [...settlements].reverse(),
    );
    expect(reversed).toEqual(forward);
    // Interleaved differently again for good measure.
    const shuffled = computePairwiseBalancesByGroup(
      [expenses[3]!, expenses[0]!, expenses[4]!, expenses[1]!, expenses[2]!],
      [settlements[2]!, settlements[3]!, settlements[0]!, settlements[1]!],
    );
    expect(shuffled).toEqual(forward);
  });

  it('reconciles with the collapsed engine per pair/currency over randomized fixtures (property)', () => {
    const rand = mulberry32(0x079);
    const users = [ANA, BOB, SAM];
    const currencies = ['PKR', 'USD', 'EUR'];
    const groups: Array<string | null | undefined> = [undefined, null, 'g1', 'g2', 'g3'];
    const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
    const other = (u: string): string => pick(users.filter((x) => x !== u));

    for (let iter = 0; iter < 200; iter++) {
      const expenses: LedgerExpense[] = [];
      const settlements: LedgerSettlement[] = [];
      const rowCount = 1 + Math.floor(rand() * 12);
      for (let i = 0; i < rowCount; i++) {
        const currency = pick(currencies);
        const amount = 1 + Math.floor(rand() * 5000);
        if (rand() < 0.6) {
          const payer = pick(users);
          expenses.push(expense(currency, payer, other(payer), amount, pick(groups)));
        } else {
          const from = pick(users);
          settlements.push(settlement(currency, from, other(from), amount, pick(groups)));
        }
      }
      const collapsed = computePairwiseBalances(expenses, settlements);
      const bucketed = computePairwiseBalancesByGroup(expenses, settlements);
      // Σ signed buckets per (currency, low, high) === collapsed signed per key
      // (dropped zero buckets/keys contribute 0 on both sides).
      expect(collapseToSignedMap(bucketed)).toEqual(collapseToSignedMap(collapsed));
    }
  });

  it('emits rows assignable to PairwiseDebt (IS-A relationship)', () => {
    const debts: PairwiseDebt[] = computePairwiseBalancesByGroup(
      [expense('PKR', ANA, SAM, 100, 'trip1')],
      [],
    );
    const attributed: GroupAttributedPairwiseDebt[] = debts as GroupAttributedPairwiseDebt[];
    expect(attributed[0]).toEqual({
      currency: 'PKR', groupId: 'trip1', fromUserId: SAM, toUserId: ANA, amount: 100,
    });
  });
});

describe('groupId inertness — existing exports are byte-identical with or without the field', () => {
  // Mirrors the existing balances.test.ts fixtures, with groupId added to some
  // rows and omitted (or explicitly undefined) from others.
  const dinnerPlain: LedgerExpense = {
    currency: 'USD',
    payers: [{ userId: ANA, amount: 3000 }],
    splits: [
      { userId: ANA, amount: 1000 },
      { userId: BOB, amount: 1000 },
      { userId: SAM, amount: 1000 },
    ],
  };
  const dinnerGrouped: LedgerExpense = { ...dinnerPlain, groupId: 'trip1' };
  const backPlain: LedgerExpense = {
    currency: 'USD',
    payers: [{ userId: BOB, amount: 800 }],
    splits: [
      { userId: ANA, amount: 400 },
      { userId: BOB, amount: 400 },
    ],
  };
  const eurPlain: LedgerExpense = {
    currency: 'EUR',
    payers: [{ userId: SAM, amount: 900 }],
    splits: [
      { userId: ANA, amount: 450 },
      { userId: BOB, amount: 450 },
    ],
  };
  const eurUndefined: LedgerExpense = { ...eurPlain, groupId: undefined };
  const settlementPlain: LedgerSettlement = {
    currency: 'USD', fromUserId: BOB, toUserId: ANA, amount: 600,
  };
  const settlementGrouped: LedgerSettlement = { ...settlementPlain, groupId: null };

  const pairs: Array<[readonly LedgerExpense[], readonly LedgerSettlement[]]> = [
    [[dinnerPlain, backPlain, eurPlain], [settlementPlain]],
    [[dinnerGrouped, backPlain, eurUndefined], [settlementGrouped]],
  ];
  const [plainExpenses, plainSettlements] = pairs[0]!;
  const [mixedExpenses, mixedSettlements] = pairs[1]!;

  it('computeNets ignores groupId', () => {
    const a = computeNets(plainExpenses, plainSettlements);
    const b = computeNets(mixedExpenses, mixedSettlements);
    expect(JSON.stringify([...b].map(([c, m]) => [c, [...m]])))
      .toBe(JSON.stringify([...a].map(([c, m]) => [c, [...m]])));
  });

  it('computePairwiseBalances ignores groupId', () => {
    expect(computePairwiseBalances(mixedExpenses, mixedSettlements))
      .toEqual(computePairwiseBalances(plainExpenses, plainSettlements));
  });

  it('suggestSettlements ignores groupId', () => {
    expect(suggestSettlements(computeNets(mixedExpenses, mixedSettlements)))
      .toEqual(suggestSettlements(computeNets(plainExpenses, plainSettlements)));
  });

  it('netsForUser ignores groupId', () => {
    for (const u of [ANA, BOB, SAM]) {
      expect(netsForUser(computeNets(mixedExpenses, mixedSettlements), u))
        .toEqual(netsForUser(computeNets(plainExpenses, plainSettlements), u));
    }
  });
});
