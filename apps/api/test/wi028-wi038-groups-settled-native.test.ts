// WI-028 (settled, group-wide) + WI-038 (yourBalancesNative) additive fields
// on GET /groups. Written from spec-WI-028.md's Sequence flow and
// spec-WI-038.md's API contract, TDD red-first against the pre-change route
// (neither field existed on GroupSummaryDto).
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

let app: FastifyInstance;
let token: string;

function freshCacheRow(base: string, rates: Record<string, number>) {
  return { id: 'cache_1', base, rates, fetchedAt: new Date() };
}

function mockSettlements(direct: unknown[], nullGroup: unknown[] = []) {
  settlementFindManyMock.mockImplementation(async (args: { where?: { groupId?: unknown } }) => {
    if (args?.where?.groupId === null) return nullGroup;
    return direct;
  });
}

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
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: 'user_1' });
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/v1/groups — settled (WI-028)', () => {
  it('is settled (true) for a group with no expenses/settlements (trivially settled)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    groupFindManyMock.mockResolvedValue([group()]);
    expenseFindManyMock.mockResolvedValue([]);
    mockSettlements([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()[0].settled).toBe(true);
  });

  it('is unsettled (false) when the VIEWER is settled but another member still owes (group-wide, not viewer-only)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    groupFindManyMock.mockResolvedValue([
      group({ members: [{ userId: 'user_1' }, { userId: 'user_2' }, { userId: 'user_3' }] }),
    ]);
    // user_2 paid for user_3 only; user_1 (viewer) is untouched and nets zero,
    // but user_2/user_3 have nonzero nets -> group-wide unsettled.
    expenseFindManyMock.mockResolvedValue([
      {
        groupId: 'group_1',
        currency: 'USD',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'user_2', amount: 1000 }],
        splits: [{ userId: 'user_3', amount: 1000 }],
      },
    ]);
    mockSettlements([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [summary] = res.json();
    expect(summary.yourBalances).toEqual([]); // viewer's own net is zero
    expect(summary.settled).toBe(false); // but the group is not fully settled
  });

  it('is settled (true) when every member nets zero across all currencies', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    groupFindManyMock.mockResolvedValue([group()]);
    expenseFindManyMock.mockResolvedValue([
      {
        groupId: 'group_1',
        currency: 'USD',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'user_1', amount: 1000 }],
        splits: [{ userId: 'user_1', amount: 500 }, { userId: 'user_2', amount: 500 }],
      },
    ]);
    mockSettlements([
      {
        groupId: 'group_1',
        currency: 'USD',
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
        fromUserId: 'user_2',
        toUserId: 'user_1',
        amount: 500,
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()[0].settled).toBe(true);
  });
});

describe('GET /api/v1/groups — yourBalancesNative (WI-038)', () => {
  it('carries the full native per-currency net even when conversion collapses yourBalances to []', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    groupFindManyMock.mockResolvedValue([group()]);
    expenseFindManyMock.mockResolvedValue([
      {
        groupId: 'group_1',
        currency: 'USD',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'user_2', amount: 5000 }],
        splits: [{ userId: 'user_1', amount: 5000 }, { userId: 'user_2', amount: 0 }],
      },
    ]);
    mockSettlements([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.79 }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [summary] = res.json();
    expect(summary.yourBalances).toEqual([]); // converted away (WI-001 leftover behavior unchanged)
    expect(summary.yourBalancesNative).toEqual([{ currency: 'USD', amount: -5000 }]);
  });

  it('is [] for a settled-up group (no native net at all)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
    groupFindManyMock.mockResolvedValue([group()]);
    expenseFindManyMock.mockResolvedValue([]);
    mockSettlements([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()[0].yourBalancesNative).toEqual([]);
  });
});

// Same fallback-drift technique as groups-route.test.ts, unrelated to this file's assertions.
vi.mock('../src/lib/rates-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates-fallback')>();
  const { PKR: _omitted, ...rest } = actual.FALLBACK_RATES;
  return { FALLBACK_RATES: rest };
});
