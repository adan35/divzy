import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const groupMemberFindFirstMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const exchangeRateCacheUpsertMock = vi.fn();
const manualExchangeRateFindUniqueMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    groupMember: {
      findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args),
      findMany: (...args: unknown[]) => groupMemberFindManyMock(...args),
    },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => exchangeRateCacheFindUniqueMock(...args),
      upsert: (...args: unknown[]) => exchangeRateCacheUpsertMock(...args),
    },
    manualExchangeRate: {
      findUnique: (...args: unknown[]) => manualExchangeRateFindUniqueMock(...args),
    },
  },
}));

// Simulates drift between the 52 supported currencies and the bundled fallback
// table (same technique as rates-unavailable.test.ts / groups-route.test.ts /
// friends-route.test.ts) so a nominally-supported code (PKR) can still hit
// true RATE_UNAVAILABLE end-to-end, exercising WI-002's manual-rate fallback.
vi.mock('../src/lib/rates-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates-fallback')>();
  const { PKR: _omitted, ...rest } = actual.FALLBACK_RATES;
  return { FALLBACK_RATES: rest };
});

import { buildApp } from '../src/app';
import { bumpUserGeneration, resetCacheForTests } from '../src/lib/cache';

let app: FastifyInstance;
let token: string;

const USER_ID = 'user_1';

/** A fresh (< 12h old) ExchangeRateCache row for `base`, matching resolveConversionRates. */
function freshCacheRow(base: string, rates: Record<string, number>) {
  return { id: 'cache_1', base, rates, fetchedAt: new Date() };
}

/** One expense where `payerId` pays `amount` in `currency` and `owerId` owes it all back. */
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
  groupMemberFindFirstMock.mockReset();
  groupMemberFindManyMock.mockReset();
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();
  exchangeRateCacheFindUniqueMock.mockReset();
  exchangeRateCacheUpsertMock.mockReset();
  manualExchangeRateFindUniqueMock.mockReset();
  manualExchangeRateFindUniqueMock.mockResolvedValue(null);
  vi.unstubAllGlobals();
  // WI-067 / ADR-030: GET /balance is now wrapped in a process-wide response
  // cache keyed on this fixed USER_ID with no query params, so every `it()`
  // below must start from a cold cache — otherwise a later test's mock
  // reconfiguration would never be seen (the earlier test's cached payload
  // would keep being served for this same user+key).
  resetCacheForTests();

  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: USER_ID });
});

afterEach(async () => {
  await app.close();
});

// story-WI-001 (settlements) + story-WI-002 (settlements) scenarios ---------------------

