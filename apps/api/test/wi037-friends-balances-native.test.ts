// WI-037 — additive FriendDto.balancesNative (full native signed per-currency
// list, pre-conversion). Written from spec-WI-037.md's API contract, TDD
// red-first against the pre-change route (field did not exist).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const friendshipFindManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const exchangeRateCacheUpsertMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    friendship: { findMany: (...args: unknown[]) => friendshipFindManyMock(...args) },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => exchangeRateCacheFindUniqueMock(...args),
      upsert: (...args: unknown[]) => exchangeRateCacheUpsertMock(...args),
    },
  },
}));

import { buildApp } from '../src/app';
import { resetCacheForTests } from '../src/lib/cache';

let app: FastifyInstance;
let token: string;

function freshCacheRow(base: string, rates: Record<string, number>) {
  return { id: 'cache_1', base, rates, fetchedAt: new Date() };
}

function friendUser(id: string, name: string) {
  return { id, name, avatarColor: '#fff' };
}

beforeEach(async () => {
  userFindUniqueMock.mockReset();
  friendshipFindManyMock.mockReset();
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();
  exchangeRateCacheFindUniqueMock.mockReset();
  exchangeRateCacheUpsertMock.mockReset();
  // WI-070: GET /friends is now wrapped in the process-wide response cache
  // (same as GET /balance since WI-067), keyed on this fixed userId with no
  // query params — every it() below must start from a cold cache, otherwise
  // a later test's mock reconfiguration would never be observed.
  resetCacheForTests();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: 'user_1' });
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/v1/friends — balancesNative (WI-037)', () => {
  it('carries the full native breakdown, including currencies collapsed into balancesConverted', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    friendshipFindManyMock.mockResolvedValue([
      {
        userAId: 'user_1',
        userBId: 'sam',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        userA: friendUser('user_1', 'Me'),
        userB: friendUser('sam', 'Sam'),
      },
    ]);
    expenseFindManyMock.mockResolvedValue([
      {
        currency: 'USD',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'sam', amount: 5000 }],
        splits: [{ userId: 'user_1', amount: 5000 }, { userId: 'sam', amount: 0 }],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.79 }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [sam] = res.json();
    expect(sam.balances).toEqual([]); // converted away — unchanged existing behavior
    expect(sam.balancesNative).toEqual([{ currency: 'USD', amount: -5000 }]); // full native breakdown
  });

  it('is [] for a settled-up friend', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    friendshipFindManyMock.mockResolvedValue([
      {
        userAId: 'user_1',
        userBId: 'sam',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        userA: friendUser('user_1', 'Me'),
        userB: friendUser('sam', 'Sam'),
      },
    ]);
    expenseFindManyMock.mockResolvedValue([]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()[0].balancesNative).toEqual([]);
  });
});
