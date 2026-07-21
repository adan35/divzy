// spec-WI-054 (ADR-027) — strikethrough-in-place lifecycle collapse for
// GET /activity, and spec-WI-055 — actor-relative colorHint. Written
// red-first against the pre-change route (no deletedAt/colorHint
// enrichment, no companion query, no terminal-type exclusion).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const activityLogFindManyMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    activityLog: { findMany: (...args: unknown[]) => activityLogFindManyMock(...args) },
  },
}));

import { buildApp } from '../src/app';
import { resetCacheForTests } from '../src/lib/cache';

let app: FastifyInstance;
let token: string;

const VIEWER_ID = 'user_viewer01';
const OTHER_ID = 'user_other001';

function actor(id: string) {
  return { id, name: 'Actor', avatarColor: '#fff', avatarUrl: null };
}

function anchorExpenseAdded(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'act_expense_added',
    type: 'EXPENSE_ADDED',
    actorId: VIEWER_ID,
    actor: actor(VIEWER_ID),
    group: null,
    groupId: null,
    expenseId: 'exp_1',
    settlementId: null,
    data: { description: 'Groceries', amount: 4210, currency: 'USD' },
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
    ...overrides,
  };
}

function anchorSettlementAdded(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'act_settlement_added',
    type: 'SETTLEMENT_ADDED',
    actorId: OTHER_ID,
    actor: actor(OTHER_ID),
    group: null,
    groupId: null,
    expenseId: null,
    settlementId: 'settle_1',
    data: { amount: 1000, currency: 'USD' },
    createdAt: new Date('2026-07-09T00:00:00.000Z'),
    ...overrides,
  };
}

