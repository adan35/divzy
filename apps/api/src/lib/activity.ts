import type { $Enums, Prisma } from '@prisma/client';
import { pino } from 'pino';
import { env } from '../config/env';
import { emitToGroup, emitToUsers } from '../realtime/io';
import { sendEmail } from './email';
import { prisma } from './prisma';
import { sendPush } from './push';
import { activityInclude, toActivityDto, toNotificationDto } from './serializers';

const log = pino({ name: 'activity', level: env.NODE_ENV === 'test' ? 'silent' : 'info' });

export interface SideEffect {
  type: $Enums.ActivityType;
  actorId: string;
  groupId?: string | null;
  expenseId?: string | null;
  settlementId?: string | null;
  data: Record<string, unknown>;
  /** Everyone who should see this in their activity feed (actor auto-added). */
  recipientIds: string[];
  /** When set, recipients (minus the actor) also get a Notification + email/push. */
  notify?: {
    type: $Enums.NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  };
}

const GROUP_CHANGE_KIND: Record<
  $Enums.ActivityType,
  'expense' | 'settlement' | 'member' | 'group'
> = {
  EXPENSE_ADDED: 'expense',
  EXPENSE_UPDATED: 'expense',
  EXPENSE_DELETED: 'expense',
  COMMENT_ADDED: 'expense',
  RECURRING_POSTED: 'expense',
  SETTLEMENT_ADDED: 'settlement',
  SETTLEMENT_DELETED: 'settlement',
  MEMBER_JOINED: 'member',
  MEMBER_LEFT: 'member',
  MEMBER_REMOVED: 'member',
  GROUP_CREATED: 'group',
  GROUP_UPDATED: 'group',
  FRIEND_ADDED: 'group',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function notificationEmailHtml(recipientName: string, title: string, body: string): string {
  return [
    '<div style="font-family:system-ui,-apple-system,\'Segoe UI\',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0b0b0b;">',
    `<p style="margin:0 0 12px;">Hi ${escapeHtml(recipientName)},</p>`,
    `<h2 style="margin:0 0 8px;font-size:18px;">${escapeHtml(title)}</h2>`,
    `<p style="margin:0 0 20px;color:#52514e;">${escapeHtml(body)}</p>`,
    `<p style="margin:0 0 24px;"><a href="${env.WEB_URL}" style="background:#2a78d6;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:10px;display:inline-block;">Open Divzy</a></p>`,
    '<p style="margin:0;font-size:12px;color:#898781;">You can turn off email notifications in your Divzy account settings.</p>',
    '</div>',
  ].join('');
}

/**
 * The single mutation side-effect fan-out, in a consistent order:
 * 1. ActivityLog + ActivityRecipient rows (recipients include the actor).
 * 2. Notification rows for recipients except the actor.
 * 3. Socket emits: activity:new + notification:new to user rooms;
 *    group:changed to the group room (or friends:changed for non-group).
 * 4. Fire-and-forget email + Expo push.
 *
 * Never throws — side effects must not break the mutation that triggered them.
 */
export async function recordActivity(e: SideEffect): Promise<void> {
  try {
    const recipientIds = [...new Set([e.actorId, ...e.recipientIds])];

    const activity = await prisma.activityLog.create({
      data: {
        type: e.type,
        actorId: e.actorId,
        groupId: e.groupId ?? null,
        expenseId: e.expenseId ?? null,
        settlementId: e.settlementId ?? null,
        data: e.data as Prisma.InputJsonValue,
        recipients: {
          createMany: {
            data: recipientIds.map((userId) => ({ userId })),
            skipDuplicates: true,
          },
        },
      },
      include: activityInclude,
    });
    emitToUsers(recipientIds, 'activity:new', toActivityDto(activity));

    const notifyIds = recipientIds.filter((id) => id !== e.actorId);
    const notify = e.notify;

    if (notify && notifyIds.length > 0) {
      const notifications = await prisma.notification.createManyAndReturn({
        data: notifyIds.map((userId) => ({
          userId,
          type: notify.type,
          title: notify.title,
          body: notify.body,
          data: (notify.data ?? {}) as Prisma.InputJsonValue,
        })),
      });
      for (const notification of notifications) {
        emitToUsers([notification.userId], 'notification:new', toNotificationDto(notification));
      }
    }

    if (e.groupId) {
      emitToGroup(e.groupId, 'group:changed', {
        groupId: e.groupId,
        kind: GROUP_CHANGE_KIND[e.type],
      });
    } else {
      emitToUsers(recipientIds, 'friends:changed', { userIds: recipientIds });
    }

    if (notify && notifyIds.length > 0) {
      // Fire-and-forget: email + push never block the response.
      void (async () => {
        try {
          await sendPush(notifyIds, notify.title, notify.body, notify.data);
          if (env.SMTP_HOST) {
            const users = await prisma.user.findMany({
              where: { id: { in: notifyIds }, emailNotifications: true },
              select: { email: true, name: true },
            });
            await Promise.all(
              users.map((user) =>
                sendEmail(
                  user.email,
                  notify.title,
                  notificationEmailHtml(user.name, notify.title, notify.body),
                ),
              ),
            );
          }
        } catch (err) {
          log.error({ err, type: e.type }, 'Notification delivery failed');
        }
      })();
    }
  } catch (err) {
    log.error({ err, type: e.type }, 'recordActivity failed');
  }
}
