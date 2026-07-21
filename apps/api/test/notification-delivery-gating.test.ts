// spec-WI-041 (notifications-activity slice) / ADR-021 (rev. 2026-07-17) —
// granular per-category (auth's real, shared `NotificationCategory`) x
// per-channel (push/email) delivery gating, wired into the existing
// fire-and-forget delivery blocks of `recordActivity` and
// `sendSystemNotification`. Per ADR-021 the gate applies ONLY to push/email
// delivery — never to the ActivityLog/ActivityRecipient/Notification rows or
// the activity:new/notification:new/group:changed/friends:changed emits,
// which must stay byte-identical to pre-WI-041 behavior. This suite mocks
// `../src/lib/notification-preferences` at the module boundary (its own
// real Prisma-backed contract is covered separately in
// test/notification-preferences.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const activityLogCreateMock = vi.fn();
const notificationCreateManyAndReturnMock = vi.fn();
const userFindManyMock = vi.fn();
const emitToUsersMock = vi.fn();
const emitToGroupMock = vi.fn();
const sendEmailMock = vi.fn();
const sendPushMock = vi.fn();
const getNotificationPreferencesMock = vi.fn();

const mockEnv = vi.hoisted(() => ({
  SMTP_HOST: undefined as string | undefined,
  EXPO_PUSH_ENABLED: true,
  WEB_URL: 'http://localhost:3000',
}));

vi.mock('../src/config/env', () => ({
  get env() {
    return mockEnv;
  },
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    activityLog: {
      create: (...args: unknown[]) => activityLogCreateMock(...args),
    },
    notification: {
      createManyAndReturn: (...args: unknown[]) => notificationCreateManyAndReturnMock(...args),
      create: vi.fn(),
    },
    user: {
      findMany: (...args: unknown[]) => userFindManyMock(...args),
    },
  },
}));

vi.mock('../src/realtime/io', () => ({
  emitToUsers: (...args: unknown[]) => emitToUsersMock(...args),
  emitToGroup: (...args: unknown[]) => emitToGroupMock(...args),
}));

vi.mock('../src/lib/email', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

vi.mock('../src/lib/push', () => ({
  sendPush: (...args: unknown[]) => sendPushMock(...args),
}));

vi.mock('../src/lib/notification-preferences', () => ({
  getNotificationPreferences: (...args: unknown[]) => getNotificationPreferencesMock(...args),
}));

import { categoryForNotificationType, recordActivity, sendSystemNotification } from '../src/lib/activity';

const ACTOR = 'user_actor001';
const RECIPIENT_A = 'user_recip_a1';
const RECIPIENT_B = 'user_recip_b1';

function baseActivityRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'act_1',
    type: 'EXPENSE_ADDED',
    actorId: ACTOR,
    actor: { id: ACTOR, name: 'Actor', avatarColor: '#111' },
    groupId: null,
    group: null,
    expenseId: 'exp_1',
    settlementId: null,
    data: {},
    createdAt: new Date('2026-07-16T00:00:00.000Z'),
    ...overrides,
  };
}

function baseNotificationRows(userIds: string[], type = 'EXPENSE_ADDED') {
  return userIds.map((userId, i) => ({
    id: `notif_${i}`,
    userId,
    type,
    title: 'Title',
    body: 'Body',
    data: {},
    readAt: null,
    createdAt: new Date('2026-07-16T00:00:00.000Z'),
  }));
}

