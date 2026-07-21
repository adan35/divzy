// spec-WI-054b — POST /expenses/:expenseId/restore + GET /expenses/:expenseId
// 200-with-deletedAt fix. Real-DB (not mocked prisma) — deliberately, per
// this domain's own memory precedent (expense-history.test.ts,
// wi054-055-056-real-db-integration.test.ts): expense-service write paths
// fan out through nested payer/split writes + recordActivity, which is more
// faithfully exercised against the real test DB than a hand-rolled prisma
// mock. TDD: written directly from story-WI-054b.md's Gherkin AC and
// spec-WI-054b.md §1/§2 before `restoreExpense`/the route/the GET fix
// existed — run red first (POST /restore 404s with no route at all; GET on
// a deleted expense 404s unconditionally), then made green.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/app';

const STAMP = Date.now();
let app: FastifyInstance;

async function createTestUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `wi054b-${label}-${STAMP}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-054b ${label}`,
      emailNotifications: false,
    },
  });
  return user.id;
}

function tokenFor(userId: string) {
  return app.jwt.sign({ sub: userId });
}

async function createGroup(name: string, memberIds: string[], createdById: string) {
  const group = await prisma.group.create({
    data: {
      name,
      inviteCode: `wi054b-${name.replace(/\s+/g, '')}-${STAMP}`,
      createdById,
      members: {
        create: memberIds.map((userId) => ({
          userId,
          role: userId === createdById ? 'ADMIN' : 'MEMBER',
        })),
      },
    },
  });
  return group.id;
}

function baseExpensePayload(overrides: Record<string, unknown> = {}) {
  return {
    description: 'Group dinner',
    amount: 2000,
    currency: 'USD',
    category: 'FOOD_DRINK',
    date: '2026-07-10T00:00:00.000Z',
    splitType: 'EQUAL',
    ...overrides,
  };
}

async function createExpenseViaApi(token: string, payload: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/expenses',
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
}

