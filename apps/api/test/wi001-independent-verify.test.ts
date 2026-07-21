import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * Test-stage independent verification for story-WI-001 (social-groups).
 *
 * Written by test-social-groups from the story's Gherkin scenarios directly —
 * NOT copied from apps/api/test/groups-route.test.ts or friends-route.test.ts
 * (the Build-stage devs' own TDD suite). Every fixture below uses different
 * numbers/currencies than the dev suite so a bug hidden by the dev's own
 * fixture choices (e.g. an off-by-one that happens to cancel out at their
 * exact numbers) has an independent chance to surface here.
 *
 * Only prisma model calls are mocked — resolveConversionRates/convert/getRates
 * (analytics' real conversion engine, apps/api/src/lib/rates.ts) run for real,
 * so every case here doubles as an INTEGRATION case: GET /groups and
 * GET /friends calling analytics' real conversion function end-to-end.
 */

const userFindUniqueMock = vi.fn();
const groupFindManyMock = vi.fn();
const groupMemberFindFirstMock = vi.fn();
// WI-052: assertSettledUp's failure branch (buildOutstandingBalanceMessage)
// resolves debtor/creditor display names via one prisma.groupMember.findMany
// call — must be mocked or the leave/remove 409 path throws (undefined not a
// function) instead of returning the expected 409.
const groupMemberFindManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const friendshipFindManyMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const exchangeRateCacheUpsertMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    group: { findMany: (...args: unknown[]) => groupFindManyMock(...args) },
    groupMember: {
      findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args),
      findMany: (...args: unknown[]) => groupMemberFindManyMock(...args),
    },
    friendship: { findMany: (...args: unknown[]) => friendshipFindManyMock(...args) },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => exchangeRateCacheFindUniqueMock(...args),
      upsert: (...args: unknown[]) => exchangeRateCacheUpsertMock(...args),
    },
  },
}));

// Same drift-simulation technique the dev suite uses (rates-unavailable.test.ts),
// applied to a different currency (JPY) so this suite's "truly unresolvable"
// case is independent of the dev suite's choice of PKR.
vi.mock('../src/lib/rates-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates-fallback')>();
  const { JPY: _omitted, ...rest } = actual.FALLBACK_RATES;
  return { FALLBACK_RATES: rest };
});

import { buildApp } from '../src/app';
import { resetCacheForTests } from '../src/lib/cache';
import { resetRatesMemoForTests } from '../src/lib/rates';

let app: FastifyInstance;
let token: string;

function freshCacheRow(base: string, rates: Record<string, number>) {
  return { id: 'cache_x', base, rates, fetchedAt: new Date() };
}

function group(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'grp_lisbon',
    name: 'Weekend in Porto',
    emoji: '🚋',
    type: 'TRIP',
    currency: 'EUR',
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    archivedAt: null,
    members: [{ userId: 'me' }, { userId: 'jo' }],
    ...overrides,
  };
}

beforeEach(async () => {
  userFindUniqueMock.mockReset();
  groupFindManyMock.mockReset();
  groupMemberFindFirstMock.mockReset();
  groupMemberFindManyMock.mockReset();
  groupMemberFindManyMock.mockResolvedValue([]);
  friendshipFindManyMock.mockReset();
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();
  exchangeRateCacheFindUniqueMock.mockReset();
  exchangeRateCacheUpsertMock.mockReset();
  // WI-072 §1's getRates() memo persists across it() blocks in this file
  // (base 'GBP' re-mocked per test) unless cleared each time.
  resetRatesMemoForTests();
  // WI-070: GET /groups/GET /friends are now wrapped in the process-wide
  // response cache (same as GET /balance since WI-067), keyed on this fixed
  // userId with no query params — every it() below must start from a cold
  // cache, otherwise a later test's mock reconfiguration would never be seen.
  resetCacheForTests();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: 'me' });
});

afterEach(async () => {
  await app.close();
});

// ===========================================================================
// Functional / black-box — derived from story-WI-001's Gherkin scenarios
// ===========================================================================

