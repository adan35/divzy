// spec-WI-079 §8 T1 / story-WI-079 Gherkin ("GET /friends includes a per-group
// breakdown", "buckets reconcile exactly to top-level balancesNative",
// "direct-only friend gets exactly one non-group bucket", "settled group bucket
// dropped", cross-bucket-cancel drb-architecture R3 case) — written red-first
// against the pre-WI-079 route (FriendDto had no balancesByGroup).
//
// Mocked-prisma convention mirrors friends-route.test.ts, extended with the
// groupMember.findMany double the WI-079 label fetch (spec §4 C3) requires.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const friendshipFindManyMock = vi.fn();
const friendshipFindUniqueMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const exchangeRateCacheUpsertMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    friendship: {
      findMany: (...args: unknown[]) => friendshipFindManyMock(...args),
      findUnique: (...args: unknown[]) => friendshipFindUniqueMock(...args),
    },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
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
  return { id: 'cache_wi079', base, rates, fetchedAt: new Date() };
}

function friendUser(id: string, name: string) {
  return { id, name, avatarColor: '#fff' };
}

/** userAId < userBId invariant: 'sam' < 'user_1'. */
function friendshipWithSam() {
  return {
    userAId: 'sam',
    userBId: 'user_1',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    userA: friendUser('sam', 'Sam'),
    userB: friendUser('user_1', 'Me'),
  };
}

/** Single-payer expense: `payerId` paid `amount`, `debtorId` owes it all. */
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

function membershipRows(groups: Array<{ id: string; name: string; emoji: string }>) {
  return groups.map((group) => ({ group }));
}

/**
 * spec-WI-079 §2 hard invariant: for every currency, Σ bucket.balancesNative[c]
 * === top-level balancesNative[c], with ABSENCE treated as zero on both sides
 * (a currency absent top-level and netting to Σ 0 across buckets satisfies it).
 */
