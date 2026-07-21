// spec-WI-016 (notifications-activity slice) / ADR-020 — `sendSystemNotification`,
// a second, deliberately narrower, owned fan-out entry point in `lib/activity.ts`,
// sibling to `recordActivity`. Unit tests written directly against the library
// function (no route exists — the only caller is settlements' cron scan), mocking
// every collaborator `activity.ts` imports: prisma, realtime/io (`emitToUsers`),
// email (`sendEmail`), push (`sendPush`), and config/env (to toggle SMTP_HOST /
// EXPO_PUSH_ENABLED per test).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notificationCreateMock = vi.fn();
const activityLogCreateMock = vi.fn();
const activityRecipientCreateManyMock = vi.fn();
const userFindFirstMock = vi.fn();
const emitToUsersMock = vi.fn();
const emitToGroupMock = vi.fn();
const sendEmailMock = vi.fn();
const sendPushMock = vi.fn();

const mockEnv = vi.hoisted(() => ({
  SMTP_HOST: undefined as string | undefined,
  EXPO_PUSH_ENABLED: false,
  WEB_URL: 'http://localhost:3000',
}));

vi.mock('../src/config/env', () => ({
  get env() {
    return mockEnv;
  },
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    notification: {
      create: (...args: unknown[]) => notificationCreateMock(...args),
    },
    activityLog: {
      create: (...args: unknown[]) => activityLogCreateMock(...args),
    },
    activityRecipient: {
      createMany: (...args: unknown[]) => activityRecipientCreateManyMock(...args),
    },
    user: {
      findFirst: (...args: unknown[]) => userFindFirstMock(...args),
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

import { sendSystemNotification } from '../src/lib/activity';

const VICTIM = 'user_victim1';
const OTHER = 'user_other01';

function baseNotificationRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'notif_1',
    userId: VICTIM,
    type: 'BALANCE_REMINDER',
    title: 'You have a stale balance',
    body: 'Settle up with Sam',
    data: {},
    readAt: null,
    createdAt: new Date('2026-07-16T00:00:00.000Z'),
    ...overrides,
  };
}

/** Flush the detached `void (async () => {...})()` email/push block. */
async function flushDetached() {
  await vi.waitFor(() => {
    // no-op condition; a couple of microtask ticks is enough since the block
    // has no real I/O latency once its own promises are mocked to resolve.
  });
  // vi.waitFor above resolves almost immediately; also flush any remaining
  // microtasks explicitly for determinism.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  notificationCreateMock.mockReset().mockResolvedValue(baseNotificationRow());
  activityLogCreateMock.mockReset();
  activityRecipientCreateManyMock.mockReset();
  userFindFirstMock.mockReset().mockResolvedValue(null);
  emitToUsersMock.mockReset();
  emitToGroupMock.mockReset();
  sendEmailMock.mockReset().mockResolvedValue(undefined);
  sendPushMock.mockReset().mockResolvedValue(undefined);
  mockEnv.SMTP_HOST = undefined;
  mockEnv.EXPO_PUSH_ENABLED = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendSystemNotification', () => {
  it('creates exactly one Notification row for n.userId with the given fields', async () => {
    await sendSystemNotification({
      userId: VICTIM,
      type: 'BALANCE_REMINDER',
      title: 'You have a stale balance',
      body: 'Settle up with Sam',
    });

    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
    expect(notificationCreateMock).toHaveBeenCalledWith({
      data: {
        userId: VICTIM,
        type: 'BALANCE_REMINDER',
        title: 'You have a stale balance',
        body: 'Settle up with Sam',
        data: {},
      },
    });
  });

  it('defaults data to {} when omitted, and passes through a provided data payload', async () => {
    await sendSystemNotification({
      userId: VICTIM,
      type: 'BALANCE_REMINDER',
      title: 't',
      body: 'b',
      data: { counterpartyId: 'user_sam0001' },
    });

    expect(notificationCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ data: { counterpartyId: 'user_sam0001' } }),
    });
  });

  it('writes NO ActivityLog row and NO ActivityRecipient row', async () => {
    await sendSystemNotification({
      userId: VICTIM,
      type: 'BALANCE_REMINDER',
      title: 't',
      body: 'b',
    });

    expect(activityLogCreateMock).not.toHaveBeenCalled();
    expect(activityRecipientCreateManyMock).not.toHaveBeenCalled();
  });

  it('emits notification:new to user:<n.userId> ONLY, via toNotificationDto payload, and never touches a group room', async () => {
    const row = baseNotificationRow();
    notificationCreateMock.mockResolvedValue(row);

    await sendSystemNotification({
      userId: VICTIM,
      type: 'BALANCE_REMINDER',
      title: 't',
      body: 'b',
    });

    expect(emitToUsersMock).toHaveBeenCalledTimes(1);
    const [targetUserIds, event, payload] = emitToUsersMock.mock.calls[0] as [
      string[],
      string,
      Record<string, unknown>,
    ];
    expect(targetUserIds).toEqual([VICTIM]);
    expect(event).toBe('notification:new');
    // Payload must be a DTO (dates as ISO strings), not a raw Prisma row.
    expect(payload).toMatchObject({
      id: row.id,
      type: 'BALANCE_REMINDER',
      title: row.title,
      body: row.body,
      readAt: null,
      createdAt: '2026-07-16T00:00:00.000Z',
    });

    // Never a group room, never activity:new/group:changed/friends:changed.
    expect(emitToGroupMock).not.toHaveBeenCalled();
    const emittedEvents = emitToUsersMock.mock.calls.map((c) => c[1]);
    expect(emittedEvents).not.toContain('activity:new');
    expect(emittedEvents).not.toContain('friends:changed');
  });

  it('never causes any row or emit for any other user id, even when other users exist', async () => {
    await sendSystemNotification({
      userId: VICTIM,
      type: 'BALANCE_REMINDER',
      title: 't',
      body: 'b',
    });
    await flushDetached();

    for (const call of notificationCreateMock.mock.calls) {
      expect((call[0] as { data: { userId: string } }).data.userId).toBe(VICTIM);
    }
    for (const call of emitToUsersMock.mock.calls) {
      const targets = call[0] as string[];
      expect(targets).toEqual([VICTIM]);
      expect(targets).not.toContain(OTHER);
    }
    expect(userFindFirstMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: OTHER }) }),
    );
    expect(sendPushMock.mock.calls.every((c) => (c[0] as string[]).every((id) => id === VICTIM))).toBe(
      true,
    );
  });

  it('never throws when the Notification create fails (DB failure swallowed)', async () => {
    notificationCreateMock.mockRejectedValue(new Error('db down'));

    await expect(
      sendSystemNotification({ userId: VICTIM, type: 'BALANCE_REMINDER', title: 't', body: 'b' }),
    ).resolves.toBeUndefined();

    expect(emitToUsersMock).not.toHaveBeenCalled();
  });

  it('never throws when emitToUsers throws', async () => {
    emitToUsersMock.mockImplementation(() => {
      throw new Error('socket boom');
    });

    await expect(
      sendSystemNotification({ userId: VICTIM, type: 'BALANCE_REMINDER', title: 't', body: 'b' }),
    ).resolves.toBeUndefined();
  });

  describe('email gating (SMTP_HOST + fresh DB read of emailNotifications)', () => {
    it('sends no email when SMTP_HOST is unset, even if the user has emailNotifications=true', async () => {
      mockEnv.SMTP_HOST = undefined;
      userFindFirstMock.mockResolvedValue({ email: 'victim@example.com', name: 'Vic' });

      await sendSystemNotification({ userId: VICTIM, type: 'BALANCE_REMINDER', title: 't', body: 'b' });
      await flushDetached();

      expect(userFindFirstMock).not.toHaveBeenCalled();
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it('sends no email when SMTP_HOST is set but a fresh read shows emailNotifications=false (query filters it out)', async () => {
      mockEnv.SMTP_HOST = 'smtp.example.com';
      userFindFirstMock.mockResolvedValue(null); // where: emailNotifications: true finds nothing

      await sendSystemNotification({ userId: VICTIM, type: 'BALANCE_REMINDER', title: 't', body: 'b' });
      await flushDetached();

      expect(userFindFirstMock).toHaveBeenCalledWith({
        where: { id: VICTIM, emailNotifications: true },
        select: { email: true, name: true },
      });
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it('sends an email when SMTP_HOST is set AND a fresh read confirms emailNotifications=true, with escaped title/body', async () => {
      mockEnv.SMTP_HOST = 'smtp.example.com';
      userFindFirstMock.mockResolvedValue({ email: 'victim@example.com', name: 'Vic <admin>' });

      await sendSystemNotification({
        userId: VICTIM,
        type: 'BALANCE_REMINDER',
        title: '<script>alert(1)</script>',
        body: 'Owed & due',
      });
      await flushDetached();

      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      const [to, subject, html] = sendEmailMock.mock.calls[0] as [string, string, string];
      expect(to).toBe('victim@example.com');
      expect(subject).toBe('<script>alert(1)</script>');
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('Owed &amp; due');
      expect(html).toContain('Vic &lt;admin&gt;');
    });

    it('never trusts a caller-supplied emailNotifications-like flag — SystemNotification has no such field influencing the gate', async () => {
      mockEnv.SMTP_HOST = 'smtp.example.com';
      userFindFirstMock.mockResolvedValue(null);

      await sendSystemNotification({
        userId: VICTIM,
        type: 'BALANCE_REMINDER',
        title: 't',
        body: 'b',
        // Intentionally passing an extraneous field to prove it cannot spoof the gate --
        // `as never` bypasses excess-property checking since SystemNotification has no
        // such field by design.
        emailNotifications: true,
      } as never);
      await flushDetached();

      // The gate is always the fresh DB read via emailNotifications: true in the where
      // clause -- a caller-supplied flag has no code path into it.
      expect(userFindFirstMock).toHaveBeenCalledWith({
        where: { id: VICTIM, emailNotifications: true },
        select: { email: true, name: true },
      });
      expect(sendEmailMock).not.toHaveBeenCalled();
    });
  });

  describe('push gating (EXPO_PUSH_ENABLED)', () => {
    // Per spec §3.3/ADR-020: push is "gated by EXPO_PUSH_ENABLED via the existing
    // sendPush" — sendPush itself (push.ts:20, tested elsewhere) already no-ops
    // when the flag is false. sendSystemNotification does not duplicate that
    // gate; it always delegates to sendPush, exactly like recordActivity does.
    it('always delegates to sendPush unconditionally (the flag is sendPush\'s own gate, not duplicated here)', async () => {
      mockEnv.EXPO_PUSH_ENABLED = false;

      await sendSystemNotification({ userId: VICTIM, type: 'BALANCE_REMINDER', title: 't', body: 'b' });
      await flushDetached();

      expect(sendPushMock).toHaveBeenCalledWith([VICTIM], 't', 'b', undefined);
    });

    it('calls sendPush with [n.userId], title, body, data when EXPO_PUSH_ENABLED is true', async () => {
      mockEnv.EXPO_PUSH_ENABLED = true;

      await sendSystemNotification({
        userId: VICTIM,
        type: 'BALANCE_REMINDER',
        title: 't',
        body: 'b',
        data: { foo: 'bar' },
      });
      await flushDetached();

      expect(sendPushMock).toHaveBeenCalledWith([VICTIM], 't', 'b', { foo: 'bar' });
    });
  });

  describe('fire-and-forget semantics', () => {
    it('resolves before awaiting email/push (does not delay the caller on slow email/push)', async () => {
      mockEnv.SMTP_HOST = 'smtp.example.com';
      mockEnv.EXPO_PUSH_ENABLED = true;
      userFindFirstMock.mockResolvedValue({ email: 'victim@example.com', name: 'Vic' });
      let pushResolved = false;
      sendPushMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              pushResolved = true;
              resolve(undefined);
            }, 50);
          }),
      );

      await sendSystemNotification({ userId: VICTIM, type: 'BALANCE_REMINDER', title: 't', body: 'b' });

      // The awaited call must have returned before the detached push settled.
      expect(pushResolved).toBe(false);
    });

    it('never throws (and never surfaces the error) when the detached email/push block fails', async () => {
      mockEnv.EXPO_PUSH_ENABLED = true;
      sendPushMock.mockRejectedValue(new Error('push provider down'));

      await expect(
        sendSystemNotification({ userId: VICTIM, type: 'BALANCE_REMINDER', title: 't', body: 'b' }),
      ).resolves.toBeUndefined();
      await flushDetached();
      // No unhandled rejection should have propagated; reaching this line is the assertion.
    });
  });
});
