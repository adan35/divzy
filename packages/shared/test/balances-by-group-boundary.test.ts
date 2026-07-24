import { describe, expect, it } from 'vitest';
import {
  computePairwiseBalancesByGroup,
  type LedgerExpense,
  type LedgerSettlement,
} from '../src/balances';

// Test-stage (test-settlements) white-box + integration boundary coverage for
// WI-079, complementing Build's TDD suite in balances-by-group.test.ts.
// Cases derived from story-WI-079's edge cases and the task brief, NOT from the
// implementation: bucket-granularity zero-drop at the exact ±50 boundary,
// multi-currency non-mixing within one (pair, groupId), and the engine boundary
// consumed with real Prisma-shaped rows.

const ANA = 'user_ana';
const SAM = 'user_sam';

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

describe('computePairwiseBalancesByGroup — bucket-granularity zero-drop (white-box)', () => {
  it('drops +50/−50 when both bumps land in the SAME bucket', () => {
    // Two opposing equal debts inside one group: the bucket nets to exactly
    // zero and must be dropped — the same granularity rule the collapsed
    // engine applies, asserted at bucket scope (story edge case).
    const result = computePairwiseBalancesByGroup(
      [
        expense('PKR', ANA, SAM, 50, 'trip1'), // sam owes ana 50 in trip1
        expense('PKR', SAM, ANA, 50, 'trip1'), // ana owes sam 50 in trip1
      ],
      [],
    );
    expect(result).toEqual([]);
  });

  it('drops NEITHER +50 nor −50 when they land in DIFFERENT buckets (no cross-bucket cancel)', () => {
    // The plausible wrong implementation: net across buckets first, then drop
    // zeros — which would silently emit nothing here and violate the
    // reconciliation-by-partition invariant (spec §1.2 step 4).
    const result = computePairwiseBalancesByGroup(
      [
        expense('PKR', ANA, SAM, 50, 'trip1'), // sam owes ana 50 in trip1
        expense('PKR', SAM, ANA, 50, 'roommates1'), // ana owes sam 50 in roommates1
      ],
      [],
    );
    expect(result).toEqual([
      { currency: 'PKR', groupId: 'roommates1', fromUserId: ANA, toUserId: SAM, amount: 50 },
      { currency: 'PKR', groupId: 'trip1', fromUserId: SAM, toUserId: ANA, amount: 50 },
    ]);
  });
});

describe('computePairwiseBalancesByGroup — multi-currency non-mixing (white-box)', () => {
  it('never mixes currencies inside one (pair, groupId) bucket', () => {
    // Same pair, SAME groupId, two currencies: must produce two independent
    // buckets — the engine-wide "currencies never mix" invariant (charter DoD)
    // asserted at the new (currency, pair, groupId) key granularity.
    const result = computePairwiseBalancesByGroup(
      [
        expense('PKR', ANA, SAM, 100, 'trip1'),
        expense('USD', ANA, SAM, 200, 'trip1'),
        expense('USD', SAM, ANA, 50, 'trip1'), // same-group USD paydown: 200 − 50
      ],
      [],
    );
    expect(result).toEqual([
      { currency: 'PKR', groupId: 'trip1', fromUserId: SAM, toUserId: ANA, amount: 100 },
      { currency: 'USD', groupId: 'trip1', fromUserId: SAM, toUserId: ANA, amount: 150 },
    ]);
  });

  it('keeps the same pair null bucket separate per currency', () => {
    const result = computePairwiseBalancesByGroup(
      [expense('EUR', ANA, SAM, 70, null), expense('PKR', ANA, SAM, 30, null)],
      [],
    );
    expect(result).toEqual([
      { currency: 'EUR', groupId: null, fromUserId: SAM, toUserId: ANA, amount: 70 },
      { currency: 'PKR', groupId: null, fromUserId: SAM, toUserId: ANA, amount: 30 },
    ]);
  });
});

describe('computePairwiseBalancesByGroup — engine boundary with Prisma-shaped rows (integration)', () => {
  // Rows shaped exactly as the spec §3.1 computeFriendsList settlement select
  // returns them (post social-groups' groupId: true addition): scalar fields
  // plus a createdAt Date and groupId typed string | null straight off the DB.
  it('threads a real DB groupId and a DB null through unmodified', () => {
    const settlementRows = [
      {
        currency: 'PKR',
        fromUserId: SAM,
        toUserId: ANA,
        amount: 300,
        createdAt: new Date('2026-07-01T10:00:00Z'),
        groupId: 'trip1' as string | null,
      },
      {
        currency: 'PKR',
        fromUserId: ANA,
        toUserId: SAM,
        amount: 50,
        createdAt: new Date('2026-07-02T10:00:00Z'),
        groupId: null as string | null,
      },
    ];
    const expenseRows = [
      {
        currency: 'PKR',
        groupId: 'trip1' as string | null,
        payers: [{ userId: ANA, amount: 300 }],
        splits: [{ userId: SAM, amount: 300 }],
      },
    ];
    const result = computePairwiseBalancesByGroup(expenseRows, settlementRows);
    // trip1: 300 expense debt paid down by Sam's 300 trip1 settlement → dropped.
    // null: Ana's direct 50 payment with no prior direct debt → flips to Sam
    // owing Ana 50. The real id 'trip1' never appears in output (bucket
    // settled), the DB null surfaces verbatim as groupId: null — never
    // inferred, defaulted, or coerced (story query-contract AC).
    expect(result).toEqual([
      { currency: 'PKR', groupId: null, fromUserId: SAM, toUserId: ANA, amount: 50 },
    ]);
  });

  it('a real group id survives to the output verbatim when its bucket is nonzero', () => {
    const result = computePairwiseBalancesByGroup(
      [expense('PKR', ANA, SAM, 175, 'ckx9group0001')],
      [],
    );
    expect(result).toEqual([
      { currency: 'PKR', groupId: 'ckx9group0001', fromUserId: SAM, toUserId: ANA, amount: 175 },
    ]);
  });

  it('rows from the UNCHANGED assertFriendPairSettled select shape (no groupId key) land in the null bucket', () => {
    // spec §3.3: assertFriendPairSettled's select is explicitly not touched —
    // its rows carry no groupId property at all. The engine boundary must
    // treat that shape identically to an explicit DB null (undefined ≡ null,
    // spec §2), so the unchanged call site can never produce a phantom bucket.
    const assertSelectShapeRows = [
      { currency: 'PKR', fromUserId: SAM, toUserId: ANA, amount: 200 }, // no groupId key, no createdAt
    ];
    const result = computePairwiseBalancesByGroup(
      [expense('PKR', ANA, SAM, 200)], // expense row also without the field
      assertSelectShapeRows,
    );
    // Both bumps land in the null bucket, net to zero, drop → empty.
    expect(result).toEqual([]);
  });
});