async function deleteExpenseViaApi(token: string, expenseId: string) {
  return app.inject({
    method: 'DELETE',
    url: `/api/v1/expenses/${expenseId}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function restoreExpenseViaApi(token: string, expenseId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/expenses/${expenseId}/restore`,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function getExpenseViaApi(token: string, expenseId: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/expenses/${expenseId}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  // Expense.createdBy has no cascade delete (Restrict) — remove expenses
  // before their creating users. Cascade handles payers/splits/items/
  // activity rows off the expense/group/user relations.
  await prisma.expense.deleteMany({ where: { createdById: { in: createdUserIds } } });
  await prisma.activityLog.deleteMany({ where: { actorId: { in: createdUserIds } } });
  await prisma.groupMember.deleteMany({ where: { groupId: { in: createdGroupIds } } });
  await prisma.group.deleteMany({ where: { id: { in: createdGroupIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe('WI-054b — POST /expenses/:expenseId/restore: authz mirrors deleteExpense (visibility only, no creator/admin gate)', () => {
  let creatorId: string;
  let participantId: string; // split participant, not a payer
  let memberOnlyId: string; // active group member, not involved in the expense at all
  let outsiderId: string; // not a member, not involved — must 404
  let creatorToken: string;
  let memberOnlyToken: string;
  let outsiderToken: string;
  let groupId: string;
  let expenseId: string;
  let notifCountBeforeRestore: number;

  beforeAll(async () => {
    creatorId = await createTestUser('authz-creator');
    participantId = await createTestUser('authz-participant');
    memberOnlyId = await createTestUser('authz-memberonly');
    outsiderId = await createTestUser('authz-outsider');
    createdUserIds.push(creatorId, participantId, memberOnlyId, outsiderId);

    creatorToken = tokenFor(creatorId);
    memberOnlyToken = tokenFor(memberOnlyId);
    outsiderToken = tokenFor(outsiderId);

    groupId = await createGroup('Authz fixture', [creatorId, participantId, memberOnlyId], creatorId);
    createdGroupIds.push(groupId);

    const expense = await createExpenseViaApi(
      creatorToken,
      baseExpensePayload({
        groupId,
        payers: [{ userId: creatorId, amount: 2000 }],
        participants: [{ userId: creatorId }, { userId: participantId }],
      }),
    );
    expenseId = expense.id;

    const del = await deleteExpenseViaApi(creatorToken, expenseId);
    expect(del.statusCode).toBe(204);

    // Snapshot Notification count right before the restore call — the
    // preceding create/delete legitimately DO create EXPENSE_ADDED/
    // EXPENSE_DELETED Notification rows (their own `notify` blocks); only
    // the restore call itself must add zero.
    notifCountBeforeRestore = await prisma.notification.count({
      where: { userId: { in: [creatorId, participantId, memberOnlyId] } },
    });
  });

  it('a non-visible caller (not creator, not payer, not split participant, not an active group member) gets 404, never a existence-leaking response', async () => {
    const res = await restoreExpenseViaApi(outsiderToken, expenseId);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('an active group member who is NOT the creator, a payer, or a split participant may still restore it — visibility is the whole authz decision', async () => {
    const res = await restoreExpenseViaApi(memberOnlyToken, expenseId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(expenseId);
    expect(body.deletedAt).toBeNull();
    // Every other field unchanged from the moment of deletion.
    expect(body.description).toBe('Group dinner');
    expect(body.amount).toBe(2000);
    expect(body.currency).toBe('USD');
    expect(body.payers).toHaveLength(1);
    expect(body.payers[0].user.id).toBe(creatorId);
    expect(body.payers[0].amount).toBe(2000);
    expect(body.splits).toHaveLength(2);
  });

  it('the restore is reflected in the underlying row and a single EXPENSE_RESTORED activity row was recorded with the delete-equivalent recipient set', async () => {
    const row = await prisma.expense.findUnique({ where: { id: expenseId } });
    expect(row?.deletedAt).toBeNull();

    const activityRows = await prisma.activityLog.findMany({
      where: { expenseId, type: 'EXPENSE_RESTORED' },
      include: { recipients: true },
    });
    expect(activityRows).toHaveLength(1);
    const row0 = activityRows[0]!;
    expect(row0.actorId).toBe(memberOnlyId);
    expect(row0.groupId).toBe(groupId);
    expect(row0.data).toMatchObject({
      description: 'Group dinner',
      amount: 2000,
      currency: 'USD',
    });
    // Recipients = every active member at restore time (group expense).
    const recipientIds = row0.recipients.map((r) => r.userId).sort();
    expect(recipientIds).toEqual([creatorId, memberOnlyId, participantId].sort());
  });

  it('restore never creates a Notification row for anyone (feed-only, no notify block, ADR-027 D4)', async () => {
    const notifCountAfter = await prisma.notification.count({
      where: { userId: { in: [creatorId, participantId, memberOnlyId] } },
    });
    expect(notifCountAfter).toBe(notifCountBeforeRestore);
  });
});

describe('WI-054b — restoring an already-active expense is an idempotent 200 no-op', () => {
  let creatorId: string;
  let creatorToken: string;
  let expenseId: string;

  beforeAll(async () => {
    creatorId = await createTestUser('idempotent-creator');
    createdUserIds.push(creatorId);
    creatorToken = tokenFor(creatorId);

    const otherId = await createTestUser('idempotent-other');
    createdUserIds.push(otherId);

    const expense = await createExpenseViaApi(
      creatorToken,
      baseExpensePayload({
        payers: [{ userId: creatorId, amount: 2000 }],
        participants: [{ userId: creatorId }, { userId: otherId }],
      }),
    );
    expenseId = expense.id;
  });

  it('restoring an expense that was never deleted is a well-formed 200 no-op — no activity row, deletedAt stays null', async () => {
    const before = await prisma.activityLog.count({ where: { expenseId, type: 'EXPENSE_RESTORED' } });
    const res = await restoreExpenseViaApi(creatorToken, expenseId);
    expect(res.statusCode).toBe(200);
    expect(res.json().deletedAt).toBeNull();
    const after = await prisma.activityLog.count({ where: { expenseId, type: 'EXPENSE_RESTORED' } });
    expect(after).toBe(before);
  });

  it('double-restore after a real delete-then-restore cycle creates exactly one EXPENSE_RESTORED row, not two', async () => {
    const del = await deleteExpenseViaApi(creatorToken, expenseId);
    expect(del.statusCode).toBe(204);

    const first = await restoreExpenseViaApi(creatorToken, expenseId);
    expect(first.statusCode).toBe(200);
    expect(first.json().deletedAt).toBeNull();

    const second = await restoreExpenseViaApi(creatorToken, expenseId);
    expect(second.statusCode).toBe(200);
    expect(second.json().deletedAt).toBeNull();

    const count = await prisma.activityLog.count({ where: { expenseId, type: 'EXPENSE_RESTORED' } });
    expect(count).toBe(1);

    const row = await prisma.expense.findUnique({ where: { id: expenseId } });
    expect(row?.deletedAt).toBeNull();
  });
});

describe('WI-054b — recipients are recomputed at restore time, not reused from delete time', () => {
  let actorId: string;
  let stayerId: string;
  let leaverId: string;
  let joinerId: string;
  let groupId: string;
  let expenseId: string;

  beforeAll(async () => {
    actorId = await createTestUser('asym-actor');
    stayerId = await createTestUser('asym-stayer');
    leaverId = await createTestUser('asym-leaver');
    joinerId = await createTestUser('asym-joiner');
    createdUserIds.push(actorId, stayerId, leaverId, joinerId);

    groupId = await createGroup('Asymmetry fixture', [actorId, stayerId, leaverId], actorId);
    createdGroupIds.push(groupId);

    const actorToken = tokenFor(actorId);
    const expense = await createExpenseViaApi(
      actorToken,
      baseExpensePayload({
        groupId,
        payers: [{ userId: actorId, amount: 2000 }],
        participants: [{ userId: actorId }, { userId: stayerId }],
      }),
    );
    expenseId = expense.id;

    const del = await deleteExpenseViaApi(actorToken, expenseId);
    expect(del.statusCode).toBe(204);

    // Membership changes between delete and restore.
    await prisma.groupMember.updateMany({
      where: { groupId, userId: leaverId },
      data: { leftAt: new Date() },
    });
    await prisma.groupMember.create({ data: { groupId, userId: joinerId, role: 'MEMBER' } });

    const restore = await restoreExpenseViaApi(actorToken, expenseId);
    expect(restore.statusCode).toBe(200);
  });

  it('the EXPENSE_RESTORED row recipients reflect membership as of restore time: the joiner is included, the leaver is not', async () => {
    const activityRows = await prisma.activityLog.findMany({
      where: { expenseId, type: 'EXPENSE_RESTORED' },
      include: { recipients: true },
    });
    expect(activityRows).toHaveLength(1);
    const recipientIds = activityRows[0]!.recipients.map((r) => r.userId).sort();
    expect(recipientIds).toEqual([actorId, joinerId, stayerId].sort());
    expect(recipientIds).not.toContain(leaverId);
  });
});

describe('WI-054b — GET /expenses/:expenseId returns 200-with-deletedAt for a visible caller, 404 for a non-visible one', () => {
  let creatorId: string;
  let outsiderId: string;
  let creatorToken: string;
  let outsiderToken: string;
  let expenseId: string;

  beforeAll(async () => {
    creatorId = await createTestUser('get-creator');
    outsiderId = await createTestUser('get-outsider');
    createdUserIds.push(creatorId, outsiderId);
    creatorToken = tokenFor(creatorId);
    outsiderToken = tokenFor(outsiderId);

    const otherId = await createTestUser('get-other');
    createdUserIds.push(otherId);

    const expense = await createExpenseViaApi(
      creatorToken,
      baseExpensePayload({
        payers: [{ userId: creatorId, amount: 2000 }],
        participants: [{ userId: creatorId }, { userId: otherId }],
      }),
    );
    expenseId = expense.id;

    const del = await deleteExpenseViaApi(creatorToken, expenseId);
    expect(del.statusCode).toBe(204);
  });

  it('a visible caller gets 200 with deletedAt populated (not 404) for a soft-deleted expense', async () => {
    const res = await getExpenseViaApi(creatorToken, expenseId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deletedAt).not.toBeNull();
    expect(body.description).toBe('Group dinner');
    expect(body.amount).toBe(2000);
  });

  it('a non-visible caller still gets 404 on the same soft-deleted expense — the visibility gate is unchanged', async () => {
    const res = await getExpenseViaApi(outsiderToken, expenseId);
    expect(res.statusCode).toBe(404);
  });

  it('history still 404s on the same soft-deleted expense (out of scope for this story, unchanged)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/expenses/${expenseId}/history`,
      headers: { authorization: `Bearer ${creatorToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('comments still 404 on the same soft-deleted expense (out of scope for this story, unchanged)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/expenses/${expenseId}/comments`,
      headers: { authorization: `Bearer ${creatorToken}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
