// spec-WI-079 §8 T2 / story-WI-079 Gherkin ("Fallback-rate disclosure is
// attributed to the correct bucket") — per-bucket usedFallbackRates via the
// D4 canonical contract: resolveConversionRates' additive `fallbackCurrencies`
// (UPPERCASED codes), membership test with .toUpperCase() normalization.
// Written red-first against the pre-WI-079 route.
//
// Mocked-prisma + mocked exchangeRateCache per the existing rates-test
// conventions (friends-route.test.ts / cross-domain-rates-import-smoke.test.ts),
// with resetRatesMemoForTests() in beforeEach (WI-072 memo).
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
  return { id: 'cache_wi079_fb', base, rates, fetchedAt: new Date() };
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
  vi.unstubAllGlobals();
  await app.close();
});

describe('GET /api/v1/friends — per-bucket fallback attribution (WI-079 T2)', () => {
  it('mixed case: only the bucket whose currency patched from the fallback table is flagged', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', 'grp_live', 'sam', 'user_1', 5000), // resolves live from the cache row
      expenseRow('INR', 'grp_fb', 'sam', 'user_1', 100000), // absent from the cache row → fallback-table patch
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    groupMemberFindManyMock.mockResolvedValue([
      { group: { id: 'grp_live', name: 'Live Rates Trip', emoji: '📈' } },
      { group: { id: 'grp_fb', name: 'Fallback Trip', emoji: '📉' } },
    ]);
    // Fresh cache row for GBP with USD but NOT INR — INR is present in the
    // bundled fallback table, so it resolves with a fallback flag (same
    // fixture technique as friends-route.test.ts's usedFallbackRates test).
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.79 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const [sam] = res.json();

    // Top-level blanket flag unchanged: any contributing fallback → true.
    expect(sam.usedFallbackRates).toBe(true);

    const liveBucket = sam.balancesByGroup.find(
      (b: { group: { id: string } | null }) => b.group?.id === 'grp_live',
    );
    const fbBucket = sam.balancesByGroup.find(
      (b: { group: { id: string } | null }) => b.group?.id === 'grp_fb',
    );
    expect(liveBucket).toBeDefined();
    expect(fbBucket).toBeDefined();
    // The per-bucket attribution: USD bucket resolved live → false; INR
    // bucket patched from the bundled table → true. Never a blanket flag.
    expect(liveBucket.usedFallbackRates).toBe(false);
    expect(fbBucket.usedFallbackRates).toBe(true);
    // Both buckets still converted (no leftovers) — fallback ≠ unresolvable.
    expect(liveBucket.balances).toEqual([]);
    expect(fbBucket.balances).toEqual([]);
    expect(liveBucket.balancesConverted).not.toBeNull();
    expect(fbBucket.balancesConverted).not.toBeNull();
  });

  it('whole-base fallback: every converted bucket is flagged (the viewer currency itself never converts)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    friendshipFindManyMock.mockResolvedValue([friendshipWithSam()]);
    expenseFindManyMock.mockResolvedValue([
      expenseRow('USD', 'grp_a', 'sam', 'user_1', 5000),
      expenseRow('EUR', 'grp_b', 'sam', 'user_1', 4000),
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    groupMemberFindManyMock.mockResolvedValue([
      { group: { id: 'grp_a', name: 'Alpha', emoji: '🅰️' } },
      { group: { id: 'grp_b', name: 'Beta', emoji: '🅱️' } },
    ]);
    // No cache row + unreachable live API → the whole base resolution falls
    // back to the bundled table; every requested currency is a fallback code.
    exchangeRateCacheFindUniqueMock.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('live API unreachable')));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const [sam] = res.json();

    expect(sam.usedFallbackRates).toBe(true);
    expect(sam.balancesByGroup).toHaveLength(2);
    for (const bucket of sam.balancesByGroup) {
      expect(bucket.usedFallbackRates).toBe(true);
      expect(bucket.balances).toEqual([]);
      expect(bucket.balancesConverted).not.toBeNull();
    }
  });
});
