// spec-WI-079 §8 T3 — cache shape: the WI-070 cached() payload is the
// serialized FriendDto[], so balancesByGroup rides inside it; a second call
// within the 15s TTL serves the identical buckets with NO recompute (every
// ledger/label mock still at call count 1). Cache keys and invalidation are
// unchanged (spec §3 / §9). Written red-first against the pre-WI-079 route.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const friendshipFindManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const exchangeRateCacheUpsertMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    friendship: { findMany: (...args: unknown[]) => friendshipFindManyMock(...args) },
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
  return { id: 'cache_wi079_t3', base, rates, fetchedAt: new Date() };
}

function friendUser(id: string, name: string) {
  return { id, name, avatarColor: '#fff' };
}

beforeEach(async () => {
  userFindUniqueMock.mockReset();
  friendshipFindManyMock.mockReset();
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

describe('GET /api/v1/friends — cached payload carries balancesByGroup (WI-079 T3)', () => {
  it('first call computes and caches buckets; second call within 15s serves identical buckets with no recompute', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([
      {
        userAId: 'sam',
        userBId: 'user_1',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        userA: friendUser('sam', 'Sam'),
        userB: friendUser('user_1', 'Me'),
      },
    ]);
    expenseFindManyMock.mockResolvedValue([
      {
        currency: 'USD',
        groupId: 'grp_trip',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'sam', amount: 10000 }],
        splits: [
          { userId: 'user_1', amount: 10000 },
          { userId: 'sam', amount: 0 },
        ],
      },
      {
        currency: 'USD',
        groupId: null,
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
        payers: [{ userId: 'user_1', amount: 2500 }],
        splits: [
          { userId: 'sam', amount: 2500 },
          { userId: 'user_1', amount: 0 },
        ],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    groupMemberFindManyMock.mockResolvedValue([
      { group: { id: 'grp_trip', name: 'Trip to Lahore', emoji: '🌴' } },
    ]);
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

    // Second call served entirely from the WI-070 response cache: no query
    // in the single-batch Promise.all ran a second time (labels included).
    expect(friendshipFindManyMock).toHaveBeenCalledTimes(1);
    expect(expenseFindManyMock).toHaveBeenCalledTimes(1);
    expect(settlementFindManyMock).toHaveBeenCalledTimes(1);
    expect(groupMemberFindManyMock).toHaveBeenCalledTimes(1);
    expect(exchangeRateCacheFindUniqueMock).toHaveBeenCalledTimes(1);

    // The cached payload is the serialized FriendDto[] — the buckets ride
    // inside it, byte-identical across the two responses.
    const [firstSam] = first.json();
    const [secondSam] = second.json();
    expect(secondSam).toEqual(firstSam);
    expect(firstSam.balancesByGroup).toHaveLength(2);
    expect(secondSam.balancesByGroup).toEqual(firstSam.balancesByGroup);
    expect(firstSam.balancesByGroup[0].group).toEqual({
      id: 'grp_trip',
      name: 'Trip to Lahore',
      emoji: '🌴',
    });
    expect(firstSam.balancesByGroup[0].balancesNative).toEqual([
      { currency: 'USD', amount: -10000 },
    ]);
    expect(firstSam.balancesByGroup[1].group).toBeNull();
    expect(firstSam.balancesByGroup[1].balancesNative).toEqual([{ currency: 'USD', amount: 2500 }]);
  });
});