/** Flush the detached `void (async () => {...})()` email/push block. */
async function flushDetached() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  activityLogCreateMock.mockReset().mockResolvedValue(baseActivityRow());
  notificationCreateManyAndReturnMock
    .mockReset()
    .mockResolvedValue(baseNotificationRows([RECIPIENT_A, RECIPIENT_B]));
  userFindManyMock.mockReset().mockResolvedValue([]);
  emitToUsersMock.mockReset();
  emitToGroupMock.mockReset();
  sendEmailMock.mockReset().mockResolvedValue(undefined);
  sendPushMock.mockReset().mockResolvedValue(undefined);
  getNotificationPreferencesMock
    .mockReset()
    .mockImplementation(async (userIds: string[]) =>
      new Map(userIds.map((id) => [id, { push: true, email: true }])),
    );
  mockEnv.SMTP_HOST = undefined;
  mockEnv.EXPO_PUSH_ENABLED = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('categoryForNotificationType (spec-WI-041 §3 — real, GRANULAR 1:1 map)', () => {
  it('maps each NotificationType to its own distinct NotificationCategory (no coarse grouping)', () => {
    expect(categoryForNotificationType('EXPENSE_ADDED')).toBe('EXPENSE_ADDED');
    expect(categoryForNotificationType('EXPENSE_UPDATED')).toBe('EXPENSE_EDITED');
    expect(categoryForNotificationType('EXPENSE_DELETED')).toBe('EXPENSE_DELETED');
    expect(categoryForNotificationType('COMMENT_ADDED')).toBe('COMMENT');
    expect(categoryForNotificationType('SETTLEMENT_RECORDED')).toBe('PAYMENT_RECEIVED');
    expect(categoryForNotificationType('MEMBER_JOINED')).toBe('GROUP_INVITE');
    expect(categoryForNotificationType('ADDED_TO_GROUP')).toBe('GROUP_INVITE');
  });

  it('regression guard: the three expense sub-events are gated INDEPENDENTLY, not grouped under one coarse category', () => {
    // A regression to the old coarse `expense_changes` taxonomy would make
    // all three equal to each other; the real contract keeps them distinct.
    const added = categoryForNotificationType('EXPENSE_ADDED');
    const edited = categoryForNotificationType('EXPENSE_UPDATED');
    const deleted = categoryForNotificationType('EXPENSE_DELETED');
    expect(added).not.toBe(edited);
    expect(added).not.toBe(deleted);
    expect(edited).not.toBe(deleted);
    expect(new Set([added, edited, deleted]).size).toBe(3);
  });

  it('EXPENSE_UPDATED maps to EXPENSE_EDITED, not EXPENSE_UPDATED (name differs from the NotificationType)', () => {
    expect(categoryForNotificationType('EXPENSE_UPDATED')).toBe('EXPENSE_EDITED');
  });

  it('MEMBER_JOINED and ADDED_TO_GROUP both fold into the single GROUP_INVITE category', () => {
    expect(categoryForNotificationType('MEMBER_JOINED')).toBe('GROUP_INVITE');
    expect(categoryForNotificationType('ADDED_TO_GROUP')).toBe('GROUP_INVITE');
  });

  it('maps ungated NotificationTypes to null', () => {
    expect(categoryForNotificationType('FRIEND_ADDED')).toBeNull();
    expect(categoryForNotificationType('RECURRING_POSTED')).toBeNull();
    expect(categoryForNotificationType('BALANCE_REMINDER')).toBeNull();
  });
});

