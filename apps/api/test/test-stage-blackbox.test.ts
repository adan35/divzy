// Test-stage functional/black-box coverage — settlements WI-001..WI-004.
//
// Written by test-settlements directly from story-WI-001..WI-004's Gherkin
// scenarios (.company/domains/settlements/stories/story-WI-00{1,2,3,4}.md),
// NOT by reading apps/api/src/routes/balances.ts or settlements.ts first.
// Real HTTP requests via Fastify's app.inject() against a fully-built app;
// only prisma is mocked (model level), matching this repo's existing
// convention — the conversion math itself (analytics' convert()/
// convertAmountForUser()) is the real, unmocked implementation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const groupMemberFindFirstMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const settlementCreateMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const exchangeRateCacheUpsertMock = vi.fn();
const manualExchangeRateFindUniqueMock = vi.fn();
const userFindManyMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      findMany: (...args: unknown[]) => userFindManyMock(...args),
    },
    groupMember: {
      findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args),
      findMany: (...args: unknown[]) => groupMemberFindManyMock(...args),
    },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: {
      findMany: (...args: unknown[]) => settlementFindManyMock(...args),
      create: (...args: unknown[]) => settlementCreateMock(...args),
    },
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => exchangeRateCacheFindUniqueMock(...args),
      upsert: (...args: unknown[]) => exchangeRateCacheUpsertMock(...args),
    },
    manualExchangeRate: {
      findUnique: (...args: unknown[]) => manualExchangeRateFindUniqueMock(...args),
    },
  },
}));

vi.mock('../src/lib/activity', () => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/lib/social', () => ({ ensureFriendshipsAmong: vi.fn().mockResolvedValue(undefined) }));

// Strips MYR from the bundled fallback table (same technique as
// test/balances.test.ts's PKR strip) so a nominally-supported currency code
// can still hit a true RATE_UNAVAILABLE end-to-end, without tripping the
// unrelated UNSUPPORTED_CURRENCY (400) path.
vi.mock('../src/lib/rates-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates-fallback')>();
  const { MYR: _omitted, ...rest } = actual.FALLBACK_RATES;
  return { FALLBACK_RATES: rest };
});

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;

const USER_ID = 'user_id_1'; // zId requires >= 8 chars

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
  for (const m of [
    userFindUniqueMock,
    groupMemberFindFirstMock,
    groupMemberFindManyMock,
    expenseFindManyMock,
    settlementFindManyMock,
    settlementCreateMock,
    exchangeRateCacheFindUniqueMock,
    exchangeRateCacheUpsertMock,
    manualExchangeRateFindUniqueMock,
    userFindManyMock,
  ]) {
    m.mockReset();
  }
  manualExchangeRateFindUniqueMock.mockResolvedValue(null);
  userFindManyMock.mockResolvedValue([]);

  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: USER_ID });
});

afterEach(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// story-WI-001 · "Edge case — settling a debt still records the
// native-currency amount": settling a specific USD debt that also appears in
// a converted GBP total must persist a Settlement row in USD, unmodified.
// ---------------------------------------------------------------------------
describe('story-WI-001 · settling a debt still records the native-currency amount', () => {
  it('POST /api/v1/settlements records the native currency/amount, never a converted figure', async () => {
    // WI-012 bound: a real USD 5000 directional debt (friend_a paid, USER_ID
    // owes) must exist in the pair's cross-context ledger for the exact-payoff
    // amount below to pass the new outstanding-balance check.
    expenseFindManyMock.mockResolvedValue([expense('USD', 5000, 'friend_a', USER_ID)]);
    settlementFindManyMock.mockResolvedValue([]);
    settlementCreateMock.mockResolvedValue({
      id: 's1',
      groupId: null,
      group: null,
      fromUserId: USER_ID,
      toUserId: 'friend_a',
      amount: 5000,
      currency: 'USD',
      method: 'CASH',
      note: null,
      date: new Date('2026-07-14T00:00:00.000Z'),
      createdById: USER_ID,
      deletedAt: null,
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
      fromUser: { id: USER_ID, name: 'Me', avatarColor: '#111' },
      toUser: { id: 'friend_a', name: 'Friend A', avatarColor: '#222' },
      createdBy: { id: USER_ID, name: 'Me', avatarColor: '#111' },
    });
    userFindUniqueMock.mockResolvedValue({ id: 'friend_a' }); // counterpart exists (non-group settlement)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settlements',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        fromUserId: USER_ID,
        toUserId: 'friend_a',
        amount: 5000,
        currency: 'USD',
        method: 'CASH',
        date: new Date('2026-07-14T00:00:00.000Z').toISOString(),
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().amount).toBe(5000);
    expect(res.json().currency).toBe('USD');
    // The created row's currency/amount came straight from the request body —
    // no conversion primitive (convert/convertAmountForUser/resolveConversionRates)
    // was ever consulted for a settlement create.
    expect(settlementCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 5000, currency: 'USD' }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// story-WI-004 · "Regression — the underlying 403 authorization is
// unchanged": a direct API request to create a settlement the caller isn't a
// party to is still rejected server-side, independent of any client gating.
// ---------------------------------------------------------------------------
describe('story-WI-004 · underlying 403 authorization is unchanged', () => {
  it('POST /api/v1/settlements 403s when the caller is neither fromUserId nor toUserId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settlements',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        fromUserId: 'user_id_2',
        toUserId: 'user_id_3',
        amount: 2000,
        currency: 'USD',
        method: 'CASH',
        date: new Date('2026-07-14T00:00:00.000Z').toISOString(),
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// story-WI-001 · "Edge case — no resolvable rate for a required pair": the
// balance response must surface the currency as unresolved rather than
// silently omitting or misconverting it — the exact signal the frontend's
// manual-rate prompt (story-WI-002) consumes.
// ---------------------------------------------------------------------------
describe('story-WI-001 · no resolvable rate surfaces the manual-rate fallback signal, never silent', () => {
  it('GET /api/v1/balance flags an unconvertible currency in converted.unresolved instead of omitting it', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    // MYR is a supported currency (isSupportedCurrency true) but stripped
    // from the fallback table above and absent from the live cache below —
    // neither conversion chain can resolve it, without tripping the
    // unrelated 400 UNSUPPORTED_CURRENCY path.
    expenseFindManyMock.mockResolvedValue([expense('MYR', 7500, 'friend_a', USER_ID)]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1 }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Native amount is still present and correct — never dropped.
    expect(body.youOwe).toEqual([{ currency: 'MYR', amount: 7500 }]);
    // The converted block flags it rather than silently zeroing/omitting.
    expect(body.converted.unresolved).toEqual([{ currency: 'MYR', amount: -7500 }]);
    expect(body.converted.youOwe).toBe(0);
  });
});
