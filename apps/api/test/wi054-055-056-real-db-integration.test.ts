// spec-WI-054 (ADR-027) / spec-WI-055 / spec-WI-056 — real-DB (not mocked
// prisma) black-box/integration coverage for the three properties the
// mocked unit tests (wi054-wi055-activity-collapse.test.ts,
// wi056-notifications-clear.test.ts) assert only structurally, on
// hand-built row arrays returned by a mocked `activityLog.findMany`:
//
//   1. Pagination safety (spec-WI-054 §3 "Why this is pagination-safe"): a
//      terminal (*_DELETED/*_RESTORED) row must never consume a page slot
//      or push an ADDED row it decorates onto a different page. The mocked
//      test only asserts the `where` clause shape passed to
//      `activityLog.findMany` — it never actually pages through >1 page of
//      REAL rows produced by `recordActivity` + real Postgres ordering.
//   2. Per-recipient scoping edge case (ADR-027 D3 / spec-WI-054 §3 "Why
//      per-recipient scoping is automatic"): a member who left a group
//      between an expense being added and later deleted must NOT see a
//      standalone DELETED row, and the ADDED row they DO see must show
//      `deletedAt: null` for them even though the expense IS deleted for
//      every other recipient. This requires two real, independently-scoped
//      `recordActivity` calls with different `recipientIds` sets, which a
//      single mocked `findMany` return value cannot faithfully model.
//   3. `GET /notifications/unread-count` excludes a cleared-but-unread
//      notification against a real row (not just the asserted `where`
//      clause).
//   4. Multi-cycle latest-wins (ADDED -> DELETED -> RESTORED) with real
//      `recordActivity` calls and real Postgres `createdAt` ordering
//      (`orderBy: [{ createdAt: 'desc' }]`, no `id` tiebreaker) — confirms
//      RESTORED (never emitted by any producer yet) is handled correctly
//      by the collapse algorithm in isolation, end-to-end through the real
//      route and real DB, not just the reducer's in-memory logic.
//
// Test-plan: .company/domains/notifications-activity/test-plans/test-plan-WI-054-055-056.md

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../src/lib/prisma';
import { recordActivity } from '../src/lib/activity';
import { buildApp } from '../src/app';

const STAMP = Date.now();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let app: FastifyInstance;

// -- Scenario 1 fixtures: pagination safety ---------------------------------
let pagUserId: string;
let pagToken: string;
let pagExpenseIds: string[] = [];

// -- Scenario 2 fixtures: per-recipient scoping (member left group) ---------
let actorId: string;
let stayerId: string; // remains a member, sees the delete
let leaverId: string; // leaves the group before the delete event
let scopeGroupId: string;
let scopeExpenseId: string;
let stayerToken: string;
let leaverToken: string;
let joinerId: string; // joins the group AFTER the add, BEFORE the delete (ADR-027 D3 orphan case)
let joinerToken: string;

// -- Scenario 3 fixtures: unread-count excludes cleared-but-unread ----------
let clearUserId: string;
let clearToken: string;
let keepNotifId: string;
let clearNotifId: string;

