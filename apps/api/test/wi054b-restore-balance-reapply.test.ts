// spec-WI-054b §3 / §8 "Highest-value test": a real-Postgres (no mocks) proof
// that a restored expense's balance effect fully reapplies on a real
// balance-computation surface with no manual/cache-invalidation step beyond
// nulling `deletedAt`. Scenario: create a group expense with a nonzero
// balance impact -> assert GET /groups/:groupId/balances reflects it ->
// DELETE it -> assert the balance drops -> POST .../restore -> assert the
// balance returns to EXACTLY the pre-delete value, with no other action.
//
// This drives the real routes end to end (POST /expenses, DELETE
// /expenses/:id, POST /expenses/:id/restore, GET /groups/:id/balances) —
// deliberately not mocking prisma, per this domain's own memory precedent
// (expense-service write paths fan out through nested writes that a mock
// can't faithfully model, and this is exactly the "prove atomicity/real
// read-time recomputation" case that precedent calls out).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/app';

const STAMP = Date.now();
let app: FastifyInstance;

let ana: string; // pays the expense
let sam: string; // owes Ana from the expense
let groupId: string;
let expenseId: string;
let anaToken: string;
let samToken: string;

async function createTestUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `wi054b-balance-${label}-${STAMP}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-054b Balance ${label}`,
      emailNotifications: false,
    },
  });
  return user.id;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  ana = await createTestUser('ana');
  sam = await createTestUser('sam');
  anaToken = app.jwt.sign({ sub: ana });
  samToken = app.jwt.sign({ sub: sam });

  const group = await prisma.group.create({
    data: {
      name: 'Balance reapply fixture',
      inviteCode: `wi054b-balance-${STAMP}`,
      createdById: ana,
      members: {
        create: [
          { userId: ana, role: 'ADMIN' },
          { userId: sam, role: 'MEMBER' },
        ],
      },
    },
  });
  groupId = group.id;

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/expenses',
    headers: { authorization: `Bearer ${anaToken}` },
    payload: {
      groupId,
      description: 'Groceries',
      amount: 5000,
      currency: 'USD',
      category: 'FOOD_DRINK',
      date: '2026-07-10T00:00:00.000Z',
      splitType: 'EQUAL',
      payers: [{ userId: ana, amount: 5000 }],
      participants: [{ userId: ana }, { userId: sam }],
    },
  });
  expect(created.statusCode).toBe(201);
  expenseId = created.json().id;
});

afterAll(async () => {
  await app?.close();
  await prisma.expense.deleteMany({ where: { createdById: { in: [ana, sam] } } });
  await prisma.activityLog.deleteMany({ where: { actorId: { in: [ana, sam] } } });
  await prisma.groupMember.deleteMany({ where: { groupId } });
  await prisma.group.deleteMany({ where: { id: groupId } });
  await prisma.user.deleteMany({ where: { id: { in: [ana, sam] } } });
  await prisma.$disconnect();
});

async function getGroupBalances() {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/groups/${groupId}/balances`,
    headers: { authorization: `Bearer ${anaToken}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    members: Array<{ user: { id: string }; balances: Array<{ currency: string; amount: number }> }>;
  };
}

function balancesFor(body: Awaited<ReturnType<typeof getGroupBalances>>, userId: string) {
  return body.members.find((m) => m.user.id === userId)?.balances;
}

describe('WI-054b — real-DB balance-reapply: delete drops the balance, restore brings it back exactly', () => {
  it('baseline: with the expense live, Sam owes Ana 2500 (half of 5000), Ana is owed 2500', async () => {
    const body = await getGroupBalances();
    expect(balancesFor(body, ana)).toEqual([{ currency: 'USD', amount: 2500 }]);
    expect(balancesFor(body, sam)).toEqual([{ currency: 'USD', amount: -2500 }]);
  });

  it('after DELETE, the balance drops to zero for both — the expense no longer contributes', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/expenses/${expenseId}`,
      headers: { authorization: `Bearer ${anaToken}` },
    });
    expect(del.statusCode).toBe(204);

    const body = await getGroupBalances();
    expect(balancesFor(body, ana)).toEqual([]);
    expect(balancesFor(body, sam)).toEqual([]);
  });

  it('after POST .../restore, the balance returns to EXACTLY the pre-delete value, with no separate reapply step', async () => {
    const restore = await app.inject({
      method: 'POST',
      url: `/api/v1/expenses/${expenseId}/restore`,
      headers: { authorization: `Bearer ${samToken}` }, // restored by a different party than who deleted it
    });
    expect(restore.statusCode).toBe(200);
    expect(restore.json().deletedAt).toBeNull();

    const body = await getGroupBalances();
    expect(balancesFor(body, ana)).toEqual([{ currency: 'USD', amount: 2500 }]);
    expect(balancesFor(body, sam)).toEqual([{ currency: 'USD', amount: -2500 }]);
  });
});
