import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * Test-stage independent verification for story-WI-019 ("You vs total" toggle
 * on the analytics monthly-trend chart).
 *
 * Written by test-analytics directly from story-WI-019.md's Gherkin scenarios
 * — NOT copied from apps/api/test/wi019-bymonth-total-activity-series.test.ts
 * (the Build-stage dev's own TDD suite). That suite only exercises an
 * unscoped (no groupId) request with EUR and PKR fixtures; this file
 * independently covers two gaps it left untouched:
 *
 *   1. The `groupId` filter scenario ("Toggle respects the existing group
 *      filter") — does the new `totalActivity` per-month series stay scoped
 *      to the filtered group exactly like `amount` does, or could it leak an
 *      out-of-group expense's full amount into the month bucket?
 *   2. A zero-decimal currency (JPY) exercised through the new accumulator —
 *      the dev suite's fixtures are all EUR/PKR (2/2-decimal-ish via the
 *      fallback table); JPY's 0-decimal exponent shift in convert() is the
 *      kind of edge a same-decimals-everywhere fixture set cannot catch.
 *
 * Only prisma model calls are mocked; resolveConversionRates/convert (the
 * real conversion engine) run for real, so this also doubles as an
 * integration case.
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
import { resetRatesMemoForTests } from '../src/lib/rates';

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
  // WI-072 §1's getRates() memo persists across it() blocks in this file
  // (both tests use base 'USD') unless cleared each time.
  resetRatesMemoForTests();
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
  groupId: string | null;
  payerId: string;
  splits: { userId: string; amount: number }[];
}) {
  return {
    id: `exp_${opts.currency}_${opts.date}_${opts.groupId ?? 'none'}`,
    amount: opts.amount,
    currency: opts.currency,
    category: opts.category,
    date: new Date(opts.date),
    groupId: opts.groupId,
    group: opts.groupId ? { id: opts.groupId, name: 'Trip', emoji: '🧳' } : null,
    payers: [{ userId: opts.payerId, amount: opts.amount }],
    splits: opts.splits,
  };
}

describe('WI-019 independent verification', () => {
  it('scopes the new totalActivity per-month series to groupId exactly like the existing amount series (AC: "Toggle respects the existing group filter")', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    // Caller is an active member of the filtered group.
    groupMemberFindFirstMock.mockResolvedValue({ id: 'member_1' });
    exchangeRateCacheFindUniqueMock.mockResolvedValue({
      id: 'cache_1',
      base: 'USD',
      rates: { USD: 1, EUR: 0.92 },
      fetchedAt: new Date(),
    });

    // The route's baseWhere applies `groupId` as a Prisma filter BEFORE the
    // query runs, so a real Postgres would never return the other group's
    // row for a groupId-scoped request. This mock stands in for that
    // filtering: it returns only rows Prisma would actually return for
    // `groupId: 'group_a'`, i.e. the out-of-group expense is deliberately
    // absent from the resolved list (not merely present-but-expected-to-be-
    // dropped), matching real DB-level filtering semantics.
    const inGroupExpense = expense({
      currency: 'EUR',
      amount: 8000, // 80.00 EUR total activity
      category: 'FOOD',
      date: '2026-03-10T00:00:00.000Z',
      groupId: 'group_alpha_01',
      payerId: 'user_1',
      splits: [{ userId: 'user_1', amount: 4000 }],
    });
    expenseFindManyMock.mockResolvedValueOnce([inGroupExpense]).mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/summary?groupId=group_alpha_01&from=2026-03-01T00:00:00.000Z&to=2026-03-31T00:00:00.000Z',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const eurToUsd = (minor: number) => Math.round(minor * (1 / 0.92));

    // Membership check ran against exactly the requested group.
    expect(groupMemberFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ groupId: 'group_alpha_01' }) }),
    );
    // The findMany `current` query was scoped with the groupId filter.
    const currentCallArgs = expenseFindManyMock.mock.calls[0][0];
    expect(currentCallArgs.where.groupId).toBe('group_alpha_01');

    // Both the your-spend (amount) and total-activity series reflect only
    // the in-group expense — no leakage, no divergence between the two.
    expect(body.byMonth).toEqual([
      { month: '2026-03', amount: eurToUsd(4000), totalActivity: eurToUsd(8000) },
    ]);
    expect(body.totalActivity).toBe(eurToUsd(8000));
  });

  it('carries a zero-decimal currency (JPY) through the new per-month totalActivity accumulator with no rounding divergence from the whole-range scalar', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    groupMemberFindFirstMock.mockResolvedValue(null);
    exchangeRateCacheFindUniqueMock.mockResolvedValue({
      id: 'cache_1',
      base: 'USD',
      rates: { USD: 1, JPY: 149.32 },
      fetchedAt: new Date(),
    });

    // Two JPY expenses (0 decimal minor units) in the same month, an odd
    // amount chosen so eur/usd-style "nice" fixtures wouldn't catch a
    // divergent rounding path on the 0-decimal exponent shift.
    const currentExpenses = [
      expense({
        currency: 'JPY',
        amount: 1237, // 1237 JPY total activity (0-decimal currency: minor === major)
        category: 'FOOD',
        date: '2026-04-05T00:00:00.000Z',
        groupId: null,
        payerId: 'user_1',
        splits: [{ userId: 'user_1', amount: 611 }],
      }),
      expense({
        currency: 'JPY',
        amount: 458,
        category: 'TRANSPORT',
        date: '2026-04-18T00:00:00.000Z',
        groupId: null,
        payerId: 'user_2',
        splits: [{ userId: 'user_1', amount: 100 }],
      }),
    ];
    expenseFindManyMock.mockResolvedValueOnce(currentExpenses).mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/summary?from=2026-04-01T00:00:00.000Z&to=2026-04-30T00:00:00.000Z',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // JPY has 0 decimals, USD has 2 — convert()'s exponentShift is
    // 10^(2-0) = 100 on top of the raw cross rate (see lib/rates.ts convert()).
    const jpyToUsd = (minor: number) => Math.round(minor * (1 / 149.32) * 100);

    const expectedTotalActivity = jpyToUsd(1237) + jpyToUsd(458);
    expect(body.totalActivity).toBe(expectedTotalActivity);
    expect(body.byMonth).toEqual([
      {
        month: '2026-04',
        amount: jpyToUsd(611) + jpyToUsd(100),
        totalActivity: expectedTotalActivity,
      },
    ]);

    // No divergence: summing the one-month totalActivity series equals the
    // whole-range scalar exactly (same convert() call, one rounding step,
    // per spec-WI-019 § Server aggregation change).
    const summedFromMonths = body.byMonth.reduce(
      (sum: number, m: { totalActivity: number }) => sum + m.totalActivity,
      0,
    );
    expect(summedFromMonths).toBe(body.totalActivity);
  });
});
