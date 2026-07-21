// spec-WI-054b §5 / §9 (backend "Balance/export reapply") — ADR-028 D3
// ratification, proven mechanically: nulling `Settlement.deletedAt` alone is
// sufficient to reapply a settlement's balance effect on every real read
// surface, with no cache/second path. Real-DB (no mocked prisma), end-to-end
// through the real routes: POST /settlements (via the real create route, so
// `assertWithinOutstanding` is exercised honestly) -> DELETE -> POST
// .../restore -> re-check GET /balance, GET /groups/:id/balances, all three
// group exports, and GET /analytics/summary (must stay untouched throughout,
// since it never reads Settlement).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/app';

const STAMP = Date.now();
let app: FastifyInstance;

let ana: string; // pays the expense, receives the settlement
let sam: string; // owes Ana from the expense, pays the settlement
let anaToken: string;
let samToken: string;
let groupId: string;
let expenseId: string;
let settlementId: string;

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `wi054b-reapply-${label}-${STAMP}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-054b Reapply ${label}`,
      emailNotifications: false,
    },
  });
  return user.id;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  ana = await createUser('ana');
  sam = await createUser('sam');
  anaToken = app.jwt.sign({ sub: ana });
  samToken = app.jwt.sign({ sub: sam });

  const group = await prisma.group.create({
    data: {
      name: 'WI-054b Reapply Fixture',
      inviteCode: `wi054b-reapply-${STAMP}`,
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

  const expenseRes = await app.inject({
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
  expect(expenseRes.statusCode).toBe(201);
  expenseId = expenseRes.json().id;

  // Sam settles the full 2500 he owes Ana (real create route — exercises
  // assertWithinOutstanding honestly).
  const settlementRes = await app.inject({
    method: 'POST',
    url: '/api/v1/settlements',
    headers: { authorization: `Bearer ${samToken}` },
    payload: {
      groupId,
      fromUserId: sam,
      toUserId: ana,
      amount: 2500,
      currency: 'USD',
      method: 'CASH',
      date: '2026-07-11T00:00:00.000Z',
    },
  });
  expect(settlementRes.statusCode).toBe(201);
  settlementId = settlementRes.json().id;
});

afterAll(async () => {
  await app?.close();
  await prisma.expense.deleteMany({ where: { createdById: { in: [ana, sam] } } });
  await prisma.settlement.deleteMany({ where: { createdById: { in: [ana, sam] } } });
  await prisma.activityLog.deleteMany({ where: { actorId: { in: [ana, sam] } } });
  await prisma.groupMember.deleteMany({ where: { groupId } });
  await prisma.group.deleteMany({ where: { id: groupId } });
  await prisma.user.deleteMany({ where: { id: { in: [ana, sam] } } });
  await prisma.$disconnect();
});

async function getGroupBalances(token: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/groups/${groupId}/balances`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    members: Array<{ user: { id: string }; balances: Array<{ currency: string; amount: number }> }>;
  };
}

function balancesFor(body: Awaited<ReturnType<typeof getGroupBalances>>, userId: string) {
  return body.members.find((m) => m.user.id === userId)?.balances;
}

async function getOverallBalance(token: string) {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/balance',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    youOwe: Array<{ currency: string; amount: number }>;
    youAreOwed: Array<{ currency: string; amount: number }>;
  };
}

async function getExportCsv() {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/groups/${groupId}/export.csv`,
    headers: { authorization: `Bearer ${anaToken}` },
  });
  expect(res.statusCode).toBe(200);
  return res.payload;
}

async function getExportBinary(extension: 'pdf' | 'xlsx') {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/groups/${groupId}/export.${extension}`,
    headers: { authorization: `Bearer ${anaToken}` },
  });
  expect(res.statusCode).toBe(200);
  return res.rawPayload as Buffer;
}

async function getAnalyticsSummary() {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/analytics/summary?groupId=${groupId}&from=2026-01-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z`,
    headers: { authorization: `Bearer ${anaToken}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('WI-054b — balance/export reapply: settlement delete then restore is fully transparent', () => {
  it('baseline: with the settlement live, Ana and Sam are settled up (net zero) on both group balances and overall balance', async () => {
    const body = await getGroupBalances(anaToken);
    expect(balancesFor(body, ana)).toEqual([]);
    expect(balancesFor(body, sam)).toEqual([]);

    const anaOverall = await getOverallBalance(anaToken);
    expect(anaOverall.youOwe).toEqual([]);
    expect(anaOverall.youAreOwed).toEqual([]);
  });

  it('after DELETE, both balance surfaces show the debt again (settlement no longer contributes)', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/settlements/${settlementId}`,
      headers: { authorization: `Bearer ${anaToken}` },
    });
    expect(del.statusCode).toBe(204);

    const body = await getGroupBalances(anaToken);
    expect(balancesFor(body, ana)).toEqual([{ currency: 'USD', amount: 2500 }]);
    expect(balancesFor(body, sam)).toEqual([{ currency: 'USD', amount: -2500 }]);

    const samOverall = await getOverallBalance(samToken);
    expect(samOverall.youOwe).toEqual([{ currency: 'USD', amount: 2500 }]);
  });

  it('after POST .../restore, both balance surfaces return to EXACTLY the pre-delete (settled) state, no separate reapply step', async () => {
    const restore = await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${settlementId}/restore`,
      headers: { authorization: `Bearer ${samToken}` }, // restored by the other party than who deleted it
    });
    expect(restore.statusCode).toBe(200);
    expect(restore.json().deletedAt).toBeNull();

    const body = await getGroupBalances(anaToken);
    expect(balancesFor(body, ana)).toEqual([]);
    expect(balancesFor(body, sam)).toEqual([]);

    const anaOverall = await getOverallBalance(anaToken);
    expect(anaOverall.youOwe).toEqual([]);
    expect(anaOverall.youAreOwed).toEqual([]);
    const samOverall = await getOverallBalance(samToken);
    expect(samOverall.youOwe).toEqual([]);
    expect(samOverall.youAreOwed).toEqual([]);
  });

  it('CSV export includes the restored settlement row identically to its pre-delete content', async () => {
    const before = await getExportCsv();
    // Sam is the payer (fromUserId), Ana the recipient (toUserId).
    expect(before).toContain('Settlement: WI-054b Reapply sam → WI-054b Reapply ana');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/settlements/${settlementId}`,
      headers: { authorization: `Bearer ${anaToken}` },
    });
    expect(del.statusCode).toBe(204);
    const duringDelete = await getExportCsv();
    expect(duringDelete).not.toContain('Settlement:');

    const restore = await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${settlementId}/restore`,
      headers: { authorization: `Bearer ${anaToken}` },
    });
    expect(restore.statusCode).toBe(200);

    const after = await getExportCsv();
    expect(after).toBe(before);
  });

  it('PDF and XLSX exports include the restored row identically (structurally equal payload size to the pre-delete export, valid content-type)', async () => {
    const pdfBefore = await getExportBinary('pdf');
    const xlsxBefore = await getExportBinary('xlsx');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/settlements/${settlementId}`,
      headers: { authorization: `Bearer ${anaToken}` },
    });
    expect(del.statusCode).toBe(204);
    const pdfDuringDelete = await getExportBinary('pdf');
    expect(pdfDuringDelete.length).not.toBe(pdfBefore.length);

    const restore = await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${settlementId}/restore`,
      headers: { authorization: `Bearer ${anaToken}` },
    });
    expect(restore.statusCode).toBe(200);

    const pdfAfter = await getExportBinary('pdf');
    const xlsxAfter = await getExportBinary('xlsx');
    expect(pdfAfter.length).toBe(pdfBefore.length);
    expect(xlsxAfter.length).toBe(xlsxBefore.length);
    expect(pdfAfter.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('GET /analytics/summary is byte-identical before and after the delete/restore cycle (never reads Settlement)', async () => {
    const before = await getAnalyticsSummary();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/settlements/${settlementId}`,
      headers: { authorization: `Bearer ${anaToken}` },
    });
    expect(del.statusCode).toBe(204);
    const duringDelete = await getAnalyticsSummary();
    expect(duringDelete).toEqual(before);

    const restore = await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${settlementId}/restore`,
      headers: { authorization: `Bearer ${anaToken}` },
    });
    expect(restore.statusCode).toBe(200);
    const after = await getAnalyticsSummary();
    expect(after).toEqual(before);
  });
});
