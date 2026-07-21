import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// TC-INT-02 — lightweight cross-domain integration check: settlements'
// routes/balances.ts and social-groups' routes/groups.ts + routes/friends.ts
// each import convert / convertAmountForUser / resolveConversionRates from
// analytics' lib/rates.ts (charter.md: "Analytics is the ONLY domain
// permitted to convert between currencies"). This is NOT a re-test of
// those domains' own balance/settlement logic (they own their own test
// suites for that) — it is analytics' own smoke check that its exported
// surface is actually wired up and callable end-to-end by every declared
// consumer, with no "X is not a function" / undefined-import runtime error.
//
// Test-plan: .company/domains/analytics/test-plans/test-plan-WI-001.md and
// test-plan-WI-002.md (both list this as their integration case).

const userFindUniqueMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const groupFindManyMock = vi.fn();
const friendshipFindManyMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const exchangeRateCacheUpsertMock = vi.fn();
const manualExchangeRateFindUniqueMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    group: { findMany: (...args: unknown[]) => groupFindManyMock(...args) },
    friendship: { findMany: (...args: unknown[]) => friendshipFindManyMock(...args) },
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => exchangeRateCacheFindUniqueMock(...args),
      upsert: (...args: unknown[]) => exchangeRateCacheUpsertMock(...args),
    },
    manualExchangeRate: {
      findUnique: (...args: unknown[]) => manualExchangeRateFindUniqueMock(...args),
    },
  },
}));

import { buildApp } from '../src/app';
import { resetRatesMemoForTests } from '../src/lib/rates';

let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  userFindUniqueMock.mockReset();
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();
  groupFindManyMock.mockReset();
  friendshipFindManyMock.mockReset();
  exchangeRateCacheFindUniqueMock.mockReset();
  exchangeRateCacheUpsertMock.mockReset();
  manualExchangeRateFindUniqueMock.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('should not be called — cache is fresh')));
  // WI-072 §1's getRates() memo persists across it() blocks in this file
  // (each test uses base 'USD') unless cleared each time.
  resetRatesMemoForTests();
  // buildApp() registers every route module, including balances.ts,
  // groups.ts, and friends.ts. If any of them had a broken/renamed import
  // from lib/rates.ts, this line (or the .ready() below, which resolves
  // all plugin registration) throws — this alone proves the import wiring.
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: 'user_1' });
});

afterEach(async () => {
  await app.close();
});

describe('TC-INT-02: cross-domain consumers import and call analytics rates functions without a runtime error', () => {
  it('settlements — GET /balance calls convert()/convertAmountForUser() through routes/balances.ts and executes a real conversion', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    // One expense in EUR, fully split to a different user than the caller,
    // so the caller (user_1) is owed EUR and a real cross-currency
    // conversion (not just an empty-map no-op) is forced through tryConvert
    // -> convert() in balances.ts.
    expenseFindManyMock.mockResolvedValue([
      {
        currency: 'EUR',
        payers: [{ userId: 'user_1', amount: 5000 }],
        splits: [{ userId: 'user_2', amount: 5000 }],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue({
      id: 'cache_1',
      base: 'USD',
      rates: { USD: 1, EUR: 0.92 },
      fetchedAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.converted.usedFallbackRates).toBe(false);
    // Proves convert() actually ran (not skipped/no-op): 50.00 EUR owed to
    // user_1 -> USD at the mocked rate is a nonzero, non-identity amount.
    expect(body.converted.total).not.toBe(0);
    expect(exchangeRateCacheFindUniqueMock).toHaveBeenCalled();
  });

  it('social-groups — GET /groups calls resolveConversionRates() through routes/groups.ts without error', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    // GET /groups short-circuits to [] before ever calling
    // resolveConversionRates when the member's group list is empty (see
    // routes/groups.ts:242) — at least one group is required to actually
    // reach the rates call this test is verifying.
    groupFindManyMock.mockResolvedValue([
      {
        id: 'group_1',
        name: 'Smoke Test Group',
        emoji: '🧾',
        type: 'TRIP',
        currency: 'USD',
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        archivedAt: null,
        members: [{ userId: 'user_1' }],
      },
    ]);
    expenseFindManyMock.mockResolvedValue([]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue({
      id: 'cache_1',
      base: 'USD',
      rates: { USD: 1 },
      fetchedAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(exchangeRateCacheFindUniqueMock).toHaveBeenCalled();
  });

  it('social-groups — GET /friends calls resolveConversionRates() through routes/friends.ts without error', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    friendshipFindManyMock.mockResolvedValue([]);
    expenseFindManyMock.mockResolvedValue([]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue({
      id: 'cache_1',
      base: 'USD',
      rates: { USD: 1 },
      fetchedAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(exchangeRateCacheFindUniqueMock).toHaveBeenCalled();
  });
});
