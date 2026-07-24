// Test-stage (test-social-groups) white-box coverage for WI-079, complementing
// Build's TDD suites (wi079-balances-by-group / wi079-fallback-attribution /
// wi079-cache-shape). Targets buildFriendBuckets branches in
// apps/api/src/routes/friends.ts that the story-derived suites do not isolate:
//
//  W-1  D4 membership-test .toUpperCase() normalization (friends.ts:193-195):
//       fallbackCurrencies is guaranteed UPPERCASED (ADR-033 Decision 3), so a
//       lowercase ledger currency MUST still match — a regression dropping the
//       .toUpperCase() call would silently misattribute the bucket's fallback
//       flag. Written from spec D4 ("The .toUpperCase() normalization is
//       mandatory — the comparison must not depend on ledger currency casing").
//  W-2  drb-security N1 (binding): an unmapped groupId falls back to the
//       static "Unknown group" embed and the route NEVER escalates to a
//       group.findMany lookup — asserted explicitly with a group delegate
//       double that must stay at zero calls (T1's ghost case proves this only
//       implicitly, by omitting the delegate).
//  W-3  Settled bucket via cross-entry cancellation WITHIN one group (expense
//       + equal opposite settlement) is dropped while a same-currency direct
//       bucket survives — route-side drop guard (friends.ts:183) over the
//       engine's own zero-bucket drop, spec §1 scenario 4 belt-and-braces.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const friendshipFindManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const groupFindManyMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const exchangeRateCacheUpsertMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    friendship: { findMany: (...args: unknown[]) => friendshipFindManyMock(...args) },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    group: { findMany: (...args: unknown[]) => groupFindManyMock(...args) },
    groupMember: { findMany: (...args: unknown[]) => groupMemberFindManyMock(...args) },
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => exchangeRateCacheFindUniqueMock(...args),
      upsert: (...args: unknown[]) => exchangeRateCacheUpsertMock(...args),
    },
  },
}));

import { buildApp } from '../src/app';
import { resetCacheForTests } from '../src/lib/cache';
import { resetRatesMemoForTests } from '../src/lib/rates';

let app: FastifyInstance;
let token: string;

function freshCacheRow(base: string, rates: Record<string, number>) {
  return { id: 'cache_wi079_wb', base, rates, fetchedAt: new Date() };
}

function friendUser(id: string, name: string) {
  return { id, name, avatarColor: '#fff' };
}

function friendshipWithSam() {
  return {
    userAId: 'sam',
    userBId: 'user_1',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    userA: friendUser('sam', 'Sam'),
    userB: friendUser('user_1', 'Me'),
  };
}

function expenseRow(
  currency: string,
  groupId: string | null,
  payerId: string,
  debtorId: string,
  amount: number,
) {
  return {
    currency,
    groupId,
    createdAt: new Date('2026-07-02T00:00:00.000Z'),
    payers: [{ userId: payerId, amount }],
    splits: [
      { userId: debtorId, amount },
      { userId: payerId, amount: 0 },
    ],
  };
}

function settlementRow(
  currency: string,
  groupId: string | null,
  fromUserId: string,
  toUserId: string,
  amount: number,
) {
  return {
    currency,
    groupId,
    fromUserId,
    toUserId,
    amount,
    createdAt: new Date('2026-07-03T00:00:00.000Z'),
  };
}

