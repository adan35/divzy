// Test-stage integration coverage — settlements WI-001/WI-002.
//
// Cross-boundary cases per the Test-stage brief: (1) settlements' balances.ts
// calling analytics' real convertAmountForUser/convert (never mocked) and
// getting a real converted figure end-to-end; (2) the WI-002 manual-rate flow
// round-tripping through POST /api/v1/rates/manual and then being consumed by
// a subsequent GET /balance read, in the same running app instance; (3)
// story-WI-001's "multiple native-currency debts to the same friend collapse
// to one converted number... settling only the USD debt reduces the
// converted total while the EUR debt remains outstanding" — explicitly
// flagged as NOT independently unit-tested in build-WI-001.md's Frontend
// "Notes for Test stage" ("recommend an integration/E2E check").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const manualExchangeRateUpsertMock = vi.fn();
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
      upsert: (...args: unknown[]) => manualExchangeRateUpsertMock(...args),
      findUnique: (...args: unknown[]) => manualExchangeRateFindUniqueMock(...args),
    },
  },
}));

// Strip PKR from the bundled fallback table so the automatic chain genuinely
// cannot resolve it — forcing the manual-rate path to be the only route to
// resolution, exactly like the manual-rate scenario requires.
vi.mock('../src/lib/rates-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates-fallback')>();
  const { PKR: _omitted, ...rest } = actual.FALLBACK_RATES;
  return { FALLBACK_RATES: rest };
});

import { buildApp } from '../src/app';
import { bumpUserGeneration, resetCacheForTests } from '../src/lib/cache';
import { resetRatesMemoForTests } from '../src/lib/rates';

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
  manualExchangeRateUpsertMock.mockReset();
  manualExchangeRateFindUniqueMock.mockReset();
  manualExchangeRateFindUniqueMock.mockResolvedValue(null);
  // WI-067: cache.ts's response/generation stores are process-wide singletons
  // (ADR-030), so this file's fixed USER_ID + repeated GET /balance calls
  // across it()s (with reconfigured mocks, no bump in between) would
  // otherwise collide with an earlier test's still-warm cache entry.
  resetCacheForTests();
  // WI-072 §1's getRates() memo persists across it() blocks in this file
  // unless cleared each time (same reason as resetCacheForTests above).
  resetRatesMemoForTests();

  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: USER_ID });
});

afterEach(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// INT-1 — story-WI-002 · "Happy path — supplied rate is used immediately":
// submit a rate through analytics' real POST /api/v1/rates/manual, then a
// subsequent GET /api/v1/balance (settlements) picks it up via
// convertAmountForUser -> prisma.manualExchangeRate.findUnique, with zero
// settlements-side special-casing.
// ---------------------------------------------------------------------------
describe('INT-1 — manual rate round-trips from POST /rates/manual into a later GET /balance', () => {
  it('a rate stored via POST /api/v1/rates/manual resolves the same pair on the next balance read', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    expenseFindManyMock.mockResolvedValue([expense('PKR', 10000, 'friend_a', USER_ID)]); // owes 10000 PKR
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1 })); // PKR unresolvable automatically

    // Step 1 — before any manual rate exists: PKR is unresolved.
    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().converted.unresolved).toEqual([{ currency: 'PKR', amount: -10000 }]);

    // Step 2 — the user submits a manual rate via analytics' real endpoint.
    manualExchangeRateUpsertMock.mockResolvedValue({
      id: 'm1',
      userId: USER_ID,
      fromCurrency: 'PKR',
      toCurrency: 'GBP',
      rate: 0.0029, // 1 PKR = 0.0029 GBP
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
      updatedAt: new Date('2026-07-14T00:00:00.000Z'),
    });
    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: { authorization: `Bearer ${token}` },
      payload: { from: 'PKR', to: 'GBP', rate: 0.0029 },
    });
    expect(submit.statusCode).toBe(200);
    expect(manualExchangeRateUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_fromCurrency_toCurrency: {
            userId: USER_ID,
            fromCurrency: 'PKR',
            toCurrency: 'GBP',
          },
        },
      }),
    );

    // Step 3 — simulate the row now being persisted (what a real DB would
    // return on the next findUnique after the upsert above).
    manualExchangeRateFindUniqueMock.mockResolvedValue({
      id: 'm1',
      userId: USER_ID,
      fromCurrency: 'PKR',
      toCurrency: 'GBP',
      rate: 0.0029,
    });

    // Step 4 — a subsequent GET /balance now resolves PKR via the stored
    // manual rate, with no settlements-side knowledge of "why" it resolved.
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(200);
    const { converted } = after.json();
    expect(converted.unresolved).toEqual([]);
    expect(converted.youOwe).toBe(29); // round(10000 * 0.0029)
  });
});

// ---------------------------------------------------------------------------
// INT-2 — story-WI-001 · "Edge case — multiple native-currency debts to the
// same friend collapse to one converted number": two debts in different
// currencies to different counterparts combine into one converted total;
// settling the USD one (a real POST /settlements call, native amount
// recorded) leaves the EUR debt outstanding and still contributing.
// ---------------------------------------------------------------------------
describe('INT-2 — settling one of two currencies leaves the other outstanding in the converted total', () => {
  it('converted.total drops by exactly the settled currency\'s converted value; the other currency still contributes', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    // Owed 2000 USD by friend_a AND owed 1500 EUR by friend_b.
    expenseFindManyMock.mockResolvedValue([
      expense('USD', 2000, USER_ID, 'friend_a'),
      expense('EUR', 1500, USER_ID, 'friend_b'),
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    // base=GBP; 1 USD = 0.79 GBP, 1 EUR = 0.86 GBP.
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.79, EUR: 1 / 0.86 }),
    );

    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json();
    const usdConverted = Math.round(2000 * 0.79); // 1580
    const eurConverted = Math.round(1500 * 0.86); // 1290
    expect(beforeBody.converted.youAreOwed).toBe(usdConverted + eurConverted); // 2870
    expect(beforeBody.converted.total).toBe(usdConverted + eurConverted);

    // Now the USD debt to friend_a gets fully settled (native amount, per
    // story-WI-001's other scenario) — reflected by the next ledger read
    // including that Settlement row.
    settlementFindManyMock.mockResolvedValue([
      { currency: 'USD', fromUserId: 'friend_a', toUserId: USER_ID, amount: 2000 },
    ]);
    // WI-067: GET /balance is now cached (15s TTL) with instant invalidation
    // ONLY on a generation bump. This test reconfigures the ledger mock
    // directly rather than driving the real POST /settlements route (which
    // would call `bumpUsers([fromUserId, toUserId])`, site S1/S2 in
    // spec-WI-067 §4.2) — so the equivalent real-world bump is simulated
    // here to preserve this test's "next read reflects the new ledger"
    // premise instead of silently asserting a stale cache hit.
    bumpUserGeneration(USER_ID);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(200);
    const afterBody = after.json();
    // USD fully paid down -> nets to 0 -> filtered from youAreOwed/totals entirely.
    expect(afterBody.youAreOwed).toEqual([{ currency: 'EUR', amount: 1500 }]);
    // The converted total dropped by exactly the USD debt's converted value;
    // the EUR debt remains outstanding and still contributes.
    expect(afterBody.converted.youAreOwed).toBe(eurConverted);
    expect(afterBody.converted.total).toBe(eurConverted);
    expect(afterBody.converted.total).toBe(beforeBody.converted.total - usdConverted);
  });
});
