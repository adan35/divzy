// spec-WI-071.md §1.3 / story-WI-071.md "Parallelized per-currency conversion
// produces byte-identical output to today's sequential loop" — verifies the
// actual numeric output of GET /balance's `sumMap` and GET
// /groups/:groupId/balances's `membersWithConverted`/`pairwiseWithConverted`
// (all now `Promise.all`-parallelized per spec §1.3) against hand-computed
// expected values, across a live rate, the automatic-rate-chain fallback
// path (the bundled FALLBACK_RATES table, patched in BEFORE tryConvert ever
// runs — see the file-level rates-fallback mock below), and a fully
// unresolvable currency.
//
// `convert()`/`resolveConversionRates()` themselves are NOT mocked — only
// `../src/lib/rates-fallback`'s bundled table is replaced with a small,
// fully-controlled one (this file's own numbers, independent of the real
// production table) so the "EUR is unresolvable anywhere" case is
// deterministic (memory: the isolating-an-unresolvable-currency
// strip-one-currency technique, applied here to the whole table for full
// control rather than stripping a single real-world entry).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const groupMemberFindFirstMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const userFindManyMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const exchangeRateCacheUpsertMock = vi.fn();
const exchangeRateSnapshotCreateManyMock = vi.fn();
const manualExchangeRateFindUniqueMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      findMany: (...args: unknown[]) => userFindManyMock(...args),
    },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    groupMember: {
      findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args),
      findMany: (...args: unknown[]) => groupMemberFindManyMock(...args),
    },
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => exchangeRateCacheFindUniqueMock(...args),
      upsert: (...args: unknown[]) => exchangeRateCacheUpsertMock(...args),
    },
    exchangeRateSnapshot: {
      createMany: (...args: unknown[]) => exchangeRateSnapshotCreateManyMock(...args),
    },
    manualExchangeRate: {
      findUnique: (...args: unknown[]) => manualExchangeRateFindUniqueMock(...args),
    },
  },
}));

// A small, fully self-contained fallback table (independent of the real
// production numbers in rates-fallback.ts): GBP and PKR present, USD present
// (so it can patch USD in at the BATCH resolution step — the "automatic rate
// chain" fallback path), EUR deliberately ABSENT (so EUR is unresolvable via
// both the live map and this bundled table — the "no resolvable rate at
// all" case).
vi.mock('../src/lib/rates-fallback', () => ({
  FALLBACK_RATES: { USD: 1, GBP: 0.79, PKR: 278 },
}));

import { buildApp } from '../src/app';
import { resetRatesMemoForTests } from '../src/lib/rates';

const ME = 'user_conv_me_001';
const CP_A = 'user_conv_cpa_001'; // owes ME in PKR (live rate)
const CP_B = 'user_conv_cpb_001'; // ME owes them in USD (automatic-chain fallback)
const CP_C = 'user_conv_cpc_001'; // owes ME in EUR (fully unresolvable)

/** Fresh, usable live cache row for base GBP: has PKR, deliberately missing USD/EUR. */
function liveGbpCacheRow() {
  return { base: 'GBP', rates: { GBP: 1, PKR: 278 }, fetchedAt: new Date() };
}

/** payer paid `amount` in `currency`; `ower` owes the full amount (a clean 1:1 debt). */
function expense(currency: string, amount: number, payerId: string, owerId: string, groupId: string | null = null) {
  return {
    groupId,
    currency,
    payers: [{ userId: payerId, amount }],
    splits: [{ userId: owerId, amount }],
  };
}

let app: FastifyInstance;

beforeEach(async () => {
  userFindUniqueMock.mockReset();
  expenseFindManyMock.mockReset().mockResolvedValue([]);
  settlementFindManyMock.mockReset().mockResolvedValue([]);
  groupMemberFindFirstMock.mockReset();
  groupMemberFindManyMock.mockReset();
  userFindManyMock.mockReset().mockResolvedValue([]);
  exchangeRateCacheFindUniqueMock.mockReset().mockResolvedValue(liveGbpCacheRow());
  exchangeRateCacheUpsertMock.mockReset().mockResolvedValue(undefined);
  exchangeRateSnapshotCreateManyMock.mockReset().mockResolvedValue(undefined);
  manualExchangeRateFindUniqueMock.mockReset().mockResolvedValue(null);
  resetRatesMemoForTests();

  app = await buildApp();
  await app.ready();
});

describe('GET /balance — byte-identical parallel conversion (spec §1.3(a))', () => {
  it('PKR (live), USD (automatic-chain fallback), EUR (fully unresolvable) — exact expected figures', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });

    // ME is owed 27800 PKR by CP_A: ME paid, CP_A owes.
    // ME owes CP_B 2000 USD: CP_B paid, ME owes.
    // ME is owed 3000 EUR by CP_C: ME paid, CP_C owes.
    expenseFindManyMock.mockResolvedValue([
      expense('PKR', 27_800, ME, CP_A),
      expense('USD', 2_000, CP_B, ME),
      expense('EUR', 3_000, ME, CP_C),
    ]);

    const token = app.jwt.sign({ sub: ME });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.youAreOwed).toEqual([
      { currency: 'EUR', amount: 3_000 },
      { currency: 'PKR', amount: 27_800 },
    ]);
    expect(body.youOwe).toEqual([{ currency: 'USD', amount: 2_000 }]);

    // Hand-computed expected figures (GBP viewer currency):
    //   PKR: round(27800 * (1/278)) = 100
    //   USD: round(2000 * 0.79) = 1580  (0.79 = fallbackRatesFor('GBP').USD's
    //     reciprocal-of-reciprocal: FALLBACK_RATES.USD/FALLBACK_RATES.GBP = 1/0.79,
    //     so toRate/fromRate = 1/(1/0.79) = 0.79)
    //   EUR: unresolvable (absent from both the live map and the fallback table)
    expect(body.converted.currency).toBe('GBP');
    expect(body.converted.total).toBe(100 - 1580); // owed PKR (+100) minus owed USD (-1580 contribution)
    expect(body.converted.youOwe).toBe(1580);
    expect(body.converted.youAreOwed).toBe(100);
    expect(body.converted.unresolved).toEqual([{ currency: 'EUR', amount: 3_000 }]);
    expect(body.converted.usedFallbackRates).toBe(true);
  });
});