function unrelatedUpdate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'act_expense_updated',
    type: 'EXPENSE_UPDATED',
    actorId: VIEWER_ID,
    actor: actor(VIEWER_ID),
    group: null,
    groupId: null,
    expenseId: 'exp_1',
    settlementId: null,
    data: { description: 'Groceries' },
    createdAt: new Date('2026-07-08T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(async () => {
  activityLogFindManyMock.mockReset();
  // WI-073: GET /activity is now wrapped in cached() (fixed VIEWER_ID across
  // it() blocks would otherwise observe a stale hit from a prior test's
  // mocked response — see lib/cache.ts's resetCacheForTests() doc comment).
  resetCacheForTests();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: VIEWER_ID });
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/v1/activity — WI-054 collapse + WI-055 colorHint', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/activity' });
    expect(res.statusCode).toBe(401);
  });

  it('excludes terminal types from the main page query at the DB level', async () => {
    activityLogFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(activityLogFindManyMock).toHaveBeenCalledTimes(1);
    const firstCallArgs = activityLogFindManyMock.mock.calls[0]![0];
    expect(firstCallArgs.where).toEqual(
      expect.objectContaining({
        recipients: { some: { userId: VIEWER_ID } },
        type: {
          notIn: ['EXPENSE_DELETED', 'SETTLEMENT_DELETED', 'EXPENSE_RESTORED', 'SETTLEMENT_RESTORED'],
        },
      }),
    );
  });

  it('skips the companion query entirely when the page has no ADDED anchor rows', async () => {
    activityLogFindManyMock.mockResolvedValueOnce([unrelatedUpdate()]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(activityLogFindManyMock).toHaveBeenCalledTimes(1);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].deletedAt).toBeNull();
    expect(body.items[0].colorHint).toBeNull();
  });

  it('decorates an EXPENSE_ADDED anchor with deletedAt when the caller received a later EXPENSE_DELETED for the same expense', async () => {
    activityLogFindManyMock
      .mockResolvedValueOnce([anchorExpenseAdded()])
      .mockResolvedValueOnce([
        {
          type: 'EXPENSE_DELETED',
          expenseId: 'exp_1',
          settlementId: null,
          createdAt: new Date('2026-07-11T00:00:00.000Z'),
        },
      ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].deletedAt).toBe('2026-07-11T00:00:00.000Z');
    // Struck-through rows are neutral regardless of actor (WI-055 precedence).
    expect(body.items[0].colorHint).toBeNull();

    // Companion query scoped to the caller's own recipient rows + this page's ids.
    const companionArgs = activityLogFindManyMock.mock.calls[1]![0];
    expect(companionArgs.where).toEqual(
      expect.objectContaining({
        recipients: { some: { userId: VIEWER_ID } },
        type: { in: ['EXPENSE_DELETED', 'SETTLEMENT_DELETED', 'EXPENSE_RESTORED', 'SETTLEMENT_RESTORED'] },
        OR: [{ expenseId: { in: ['exp_1'] } }, { settlementId: { in: [] } }],
      }),
    );
  });

  it('latest-terminal-wins: a RESTORED row after a DELETED row clears deletedAt back to null', async () => {
    activityLogFindManyMock
      .mockResolvedValueOnce([anchorExpenseAdded()])
      .mockResolvedValueOnce([
        // desc-ordered by createdAt — RESTORED is the newest, so "first hit wins".
        {
          type: 'EXPENSE_RESTORED',
          expenseId: 'exp_1',
          settlementId: null,
          createdAt: new Date('2026-07-12T00:00:00.000Z'),
        },
        {
          type: 'EXPENSE_DELETED',
          expenseId: 'exp_1',
          settlementId: null,
          createdAt: new Date('2026-07-11T00:00:00.000Z'),
        },
      ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${token}` },
    });

    const body = res.json();
    expect(body.items[0].deletedAt).toBeNull();
    // Not struck through -> actor is the viewer -> green.
    expect(body.items[0].colorHint).toBe('green');
  });

  it('does not decorate an unrelated EXPENSE_UPDATED row for the same entity (decoration scope: anchors only)', async () => {
    activityLogFindManyMock
      .mockResolvedValueOnce([anchorExpenseAdded(), unrelatedUpdate({ id: 'act_upd_2' })])
      .mockResolvedValueOnce([
        {
          type: 'EXPENSE_DELETED',
          expenseId: 'exp_1',
          settlementId: null,
          createdAt: new Date('2026-07-11T00:00:00.000Z'),
        },
      ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${token}` },
    });

    const body = res.json();
    const addedRow = body.items.find((i: { id: string }) => i.id === 'act_expense_added');
    const updatedRow = body.items.find((i: { id: string }) => i.id === 'act_upd_2');
    expect(addedRow.deletedAt).toBe('2026-07-11T00:00:00.000Z');
    expect(updatedRow.deletedAt).toBeNull();
  });

  it('per-recipient scoping falls out of the companion query filter: no terminal match -> stays un-decorated', async () => {
    activityLogFindManyMock.mockResolvedValueOnce([anchorExpenseAdded()]).mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${token}` },
    });

    const body = res.json();
    expect(body.items[0].deletedAt).toBeNull();
    expect(body.items[0].colorHint).toBe('green');
  });

  it('colorHint: green when the viewer is the EXPENSE_ADDED actor, red otherwise, null for non-EXPENSE_ADDED types', async () => {
    activityLogFindManyMock
      .mockResolvedValueOnce([
        anchorExpenseAdded({ id: 'act_mine', actorId: VIEWER_ID, actor: actor(VIEWER_ID) }),
        anchorExpenseAdded({ id: 'act_theirs', actorId: OTHER_ID, actor: actor(OTHER_ID), expenseId: 'exp_2' }),
        anchorSettlementAdded({ id: 'act_settlement', actorId: VIEWER_ID, actor: actor(VIEWER_ID) }),
      ])
      .mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${token}` },
    });

    const body = res.json();
    const byId = Object.fromEntries(body.items.map((i: { id: string; colorHint: unknown }) => [i.id, i.colorHint]));
    expect(byId.act_mine).toBe('green');
    expect(byId.act_theirs).toBe('red');
    expect(byId.act_settlement).toBeNull();
  });

  it('collects both expenseIds and settlementIds from the page for the companion query', async () => {
    activityLogFindManyMock
      .mockResolvedValueOnce([anchorExpenseAdded(), anchorSettlementAdded()])
      .mockResolvedValueOnce([]);

    await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${token}` },
    });

    const companionArgs = activityLogFindManyMock.mock.calls[1]![0];
    expect(companionArgs.where.OR).toEqual([
      { expenseId: { in: ['exp_1'] } },
      { settlementId: { in: ['settle_1'] } },
    ]);
  });
});