describe('FB — GET /api/v1/groups (story-WI-001)', () => {
  it('FB-1: "Groups list collapses a multi-currency balance to one converted figure" — own numbers', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    groupFindManyMock.mockResolvedValue([group()]);
    expenseFindManyMock.mockResolvedValue([
      {
        groupId: 'grp_lisbon',
        currency: 'USD',
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
        payers: [{ userId: 'jo', amount: 8000 }],
        splits: [
          { userId: 'me', amount: 8000 },
          { userId: 'jo', amount: 0 },
        ],
      },
      {
        groupId: 'grp_lisbon',
        currency: 'EUR',
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
        payers: [{ userId: 'jo', amount: 4500 }],
        splits: [
          { userId: 'me', amount: 4500 },
          { userId: 'jo', amount: 0 },
        ],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    // 1 USD = 0.75 GBP, 1 EUR = 0.83 GBP (independent rates from the dev suite's 0.79/0.86)
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.75, EUR: 1 / 0.83 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [summary] = res.json();
    // -80.00 USD * 0.75 = -60.00 GBP ; -45.00 EUR * 0.83 = -37.35 GBP ; sum = -97.35 GBP
    expect(summary.yourBalanceConverted).toEqual({ currency: 'GBP', amount: -9735 });
    expect(summary.yourBalances).toEqual([]);
    expect(summary.usedFallbackRates).toBe(false);
  });

  it('FB-2: "Each group card converts independently, not pooled across groups" — own numbers', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    groupFindManyMock.mockResolvedValue([
      group({ id: 'porto', name: 'Weekend in Porto' }),
      group({ id: 'bills', name: 'Flat Bills' }),
    ]);
    expenseFindManyMock.mockResolvedValue([
      {
        groupId: 'porto',
        currency: 'EUR',
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
        payers: [{ userId: 'jo', amount: 6000 }],
        splits: [
          { userId: 'me', amount: 6000 },
          { userId: 'jo', amount: 0 },
        ],
      },
      {
        groupId: 'bills',
        currency: 'USD',
        createdAt: new Date('2026-06-04T00:00:00.000Z'),
        payers: [{ userId: 'me', amount: 2500 }],
        splits: [
          { userId: 'me', amount: 0 },
          { userId: 'jo', amount: 2500 },
        ],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.75, EUR: 1 / 0.83 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    const summaries = res.json();
    const porto = summaries.find((s: { id: string }) => s.id === 'porto');
    const bills = summaries.find((s: { id: string }) => s.id === 'bills');
    expect(porto.yourBalanceConverted).toEqual({ currency: 'GBP', amount: -4980 }); // -60 EUR * 0.83
    expect(bills.yourBalanceConverted).toEqual({ currency: 'GBP', amount: 1875 }); // +25 USD * 0.75
    // Neither figure leaks into the other (pooling would produce -3105 or similar).
    expect(porto.yourBalanceConverted.amount).not.toBe(
      porto.yourBalanceConverted.amount + bills.yourBalanceConverted.amount,
    );
  });

  it('FB-3: "A currency the engine cannot rate falls back to the current unconverted display" — GET /groups, own currency (JPY)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    groupFindManyMock.mockResolvedValue([group()]);
    expenseFindManyMock.mockResolvedValue([
      {
        groupId: 'grp_lisbon',
        currency: 'JPY',
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
        payers: [{ userId: 'jo', amount: 500000 }],
        splits: [
          { userId: 'me', amount: 500000 },
          { userId: 'jo', amount: 0 },
        ],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    // GBP cache present, no JPY entry; module-level mock above also strips JPY
    // from the bundled fallback table, forcing a genuine RATE_UNAVAILABLE.
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1 }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200); // no amount silently dropped / request never fails
    const [summary] = res.json();
    expect(summary.yourBalances).toEqual([{ currency: 'JPY', amount: -500000 }]);
    expect(summary.yourBalanceConverted).toBeNull();
  });

  it('FB-4: "Leaving or removing a member still gates on native, unconverted per-currency nets" — POST /groups/:id/leave', async () => {
    // Own scenario: a tiny 1.00 USD outstanding net, which converts to a
    // near-zero GBP display figure — the gate must still fire on the native
    // amount, never on any converted/rounded figure.
    groupMemberFindFirstMock.mockResolvedValue({
      id: 'gm_1',
      groupId: 'grp_lisbon',
      userId: 'me',
      role: 'MEMBER',
      leftAt: null,
      user: { id: 'me', name: 'Me', avatarColor: '#000' },
      group: { name: 'Weekend in Porto' },
    });
    expenseFindManyMock.mockResolvedValue([
      {
        currency: 'USD',
        payers: [{ userId: 'jo', amount: 100 }],
        splits: [
          { userId: 'me', amount: 100 },
          { userId: 'jo', amount: 0 },
        ],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/groups/grp_lisbon/leave',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('OUTSTANDING_BALANCE');
    // The gate never touches the conversion engine — confirms
    // assertSettledUp/loadGroupLedger stay native-only per the charter.
    expect(exchangeRateCacheFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe('FB — GET /api/v1/friends (story-WI-001 coverage-gap addendum, 2026-07-14)', () => {
  it('FB-5: "Friends list and friend detail collapse a multi-currency balance to one converted figure" — own numbers', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    friendshipFindManyMock.mockResolvedValue([
      {
        userAId: 'me',
        userBId: 'jo',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        userA: { id: 'me', name: 'Me', avatarColor: '#fff' },
        userB: { id: 'jo', name: 'Jo Alvarez', avatarColor: '#fff' },
      },
    ]);
    expenseFindManyMock.mockResolvedValue([
      {
        currency: 'USD',
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
        payers: [{ userId: 'jo', amount: 8000 }],
        splits: [
          { userId: 'me', amount: 8000 },
          { userId: 'jo', amount: 0 },
        ],
      },
      {
        currency: 'EUR',
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
        payers: [{ userId: 'jo', amount: 4500 }],
        splits: [
          { userId: 'me', amount: 4500 },
          { userId: 'jo', amount: 0 },
        ],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.75, EUR: 1 / 0.83 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [jo] = res.json();
    expect(jo.balancesConverted).toEqual({ currency: 'GBP', amount: -9735 });
    expect(jo.balances).toEqual([]);
  });

  it('FB-6: settled-up friend shows empty balances + null converted, never "£0.00" — own fixture', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    friendshipFindManyMock.mockResolvedValue([
      {
        userAId: 'me',
        userBId: 'jo',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        userA: { id: 'me', name: 'Me', avatarColor: '#fff' },
        userB: { id: 'jo', name: 'Jo Alvarez', avatarColor: '#fff' },
      },
    ]);
    expenseFindManyMock.mockResolvedValue([]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
    });

    const [jo] = res.json();
    expect(jo.balances).toEqual([]);
    expect(jo.balancesConverted).toBeNull();
  });
});

// ===========================================================================
// White-box — targeting logic flagged in build-WI-001.md's "Notes for Test stage"
// ===========================================================================

describe('WB — friends.ts sort-by-converted-magnitude rework', () => {
  it('WB-1: exercises the name tie-break branch for exactly-equal converted magnitudes (flagged by build-WI-001.md as untested — "unreachable in this build\'s fixtures because every test uses distinguishable balances")', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    friendshipFindManyMock.mockResolvedValue([
      {
        userAId: 'me',
        userBId: 'zeb',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        userA: { id: 'me', name: 'Me', avatarColor: '#fff' },
        userB: { id: 'zeb', name: 'Zeb Carter', avatarColor: '#fff' },
      },
      {
        userAId: 'me',
        userBId: 'amy',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        userA: { id: 'me', name: 'Me', avatarColor: '#fff' },
        userB: { id: 'amy', name: 'Amy Baker', avatarColor: '#fff' },
      },
    ]);
    // Both friends owe the caller EXACTLY 100.00 USD -> identical converted
    // magnitude once rates are applied -> comparator falls through to the
    // a.user.name.localeCompare(b.user.name) tie-break.
    expenseFindManyMock.mockResolvedValue([
      {
        currency: 'USD',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        payers: [{ userId: 'me', amount: 10000 }],
        splits: [
          { userId: 'me', amount: 0 },
          { userId: 'zeb', amount: 10000 },
        ],
      },
      {
        currency: 'USD',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        payers: [{ userId: 'me', amount: 10000 }],
        splits: [
          { userId: 'me', amount: 0 },
          { userId: 'amy', amount: 10000 },
        ],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.75 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
    });

    const friends = res.json();
    expect(friends[0].balancesConverted.amount).toBe(friends[1].balancesConverted.amount);
    // Alphabetical tie-break: "Amy Baker" before "Zeb Carter".
    expect(friends.map((f: { user: { name: string } }) => f.user.name)).toEqual([
      'Amy Baker',
      'Zeb Carter',
    ]);
  });
});

describe('WB — convertBalanceForViewer / route DTOs: a multi-currency net that sums to exactly zero after conversion', () => {
  it('WB-2: GET /groups returns yourBalanceConverted: { amount: 0 } (NOT null) when offsetting currencies net to zero post-conversion — this is a real, non-obvious edge distinct from "nothing was convertible"', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    groupFindManyMock.mockResolvedValue([group()]);
    // -40.00 USD and +40.00 EUR, with USD and EUR sharing the same GBP rate
    // (0.75), so the converted GBP amounts exactly cancel: -30.00 + 30.00 = 0.
    expenseFindManyMock.mockResolvedValue([
      {
        groupId: 'grp_lisbon',
        currency: 'USD',
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
        payers: [{ userId: 'jo', amount: 4000 }],
        splits: [
          { userId: 'me', amount: 4000 },
          { userId: 'jo', amount: 0 },
        ],
      },
      {
        groupId: 'grp_lisbon',
        currency: 'EUR',
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
        payers: [{ userId: 'me', amount: 4000 }],
        splits: [
          { userId: 'me', amount: 0 },
          { userId: 'jo', amount: 4000 },
        ],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.75, EUR: 1 / 0.75 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    const [summary] = res.json();
    // Backend intentionally does NOT collapse this to null — that collapsing
    // (skip a zero-amount converted line) is the frontend's job
    // (collapsedBalanceEntries), verified separately in the web/mobile suites.
    expect(summary.yourBalanceConverted).toEqual({ currency: 'GBP', amount: 0 });
    expect(summary.yourBalanceConverted).not.toBeNull();
  });
});

// ===========================================================================
// Integration — confirms the real analytics conversion engine is exercised,
// not a stub. Only prisma is mocked above; rates.ts/getRates/convert run for
// real against the mocked ExchangeRateCache row.
// ===========================================================================

describe('INT — GET /groups and GET /friends both call the real resolveConversionRates/convert chain', () => {
  it('INT-1: identical input rates + identical native balance produce identical converted output on both endpoints (proves both routes funnel through the same real conversion function, not divergent stubs)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.75 }),
    );

    groupFindManyMock.mockResolvedValue([group()]);
    expenseFindManyMock.mockResolvedValue([
      {
        groupId: 'grp_lisbon',
        currency: 'USD',
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
        payers: [{ userId: 'jo', amount: 6000 }],
        splits: [
          { userId: 'me', amount: 6000 },
          { userId: 'jo', amount: 0 },
        ],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    const groupsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });
    const groupConverted = groupsRes.json()[0].yourBalanceConverted;

    friendshipFindManyMock.mockResolvedValue([
      {
        userAId: 'me',
        userBId: 'jo',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        userA: { id: 'me', name: 'Me', avatarColor: '#fff' },
        userB: { id: 'jo', name: 'Jo Alvarez', avatarColor: '#fff' },
      },
    ]);
    expenseFindManyMock.mockResolvedValue([
      {
        currency: 'USD',
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
        payers: [{ userId: 'jo', amount: 6000 }],
        splits: [
          { userId: 'me', amount: 6000 },
          { userId: 'jo', amount: 0 },
        ],
      },
    ]);
    const friendsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
    });
    const friendConverted = friendsRes.json()[0].balancesConverted;

    expect(groupConverted).toEqual({ currency: 'GBP', amount: -4500 }); // -60 USD * 0.75
    expect(friendConverted).toEqual(groupConverted);
  });
});
