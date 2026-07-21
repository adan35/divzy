import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * WI-008 (social-groups) — GET /groups folds a null-groupId settlement into
 * the one group a pair shares, written directly from story-WI-008.md's
 * Gherkin scenarios (TDD: written before/alongside the groups.ts fix).
 *
 * `assertSettledUp`/`loadGroupLedger` (the leave/remove 409 gate) is a
 * separate code path in the same file, untouched by this fix — the last
 * describe block below proves it directly by asserting the new
 * `groupMember.findMany` (Step 2 of the fold-in algorithm) is never invoked
 * on that path.
 */

const userFindUniqueMock = vi.fn();
const groupFindManyMock = vi.fn();
const groupMemberFindFirstMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
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
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => exchangeRateCacheFindUniqueMock(...args),
      upsert: (...args: unknown[]) => exchangeRateCacheUpsertMock(...args),
    },
  },
}));

import { buildApp } from '../src/app';
import { resetCacheForTests } from '../src/lib/cache';

let app: FastifyInstance;
let token: string;

function freshCacheRow(base: string, rates: Record<string, number>) {
  return { id: 'cache_wi008', base, rates, fetchedAt: new Date() };
}

/** Routes prisma.settlement.findMany by its own where.groupId shape, matching groups.ts's two calls. */
function mockSettlements(direct: unknown[], nullGroup: unknown[] = []) {
  settlementFindManyMock.mockImplementation(async (args: { where?: { groupId?: unknown } }) => {
    if (args?.where?.groupId === null) return nullGroup;
    return direct;
  });
}

function group(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'grp_roomies',
    name: 'Roomies',
    emoji: '🏠',
    type: 'HOME',
    currency: 'PKR',
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    archivedAt: null,
    members: [{ userId: 'me' }, { userId: 'ana' }],
    ...overrides,
  };
}

/** "Ana owes me PKR 800.00" — I paid, Ana's split is the full amount. */
function expenseAnaOwesMe(groupId: string, amountMinor: number) {
  return {
    groupId,
    currency: 'PKR',
    createdAt: new Date('2026-07-02T00:00:00.000Z'),
    payers: [{ userId: 'me', amount: amountMinor }],
    splits: [
      { userId: 'ana', amount: amountMinor },
      { userId: 'me', amount: 0 },
    ],
  };
}

/** A settlement of Ana paying me back — fromUserId is the debtor paying down their debt. */
function anaPaysMe(groupId: string | null, amountMinor: number) {
  return {
    groupId,
    currency: 'PKR',
    createdAt: new Date('2026-07-05T00:00:00.000Z'),
    fromUserId: 'ana',
    toUserId: 'me',
    amount: amountMinor,
  };
}