function expectReconciliation(dto: {
  balancesNative: Array<{ currency: string; amount: number }>;
  balancesByGroup: Array<{ balancesNative: Array<{ currency: string; amount: number }> }>;
}) {
  const bucketTotals = new Map<string, number>();
  for (const bucket of dto.balancesByGroup) {
    for (const entry of bucket.balancesNative) {
      bucketTotals.set(entry.currency, (bucketTotals.get(entry.currency) ?? 0) + entry.amount);
    }
  }
  const currencies = new Set<string>([
    ...bucketTotals.keys(),
    ...dto.balancesNative.map((b) => b.currency),
  ]);
  for (const currency of currencies) {
    const top = dto.balancesNative.find((b) => b.currency === currency)?.amount ?? 0;
    expect(bucketTotals.get(currency) ?? 0).toBe(top);
  }
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
  friendshipFindUniqueMock.mockReset();
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();
  groupMemberFindManyMock.mockReset();
  exchangeRateCacheFindUniqueMock.mockReset();
  exchangeRateCacheUpsertMock.mockReset();
  // WI-070: GET /friends is response-cached 15s keyed on the fixed userId —
  // cold cache per test or later mock reconfiguration is never observed.
  resetCacheForTests();
  // WI-072: getRates() memo is keyed per base and persists across it() blocks.
  resetRatesMemoForTests();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: 'user_1' });
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/v1/friends — balancesByGroup (WI-079 T1)', () => {
  it('multi-group + direct friend: one bucket per shared group plus one direct bucket, each with native/converted/fallback', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', 'grp_trip', 'sam', 'user_1', 10000), // user_1 owes sam 10000 in the trip group
      expenseRow('USD', 'grp_home', 'user_1', 'sam', 4000), // sam owes user_1 4000 in the home group
      expenseRow('USD', null, 'sam', 'user_1', 2000), // user_1 owes sam 2000 direct
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    groupMemberFindManyMock.mockResolvedValue(
      membershipRows([
        { id: 'grp_trip', name: 'Trip to Lahore', emoji: '🌴' },
        { id: 'grp_home', name: 'Roommates', emoji: '🏠' },
      ]),
    );
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();

    expect(sam.user.id).toBe('sam');
    // Top-level fields unchanged: -10000 + 4000 - 2000 = -8000 USD.
    expect(sam.balancesNative).toEqual([{ currency: 'USD', amount: -8000 }]);
    expect(sam.balancesConverted).toEqual({ currency: 'USD', amount: -8000 });
    expect(sam.usedFallbackRates).toBe(false);

    expect(sam.balancesByGroup).toHaveLength(3);
    // DTO contract order: magnitude desc (10000, 4000, 2000) — no ties here.
    const [trip, home, direct] = sam.balancesByGroup;
    expect(trip.group).toEqual({ id: 'grp_trip', name: 'Trip to Lahore', emoji: '🌴' });
    expect(trip.balancesNative).toEqual([{ currency: 'USD', amount: -10000 }]);
    expect(trip.balancesConverted).toEqual({ currency: 'USD', amount: -10000 });
    expect(trip.balances).toEqual([]);
    expect(trip.usedFallbackRates).toBe(false);
    expect(home.group).toEqual({ id: 'grp_home', name: 'Roommates', emoji: '🏠' });
    expect(home.balancesNative).toEqual([{ currency: 'USD', amount: 4000 }]);
    expect(direct.group).toBeNull(); // the single direct/non-group bucket (D1)
    expect(direct.balancesNative).toEqual([{ currency: 'USD', amount: -2000 }]);

    expectReconciliation(sam);

    // C3: exactly one groupMember.findMany, keyed on the caller's membership
    // with NO leftAt filter, selecting only the group label embed.
    expect(groupMemberFindManyMock).toHaveBeenCalledTimes(1);
    expect(groupMemberFindManyMock).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      select: { group: { select: { id: true, name: true, emoji: true } } },
    });
  });

  it('reconciles exactly to top-level balancesNative per currency across a multi-currency ledger', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('EUR', 'grp_a', 'sam', 'user_1', 3000), // -3000 EUR in grp_a
      expenseRow('USD', 'grp_b', 'sam', 'user_1', 5000), // -5000 USD in grp_b
      expenseRow('USD', null, 'user_1', 'sam', 2000), // +2000 USD direct
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    groupMemberFindManyMock.mockResolvedValue(
      membershipRows([
        { id: 'grp_a', name: 'Alpha', emoji: '🅰️' },
        { id: 'grp_b', name: 'Beta', emoji: '🅱️' },
      ]),
    );
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 1.2 }));

    const [sam] = await getFriends();

    // Top-level: EUR -3000, USD (-5000 + 2000) = -3000.
    expect(sam.balancesNative).toEqual([
      { currency: 'EUR', amount: -3000 },
      { currency: 'USD', amount: -3000 },
    ]);
    expect(sam.balancesConverted).toEqual({ currency: 'USD', amount: -5500 });

    expect(sam.balancesByGroup).toHaveLength(3);
    // Magnitudes: grp_b 5000, grp_a 3000/1.2=2500, direct 2000 → b, a, direct.
    const [b, a, direct] = sam.balancesByGroup;
    expect(b.group?.id).toBe('grp_b');
    expect(b.balancesNative).toEqual([{ currency: 'USD', amount: -5000 }]);
    expect(b.balancesConverted).toEqual({ currency: 'USD', amount: -5000 });
    expect(a.group?.id).toBe('grp_a');
    expect(a.balancesNative).toEqual([{ currency: 'EUR', amount: -3000 }]);
    expect(a.balancesConverted).toEqual({ currency: 'USD', amount: -2500 });
    expect(a.usedFallbackRates).toBe(false);
    expect(direct.group).toBeNull();
    expect(direct.balancesNative).toEqual([{ currency: 'USD', amount: 2000 }]);

    expectReconciliation(sam);
  });

  it('direct-only friend gets exactly one null-group bucket, never an empty breakdown', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([expenseRow('USD', null, 'sam', 'user_1', 7500)]);
    settlementFindManyMock.mockResolvedValue([]);
    groupMemberFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();

    expect(sam.balancesNative).toEqual([{ currency: 'USD', amount: -7500 }]);
    expect(sam.balancesByGroup).toHaveLength(1);
    expect(sam.balancesByGroup[0].group).toBeNull();
    expect(sam.balancesByGroup[0].balancesNative).toEqual([{ currency: 'USD', amount: -7500 }]);
    expect(sam.balancesByGroup[0].balancesConverted).toEqual({ currency: 'USD', amount: -7500 });
    expectReconciliation(sam);
  });

  it('a fully settled group bucket is dropped; only the non-settled group bucket remains', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', 'grp_settled', 'sam', 'user_1', 5000),
      expenseRow('USD', 'grp_active', 'sam', 'user_1', 3000),
    ]);
    settlementFindManyMock.mockResolvedValue([
      settlementRow('USD', 'grp_settled', 'user_1', 'sam', 5000), // settles the grp_settled debt
    ]);
    groupMemberFindManyMock.mockResolvedValue(
      membershipRows([
        { id: 'grp_settled', name: 'Settled Group', emoji: '✅' },
        { id: 'grp_active', name: 'Active Group', emoji: '🎯' },
      ]),
    );
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();

    expect(sam.balancesNative).toEqual([{ currency: 'USD', amount: -3000 }]);
    expect(sam.balancesByGroup).toHaveLength(1);
    expect(sam.balancesByGroup[0].group?.id).toBe('grp_active');
    expect(sam.balancesByGroup[0].balancesNative).toEqual([{ currency: 'USD', amount: -3000 }]);
    expectReconciliation(sam);
  });

  it('cross-bucket cancel (R3): +100/−100 same currency across two groups, collapsed total zero — BOTH buckets stay present', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', 'grp_a', 'sam', 'user_1', 10000), // -10000
      expenseRow('USD', 'grp_b', 'user_1', 'sam', 10000), // +10000
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    groupMemberFindManyMock.mockResolvedValue(
      membershipRows([
        { id: 'grp_a', name: 'Alpha', emoji: '🅰️' },
        { id: 'grp_b', name: 'Beta', emoji: '🅱️' },
      ]),
    );
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();

    // Collapsed top-level net is zero: the currency is omitted (zeros dropped),
    // there is no converted figure, and the friend looks "settled" up top…
    expect(sam.balancesNative).toEqual([]);
    expect(sam.balances).toEqual([]);
    expect(sam.balancesConverted).toBeNull();
    // …but the breakdown gives NO settled treatment: both nonzero buckets are
    // present, so the affordance driver (balancesByGroup.length) is 2.
    expect(sam.balancesByGroup).toHaveLength(2);
    // Equal magnitude (10000) → direct-last tie-break inapplicable → name asc.
    const [alpha, beta] = sam.balancesByGroup;
    expect(alpha.group?.id).toBe('grp_a');
    expect(alpha.balancesNative).toEqual([{ currency: 'USD', amount: -10000 }]);
    expect(beta.group?.id).toBe('grp_b');
    expect(beta.balancesNative).toEqual([{ currency: 'USD', amount: 10000 }]);
    // Reconciliation with absence ≡ 0: Σ buckets (0) === absent top-level (0).
    expectReconciliation(sam);
  });

  it('bucket ordering: magnitude desc, direct (group: null) last on ties, then group name asc', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', 'grp_zulu', 'sam', 'user_1', 5000),
      expenseRow('USD', 'grp_alpha', 'sam', 'user_1', 5000),
      expenseRow('USD', null, 'sam', 'user_1', 5000),
      expenseRow('USD', 'grp_big', 'sam', 'user_1', 9000),
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    groupMemberFindManyMock.mockResolvedValue(
      membershipRows([
        { id: 'grp_zulu', name: 'Zulu', emoji: '🇿' },
        { id: 'grp_alpha', name: 'Alpha', emoji: '🅰️' },
        { id: 'grp_big', name: 'Big', emoji: '🅱️' },
      ]),
    );
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();

    expect(
      sam.balancesByGroup.map((bkt: { group: { id: string } | null }) => bkt.group?.id ?? null),
    ).toEqual([
      'grp_big', // biggest magnitude first
      'grp_alpha', // equal magnitude → name asc before Zulu
      'grp_zulu',
      null, // equal magnitude → direct bucket last
    ]);
    expectReconciliation(sam);
  });

  it('an unmapped groupId falls back to the defensive "Unknown group" label (never dropped, never a group.findMany upgrade)', async () => {
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
    expectReconciliation(sam);
  });

  it('a friend with no nonzero per-group net anywhere gets balancesByGroup: []', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([]);
    settlementFindManyMock.mockResolvedValue([]);
    groupMemberFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();

    expect(sam.balancesNative).toEqual([]);
    expect(sam.balancesByGroup).toEqual([]);
  });
});

