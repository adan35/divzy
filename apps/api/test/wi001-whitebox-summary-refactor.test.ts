import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// TC-WB1-01 — white-box case flagged explicitly in build-WI-001.md's "Notes
// for Test stage": the routes/analytics.ts summary-endpoint refactor
// (inline fallback-patch loop -> resolveConversionRates) is "glue code
// exercised only by the full regression suite, not a dedicated new unit
// test." This is that dedicated test: a golden, hand-computed,
// mixed-currency fixture confirming GET /analytics/summary still returns
// correct usedFallbackRates + amount values post-refactor.
//
// Test-plan: .company/domains/analytics/test-plans/test-plan-WI-001.md

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
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('should not be called — cache is fresh')));
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
    id: `exp_${opts.currency}_${opts.date}`,
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

describe('TC-WB1-01: GET /analytics/summary preserves behavior through the resolveConversionRates refactor', () => {
  it('computes yourSpend/totalActivity/previousYourSpend/usedFallbackRates identically for a mixed-currency, partially-fallback fixture', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    groupMemberFindFirstMock.mockResolvedValue(null);
    // Fresh USD-base cache with EUR live but PKR absent -> must be patched
    // from the bundled fallback table, flagging usedFallbackRates.
    exchangeRateCacheFindUniqueMock.mockResolvedValue({
      id: 'cache_1',
      base: 'USD',
      rates: { USD: 1, EUR: 0.92 },
      fetchedAt: new Date(),
    });

    // Current-period expenses (within [from, to]):
    const currentExpenses = [
      expense({
        currency: 'EUR',
        amount: 10000, // 100.00 EUR
        category: 'FOOD',
        date: '2026-03-01T00:00:00.000Z',
        payerId: 'user_1',
        splits: [
          { userId: 'user_1', amount: 6000 },
          { userId: 'user_2', amount: 4000 },
        ],
      }),
      expense({
        currency: 'PKR', // missing from the live map -> patched from fallback
        amount: 50000, // 500.00 PKR
        category: 'TRANSPORT',
        date: '2026-03-05T00:00:00.000Z',
        payerId: 'user_2',
        splits: [
          { userId: 'user_1', amount: 25000 },
          { userId: 'user_2', amount: 25000 },
        ],
      }),
    ];
    const previousExpenses = [
      expense({
        currency: 'EUR',
        amount: 4000, // 40.00 EUR, full share to user_1
        category: 'FOOD',
        date: '2025-09-01T00:00:00.000Z',
        payerId: 'user_1',
        splits: [{ userId: 'user_1', amount: 4000 }],
      }),
    ];
    expenseFindManyMock
      .mockResolvedValueOnce(currentExpenses) // `current` query
      .mockResolvedValueOnce(previousExpenses); // `previous` query

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/summary?from=2026-01-13T00:00:00.000Z&to=2026-07-13T00:00:00.000Z',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Hand-computed expectations (independent of the route's own convert()
    // calls): EUR/USD cross-rate = 1/0.92; PKR/USD cross-rate patched from
    // the real bundled fallback table (FALLBACK_RATES.PKR = 278, so
    // PKR->USD = 1/278), both at exponentShift=1 (all three currencies are
    // 2-decimal).
    const eurToUsd = (minor: number) => Math.round(minor * (1 / 0.92));
    const pkrToUsd = (minor: number) => Math.round(minor * (1 / 278));

    const expectedYourSpend = eurToUsd(6000) + pkrToUsd(25000); // 6522 + 90
    const expectedTotalActivity = eurToUsd(10000) + pkrToUsd(50000); // 10870 + 180
    const expectedPreviousYourSpend = eurToUsd(4000); // 4348

    expect(expectedYourSpend).toBe(6612);
    expect(expectedTotalActivity).toBe(11050);
    expect(expectedPreviousYourSpend).toBe(4348);

    expect(body.currency).toBe('USD');
    expect(body.usedFallbackRates).toBe(true);
    expect(body.yourSpend).toBe(expectedYourSpend);
    expect(body.totalActivity).toBe(expectedTotalActivity);
    expect(body.previousYourSpend).toBe(expectedPreviousYourSpend);

    expect(body.byCategory).toEqual([
      { category: 'FOOD', amount: eurToUsd(6000) },
      { category: 'TRANSPORT', amount: pkrToUsd(25000) },
    ]);

    // Concurrency note from build-WI-001.md: the refactor fetches expenses
    // before resolving rates (rates fetch is no longer concurrent with the
    // expense queries). Functionally this must still mean exactly one
    // ExchangeRateCache read for the whole request, not one per expense.
    expect(exchangeRateCacheFindUniqueMock).toHaveBeenCalledTimes(1);
  });
});