beforeEach(async () => {
  userFindUniqueMock.mockReset();
  groupFindManyMock.mockReset();
  groupMemberFindFirstMock.mockReset();
  groupMemberFindManyMock.mockReset();
  groupMemberFindManyMock.mockResolvedValue([]);
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();
  exchangeRateCacheFindUniqueMock.mockReset();
  exchangeRateCacheUpsertMock.mockReset();
  userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'PKR' });
  exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('PKR', { PKR: 1 }));
  // WI-070: GET /groups is now wrapped in the process-wide response cache
  // (same as GET /balance since WI-067), keyed on this fixed userId with no
  // query params — every it() below must start from a cold cache, otherwise
  // a later test's mock reconfiguration would never be observed.
  resetCacheForTests();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: 'me' });
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/v1/groups — WI-008 null-groupId settlement fold-in', () => {
  it('Reproduction: a group-scoped debt settled via a null-groupId payment nets to zero', async () => {
    groupFindManyMock.mockResolvedValue([group()]);
    expenseFindManyMock.mockResolvedValue([expenseAnaOwesMe('grp_roomies', 80000)]);
    // Full null-groupId settlement between the only two people who share exactly one group.
    mockSettlements([], [anaPaysMe(null, 80000)]);
    groupMemberFindManyMock.mockResolvedValue([
      { userId: 'me', groupId: 'grp_roomies' },
      { userId: 'ana', groupId: 'grp_roomies' },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [summary] = res.json();
    expect(summary.yourBalances).toEqual([]);
    expect(summary.yourBalanceConverted).toBeNull(); // settled up, not "owed PKR 800"
  });

  it('A group-scoped settlement (groupId explicitly set) already nets correctly and keeps doing so', async () => {
    groupFindManyMock.mockResolvedValue([group()]);
    expenseFindManyMock.mockResolvedValue([expenseAnaOwesMe('grp_roomies', 80000)]);
    // Same settlement, but recorded WITH groupId set — the pre-existing "direct" path.
    mockSettlements([anaPaysMe('grp_roomies', 80000)], []);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [summary] = res.json();
    expect(summary.yourBalances).toEqual([]);
    expect(summary.yourBalanceConverted).toBeNull();
    // The direct-settlement path never needs the Step-2 shared-group lookup.
    expect(groupMemberFindManyMock).not.toHaveBeenCalled();
  });

  it('A partial null-groupId settlement nets a partial balance, not zero or double-counted', async () => {
    groupFindManyMock.mockResolvedValue([group()]);
    expenseFindManyMock.mockResolvedValue([expenseAnaOwesMe('grp_roomies', 80000)]);
    mockSettlements([], [anaPaysMe(null, 30000)]);
    groupMemberFindManyMock.mockResolvedValue([
      { userId: 'me', groupId: 'grp_roomies' },
      { userId: 'ana', groupId: 'grp_roomies' },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [summary] = res.json();
    expect(summary.yourBalances).toEqual([]);
    expect(summary.yourBalanceConverted).toEqual({ currency: 'PKR', amount: 50000 }); // 800 - 300 = 500 owed
  });

  it('Multi-shared-group: a null-groupId settlement between a pair sharing two groups stays excluded from both', async () => {
    groupFindManyMock.mockResolvedValue([
      group({ id: 'grp_roomies', name: 'Roomies' }),
      group({ id: 'grp_trip', name: 'Lisbon trip' }),
    ]);
    expenseFindManyMock.mockResolvedValue([
      expenseAnaOwesMe('grp_roomies', 80000),
      expenseAnaOwesMe('grp_trip', 50000),
    ]);
    mockSettlements([], [anaPaysMe(null, 80000)]);
    // Ana and I are BOTH active in both groups -> shared-group count is 2 -> ambiguous -> excluded.
    groupMemberFindManyMock.mockResolvedValue([
      { userId: 'me', groupId: 'grp_roomies' },
      { userId: 'me', groupId: 'grp_trip' },
      { userId: 'ana', groupId: 'grp_roomies' },
      { userId: 'ana', groupId: 'grp_trip' },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const summaries: Array<{ id: string; yourBalanceConverted: { amount: number } | null }> =
      res.json();
    const roomies = summaries.find((s) => s.id === 'grp_roomies')!;
    const trip = summaries.find((s) => s.id === 'grp_trip')!;
    // Neither group absorbs the settlement — both still show their own expense-only net,
    // unattributed and unaffected (matching today's pre-WI-008 behavior for this case).
    expect(roomies.yourBalanceConverted).toEqual({ currency: 'PKR', amount: 80000 });
    expect(trip.yourBalanceConverted).toEqual({ currency: 'PKR', amount: 50000 });
  });
});

describe('WI-008 regression guard — the leave/remove balance gate is unaffected', () => {
  it('POST /groups/:groupId/leave still 409s on an outstanding native balance, never touching the WI-008 fold-in query path', async () => {
    groupMemberFindFirstMock.mockResolvedValue({
      id: 'gm_1',
      groupId: 'grp_roomies',
      userId: 'me',
      role: 'MEMBER',
      leftAt: null,
      user: { id: 'me', name: 'Me', avatarColor: '#000' },
      group: { name: 'Roomies' },
    });
    expenseFindManyMock.mockResolvedValue([
      {
        currency: 'PKR',
        payers: [{ userId: 'ana', amount: 80000 }],
        splits: [
          { userId: 'me', amount: 80000 },
          { userId: 'ana', amount: 0 },
        ],
      },
    ]);
    // loadGroupLedger's own settlement query passes a truthy groupId (never null),
    // so the plain mockResolvedValue([]) below only ever serves that one call shape.
    settlementFindManyMock.mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/groups/grp_roomies/leave',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('OUTSTANDING_BALANCE');
    // WI-052 (test-social-groups, 2026-07-18): assertSettledUp's failure branch
    // now legitimately calls prisma.groupMember.findMany exactly once, to
    // resolve debtor/creditor display names for the counterparty-named 409
    // message (buildOutstandingBalanceMessage, spec-WI-052 D3) — this is NOT
    // the WI-008 Step-2 shared-group fold-in query (that shape has no
    // `groupId` in its where clause and selects `groupId`, not `user`; it is
    // reachable only from the GET /groups handler, still proven separately by
    // the describe block above). Distinguish the two call shapes explicitly
    // so a future accidental reintroduction of the Step-2 query on this path
    // would still be caught.
    expect(groupMemberFindManyMock).toHaveBeenCalledTimes(1);
    expect(groupMemberFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ groupId: 'grp_roomies' }),
        select: expect.objectContaining({ user: expect.anything() }),
      }),
    );
    // And the gate never touches the conversion engine either (charter invariant, unchanged).
    expect(exchangeRateCacheFindUniqueMock).not.toHaveBeenCalled();
  });
});
