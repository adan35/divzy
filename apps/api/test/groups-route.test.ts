import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const groupFindManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const exchangeRateCacheUpsertMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    group: { findMany: (...args: unknown[]) => groupFindManyMock(...args) },
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

/** A fresh (< 12h old) ExchangeRateCache row for `base`, matching resolveConversionRates. */
function freshCacheRow(base: string, rates: Record<string, number>) {
  return { id: 'cache_1', base, rates, fetchedAt: new Date() };
}

/**
 * GET /groups (WI-008) calls `prisma.settlement.findMany` twice — once for
 * "direct" (groupId in the caller's groups) settlements, once for candidate
 * null-groupId settlements between the caller's own social circle — and
 * routes each call by its own `where.groupId` shape. This helper wires both
 * behind the one mock so existing tests that only care about the "direct"
 * list don't need to know about the second call (it defaults to []).
 */
function mockSettlements(direct: unknown[], nullGroup: unknown[] = []) {
  settlementFindManyMock.mockImplementation(async (args: { where?: { groupId?: unknown } }) => {
    if (args?.where?.groupId === null) return nullGroup;
    return direct;
  });
}

beforeEach(async () => {
  userFindUniqueMock.mockReset();
  groupFindManyMock.mockReset();
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();
  groupMemberFindManyMock.mockReset();
  groupMemberFindManyMock.mockResolvedValue([]);
  exchangeRateCacheFindUniqueMock.mockReset();
  exchangeRateCacheUpsertMock.mockReset();
  // WI-070: GET /groups is now wrapped in the process-wide response cache
  // (same as GET /balance since WI-067), keyed on this fixed userId with no
  // query params — every it() below must start from a cold cache, otherwise
  // a later test's mock reconfiguration would never be observed.
  resetCacheForTests();
  // WI-072 §1's getRates() memo persists across it() blocks in this file
  // (base 'GBP' re-mocked per test) unless cleared each time.
  resetRatesMemoForTests();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: 'user_1' });
});

afterEach(async () => {
  await app.close();
});

function group(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'group_1',
    name: 'Trip to Lisbon',
    emoji: '🧾',
    type: 'TRIP',
    currency: 'USD',
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    archivedAt: null,
    members: [{ userId: 'user_1' }, { userId: 'user_2' }],
    ...overrides,
  };
}

// story-WI-001 (social-groups) scenarios ------------------------------------------------

