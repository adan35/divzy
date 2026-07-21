import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// story-WI-016 (reminders half, notifications-activity slice) —
// `sendSystemNotification` exercised end-to-end against the REAL database
// (not mocked prisma), unlike test/send-system-notification.test.ts which
// mocks `../src/lib/prisma` entirely and therefore can never catch:
//
//   1. Whether the `BALANCE_REMINDER` NotificationType enum value from
//      migration 20260716140000_add_balance_reminder_notification_type has
//      actually been applied to the database `sendSystemNotification` writes
//      to (a mocked `prisma.notification.create` accepts ANY string as
//      `type` and can never surface a Postgres
//      "invalid input value for enum" failure).
//   2. Whether GET /activity (a real route, real ActivityLog query) is
//      structurally incapable of surfacing a reminder — the mocked unit
//      tests only assert `prisma.activityLog.create` was never *called*,
//      they never assert what a real GET /activity response contains
//      afterwards.
//
// Both gaps were confirmed live during Test-stage verification of WI-016:
// `prisma migrate status` showed migration
// 20260716140000_add_balance_reminder_notification_type as NOT yet applied
// to the shared dev/test Postgres instance (`pg_enum` had only 9 values,
// missing BALANCE_REMINDER) despite the migration file being correct and
// present in the repo and the build report claiming a green build. Every
// existing sendSystemNotification test mocks prisma, so none of them could
// have caught this — a real call would have thrown inside the try/catch,
// been silently swallowed by the "never throws" contract, and the
// reminder would simply never have been delivered in production, with no
// visible error anywhere. `prisma migrate deploy` was run once as part of
// Test-stage verification to bring the environment in sync with the
// already-written, already-additive migration; this test now guards
// against that regressing silently again.
//
// Test-plan: .company/domains/notifications-activity/test-plans/test-plan-WI-016.md

import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let targetToken: string;
let otherToken: string;
let targetUserId: string;
let otherUserId: string;
const TARGET_EMAIL = `test-notif-wi016-target-${Date.now()}@test.local`;
const OTHER_EMAIL = `test-notif-wi016-other-${Date.now()}@test.local`;

beforeAll(async () => {
  const target = await prisma.user.create({
    data: {
      email: TARGET_EMAIL,
      passwordHash: 'not-a-real-hash',
      name: 'Target WI-016',
      defaultCurrency: 'USD',
      emailNotifications: false, // keep this test hermetic — no outbound mail dependency
    },
  });
  targetUserId = target.id;

  const other = await prisma.user.create({
    data: {
      email: OTHER_EMAIL,
      passwordHash: 'not-a-real-hash',
      name: 'Other WI-016',
      defaultCurrency: 'USD',
      emailNotifications: false,
    },
  });
  otherUserId = other.id;

  app = await buildApp();
  await app.ready();
  targetToken = app.jwt.sign({ sub: targetUserId });
  otherToken = app.jwt.sign({ sub: otherUserId });
});

afterAll(async () => {
  await app?.close();
  await prisma.notification.deleteMany({ where: { userId: { in: [targetUserId, otherUserId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [targetUserId, otherUserId] } } });
  await prisma.$disconnect();
});

describe('WI-016 real-DB integration: sendSystemNotification (BALANCE_REMINDER)', () => {
  it('creates a real Notification row with type BALANCE_REMINDER (proves the enum migration is applied, not just present in the repo)', async () => {
    const { sendSystemNotification } = await import('../src/lib/activity');

    await sendSystemNotification({
      userId: targetUserId,
      type: 'BALANCE_REMINDER',
      title: 'You have a stale balance',
      body: 'Settle up with Sam',
      data: { counterpartyId: 'user_sam' },
    });

    const rows = await prisma.notification.findMany({ where: { userId: targetUserId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('BALANCE_REMINDER');
    expect(rows[0].title).toBe('You have a stale balance');
    expect(rows[0].body).toBe('Settle up with Sam');
    expect(rows[0].readAt).toBeNull();
  });

  it('GET /notifications for the target user includes the reminder, round-tripped through the real toNotificationDto with no special-casing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { authorization: `Bearer ${targetToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const reminder = body.items.find((i: { type: string }) => i.type === 'BALANCE_REMINDER');
    expect(reminder).toBeDefined();
    expect(reminder.title).toBe('You have a stale balance');
    expect(reminder.data).toEqual({ counterpartyId: 'user_sam' });
    expect(typeof reminder.createdAt).toBe('string'); // ISO string DTO, not a raw Date

    // /unread-count reflects it too, since sendSystemNotification is never
    // gated by an opt-in preference at the in-app layer.
    const unread = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/unread-count',
      headers: { authorization: `Bearer ${targetToken}` },
    });
    expect(unread.json().count).toBeGreaterThanOrEqual(1);
  });

  it('GET /activity for the target user does NOT include the reminder, before or after the call — no ActivityLog row was written at all', async () => {
    const activityLogCount = await prisma.activityLog.count({
      where: { recipients: { some: { userId: targetUserId } } },
    });
    expect(activityLogCount).toBe(0);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${targetToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(0);
  });

  it('does not leak to any other user: no Notification row, and GET /activity + GET /notifications for user B are unaffected', async () => {
    const otherNotifications = await prisma.notification.findMany({ where: { userId: otherUserId } });
    expect(otherNotifications).toHaveLength(0);

    const otherActivityRes = await app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(otherActivityRes.statusCode).toBe(200);
    expect(otherActivityRes.json().items).toHaveLength(0);

    const otherNotificationsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(otherNotificationsRes.statusCode).toBe(200);
    expect(otherNotificationsRes.json().items).toHaveLength(0);
  });
});