describe('recordActivity — granular delivery gating (gated category, e.g. EXPENSE_ADDED)', () => {
  it('per-recipient independence: one recipient gated (push+email off) never affects the sibling recipient', async () => {
    getNotificationPreferencesMock.mockResolvedValue(
      new Map([
        [RECIPIENT_A, { push: false, email: false }],
        [RECIPIENT_B, { push: true, email: true }],
      ]),
    );
    mockEnv.SMTP_HOST = 'smtp.example.com';
    userFindManyMock.mockResolvedValue([
      { email: 'b@example.com', name: 'B' },
    ]);

    await recordActivity({
      type: 'EXPENSE_ADDED',
      actorId: ACTOR,
      recipientIds: [RECIPIENT_A, RECIPIENT_B],
      data: {},
      notify: { type: 'EXPENSE_ADDED', title: 'Title', body: 'Body' },
    });
    await flushDetached();

    expect(getNotificationPreferencesMock).toHaveBeenCalledWith(
      expect.arrayContaining([RECIPIENT_A, RECIPIENT_B]),
      'EXPENSE_ADDED',
    );
    // Push only goes to RECIPIENT_B.
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    const [pushIds] = sendPushMock.mock.calls[0] as [string[]];
    expect(pushIds).toEqual([RECIPIENT_B]);

    // Email lookup narrowed to RECIPIENT_B only, ANDed with existing gate.
    expect(userFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: [RECIPIENT_B] }, emailNotifications: true },
      select: { email: true, name: true },
    });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('both recipients enabled/unset -> delivery is unchanged from pre-WI-041 behavior', async () => {
    mockEnv.SMTP_HOST = 'smtp.example.com';
    userFindManyMock.mockResolvedValue([
      { email: 'a@example.com', name: 'A' },
      { email: 'b@example.com', name: 'B' },
    ]);

    await recordActivity({
      type: 'EXPENSE_ADDED',
      actorId: ACTOR,
      recipientIds: [RECIPIENT_A, RECIPIENT_B],
      data: {},
      notify: { type: 'EXPENSE_ADDED', title: 'Title', body: 'Body' },
    });
    await flushDetached();

    const [pushIds] = sendPushMock.mock.calls[0] as [string[]];
    expect(pushIds).toEqual(expect.arrayContaining([RECIPIENT_A, RECIPIENT_B]));
    expect(pushIds).toHaveLength(2);
    expect(userFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining([RECIPIENT_A, RECIPIENT_B]) }, emailNotifications: true },
      select: { email: true, name: true },
    });
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });

  it('email gate is ANDed with the existing SMTP_HOST/emailNotifications gate, not a replacement', async () => {
    // Granular prefs say email is enabled, but SMTP_HOST is unset -> still no email.
    getNotificationPreferencesMock.mockResolvedValue(
      new Map([[RECIPIENT_A, { push: true, email: true }]]),
    );
    mockEnv.SMTP_HOST = undefined;

    await recordActivity({
      type: 'EXPENSE_ADDED',
      actorId: ACTOR,
      recipientIds: [RECIPIENT_A],
      data: {},
      notify: { type: 'EXPENSE_ADDED', title: 'Title', body: 'Body' },
    });
    await flushDetached();

    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('actor exclusion is unaffected by the gate: actor is never in notifyIds regardless of preferences', async () => {
    getNotificationPreferencesMock.mockImplementation(async (userIds: string[]) =>
      new Map(userIds.map((id) => [id, { push: true, email: true }])),
    );
    mockEnv.SMTP_HOST = 'smtp.example.com';
    userFindManyMock.mockResolvedValue([{ email: 'a@example.com', name: 'A' }]);

    await recordActivity({
      type: 'EXPENSE_ADDED',
      actorId: ACTOR,
      recipientIds: [ACTOR, RECIPIENT_A],
      data: {},
      notify: { type: 'EXPENSE_ADDED', title: 'Title', body: 'Body' },
    });
    await flushDetached();

    const [, calledCategory] = getNotificationPreferencesMock.mock.calls[0] as [string[], string];
    const [calledIds] = getNotificationPreferencesMock.mock.calls[0] as [string[], string];
    expect(calledIds).not.toContain(ACTOR);
    expect(calledCategory).toBe('EXPENSE_ADDED');
    const [pushIds] = sendPushMock.mock.calls[0] as [string[]];
    expect(pushIds).not.toContain(ACTOR);
  });

  it('gate-lookup failure never breaks the mutation: rows/emits still happen, delivery for that event is skipped', async () => {
    getNotificationPreferencesMock.mockRejectedValue(new Error('preferences lookup down'));

    await expect(
      recordActivity({
        type: 'EXPENSE_ADDED',
        actorId: ACTOR,
        recipientIds: [RECIPIENT_A],
        data: {},
        notify: { type: 'EXPENSE_ADDED', title: 'Title', body: 'Body' },
      }),
    ).resolves.toBeUndefined();

    // The activity/notification rows and emits (created BEFORE the fire-and-forget
    // block) must have happened regardless.
    expect(activityLogCreateMock).toHaveBeenCalledTimes(1);
    expect(notificationCreateManyAndReturnMock).toHaveBeenCalledTimes(1);
    expect(emitToUsersMock.mock.calls.map((c) => c[1])).toContain('activity:new');
    expect(emitToUsersMock.mock.calls.map((c) => c[1])).toContain('notification:new');

    await flushDetached();
    // Delivery for this one event is best-effort-skipped; no crash reached here is the assertion.
    expect(sendPushMock).not.toHaveBeenCalled();
  });
});