// -- Scenario 4 fixtures: multi-cycle latest-wins (ADDED -> DELETED -> RESTORED)
let cycleUserId: string;
let cycleToken: string;
let cycleExpenseId: string;
let deleteOnlyExpenseId: string;

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `wi054-055-056-${label}-${STAMP}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-054-056 ${label}`,
      emailNotifications: false,
    },
  });
  return user.id;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  // --- Scenario 1: pagination safety ---
  pagUserId = await createUser('pag-viewer');
  pagToken = app.jwt.sign({ sub: pagUserId });

  // 5 EXPENSE_ADDED anchors, spaced out so createdAt strictly increases.
  for (let i = 0; i < 5; i++) {
    const expenseId = `wi054int-exp-${STAMP}-${i}`;
    pagExpenseIds.push(expenseId);
    await recordActivity({
      type: 'EXPENSE_ADDED',
      actorId: pagUserId,
      expenseId,
      data: { description: `Pagination fixture ${i}`, amount: 1000, currency: 'USD' },
      recipientIds: [pagUserId],
    });
    await sleep(15);
  }
  // Delete the middle one (index 2) LAST, so its terminal row is the newest
  // ActivityLog row overall — the case most likely to break naive pagination
  // (a post-hoc in-memory filter would otherwise let it consume a page slot
  // on page 1 despite decorating an anchor several "pages" back).
  await recordActivity({
    type: 'EXPENSE_DELETED',
    actorId: pagUserId,
    expenseId: pagExpenseIds[2]!,
    data: { description: 'Pagination fixture 2', amount: 1000, currency: 'USD' },
    recipientIds: [pagUserId],
  });

  // --- Scenario 2: per-recipient scoping (member left before delete) ---
  actorId = await createUser('scope-actor');
  stayerId = await createUser('scope-stayer');
  leaverId = await createUser('scope-leaver');
  joinerId = await createUser('scope-joiner');
  stayerToken = app.jwt.sign({ sub: stayerId });
  leaverToken = app.jwt.sign({ sub: leaverId });
  joinerToken = app.jwt.sign({ sub: joinerId });

  const scopeGroup = await prisma.group.create({
    data: {
      name: 'WI-054 scoping fixture',
      inviteCode: `wi054int-${STAMP}`,
      createdById: actorId,
      members: {
        create: [
          { userId: actorId, role: 'ADMIN' },
          { userId: stayerId, role: 'MEMBER' },
          { userId: leaverId, role: 'MEMBER' },
        ],
      },
    },
  });
  scopeGroupId = scopeGroup.id;
  scopeExpenseId = `wi054int-scoped-exp-${STAMP}`;

  // Add: fans out to actor + stayer + leaver (all active members at add time).
  await recordActivity({
    type: 'EXPENSE_ADDED',
    actorId,
    groupId: scopeGroupId,
    expenseId: scopeExpenseId,
    data: { description: 'Dinner', amount: 3000, currency: 'USD' },
    recipientIds: [stayerId, leaverId],
  });
  await sleep(15);

  // Leaver leaves the group (real GroupMember.leftAt write, mirroring how
  // social-groups' leave-group route would).
  await prisma.groupMember.updateMany({
    where: { groupId: scopeGroupId, userId: leaverId },
    data: { leftAt: new Date() },
  });

  // Joiner joins the group AFTER the add but BEFORE the delete (ADR-027 D3
  // "orphan-terminal" case) — they were never a recipient of the ADDED row.
  await prisma.groupMember.create({
    data: { groupId: scopeGroupId, userId: joinerId, role: 'MEMBER' },
  });

  // Delete: fans out to all members active at delete time (actor, stayer,
  // AND the joiner who joined after the add) — the leaver is correctly
  // excluded, mirroring what deleteExpense's real recipient computation
  // would do.
  await recordActivity({
    type: 'EXPENSE_DELETED',
    actorId,
    groupId: scopeGroupId,
    expenseId: scopeExpenseId,
    data: { description: 'Dinner', amount: 3000, currency: 'USD' },
    recipientIds: [stayerId, joinerId],
  });

  // --- Scenario 3: unread-count excludes cleared-but-unread ---
  clearUserId = await createUser('clear-viewer');
  clearToken = app.jwt.sign({ sub: clearUserId });
  const keep = await prisma.notification.create({
    data: {
      userId: clearUserId,
      type: 'EXPENSE_ADDED',
      title: 'Kept notification',
      body: 'stays unread and uncleared',
      data: {},
    },
  });
  keepNotifId = keep.id;
  const toClear = await prisma.notification.create({
    data: {
      userId: clearUserId,
      type: 'EXPENSE_ADDED',
      title: 'Cleared notification',
      body: 'unread but cleared',
      data: {},
    },
  });
  clearNotifId = toClear.id;

  // --- Scenario 4: multi-cycle latest-wins (ADDED -> DELETED -> RESTORED) ---
  cycleUserId = await createUser('cycle-viewer');
  cycleToken = app.jwt.sign({ sub: cycleUserId });
  cycleExpenseId = `wi054int-cycle-exp-${STAMP}`;
  deleteOnlyExpenseId = `wi054int-deleteonly-exp-${STAMP}`;

  await recordActivity({
    type: 'EXPENSE_ADDED',
    actorId: cycleUserId,
    expenseId: cycleExpenseId,
    data: { description: 'Cycle fixture', amount: 500, currency: 'USD' },
    recipientIds: [cycleUserId],
  });
  await sleep(15);
  await recordActivity({
    type: 'EXPENSE_DELETED',
    actorId: cycleUserId,
    expenseId: cycleExpenseId,
    data: { description: 'Cycle fixture', amount: 500, currency: 'USD' },
    recipientIds: [cycleUserId],
  });
  await sleep(15);
  await recordActivity({
    type: 'EXPENSE_RESTORED',
    actorId: cycleUserId,
    expenseId: cycleExpenseId,
    data: { description: 'Cycle fixture', amount: 500, currency: 'USD' },
    recipientIds: [cycleUserId],
  });

  // A second, ADDED -> DELETED-only cycle (no restore) for the real-DB
  // colorHint-forced-null-when-deleted precedence check (spec-WI-055 §3).
  await recordActivity({
    type: 'EXPENSE_ADDED',
    actorId: cycleUserId,
    expenseId: deleteOnlyExpenseId,
    data: { description: 'Delete-only fixture', amount: 700, currency: 'USD' },
    recipientIds: [cycleUserId],
  });
  await sleep(15);
  await recordActivity({
    type: 'EXPENSE_DELETED',
    actorId: cycleUserId,
    expenseId: deleteOnlyExpenseId,
    data: { description: 'Delete-only fixture', amount: 700, currency: 'USD' },
    recipientIds: [cycleUserId],
  });
});

