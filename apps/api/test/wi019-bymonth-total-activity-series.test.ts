import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// WI-019 — "You vs total" toggle on the analytics monthly-trend chart.
// spec-WI-019.md § Server aggregation change / ADR-011: byMonth gains a
// second per-month `totalActivity` series, fed by the SAME convert() result
// already accumulated into the whole-range totalActivity scalar (one
// conversion call, one rounding step), zero-filled over the SAME
// monthGrid(from, to) as the existing `amount` (your-spend) series.
//
// Test-plan: this file (analytics/test-plans has no dedicated WI-019 plan at
// build time; acceptance criteria taken directly from story-WI-019.md).

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

describe('WI-019: GET /analytics/summary byMonth carries both amount and totalActivity series', () => {
  it('buckets both series per month from the same converted values, zero-filled over the identical grid', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    groupMemberFindFirstMock.mockResolvedValue(null);
    exchangeRateCacheFindUniqueMock.mockResolvedValue({
      id: 'cache_1',
      base: 'USD',
      rates: { USD: 1, EUR: 0.92 },
      fetchedAt: new Date(),
    });

    // Two expenses in the same month (March) and one in a later month
    // (May), all EUR -> USD, no fallback needed. February and April have no
    // expenses and must still appear zero-filled in BOTH series.
    const currentExpenses = [
      expense({
        currency: 'EUR',
        amount: 10000, // 100.00 EUR total activity
        category: 'FOOD',
        date: '2026-03-01T00:00:00.000Z',
        payerId: 'user_1',
        splits: [
          { userId: 'user_1', amount: 6000 }, // your share
          { userId: 'user_2', amount: 4000 },
        ],
      }),
      expense({
        currency: 'EUR',
        amount: 2000, // 20.00 EUR total activity
        category: 'TRANSPORT',
        date: '2026-03-20T00:00:00.000Z',
        payerId: 'user_2',
        splits: [
          { userId: 'user_1', amount: 500 },
          { userId: 'user_2', amount: 1500 },
        ],
      }),
      expense({
        currency: 'EUR',
        amount: 5000, // 50.00 EUR total activity
        category: 'FOOD',
        date: '2026-05-15T00:00:00.000Z',
        payerId: 'user_1',
        splits: [{ userId: 'user_1', amount: 5000 }],
      }),
    ];
    expenseFindManyMock
      .mockResolvedValueOnce(currentExpenses) // `current` query
      .mockResolvedValueOnce([]); // `previous` query

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/summary?from=2026-02-01T00:00:00.000Z&to=2026-05-31T00:00:00.000Z',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    const eurToUsd = (minor: number) => Math.round(minor * (1 / 0.92));

    // Whole-range scalar must match the sum of the per-month totalActivity
    // series (same convert() result, one conversion, no divergence).
    const expectedTotalActivityScalar = eurToUsd(10000) + eurToUsd(2000) + eurToUsd(5000);
    expect(body.totalActivity).toBe(expectedTotalActivityScalar);

    expect(body.byMonth).toEqual([
      { month: '2026-02', amount: 0, totalActivity: 0 },
      {
        month: '2026-03',
        amount: eurToUsd(6000) + eurToUsd(500),
        totalActivity: eurToUsd(10000) + eurToUsd(2000),
      },
      { month: '2026-04', amount: 0, totalActivity: 0 },
      { month: '2026-05', amount: eurToUsd(5000), totalActivity: eurToUsd(5000) },
    ]);

    // Both series share the identical set of month keys — no month present
    // in one series and missing from the other (story-WI-019 AC).
    const months = body.byMonth.map((m: { month: string }) => m.month);
    expect(months).toEqual(['2026-02', '2026-03', '2026-04', '2026-05']);
    for (const entry of body.byMonth) {
      expect(entry).toHaveProperty('amount');
      expect(entry).toHaveProperty('totalActivity');
    }

    // Sum of the per-month totalActivity series must equal the whole-range
    // totalActivity scalar (same conversion path, one rounding step).
    const summedFromMonths = body.byMonth.reduce(
      (sum: number, m: { totalActivity: number }) => sum + m.totalActivity,
      0,
    );
    expect(summedFromMonths).toBe(body.totalActivity);

    // `amount` (your-spend series) meaning is unchanged: sum equals yourSpend.
    const summedYourSpendFromMonths = body.byMonth.reduce(
      (sum: number, m: { amount: number }) => sum + m.amount,
      0,
    );
    expect(summedYourSpendFromMonths).toBe(body.yourSpend);

    // usedFallbackRates untouched by this change.
    expect(body.usedFallbackRates).toBe(false);
  });

  it('flags usedFallbackRates and applies the fallback-patched rate identically to both byMonth series and the whole-range totalActivity scalar', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    groupMemberFindFirstMock.mockResolvedValue(null);
    // PKR missing from the live map -> must be patched from the bundled
    // fallback table for BOTH the scalar and the month bucket.
    exchangeRateCacheFindUniqueMock.mockResolvedValue({
      id: 'cache_1',
      base: 'USD',
      rates: { USD: 1 },
      fetchedAt: new Date(),
    });

    const currentExpenses = [
      expense({
        currency: 'PKR',
        amount: 50000, // 500.00 PKR
        category: 'TRANSPORT',
        date: '2026-06-05T00:00:00.000Z',
        payerId: 'user_1',
        splits: [{ userId: 'user_1', amount: 25000 }],
      }),
    ];
    expenseFindManyMock.mockResolvedValueOnce(currentExpenses).mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/summary?from=2026-06-01T00:00:00.000Z&to=2026-06-30T00:00:00.000Z',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const pkrToUsd = (minor: number) => Math.round(minor * (1 / 278));

    expect(body.usedFallbackRates).toBe(true);
    expect(body.totalActivity).toBe(pkrToUsd(50000));
    expect(body.byMonth).toEqual([
      { month: '2026-06', amount: pkrToUsd(25000), totalActivity: pkrToUsd(50000) },
    ]);
  });
});