async function getFriends() {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/friends',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

beforeEach(async () => {
  userFindUniqueMock.mockReset();
  friendshipFindManyMock.mockReset();
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();
  groupFindManyMock.mockReset();
  groupMemberFindManyMock.mockReset();
  exchangeRateCacheFindUniqueMock.mockReset();
  exchangeRateCacheUpsertMock.mockReset();
  resetCacheForTests();
  resetRatesMemoForTests();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: 'user_1' });
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/v1/friends — buildFriendBuckets white-box branches (WI-079, test-stage)', () => {
  it('W-1: a lowercase ledger currency still matches the UPPERCASED fallbackCurrencies list (D4 mandatory normalization)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    // 'pkr' lowercase in the ledger — convert()/resolveConversionRates
    // uppercase internally, so the bucket converts; the D4 membership test
    // must likewise uppercase or the flag is silently lost.
    expenseFindManyMock.mockResolvedValue([
      expenseRow('pkr', 'grp_trip', 'sam', 'user_1', 47516),
      expenseRow('EUR', 'grp_live', 'sam', 'user_1', 3000),
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    groupMemberFindManyMock.mockResolvedValue([
      { group: { id: 'grp_trip', name: 'Trip to Lahore', emoji: '🌴' } },
      { group: { id: 'grp_live', name: 'Live Group', emoji: '📈' } },
    ]);
    // USD base cache with EUR live but NO PKR → PKR patches from the bundled
    // fallback table → fallbackCurrencies = ['PKR'] (uppercased by rates.ts).
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('USD', { USD: 1, EUR: 1.2 }),
    );

    const [sam] = await getFriends();

    const pkrBucket = sam.balancesByGroup.find(
      (b: { group: { id: string } | null }) => b.group?.id === 'grp_trip',
    );
    const eurBucket = sam.balancesByGroup.find(
      (b: { group: { id: string } | null }) => b.group?.id === 'grp_live',
    );
    expect(pkrBucket).toBeDefined();
    expect(eurBucket).toBeDefined();
    // The branch under test: 'pkr'.toUpperCase() ∈ ['PKR'] → true. Without
    // the normalization this would be false — the exact defect D4 forbids.
    expect(pkrBucket.usedFallbackRates).toBe(true);
    expect(eurBucket.usedFallbackRates).toBe(false);
    // Casing tolerance is end-to-end: the lowercase bucket still converted
    // (no leftover), preserving the bucket's native entry verbatim.
    expect(pkrBucket.balancesNative).toEqual([{ currency: 'pkr', amount: -47516 }]);
    expect(pkrBucket.balances).toEqual([]);
    expect(pkrBucket.balancesConverted).not.toBeNull();
  });

  it('W-2: an unmapped groupId renders "Unknown group" and NEVER escalates to group.findMany (drb-security N1)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([expenseRow('USD', 'grp_ghost', 'sam', 'user_1', 1234)]);
    settlementFindManyMock.mockResolvedValue([]);
    groupMemberFindManyMock.mockResolvedValue([]); // unreachable by domain invariant — defensive only
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();

    expect(sam.balancesByGroup).toHaveLength(1);
    expect(sam.balancesByGroup[0].group).toEqual({
      id: 'grp_ghost',
      name: 'Unknown group',
      emoji: '🧾',
    });
    // Explicit N1 guard: the group delegate exists in this double and stayed
    // at zero calls — no per-bucket group lookup, no N+1, no enumeration.
    expect(groupFindManyMock).not.toHaveBeenCalled();
  });

  it('W-3: a bucket zeroed by an in-group settlement is dropped while a same-currency direct bucket survives', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', 'grp_settled', 'sam', 'user_1', 5000),
      expenseRow('USD', null, 'sam', 'user_1', 1500),
    ]);
    settlementFindManyMock.mockResolvedValue([
      settlementRow('USD', 'grp_settled', 'user_1', 'sam', 5000), // exact in-group settle
    ]);
    groupMemberFindManyMock.mockResolvedValue([
      { group: { id: 'grp_settled', name: 'Settled Group', emoji: '✅' } },
    ]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();

    // Top-level: only the direct 1500 remains.
    expect(sam.balancesNative).toEqual([{ currency: 'USD', amount: -1500 }]);
    // The settled group bucket is dropped; the direct bucket carries the full
    // remainder — never a zero ledger line, never a dropped remainder.
    expect(sam.balancesByGroup).toHaveLength(1);
    expect(sam.balancesByGroup[0].group).toBeNull();
    expect(sam.balancesByGroup[0].balancesNative).toEqual([{ currency: 'USD', amount: -1500 }]);
  });
});
