// spec-WI-080 §8 / ADR-034 — per-bucket composition counts on
// FriendBalanceBucket.expenseCount / settlementCount. Written red-first against
// the pre-WI-080 route (buckets had no composition fields).
//
// Mocked-prisma convention mirrors wi079-balances-by-group.test.ts.
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
  return { id: 'cache_wi080', base, rates, fetchedAt: new Date() };
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

function friendshipWithSamLong() {
  return {
    userAId: 'sam_wi080',
    userBId: 'user_1',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    userA: friendUser('sam_wi080', 'Sam'),
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
  resetCacheForTests();
  resetRatesMemoForTests();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: 'user_1' });
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/v1/friends — bucket composition counts (WI-080)', () => {
  it('direct expenses-only bucket: expenseCount=1, settlementCount=0', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([expenseRow('USD', null, 'sam', 'user_1', 5000)]);
    settlementFindManyMock.mockResolvedValue([]);
    groupMemberFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();
    expect(sam.balancesByGroup).toHaveLength(1);
    const [direct] = sam.balancesByGroup;
    expect(direct.group).toBeNull();
    expect(direct.expenseCount).toBe(1);
    expect(direct.settlementCount).toBe(0);
  });

  it('direct settlements-only bucket: expenseCount=0, settlementCount=1', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([]);
    settlementFindManyMock.mockResolvedValue([
      settlementRow('USD', null, 'user_1', 'sam', 5000),
    ]);
    groupMemberFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();
    expect(sam.balancesByGroup).toHaveLength(1);
    const [direct] = sam.balancesByGroup;
    expect(direct.group).toBeNull();
    expect(direct.expenseCount).toBe(0);
    expect(direct.settlementCount).toBe(1);
  });

  it('mixed direct bucket counts both expenses and settlements', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', null, 'sam', 'user_1', 4000),
      expenseRow('USD', null, 'user_1', 'sam', 1000),
    ]);
    settlementFindManyMock.mockResolvedValue([
      settlementRow('USD', null, 'user_1', 'sam', 2000),
      settlementRow('USD', null, 'user_1', 'sam', 500),
      settlementRow('USD', null, 'sam', 'user_1', 1500),
    ]);
    groupMemberFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();
    expect(sam.balancesByGroup).toHaveLength(1);
    const [direct] = sam.balancesByGroup;
    expect(direct.expenseCount).toBe(2);
    expect(direct.settlementCount).toBe(3);
  });

  it('group bucket counts only its own groupId rows', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', 'grp_a', 'sam', 'user_1', 1000),
      expenseRow('USD', 'grp_b', 'sam', 'user_1', 2000),
    ]);
    settlementFindManyMock.mockResolvedValue([
      settlementRow('USD', 'grp_a', 'user_1', 'sam', 500),
    ]);
    groupMemberFindManyMock.mockResolvedValue(
      membershipRows([
        { id: 'grp_a', name: 'Alpha', emoji: '🅰️' },
        { id: 'grp_b', name: 'Beta', emoji: '🅱️' },
      ]),
    );
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();
    expect(sam.balancesByGroup).toHaveLength(2);
    const a = sam.balancesByGroup.find(
      (b: { group: { id: string } | null }) => b.group?.id === 'grp_a',
    );
    const b = sam.balancesByGroup.find(
      (b: { group: { id: string } | null }) => b.group?.id === 'grp_b',
    );
    expect(a.expenseCount).toBe(1);
    expect(a.settlementCount).toBe(1);
    expect(b.expenseCount).toBe(1);
    expect(b.settlementCount).toBe(0);
  });

  it('multi-currency bucket: counts include all currencies in the same group bucket', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', 'grp_multi', 'sam', 'user_1', 1000),
      expenseRow('EUR', 'grp_multi', 'sam', 'user_1', 2000),
      expenseRow('GBP', 'grp_multi', 'user_1', 'sam', 3000),
    ]);
    settlementFindManyMock.mockResolvedValue([
      settlementRow('JPY', 'grp_multi', 'user_1', 'sam', 10000),
    ]);
    groupMemberFindManyMock.mockResolvedValue(
      membershipRows([{ id: 'grp_multi', name: 'Multi', emoji: '💱' }]),
    );
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('USD', { USD: 1, EUR: 1.1, GBP: 1.2, JPY: 0.01 }),
    );

    const [sam] = await getFriends();
    expect(sam.balancesByGroup).toHaveLength(1);
    const [multi] = sam.balancesByGroup;
    expect(multi.group?.id).toBe('grp_multi');
    expect(multi.expenseCount).toBe(3);
    expect(multi.settlementCount).toBe(1);
  });

  it('cross-bucket cancel: both surviving buckets keep their real counts', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', 'grp_a', 'sam', 'user_1', 10000),
      expenseRow('USD', 'grp_a', 'sam', 'user_1', 5000),
      expenseRow('USD', 'grp_b', 'user_1', 'sam', 10000),
    ]);
    settlementFindManyMock.mockResolvedValue([
      settlementRow('USD', 'grp_b', 'user_1', 'sam', 3000),
      settlementRow('USD', 'grp_b', 'user_1', 'sam', 2000),
    ]);
    groupMemberFindManyMock.mockResolvedValue(
      membershipRows([
        { id: 'grp_a', name: 'Alpha', emoji: '🅰️' },
        { id: 'grp_b', name: 'Beta', emoji: '🅱️' },
      ]),
    );
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();
    expect(sam.balancesNative).toEqual([]);
    expect(sam.balancesByGroup).toHaveLength(2);
    const a = sam.balancesByGroup.find(
      (b: { group: { id: string } | null }) => b.group?.id === 'grp_a',
    );
    const b = sam.balancesByGroup.find(
      (b: { group: { id: string } | null }) => b.group?.id === 'grp_b',
    );
    expect(a.expenseCount).toBe(2);
    expect(a.settlementCount).toBe(0);
    expect(b.expenseCount).toBe(1);
    expect(b.settlementCount).toBe(2);
  });

  it('zero-net bucket is dropped — its counts are never rendered', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', 'grp_active', 'sam', 'user_1', 3000),
      expenseRow('USD', 'grp_settled', 'sam', 'user_1', 5000),
    ]);
    settlementFindManyMock.mockResolvedValue([
      settlementRow('USD', 'grp_settled', 'user_1', 'sam', 5000),
    ]);
    groupMemberFindManyMock.mockResolvedValue(
      membershipRows([
        { id: 'grp_active', name: 'Active', emoji: '🔥' },
        { id: 'grp_settled', name: 'Settled', emoji: '✅' },
      ]),
    );
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();
    expect(sam.balancesByGroup).toHaveLength(1);
    expect(sam.balancesByGroup[0].group?.id).toBe('grp_active');
    expect(sam.balancesByGroup[0].expenseCount).toBe(1);
  });

  it('direct bucket counts only groupId-null rows, ignoring group activity', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', null, 'sam', 'user_1', 2000),
      expenseRow('USD', 'grp_a', 'sam', 'user_1', 8000),
    ]);
    settlementFindManyMock.mockResolvedValue([
      settlementRow('USD', 'grp_a', 'user_1', 'sam', 1000),
    ]);
    groupMemberFindManyMock.mockResolvedValue(
      membershipRows([{ id: 'grp_a', name: 'Alpha', emoji: '🅰️' }]),
    );
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();
    const direct = sam.balancesByGroup.find(
      (b: { group: { id: string } | null }) => b.group === null,
    );
    const a = sam.balancesByGroup.find(
      (b: { group: { id: string } | null }) => b.group?.id === 'grp_a',
    );
    expect(direct.expenseCount).toBe(1);
    expect(direct.settlementCount).toBe(0);
    expect(a.expenseCount).toBe(1);
    expect(a.settlementCount).toBe(1);
  });

  it('counts ignore rows that do not involve the caller↔friend pair', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', null, 'sam', 'user_1', 1000),
      {
        currency: 'USD',
        groupId: null,
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'someone_else', amount: 9999 }],
        splits: [
          { userId: 'user_1', amount: 9999 },
          { userId: 'someone_else', amount: 0 },
        ],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([
      settlementRow('USD', null, 'someone_else', 'user_1', 1234),
    ]);
    groupMemberFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();
    expect(sam.balancesByGroup).toHaveLength(1);
    expect(sam.balancesByGroup[0].expenseCount).toBe(1);
    expect(sam.balancesByGroup[0].settlementCount).toBe(0);
  });

  it('every emitted bucket has both count fields populated', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', 'grp_a', 'sam', 'user_1', 1000),
      expenseRow('USD', null, 'user_1', 'sam', 500),
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    groupMemberFindManyMock.mockResolvedValue(
      membershipRows([{ id: 'grp_a', name: 'Alpha', emoji: '🅰️' }]),
    );
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const [sam] = await getFriends();
    for (const bucket of sam.balancesByGroup) {
      expect(typeof bucket.expenseCount).toBe('number');
      expect(typeof bucket.settlementCount).toBe('number');
      expect(bucket.expenseCount).toBeGreaterThanOrEqual(0);
      expect(bucket.settlementCount).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('GET /api/v1/friends/:userId — composition count parity', () => {
  it('emits identical balancesByGroup (counts included) to the matching GET /friends entry', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSamLong()]);
    friendshipFindUniqueMock.mockResolvedValue(friendshipWithSamLong());
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', 'grp_parity', 'sam_wi080', 'user_1', 7000),
      expenseRow('USD', null, 'user_1', 'sam_wi080', 2000),
      expenseRow('USD', null, 'user_1', 'sam_wi080', 1000),
    ]);
    settlementFindManyMock.mockResolvedValue([
      settlementRow('USD', 'grp_parity', 'user_1', 'sam_wi080', 1500),
    ]);
    groupMemberFindManyMock.mockResolvedValue(
      membershipRows([{ id: 'grp_parity', name: 'Parity', emoji: '⚖️' }]),
    );
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const singleRes = await app.inject({
      method: 'GET',
      url: '/api/v1/friends/sam_wi080',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(singleRes.statusCode).toBe(200);
    const single = singleRes.json();

    const list = await getFriends();
    const listEntry = list.find((f: { user: { id: string } }) => f.user.id === 'sam_wi080');

    expect(single).toEqual(listEntry);
    expect(single.balancesByGroup).toHaveLength(2);
    const grp = single.balancesByGroup.find(
      (b: { group: { id: string } | null }) => b.group?.id === 'grp_parity',
    );
    const direct = single.balancesByGroup.find(
      (b: { group: { id: string } | null }) => b.group === null,
    );
    expect(grp.expenseCount).toBe(1);
    expect(grp.settlementCount).toBe(1);
    expect(direct.expenseCount).toBe(2);
    expect(direct.settlementCount).toBe(0);
  });
});

describe('GET /api/v1/friends — cached composition counts', () => {
  it('second call within 15s serves identical count fields with no recompute', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([expenseRow('USD', 'grp_cache', 'sam', 'user_1', 4444)]);
    settlementFindManyMock.mockResolvedValue([]);
    groupMemberFindManyMock.mockResolvedValue(
      membershipRows([{ id: 'grp_cache', name: 'Cache', emoji: '💾' }]),
    );
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 }));

    const call = () =>
      app.inject({
        method: 'GET',
        url: '/api/v1/friends',
        headers: { authorization: `Bearer ${token}` },
      });

    const first = await call();
    expect(first.statusCode).toBe(200);
    const second = await call();
    expect(second.statusCode).toBe(200);

    expect(expenseFindManyMock).toHaveBeenCalledTimes(1);
    expect(settlementFindManyMock).toHaveBeenCalledTimes(1);

    const [firstSam] = first.json();
    const [secondSam] = second.json();
    expect(secondSam).toEqual(firstSam);
    expect(firstSam.balancesByGroup[0].expenseCount).toBe(1);
    expect(firstSam.balancesByGroup[0].settlementCount).toBe(0);
  });
});