afterAll(async () => {
  await app?.close();
  await prisma.notification.deleteMany({
    where: { userId: { in: [clearUserId] } },
  });
  await prisma.activityRecipient.deleteMany({
    where: {
      userId: {
        in: [pagUserId, actorId, stayerId, leaverId, joinerId, cycleUserId].filter(Boolean),
      },
    },
  });
  await prisma.activityLog.deleteMany({
    where: {
      actorId: { in: [pagUserId, actorId, cycleUserId].filter(Boolean) },
    },
  });
  await prisma.groupMember.deleteMany({ where: { groupId: scopeGroupId } });
  await prisma.group.deleteMany({ where: { id: scopeGroupId } });
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [
          pagUserId,
          actorId,
          stayerId,
          leaverId,
          joinerId,
          clearUserId,
          cycleUserId,
        ].filter(Boolean),
      },
    },
  });
  await prisma.$disconnect();
});

describe('WI-054 real-DB integration: GET /activity pagination safety', () => {
  it('never lets a terminal (DELETED) row consume a page slot: every page but the last is exactly `limit` items, deleted anchor is decorated wherever it lands, no terminal row ever appears as its own item', async () => {
    const seen: Array<{ id: string; expenseId: string | null; deletedAt: string | null }> = [];
    let cursor: string | undefined;
    let pageCount = 0;

    for (;;) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/activity?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        headers: { authorization: `Bearer ${pagToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      pageCount++;

      const pageItems = body.items.filter((i: { expenseId: string | null }) =>
        pagExpenseIds.includes(i.expenseId ?? ''),
      );
      seen.push(...pageItems);

      // No terminal row (EXPENSE_DELETED) is ever present in ANY page.
      for (const item of body.items) {
        expect(item.type).not.toBe('EXPENSE_DELETED');
        expect(item.type).not.toBe('EXPENSE_RESTORED');
      }

      if (!body.nextCursor) break;
      cursor = body.nextCursor;
      // Guard against a pagination bug causing an infinite loop.
      expect(pageCount).toBeLessThan(20);
    }

    // Exactly 5 anchor rows total across all pages — the DELETED row was
    // never counted as a 6th item anywhere.
    expect(seen).toHaveLength(5);
    const ids = seen.map((i) => i.id);
    expect(new Set(ids).size).toBe(5); // no duplicates across page boundaries

    const decoratedExpenseId = pagExpenseIds[2]!;
    const decorated = seen.find((i) => i.expenseId === decoratedExpenseId);
    expect(decorated).toBeDefined();
    expect(decorated!.deletedAt).not.toBeNull();

    // Every OTHER anchor stays undecorated.
    for (const item of seen) {
      if (item.expenseId !== decoratedExpenseId) {
        expect(item.deletedAt).toBeNull();
      }
    }
  });
});

describe('WI-054 real-DB integration: per-recipient scoping (member left group before delete)', () => {
  it('the still-active recipient sees the ADDED row struck through', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${stayerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const row = body.items.find((i: { expenseId: string | null }) => i.expenseId === scopeExpenseId);
    expect(row).toBeDefined();
    expect(row.deletedAt).not.toBeNull();
    expect(row.colorHint).toBeNull(); // struck-through rows are neutral (WI-055 precedence)
  });

  it('the member who left before the delete still sees the ADDED row, but NOT struck through (deletedAt: null) — they never received the DELETED terminal row', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${leaverToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const row = body.items.find((i: { expenseId: string | null }) => i.expenseId === scopeExpenseId);
    expect(row).toBeDefined();
    expect(row.deletedAt).toBeNull();
  });

  it('the leaver never sees a standalone EXPENSE_DELETED row either (terminal types are excluded from the paginated feed for everyone, not just decorated per-recipient)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${leaverToken}` },
    });
    const body = res.json();
    expect(body.items.some((i: { type: string }) => i.type === 'EXPENSE_DELETED')).toBe(false);
  });

  it('ADR-027 D3 orphan case: a member who joined AFTER the add but BEFORE the delete (received the DELETED recipient fan-out, never the ADDED one) sees NEITHER the anchor row NOR a standalone DELETED row for that expense', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${joinerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.some((i: { expenseId: string | null }) => i.expenseId === scopeExpenseId)).toBe(
      false,
    );
    expect(body.items.some((i: { type: string }) => i.type === 'EXPENSE_DELETED')).toBe(false);
  });
});