describe('GET /api/v1/groups', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/groups' });
    expect(res.statusCode).toBe(401);
  });

  it('collapses a multi-currency balance to one converted figure in the viewer defaultCurrency (Groups list collapses a multi-currency balance to one converted figure)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    groupFindManyMock.mockResolvedValue([group()]);
    expenseFindManyMock.mockResolvedValue([
      {
        groupId: 'group_1',
        currency: 'USD',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'user_2', amount: 5000 }],
        splits: [
          { userId: 'user_1', amount: 5000 },
          { userId: 'user_2', amount: 0 },
        ],
      },
      {
        groupId: 'group_1',
        currency: 'EUR',
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
        payers: [{ userId: 'user_2', amount: 3000 }],
        splits: [
          { userId: 'user_1', amount: 3000 },
          { userId: 'user_2', amount: 0 },
        ],
      },
    ]);
    mockSettlements([]);
    // base=GBP; rates are "units of X per 1 GBP" — 1 USD = 0.79 GBP => 1 GBP = 1/0.79 USD.
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.79, EUR: 1 / 0.86 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [summary] = res.json();
    expect(summary.yourBalances).toEqual([]);
    expect(summary.yourBalanceConverted).toEqual({ currency: 'GBP', amount: -6530 });
    expect(summary.usedFallbackRates).toBe(false);
    expect(exchangeRateCacheFindUniqueMock).toHaveBeenCalledTimes(1); // one resolveConversionRates call for the whole request
  });

  it('converts each group card independently, never pooling balances across groups (Each group card converts independently, not pooled across groups)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    groupFindManyMock.mockResolvedValue([
      group({ id: 'lisbon', name: 'Trip to Lisbon' }),
      group({ id: 'home', name: 'Home' }),
    ]);
    expenseFindManyMock.mockResolvedValue([
      {
        groupId: 'lisbon',
        currency: 'USD',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'user_2', amount: 5000 }],
        splits: [
          { userId: 'user_1', amount: 5000 },
          { userId: 'user_2', amount: 0 },
        ],
      },
      {
        groupId: 'home',
        currency: 'EUR',
        createdAt: new Date('2026-07-04T00:00:00.000Z'),
        payers: [{ userId: 'user_1', amount: 2000 }],
        splits: [
          { userId: 'user_1', amount: 0 },
          { userId: 'user_2', amount: 2000 },
        ],
      },
    ]);
    mockSettlements([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.79, EUR: 1 / 0.86 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    const summaries = res.json();
    const lisbon = summaries.find((s: { id: string }) => s.id === 'lisbon');
    const home = summaries.find((s: { id: string }) => s.id === 'home');
    expect(lisbon.yourBalanceConverted).toEqual({ currency: 'GBP', amount: -3950 }); // -£39.50, owe 50 USD
    expect(home.yourBalanceConverted).toEqual({ currency: 'GBP', amount: 1720 }); // +£17.20, owed 20 EUR
  });

  it('falls back to the native leftover line when a currency has no resolvable rate, without failing the request (A currency the engine cannot rate falls back to the current unconverted display)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    groupFindManyMock.mockResolvedValue([group()]);
    expenseFindManyMock.mockResolvedValue([
      {
        groupId: 'group_1',
        currency: 'PKR',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'user_2', amount: 100000 }],
        splits: [
          { userId: 'user_1', amount: 100000 },
          { userId: 'user_2', amount: 0 },
        ],
      },
    ]);
    mockSettlements([]);
    // GBP cache present but missing PKR entirely -> even the fallback table lookup
    // is exercised by resolveConversionRates; simulate total unresolvability by
    // returning a cache with no PKR and letting the (real) bundled fallback patch it.
    // To force a genuine RATE_UNAVAILABLE we must also strip PKR from the fallback
    // table, which the vi.mock below (module-level) already does for this file.
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1 }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [summary] = res.json();
    expect(summary.yourBalances).toEqual([{ currency: 'PKR', amount: -100000 }]);
    expect(summary.yourBalanceConverted).toBeNull();
    // Genuinely unresolvable (even the bundled fallback table has no PKR entry in
    // this test, see the module-level rates-fallback mock below) — no fallback rate
    // was actually *used*, so usedFallbackRates correctly stays false here; a currency
    // that DOES resolve via the fallback table is covered by the next test.
    expect(summary.usedFallbackRates).toBe(false);
  });

  it('flags usedFallbackRates when a currency needed the bundled fallback rate table but still resolved (Conversion source is live/cached rates unless the automatic chain is exhausted)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    groupFindManyMock.mockResolvedValue([group()]);
    expenseFindManyMock.mockResolvedValue([
      {
        groupId: 'group_1',
        currency: 'INR', // present in the bundled fallback table, absent from the live/cached map below
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'user_2', amount: 100000 }],
        splits: [
          { userId: 'user_1', amount: 100000 },
          { userId: 'user_2', amount: 0 },
        ],
      },
    ]);
    mockSettlements([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1 }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [summary] = res.json();
    expect(summary.yourBalances).toEqual([]); // resolved via fallback table, not a leftover
    expect(summary.yourBalanceConverted).not.toBeNull();
    expect(summary.usedFallbackRates).toBe(true);
  });

  it('folds settlements into the net before converting (settlement-side grouping branch)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    groupFindManyMock.mockResolvedValue([group()]);
    expenseFindManyMock.mockResolvedValue([
      {
        groupId: 'group_1',
        currency: 'USD',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'user_2', amount: 10000 }],
        splits: [
          { userId: 'user_1', amount: 10000 },
          { userId: 'user_2', amount: 0 },
        ],
      },
    ]);
    mockSettlements([
      {
        groupId: 'group_1',
        currency: 'USD',
        createdAt: new Date('2026-07-05T00:00:00.000Z'),
        fromUserId: 'user_1',
        toUserId: 'user_2',
        amount: 3000, // partial settlement — reduces (but doesn't zero) the net
      },
    ]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.79 }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [summary] = res.json();
    expect(summary.yourBalanceConverted).toEqual({ currency: 'GBP', amount: -5530 }); // -70.00 USD net * 0.79
  });

  it('shows settled up (empty balances, null converted) for a group with zero net across all currencies', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    groupFindManyMock.mockResolvedValue([group()]);
    expenseFindManyMock.mockResolvedValue([]);
    mockSettlements([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [summary] = res.json();
    expect(summary.yourBalances).toEqual([]);
    expect(summary.yourBalanceConverted).toBeNull();
    // Fully settled up -> no currency to resolve rates for, so resolveConversionRates
    // is still called once (per-request contract) but with no extra currencies.
    expect(exchangeRateCacheFindUniqueMock).toHaveBeenCalledTimes(1);
  });

  it('returns [] without touching the rates engine when the caller belongs to no groups', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    groupFindManyMock.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(exchangeRateCacheFindUniqueMock).not.toHaveBeenCalled();
  });
});

// Simulates drift between the 52 supported currencies and the bundled fallback
// table (same technique as rates-unavailable.test.ts) so a nominally-supported
// code (PKR) can still hit true RATE_UNAVAILABLE end-to-end.
vi.mock('../src/lib/rates-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates-fallback')>();
  const { PKR: _omitted, ...rest } = actual.FALLBACK_RATES;
  return { FALLBACK_RATES: rest };
});