describe('GET /api/v1/friends/:userId — balancesByGroup parity (WI-070 §2b rule)', () => {
  it('carries the same balancesByGroup as the matching GET /friends entry', async () => {
    // zId route-param validation requires >= 8 chars, so this pair uses a
    // longer friend id than the list-only tests above ('sam_wi079' < 'user_1').
    const friendship = {
      userAId: 'sam_wi079',
      userBId: 'user_1',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      userA: friendUser('sam_wi079', 'Sam'),
      userB: friendUser('user_1', 'Me'),
    };
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendship]);
    friendshipFindUniqueMock.mockResolvedValue(friendship);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', 'grp_trip', 'sam_wi079', 'user_1', 10000),
      expenseRow('USD', null, 'user_1', 'sam_wi079', 2500),
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    groupMemberFindManyMock.mockResolvedValue(
      membershipRows([{ id: 'grp_trip', name: 'Trip to Lahore', emoji: '🌴' }]),
    );
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const singleRes = await app.inject({
      method: 'GET',
      url: '/api/v1/friends/sam_wi079',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(singleRes.statusCode).toBe(200);
    const single = singleRes.json();

    const list = await getFriends();
    const listEntry = list.find((f: { user: { id: string } }) => f.user.id === 'sam_wi079');

    // Field-identical DTOs for the same pair — balancesByGroup included.
    expect(single).toEqual(listEntry);
    expect(single.balancesByGroup).toHaveLength(2);
    expect(single.balancesByGroup[0].group?.id).toBe('grp_trip'); // 10000 > 2500
    expect(single.balancesByGroup[1].group).toBeNull();
    expectReconciliation(single);
  });
});