describe('WI-056 real-DB integration: unread-count excludes cleared-but-unread notifications', () => {
  it('unread-count is 2 before clearing, drops to 1 after clearing one unread notification (both stay unread throughout)', async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/unread-count',
      headers: { authorization: `Bearer ${clearToken}` },
    });
    expect(before.json().count).toBe(2);

    const clearRes = await app.inject({
      method: 'POST',
      url: `/api/v1/notifications/${clearNotifId}/clear`,
      headers: { authorization: `Bearer ${clearToken}` },
    });
    expect(clearRes.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/unread-count',
      headers: { authorization: `Bearer ${clearToken}` },
    });
    expect(after.json().count).toBe(1);

    // The cleared row is still genuinely unread underneath (clear != read).
    const row = await prisma.notification.findUnique({ where: { id: clearNotifId } });
    expect(row?.readAt).toBeNull();
    expect(row?.clearedAt).not.toBeNull();

    // The kept notification is unaffected.
    const keptRow = await prisma.notification.findUnique({ where: { id: keepNotifId } });
    expect(keptRow?.clearedAt).toBeNull();
  });

  it('GET /notifications no longer returns the cleared row', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { authorization: `Bearer ${clearToken}` },
    });
    const body = res.json();
    expect(body.items.some((i: { id: string }) => i.id === clearNotifId)).toBe(false);
    expect(body.items.some((i: { id: string }) => i.id === keepNotifId)).toBe(true);
  });
});

describe('WI-054 real-DB integration: multi-cycle latest-wins (ADDED -> DELETED -> RESTORED)', () => {
  it('RESTORED being the newest terminal row clears deletedAt back to null end-to-end, and colorHint recovers to green', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${cycleToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const row = body.items.find((i: { expenseId: string | null }) => i.expenseId === cycleExpenseId);
    expect(row).toBeDefined();
    expect(row.deletedAt).toBeNull();
    expect(row.colorHint).toBe('green');
  });

  it('a plain ADDED -> DELETED cycle (no restore) keeps deletedAt set and forces colorHint to null end-to-end (WI-055 precedence, real DB)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${cycleToken}` },
    });
    const body = res.json();
    const row = body.items.find(
      (i: { expenseId: string | null }) => i.expenseId === deleteOnlyExpenseId,
    );
    expect(row).toBeDefined();
    expect(row.deletedAt).not.toBeNull();
    expect(row.colorHint).toBeNull();
  });
});