describe('GET /groups/:groupId/balances — byte-identical parallel conversion (spec §1.3(b)/(c))', () => {
  const GROUP_ID = 'group_conv_fixture_01';
  const M1 = 'user_conv_m1_00001'; // viewer
  const M2 = 'user_conv_m2_00001';
  const M3 = 'user_conv_m3_00001';

  function publicUser(id: string, name: string) {
    return { id, name, avatarColor: '#2a78d6', avatarUrl: null };
  }

  function mockGroupFixture() {
    groupMemberFindFirstMock.mockResolvedValue({ id: 'gm_viewer' }); // M1 is active
    groupMemberFindManyMock.mockImplementation((args: { where: Record<string, unknown> }) => {
      if ('groupId' in args.where) {
        return Promise.resolve([
          { userId: M1, leftAt: null, user: publicUser(M1, 'Mem One') },
          { userId: M2, leftAt: null, user: publicUser(M2, 'Mem Two') },
          { userId: M3, leftAt: null, user: publicUser(M3, 'Mem Three') },
        ]);
      }
      // ADR-009 direct-settlement-pool membership rows (userId: {in: memberIds}).
      return Promise.resolve([
        { userId: M1, groupId: GROUP_ID },
        { userId: M2, groupId: GROUP_ID },
        { userId: M3, groupId: GROUP_ID },
      ]);
    });
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    expenseFindManyMock.mockResolvedValue([
      expense('PKR', 27_800, M1, M2, GROUP_ID), // M2 owes M1 27800 PKR
      expense('USD', 2_000, M3, M2, GROUP_ID), // M2 owes M3 2000 USD
      expense('EUR', 3_000, M1, M3, GROUP_ID), // M3 owes M1 3000 EUR (unresolvable)
    ]);
    settlementFindManyMock.mockResolvedValue([]);
  }

  it('per-member convertedNet and per-pairwise convertedAmount match hand-computed expected figures', async () => {
    mockGroupFixture();

    const token = app.jwt.sign({ sub: M1 });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${GROUP_ID}/balances`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.viewerCurrency).toBe('GBP');
    expect(body.usedFallbackRates).toBe(true);

    const byId = new Map<string, { balances: unknown; convertedNet: unknown }>(
      body.members.map((m: { user: { id: string } }) => [m.user.id, m]),
    );

    // M1: balances [{EUR,3000},{PKR,27800}] (sorted). EUR unresolvable, PKR -> 100.
    expect(byId.get(M1)!.balances).toEqual([
      { currency: 'EUR', amount: 3_000 },
      { currency: 'PKR', amount: 27_800 },
    ]);
    expect(byId.get(M1)!.convertedNet).toEqual({ amount: 100, unresolved: [{ currency: 'EUR', amount: 3_000 }] });

    // M2: balances [{PKR,-27800},{USD,-2000}]. Both resolve: -100 + -1580 = -1680.
    expect(byId.get(M2)!.balances).toEqual([
      { currency: 'PKR', amount: -27_800 },
      { currency: 'USD', amount: -2_000 },
    ]);
    expect(byId.get(M2)!.convertedNet).toEqual({ amount: -1_680, unresolved: [] });

    // M3: balances [{EUR,-3000},{USD,2000}]. EUR unresolvable, USD -> 1580.
    expect(byId.get(M3)!.balances).toEqual([
      { currency: 'EUR', amount: -3_000 },
      { currency: 'USD', amount: 2_000 },
    ]);
    expect(byId.get(M3)!.convertedNet).toEqual({ amount: 1_580, unresolved: [{ currency: 'EUR', amount: -3_000 }] });

    // Pairwise, sorted by currency then fromUserId then toUserId: EUR, PKR, USD.
    expect(body.pairwise).toHaveLength(3);
    const eurRow = body.pairwise.find((p: { currency: string }) => p.currency === 'EUR');
    const pkrRow = body.pairwise.find((p: { currency: string }) => p.currency === 'PKR');
    const usdRow = body.pairwise.find((p: { currency: string }) => p.currency === 'USD');

    expect(eurRow).toMatchObject({ fromUserId: M3, toUserId: M1, amount: 3_000 });
    expect(eurRow.convertedAmount).toBeUndefined(); // unresolved -> field absent, never 0/null

    expect(pkrRow).toMatchObject({ fromUserId: M2, toUserId: M1, amount: 27_800, convertedAmount: 100 });
    expect(usdRow).toMatchObject({ fromUserId: M2, toUserId: M3, amount: 2_000, convertedAmount: 1_580 });
  });
});