describe('GET /api/v1/balance', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/balance' });
    expect(res.statusCode).toBe(401);
  });

  it('shows converted totals in the caller defaultCurrency alongside unchanged native arrays (Happy path — overall balance totals shown in default currency)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    // owed 5000 USD by friend_a; owes 3000 EUR to friend_b.
    expenseFindManyMock.mockResolvedValue([
      expense('USD', 5000, USER_ID, 'friend_a'),
      expense('EUR', 3000, 'friend_b', USER_ID),
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    // base=GBP; 1 USD = 0.79 GBP, 1 EUR = 0.86 GBP (rates keyed "units of X per 1 GBP").
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.79, EUR: 1 / 0.86 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Unchanged native fields — still the source of truth.
    expect(body.totals).toEqual([
      { currency: 'EUR', amount: -3000 },
      { currency: 'USD', amount: 5000 },
    ]);
    expect(body.youOwe).toEqual([{ currency: 'EUR', amount: 3000 }]);
    expect(body.youAreOwed).toEqual([{ currency: 'USD', amount: 5000 }]);
    // New converted block.
    expect(body.converted.currency).toBe('GBP');
    expect(body.converted.youAreOwed).toBe(3950); // 5000 USD * 0.79
    expect(body.converted.youOwe).toBe(2580); // 3000 EUR * 0.86
    expect(body.converted.total).toBe(1370); // 3950 - 2580
    expect(body.converted.unresolved).toEqual([]);
    expect(body.converted.usedFallbackRates).toBe(false);
  });

  it('never crashes the whole endpoint on a currency with no resolvable rate, excluding it from the sums and flagging it (Edge case — no resolvable rate for a required pair; WI-002 detection)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    expenseFindManyMock.mockResolvedValue([
      expense('USD', 5000, USER_ID, 'friend_a'),
      expense('PKR', 100000, 'friend_b', USER_ID), // PKR stripped from the fallback table above
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.79 }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { converted } = res.json();
    expect(converted.youAreOwed).toBe(3950); // only the USD debt converted
    expect(converted.total).toBe(3950);
    expect(converted.youOwe).toBe(0); // the unresolved PKR debt contributes nothing
    expect(converted.unresolved).toEqual([{ currency: 'PKR', amount: -100000 }]);
    // USD resolved from the live cache; PKR resolved via neither the live map
    // nor the (stripped) fallback table — no successful conversion actually
    // used the bundled fallback table, so the flag stays false.
    expect(converted.usedFallbackRates).toBe(false);
  });

  it('resolves via a stored manual rate once the automatic chain fails, excluding it from unresolved (WI-002 — supplied rate is used immediately)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    // user_1 owes friend_a 1000 PKR; PKR is stripped from the fallback table
    // above, so the automatic chain cannot resolve PKR->GBP at all.
    expenseFindManyMock.mockResolvedValue([expense('PKR', 1000, 'friend_a', USER_ID)]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1 }));
    manualExchangeRateFindUniqueMock.mockResolvedValue({
      id: 'm1',
      userId: USER_ID,
      fromCurrency: 'PKR',
      toCurrency: 'GBP',
      rate: 2,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { converted } = res.json();
    expect(converted.unresolved).toEqual([]);
    expect(converted.youOwe).toBe(2000); // 1000 * manual rate 2
    expect(manualExchangeRateFindUniqueMock).toHaveBeenCalledWith({
      where: {
        userId_fromCurrency_toCurrency: { userId: USER_ID, fromCurrency: 'PKR', toCurrency: 'GBP' },
      },
    });
  });

  it('stays unresolved when neither the automatic chain nor a manual rate can resolve the pair (WI-002 — rate cannot be resolved for a required pair)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    expenseFindManyMock.mockResolvedValue([expense('PKR', 1000, 'friend_a', USER_ID)]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1 }));
    manualExchangeRateFindUniqueMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { converted } = res.json();
    expect(converted.unresolved).toEqual([{ currency: 'PKR', amount: -1000 }]);
    expect(converted.youOwe).toBe(0);
  });

  it('re-propagates a non-RATE_UNAVAILABLE error from the manual-rate fallback instead of silently swallowing it', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    expenseFindManyMock.mockResolvedValue([expense('PKR', 1000, 'friend_a', USER_ID)]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1 }));
    manualExchangeRateFindUniqueMock.mockRejectedValue(new Error('db unavailable'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(500);
  });

  it('reads defaultCurrency fresh once invalidated (WI-067: cached() wrap — a currency change is picked up on the next generation bump, exactly what PATCH /users/me\'s C1 site now does on an actual change; not on every raw request)', async () => {
    expenseFindManyMock.mockResolvedValue([expense('USD', 5000, USER_ID, 'friend_a')]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.79, EUR: 1 / 0.86 }),
    );

    userFindUniqueMock.mockResolvedValueOnce({ defaultCurrency: 'GBP' });
    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.json().converted.currency).toBe('GBP');

    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('USD', { USD: 1, GBP: 0.79, EUR: 0.9 }),
    );
    userFindUniqueMock.mockResolvedValueOnce({ defaultCurrency: 'USD' });

    // Without a bump, the read within the 15s TTL is still served from the
    // cache (the whole point of WI-067) — same GBP figure as `first`.
    const stillCached = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(stillCached.json()).toEqual(first.json());

    // A real defaultCurrency change goes through PATCH /users/me, which bumps
    // the caller's generation (site C1) — simulated directly here since this
    // file mocks prisma at the model layer, not through that route.
    bumpUserGeneration(USER_ID);
    userFindUniqueMock.mockResolvedValueOnce({ defaultCurrency: 'USD' });
    const second = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.json().converted.currency).toBe('USD');
    expect(second.json().converted.youAreOwed).toBe(5000); // native currency == converted currency
  });
});

