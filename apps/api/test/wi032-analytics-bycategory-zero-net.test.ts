import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * Regression coverage for story-WI-032 (reopened under analytics 2026-07-17:
 * "category filter/breakdown still shows ALL categories, not just ones with
 * expenses in view"). Design-stage investigation
 * (.company/domains/analytics/specs/spec-WI-032.md) found the server and
 * both client surfaces already correct and recommended no code change; this
 * is the regression test that locks the finding in so a future change to
 * routes/analytics.ts can't silently reintroduce the bug and cause a third
 * reopening of the same complaint.
 *
 * routes/analytics.ts builds `byCategory` from each expense's *caller share*
 * (shareOf(expense), i.e. the split amount belonging to userId), not the
 * expense's total amount — so a category can have nonzero `totalActivity`
 * while still being zero (and therefore excluded) for this caller's
 * byCategory if the caller paid but was not a split participant (share 0).
 * That is the exact "zero net amount for the caller" scenario this test
 * seeds.
 *
 * Follows the mocked-prisma / real-convert() "independent verify" pattern
 * established by wi019-independent-verify.test.ts: only Prisma model calls
 * are stubbed, resolveConversionRates/convert run for real.
 */

const userFindUniqueMock = vi.fn();
const groupMemberFindFirstMock = vi.fn();
const expenseFindManyMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const exchangeRateCacheUpsertMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    groupMember: { findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args) },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => exchangeRateCacheFindUniqueMock(...args),
      upsert: (...args: unknown[]) => exchangeRateCacheUpsertMock(...args),
    },
  },
}));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  userFindUniqueMock.mockReset();
  groupMemberFindFirstMock.mockReset();
  expenseFindManyMock.mockReset();
  exchangeRateCacheFindUniqueMock.mockReset();
  exchangeRateCacheUpsertMock.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('should not be called — cache is fresh')),
  );
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: 'user_1' });
});

afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
});

function expense(opts: {
  currency: string;
  amount: number;
  category: string;
  date: string;
  payerId: string;
  splits: { userId: string; amount: number }[];
}) {
  return {
    id: `exp_${opts.currency}_${opts.category}_${opts.date}`,
    amount: opts.amount,
    currency: opts.currency,
    category: opts.category,
    date: new Date(opts.date),
    groupId: null,
    group: null,
    payers: [{ userId: opts.payerId, amount: opts.amount }],
    splits: opts.splits,
  };
}

describe('WI-032 (analytics) — byCategory excludes categories with zero net amount for the caller', () => {
  it('drops a category where the caller paid but has no split share, while keeping categories with nonzero share', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    groupMemberFindFirstMock.mockResolvedValue(null);
    exchangeRateCacheFindUniqueMock.mockResolvedValue({
      id: 'cache_1',
      base: 'USD',
      rates: { USD: 1, EUR: 0.92 },
      fetchedAt: new Date(),
    });

    const currentExpenses = [
      // Caller (user_1) is a split participant here -> nonzero share, must
      // appear in byCategory.
      expense({
        currency: 'USD',
        amount: 10000,
        category: 'FOOD_DRINK',
        date: '2026-03-01T00:00:00.000Z',
        payerId: 'user_1',
        splits: [
          { userId: 'user_1', amount: 6000 },
          { userId: 'user_2', amount: 4000 },
        ],
      }),
      // Caller (user_1) fully paid this HOME expense on user_2's behalf and
      // has zero split share -> contributes to totalActivity but must be
      // excluded from byCategory (net-zero for the caller).
      expense({
        currency: 'USD',
        amount: 8000,
        category: 'HOME',
        date: '2026-03-05T00:00:00.000Z',
        payerId: 'user_1',
        splits: [{ userId: 'user_2', amount: 8000 }],
      }),
      // A second, nonzero-share category to confirm sort order/independence
      // from the zero-share row.
      expense({
        currency: 'EUR',
        amount: 3000,
        category: 'TRANSPORT',
        date: '2026-03-10T00:00:00.000Z',
        payerId: 'user_2',
        splits: [{ userId: 'user_1', amount: 3000 }],
      }),
    ];
    expenseFindManyMock.mockResolvedValueOnce(currentExpenses).mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/summary?from=2026-03-01T00:00:00.000Z&to=2026-03-31T00:00:00.000Z',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const eurToUsd = (minor: number) => Math.round(minor * (1 / 0.92));

    // HOME contributed to totalActivity...
    expect(body.totalActivity).toBe(10000 + 8000 + eurToUsd(3000));
    // ...but is absent from byCategory: only the two nonzero-share
    // categories are present, sorted amount-desc.
    expect(body.byCategory).toEqual([
      { category: 'FOOD_DRINK', amount: 6000 },
      { category: 'TRANSPORT', amount: eurToUsd(3000) },
    ]);
    expect(body.byCategory.find((c: { category: string }) => c.category === 'HOME')).toBeUndefined();
    expect(body.byCategory).toHaveLength(2);
  });
});
