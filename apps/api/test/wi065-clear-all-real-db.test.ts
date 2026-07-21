// spec-WI-065 / story-WI-065 — real-DB (not mocked prisma) black-box/
// integration coverage for the properties wi065-notifications-clear-all.test.ts
// (Build's mocked-prisma unit test) can only assert structurally, on the
// `where`/`data` object literal passed to a mocked `updateMany`:
//
//   1. Cross-user isolation (US1 "Clear-all only affects the caller's own
//      notifications"): the mocked test only asserts `where.userId ===
//      CALLER_ID` was passed to the mock — it never creates a second real
//      user's notification and checks it survives untouched. A regression
//      that changed the `where` shape in a way that still "looks scoped" to
//      a structural assertion (e.g. an accidental OR, or a scoping bug that
//      only manifests against Prisma's real query planner) would not be
//      caught by the mocked test alone. This test seeds two real users and
//      asserts the non-caller's rows are byte-for-byte unchanged after the
//      caller's clear-all call.
//   2. `readAt` genuinely left alone on real rows (not just "the `data`
//      object literal lacks a readAt key" — trivially true from reading the
//      route source, not from an actual row read-back).
//   3. Idempotency across two REAL sequential calls against the same rows
//      (the mocked test simulates the second call by re-mocking
//      `updateMany` to return `{ count: 0 }` — it never proves the actual
//      `clearedAt: null` filter in a real WHERE clause excludes
//      already-cleared rows from a second real UPDATE).
//   4. Empty-list no-op against a real user with zero notification rows.
//
// Mirrors the wi054-055-056-real-db-integration.test.ts precedent (same gap
// class, filed against WI-056's per-row `clear` — this is the WI-065 bulk
// analogue).
//
// Test-plan: .company/domains/notifications-activity/test-plans/test-plan-WI-065.md

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/app';

const STAMP = Date.now();

let app: FastifyInstance;

let callerId: string;
let callerToken: string;
let otherId: string;
let otherToken: string;

let unreadNotifId: string;
let readNotifId: string;
let readAtValue: Date;
let otherNotifId: string;

let emptyUserId: string;
let emptyToken: string;

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `wi065-clearall-${label}-${STAMP}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-065 ${label}`,
      emailNotifications: false,
    },
  });
  return user.id;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  callerId = await createUser('caller');
  callerToken = app.jwt.sign({ sub: callerId });
  otherId = await createUser('other');
  otherToken = app.jwt.sign({ sub: otherId });
  emptyUserId = await createUser('empty');
  emptyToken = app.jwt.sign({ sub: emptyUserId });

  const unread = await prisma.notification.create({
    data: {
      userId: callerId,
      type: 'EXPENSE_ADDED',
      title: 'Unread notification',
      body: 'stays unread, gets cleared',
      data: {},
    },
  });
  unreadNotifId = unread.id;

  readAtValue = new Date('2026-07-15T12:00:00.000Z');
  const read = await prisma.notification.create({
    data: {
      userId: callerId,
      type: 'EXPENSE_UPDATED',
      title: 'Read notification',
      body: 'already read, gets cleared',
      data: {},
      readAt: readAtValue,
    },
  });
  readNotifId = read.id;

  const other = await prisma.notification.create({
    data: {
      userId: otherId,
      type: 'EXPENSE_ADDED',
      title: "Other user's notification",
      body: 'must survive untouched',
      data: {},
    },
  });
  otherNotifId = other.id;
});

afterAll(async () => {
  await app?.close();
  await prisma.notification.deleteMany({
    where: { userId: { in: [callerId, otherId, emptyUserId].filter(Boolean) } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [callerId, otherId, emptyUserId].filter(Boolean) } },
  });
  await prisma.$disconnect();
});

describe('WI-065 real-DB integration: POST /notifications/clear-all', () => {
  it('clears every uncleared notification owned by the caller; readAt is left exactly as it was; GET /notifications and unread-count reflect the clear', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/clear-all',
      headers: { authorization: `Bearer ${callerToken}` },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');

    const unreadRow = await prisma.notification.findUnique({ where: { id: unreadNotifId } });
    const readRow = await prisma.notification.findUnique({ where: { id: readNotifId } });

    expect(unreadRow?.clearedAt).not.toBeNull();
    expect(unreadRow?.readAt).toBeNull(); // was unread before, still unread after

    expect(readRow?.clearedAt).not.toBeNull();
    expect(readRow?.readAt?.toISOString()).toBe(readAtValue.toISOString()); // untouched

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { authorization: `Bearer ${callerToken}` },
    });
    const body = listRes.json();
    expect(body.items.some((i: { id: string }) => i.id === unreadNotifId)).toBe(false);
    expect(body.items.some((i: { id: string }) => i.id === readNotifId)).toBe(false);

    const countRes = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/unread-count',
      headers: { authorization: `Bearer ${callerToken}` },
    });
    expect(countRes.json().count).toBe(0);
  });

  it('does not touch another user\'s notifications (owner-scoped against a real second user)', async () => {
    const otherRow = await prisma.notification.findUnique({ where: { id: otherNotifId } });
    expect(otherRow?.clearedAt).toBeNull();
    expect(otherRow?.readAt).toBeNull();

    // The other user can still see their own notification via a real GET.
    const otherListRes = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { authorization: `Bearer ${otherToken}` },
    });
    const otherBody = otherListRes.json();
    expect(otherBody.items.some((i: { id: string }) => i.id === otherNotifId)).toBe(true);
  });

  it('is idempotent against two real sequential calls: the second call is a 204 no-op and does not change the already-set clearedAt timestamp', async () => {
    const before = await prisma.notification.findUnique({ where: { id: unreadNotifId } });
    const clearedAtBefore = before?.clearedAt;
    expect(clearedAtBefore).toBeTruthy();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/clear-all',
      headers: { authorization: `Bearer ${callerToken}` },
    });
    expect(res.statusCode).toBe(204);

    const after = await prisma.notification.findUnique({ where: { id: unreadNotifId } });
    expect(after?.clearedAt?.toISOString()).toBe(clearedAtBefore?.toISOString());
  });

  it('is a safe no-op for a caller with zero notifications', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/clear-all',
      headers: { authorization: `Bearer ${emptyToken}` },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });
});