describe('GET /api/v1/groups/:groupId/balances', () => {
  const GROUP_ID = 'group_id_1';

  function activeMembership() {
    return { id: 'gm_1' };
  }

  function members() {
    return [
      {
        userId: USER_ID,
        leftAt: null,
        joinedAt: new Date('2026-01-01T00:00:00.000Z'),
        id: 'm1',
        user: { id: USER_ID, name: 'Zain', avatarColor: '#111111' },
      },
      {
        userId: 'user_2',
        leftAt: null,
        joinedAt: new Date('2026-01-02T00:00:00.000Z'),
        id: 'm2',
        user: { id: 'user_2', name: 'Friend', avatarColor: '#222222' },
      },
    ];
  }

  /**
   * WI-008 / ADR-009 (reconciled)'s membership-count scan (`groupMember.findMany({ where: {
   * userId: { in: memberIds } }, select: { userId: true, groupId: true } })`) reuses this
   * same mocked prisma method. In these single-group tests, every one of the target's
   * members is only ever a member of the target group itself, so
   * `sharedGroupCountOf(low, high) === 1` — the sole-shared-group rule fires normally.
   */
  function crossGroupMembershipRows() {
    return [USER_ID, 'user_2'].map((userId) => ({ groupId: GROUP_ID, userId }));
  }

  /**
   * `groupMember.findMany` now serves two distinct queries in this route: the target
   * group's own member list (`where: { groupId }`, `include: { user }`) and WI-008's
   * cross-group membership scan (`where: { userId: { in: memberIds } }`). Route this single
   * mock by shape so each caller gets the fixture it actually expects.
   */
  function mockGroupMemberFindMany() {
    groupMemberFindManyMock.mockImplementation((args: { where?: { groupId?: unknown; userId?: unknown } }) => {
      if (args?.where && 'groupId' in args.where) return Promise.resolve(members());
      return Promise.resolve(crossGroupMembershipRows());
    });
  }

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/groups/${GROUP_ID}/balances` });
    expect(res.statusCode).toBe(401);
  });

  it('404s for a non-member without leaking group existence (unchanged behavior)', async () => {
    groupMemberFindFirstMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${GROUP_ID}/balances`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('adds viewerCurrency + convertedNet/convertedAmount without altering the native shape (ADR-008 — settlements-owned conversion)', async () => {
    groupMemberFindFirstMock.mockResolvedValue(activeMembership());
    mockGroupMemberFindMany();
    expenseFindManyMock.mockResolvedValue([expense('USD', 4000, 'user_2', USER_ID)]); // user_1 owes user_2 4000 USD
    settlementFindManyMock.mockResolvedValue([]);
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.79 }));

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${GROUP_ID}/balances`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.viewerCurrency).toBe('GBP');
    expect(body.usedFallbackRates).toBe(false);

    const me = body.members.find((m: { user: { id: string } }) => m.user.id === USER_ID);
    expect(me.balances).toEqual([{ currency: 'USD', amount: -4000 }]); // native, unchanged
    expect(me.convertedNet).toEqual({ amount: -3160, unresolved: [] }); // -4000 * 0.79

    const row = body.pairwise[0];
    expect(row.currency).toBe('USD');
    expect(row.amount).toBe(4000); // native, unchanged
    expect(row.convertedAmount).toBe(3160);

    // suggestions never gain a converted field.
    for (const s of body.suggestions) {
      expect(s).not.toHaveProperty('convertedAmount');
    }
  });

  it('omits convertedNet entirely for a settled-up member instead of showing a converted zero (spec — never "you owe 0.00")', async () => {
    groupMemberFindFirstMock.mockResolvedValue(activeMembership());
    mockGroupMemberFindMany();
    expenseFindManyMock.mockResolvedValue([]);
    settlementFindManyMock.mockResolvedValue([]);
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1 }));

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${GROUP_ID}/balances`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body = res.json();
    for (const m of body.members) {
      expect(m.balances).toEqual([]);
      expect(m).not.toHaveProperty('convertedNet');
    }
  });

  it('omits convertedAmount (never null/0) on a pairwise row whose currency cannot be converted, keeping the native amount usable (per-row RATE_UNAVAILABLE, non-500 discipline)', async () => {
    groupMemberFindFirstMock.mockResolvedValue(activeMembership());
    mockGroupMemberFindMany();
    expenseFindManyMock.mockResolvedValue([expense('PKR', 100000, 'user_2', USER_ID)]);
    settlementFindManyMock.mockResolvedValue([]);
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1 })); // PKR unresolvable
    manualExchangeRateFindUniqueMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${GROUP_ID}/balances`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pairwise[0].amount).toBe(100000);
    expect(body.pairwise[0]).not.toHaveProperty('convertedAmount');

    const me = body.members.find((m: { user: { id: string } }) => m.user.id === USER_ID);
    expect(me.convertedNet).toEqual({ amount: 0, unresolved: [{ currency: 'PKR', amount: -100000 }] });
  });

  // WI-008 (settlements) / ADR-009 (reconciled 2026-07-14) — a directly-recorded (groupId:
  // null) settlement is attributed to a group only when that group is the pair's SOLE
  // shared group system-wide; for 2+ shared groups the pool is left unattributed
  // (documented limitation), never resolved/spread across them.
  describe('WI-008: direct (groupId: null) settlements attributed to group balances', () => {
    /**
     * `settlement.findMany` now serves two distinct queries in this route: the target
     * group's own rows (`where: { groupId }`) and the direct (`groupId: null`) pool.
     * Dispatch by the `where.groupId` shape so one mock can serve both.
     */
    function mockSettlementFindMany(opts: { own?: unknown[]; direct?: unknown[] }) {
      const { own = [], direct = [] } = opts;
      settlementFindManyMock.mockImplementation((args: { where: { groupId?: unknown } }) => {
        return Promise.resolve(args.where.groupId === null ? direct : own);
      });
    }

    it('Happy path — a directly-recorded settlement clears a group-only debt (single shared group, count === 1)', async () => {
      groupMemberFindFirstMock.mockResolvedValue(activeMembership());
      mockGroupMemberFindMany(); // single-group fixture: the pair's sole shared group is the target.
      expenseFindManyMock.mockResolvedValue([expense('PKR', 800, USER_ID, 'user_2')]); // user_2 (Ana) owes USER_ID 800
      mockSettlementFindMany({
        own: [], // no group-scoped settlement
        direct: [{ currency: 'PKR', fromUserId: 'user_2', toUserId: USER_ID, amount: 800 }], // recorded groupId: null
      });
      userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'PKR' });
      exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('PKR', { PKR: 1 }));

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/groups/${GROUP_ID}/balances`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Settled: no stale "Ana owes PKR 800" pairwise row, no member balance, no suggestion.
      expect(body.pairwise).toEqual([]);
      expect(body.suggestions).toEqual([]);
      for (const m of body.members) expect(m.balances).toEqual([]);
    });

    it('Worked example A (reconciled) — a pair sharing two groups leaves a direct settlement unattributed, not double-counted or resolved', async () => {
      const HOME_GROUP_ID = 'group_id_home';
      groupMemberFindFirstMock.mockResolvedValue(activeMembership());
      // Both members belong to GROUP_ID ("Trip", the target) AND HOME_GROUP_ID ("Home") ->
      // sharedGroupCountOf(USER_ID, 'user_2') === 2 -> the rule does not fire.
      groupMemberFindManyMock.mockImplementation((args: { where?: { groupId?: unknown; userId?: unknown } }) => {
        if (args?.where && 'groupId' in args.where) return Promise.resolve(members());
        return Promise.resolve([
          { groupId: GROUP_ID, userId: USER_ID },
          { groupId: GROUP_ID, userId: 'user_2' },
          { groupId: HOME_GROUP_ID, userId: USER_ID },
          { groupId: HOME_GROUP_ID, userId: 'user_2' },
        ]);
      });
      // Trip (target): user_2 owes USER_ID 500 from this group's own expenses.
      expenseFindManyMock.mockResolvedValue([expense('PKR', 500, USER_ID, 'user_2')]);
      // One direct (groupId: null) settlement for the full PKR 800 combined (Trip 500 + Home 300) debt.
      mockSettlementFindMany({
        own: [],
        direct: [{ currency: 'PKR', fromUserId: 'user_2', toUserId: USER_ID, amount: 800 }],
      });
      userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'PKR' });
      exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('PKR', { PKR: 1 }));

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/groups/${GROUP_ID}/balances`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Rule does not fire (count === 2): Trip keeps showing its native, unadjusted PKR 500
      // debt — the accepted, documented limitation for 2+ shared groups (spec-WI-008.md's
      // Worked example A, reconciled 2026-07-14) — never double-counted, never silently
      // resolved either.
      expect(body.pairwise).toHaveLength(1);
      expect(body.pairwise[0]).toMatchObject({
        currency: 'PKR',
        fromUserId: 'user_2',
        toUserId: USER_ID,
        amount: 500,
      });
    });

    it('Worked example B (reconciled) — a partial direct settlement across two shared groups is likewise left unattributed', async () => {
      const HOME_GROUP_ID = 'group_id_home';
      groupMemberFindFirstMock.mockResolvedValue(activeMembership());
      groupMemberFindManyMock.mockImplementation((args: { where?: { groupId?: unknown; userId?: unknown } }) => {
        if (args?.where && 'groupId' in args.where) return Promise.resolve(members());
        return Promise.resolve([
          { groupId: GROUP_ID, userId: USER_ID },
          { groupId: GROUP_ID, userId: 'user_2' },
          { groupId: HOME_GROUP_ID, userId: USER_ID },
          { groupId: HOME_GROUP_ID, userId: 'user_2' },
        ]);
      });
      expenseFindManyMock.mockResolvedValue([expense('PKR', 500, USER_ID, 'user_2')]);
      // A partial PKR 500 direct settlement (less than the 800 combined debt) — still unattributed.
      mockSettlementFindMany({
        own: [],
        direct: [{ currency: 'PKR', fromUserId: 'user_2', toUserId: USER_ID, amount: 500 }],
      });
      userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'PKR' });
      exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('PKR', { PKR: 1 }));

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/groups/${GROUP_ID}/balances`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.pairwise).toHaveLength(1);
      expect(body.pairwise[0]).toMatchObject({
        currency: 'PKR',
        fromUserId: 'user_2',
        toUserId: USER_ID,
        amount: 500, // Trip's native debt, unadjusted — the partial payment is not attributed here either.
      });
    });

    it('Regression — a settlement explicitly scoped to one group never leaks into another', async () => {
      groupMemberFindFirstMock.mockResolvedValue(activeMembership());
      mockGroupMemberFindMany(); // single shared group (the target) — isolates the scoped-settlement behavior.
      expenseFindManyMock.mockResolvedValue([expense('PKR', 500, USER_ID, 'user_2')]);
      mockSettlementFindMany({
        own: [{ currency: 'PKR', fromUserId: 'user_2', toUserId: USER_ID, amount: 500 }], // groupId explicitly = GROUP_ID
        direct: [], // no groupId: null settlements at all
      });
      userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'PKR' });
      exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('PKR', { PKR: 1 }));

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/groups/${GROUP_ID}/balances`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.pairwise).toEqual([]); // settled by its own scoped settlement, not by any attribution
      for (const m of body.members) expect(m.balances).toEqual([]);
    });

    it('Regression — a soft-deleted direct settlement never influences the group balance', async () => {
      groupMemberFindFirstMock.mockResolvedValue(activeMembership());
      mockGroupMemberFindMany();
      expenseFindManyMock.mockResolvedValue([expense('PKR', 800, USER_ID, 'user_2')]);
      // The direct-pool query itself filters deletedAt: null, so a soft-deleted settlement is
      // simply never returned here — simulate that by returning an empty pool.
      mockSettlementFindMany({ own: [], direct: [] });
      userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'PKR' });
      exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('PKR', { PKR: 1 }));

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/groups/${GROUP_ID}/balances`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Still outstanding — the (soft-deleted, excluded) settlement contributed nothing.
      expect(body.pairwise).toHaveLength(1);
      expect(body.pairwise[0]).toMatchObject({
        currency: 'PKR',
        fromUserId: 'user_2',
        toUserId: USER_ID,
        amount: 800,
      });
    });
  });
});
