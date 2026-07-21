// Test-stage white-box coverage — settlements WI-001/WI-002.
//
// Code-aware cases targeting the branches build-WI-002.md's "Notes for Test
// stage" flagged: (1) analytics' convert() exponent-shift math when the
// from/to currencies have different minor-unit decimal exponents (settlements
// exercises this same primitive via balances.ts' tryConvert — the note in
// build-WI-002.md (analytics domain) recommending this case applies equally
// here since settlements calls the identical convert()), and (2)
// build-WI-001.md's documented "totals nets to exactly zero while the
// currency is still individually unresolved" interpretation for
// converted.unresolved's representative amount.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const manualExchangeRateFindUniqueMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    groupMember: { findFirst: vi.fn(), findMany: vi.fn() },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => exchangeRateCacheFindUniqueMock(...args),
      upsert: vi.fn(),
    },
    manualExchangeRate: {
      findUnique: (...args: unknown[]) => manualExchangeRateFindUniqueMock(...args),
    },
  },
}));

// Strip THB from the fallback table so the "stays unresolved" case (test 3)
// can't accidentally resolve via the bundled fallback map.
vi.mock('../src/lib/rates-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates-fallback')>();
  const { THB: _omitted, ...rest } = actual.FALLBACK_RATES;
  return { FALLBACK_RATES: rest };
});

import { buildApp } from '../src/app';
import { convert } from '../src/lib/rates';
import { resetCacheForTests } from '../src/lib/cache';

let app: FastifyInstance;
let token: string;

const USER_ID = 'user_id_1';

function freshCacheRow(base: string, rates: Record<string, number>) {
  return { id: 'cache_1', base, rates, fetchedAt: new Date() };
}

function expense(currency: string, amount: number, payerId: string, owerId: string) {
  return {
    currency,
    payers: [{ userId: payerId, amount }],
    splits: [
      { userId: owerId, amount },
      { userId: payerId, amount: 0 },
    ],
  };
}

beforeEach(async () => {
  userFindUniqueMock.mockReset();
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();
  exchangeRateCacheFindUniqueMock.mockReset();
  manualExchangeRateFindUniqueMock.mockReset();
  manualExchangeRateFindUniqueMock.mockResolvedValue(null);
  // WI-067: cache.ts's response/generation stores are process-wide singletons
  // (ADR-030), so this file's fixed USER_ID + repeated GET /balance calls
  // across it()s (with reconfigured mocks, no bump in between) would
  // otherwise collide with an earlier test's still-warm cache entry.
  resetCacheForTests();

  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: USER_ID });
});

afterEach(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// WB-1 — apps/api/src/lib/rates.ts:convert() exponentShift branch: converting
// FROM a 2-decimal currency (USD) TO a 0-decimal currency (JPY, per
// packages/shared/src/currencies.ts) via a real HTTP round trip through
// settlements' GET /balance (real analytics convert(), only prisma mocked).
// ---------------------------------------------------------------------------
describe('WB-1 — convert() exponent-shift across differing minor-unit decimals', () => {
  it('unit: convert() scales correctly USD (2 decimals) -> JPY (0 decimals)', () => {
    // Rates keyed on base=JPY: 1 JPY = 1 JPY; 1 JPY = 1/150 USD (i.e. 150 JPY = 1 USD).
    const rates = { JPY: 1, USD: 1 / 150 };
    // $100.00 (10000 minor units) -> expect 15000 (¥15,000, 0 decimals).
    expect(convert(10000, 'USD', 'JPY', rates)).toBe(15000);
  });

  it('unit: convert() scales correctly JPY (0 decimals) -> USD (2 decimals), inverse direction', () => {
    const rates = { JPY: 1, USD: 1 / 150 };
    // ¥15,000 -> expect 10000 minor units ($100.00).
    expect(convert(15000, 'JPY', 'USD', rates)).toBe(10000);
  });

  it('unit: convert() scales correctly across a 3-decimal currency (KWD) and a 0-decimal one (JPY)', () => {
    // 1 KWD = 1000 minor units; pick a rate where 1 KWD = 400 JPY.
    const rates = { JPY: 1, KWD: 1 / 400 };
    // 1.000 KWD (1000 minor units) -> 400 JPY (0 decimals).
    expect(convert(1000, 'KWD', 'JPY', rates)).toBe(400);
  });

  it('end-to-end via GET /balance: a JPY debt converts correctly into the caller\'s 2-decimal defaultCurrency', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    // friend_a owes user 15000 JPY (¥15,000).
    expenseFindManyMock.mockResolvedValue([expense('JPY', 15000, USER_ID, 'friend_a')]);
    settlementFindManyMock.mockResolvedValue([]);
    // base=USD; 1 USD = 150 JPY.
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, JPY: 150 }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { converted } = res.json();
    // 15000 JPY (0 decimals) at 150 JPY/USD -> $100.00 (10000 minor units, 2 decimals).
    expect(converted.youAreOwed).toBe(10000);
    expect(converted.unresolved).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WB-2 — apps/api/src/routes/balances.ts `sumMap`'s documented interpretation
// (build-WI-001.md, "Notes for Test stage"): when a currency appears in both
// youOwe and youAreOwed and nets to exactly zero in `totals`, but the pair is
// individually unresolved, the surfaced `unresolved` amount reads 0 (sourced
// from `totals`) even though the underlying per-direction debts are
// non-zero. This confirms the build's documented behavior so a future change
// doesn't silently alter it without Test stage noticing.
// ---------------------------------------------------------------------------
describe('WB-2 — unresolved-but-zero-net currency: documented amount interpretation', () => {
  it('flags the currency as unresolved with amount 0 when youOwe and youAreOwed cancel out exactly', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    // user owes friend_a 500 THB, and is owed 500 THB by friend_b — nets to
    // exactly 0 in `totals`, but THB->GBP is unresolvable in both directions.
    expenseFindManyMock.mockResolvedValue([
      expense('THB', 500, 'friend_a', USER_ID),
      expense('THB', 500, USER_ID, 'friend_b'),
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1 }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Native per-direction amounts are correct and non-zero.
    expect(body.youOwe).toEqual([{ currency: 'THB', amount: 500 }]);
    expect(body.youAreOwed).toEqual([{ currency: 'THB', amount: 500 }]);
    expect(body.totals).toEqual([]); // nets to 0, filtered out by toCurrencyAmounts
    // Documented (not a bug) interpretation: the currency IS flagged as
    // unresolved (never silently dropped), but its representative `amount`
    // reads 0 because it's sourced from `totals`, not from youOwe/youAreOwed.
    expect(body.converted.unresolved).toEqual([{ currency: 'THB', amount: 0 }]);
  });
});