describe('recordActivity — granular 1:1 mapping regression guard at the call-site level', () => {
  it('EXPENSE_UPDATED (-> EXPENSE_EDITED) and EXPENSE_DELETED (-> EXPENSE_DELETED) are gated independently, not coarsely grouped', async () => {
    // A regression to the old coarse `expense_changes` taxonomy would call
    // getNotificationPreferences with the SAME category for both types.
    getNotificationPreferencesMock.mockResolvedValue(new Map());

    await recordActivity({
      type: 'EXPENSE_UPDATED',
      actorId: ACTOR,
      recipientIds: [RECIPIENT_A],
      data: {},
      notify: { type: 'EXPENSE_UPDATED', title: 'Title', body: 'Body' },
    });
    await flushDetached();

    await recordActivity({
      type: 'EXPENSE_DELETED',
      actorId: ACTOR,
      recipientIds: [RECIPIENT_A],
      data: {},
      notify: { type: 'EXPENSE_DELETED', title: 'Title', body: 'Body' },
    });
    await flushDetached();

    const categoriesCalled = getNotificationPreferencesMock.mock.calls.map((c) => c[1]);
    expect(categoriesCalled).toContain('EXPENSE_EDITED');
    expect(categoriesCalled).toContain('EXPENSE_DELETED');
    expect(categoriesCalled).not.toContain('expense_changes');
  });

  it('SETTLEMENT_RECORDED resolves to PAYMENT_RECEIVED', async () => {
    getNotificationPreferencesMock.mockResolvedValue(new Map());

    await recordActivity({
      type: 'SETTLEMENT_ADDED',
      actorId: ACTOR,
      recipientIds: [RECIPIENT_A],
      data: {},
      notify: { type: 'SETTLEMENT_RECORDED', title: 'Title', body: 'Body' },
    });
    await flushDetached();

    expect(getNotificationPreferencesMock).toHaveBeenCalledWith(
      expect.arrayContaining([RECIPIENT_A]),
      'PAYMENT_RECEIVED',
    );
  });

  it('MEMBER_JOINED and ADDED_TO_GROUP both resolve to GROUP_INVITE', async () => {
    getNotificationPreferencesMock.mockResolvedValue(new Map());

    await recordActivity({
      type: 'MEMBER_JOINED',
      actorId: ACTOR,
      recipientIds: [RECIPIENT_A],
      data: {},
      notify: { type: 'MEMBER_JOINED', title: 'Title', body: 'Body' },
    });
    await flushDetached();

    await recordActivity({
      type: 'MEMBER_JOINED',
      actorId: ACTOR,
      recipientIds: [RECIPIENT_A],
      data: {},
      notify: { type: 'ADDED_TO_GROUP', title: 'Title', body: 'Body' },
    });
    await flushDetached();

    const categoriesCalled = getNotificationPreferencesMock.mock.calls.map((c) => c[1]);
    expect(categoriesCalled).toEqual(['GROUP_INVITE', 'GROUP_INVITE']);
  });
});

describe('recordActivity — ungated category (null), e.g. FRIEND_ADDED', () => {
  it('never calls getNotificationPreferences and delivers to the full notifyIds exactly as pre-WI-041', async () => {
    activityLogCreateMock.mockResolvedValue(baseActivityRow({ type: 'FRIEND_ADDED' }));
    notificationCreateManyAndReturnMock.mockResolvedValue(
      baseNotificationRows([RECIPIENT_A, RECIPIENT_B], 'FRIEND_ADDED'),
    );
    mockEnv.SMTP_HOST = 'smtp.example.com';
    userFindManyMock.mockResolvedValue([
      { email: 'a@example.com', name: 'A' },
      { email: 'b@example.com', name: 'B' },
    ]);

    await recordActivity({
      type: 'FRIEND_ADDED',
      actorId: ACTOR,
      recipientIds: [RECIPIENT_A, RECIPIENT_B],
      data: {},
      notify: { type: 'FRIEND_ADDED', title: 'Title', body: 'Body' },
    });
    await flushDetached();

    expect(getNotificationPreferencesMock).not.toHaveBeenCalled();
    const [pushIds] = sendPushMock.mock.calls[0] as [string[]];
    expect(pushIds).toEqual(expect.arrayContaining([RECIPIENT_A, RECIPIENT_B]));
    expect(pushIds).toHaveLength(2);
    expect(userFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining([RECIPIENT_A, RECIPIENT_B]) }, emailNotifications: true },
      select: { email: true, name: true },
    });
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });
});

describe('sendSystemNotification — same hook, no-op for BALANCE_REMINDER (spec §5b)', () => {
  it('never calls getNotificationPreferences and delivers exactly as pre-WI-041', async () => {
    mockEnv.SMTP_HOST = 'smtp.example.com';
    const userFindFirstMock = vi.fn().mockResolvedValue({ email: 'a@example.com', name: 'A' });
    // sendSystemNotification uses prisma.user.findFirst and prisma.notification.create;
    // patch them onto the already-mocked prisma module.
    const prismaModule = await import('../src/lib/prisma');
    (prismaModule.prisma as unknown as { user: { findFirst: unknown } }).user.findFirst =
      userFindFirstMock;
    (prismaModule.prisma as unknown as { notification: { create: unknown } }).notification.create = vi
      .fn()
      .mockResolvedValue({
        id: 'notif_x',
        userId: RECIPIENT_A,
        type: 'BALANCE_REMINDER',
        title: 'Title',
        body: 'Body',
        data: {},
        readAt: null,
        createdAt: new Date('2026-07-16T00:00:00.000Z'),
      });

    await sendSystemNotification({
      userId: RECIPIENT_A,
      type: 'BALANCE_REMINDER',
      title: 'Title',
      body: 'Body',
    });
    await flushDetached();

    expect(getNotificationPreferencesMock).not.toHaveBeenCalled();
    expect(sendPushMock).toHaveBeenCalledWith([RECIPIENT_A], 'Title', 'Body', undefined);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});
