import type { $Enums, Prisma } from '@prisma/client';
import { pino } from 'pino';
import type { NotificationCategory } from '@divzy/shared';
import { env } from '../config/env';
import { emitToGroup, emitToUsers } from '../realtime/io';
import { bumpUsers } from './cache';
import { sendEmail } from './email';
import { getNotificationPreferences } from './notification-preferences';
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
  EXPENSE_RESTORED: 'expense',
  COMMENT_ADDED: 'expense',
  RECURRING_POSTED: 'expense',
  SETTLEMENT_ADDED: 'settlement',
  SETTLEMENT_DELETED: 'settlement',
  SETTLEMENT_RESTORED: 'settlement',
  MEMBER_JOINED: 'member',
  MEMBER_LEFT: 'member',
  MEMBER_REMOVED: 'member',
  GROUP_CREATED: 'group',
  GROUP_UPDATED: 'group',
  FRIEND_ADDED: 'group',
};

/**
 * spec-WI-041 §3 / ADR-021 (rev. 2026-07-17) — static, exhaustive 1:1 map from
 * `NotificationType` to auth's real, granular `NotificationCategory` (shared
 * enum, `packages/shared/src/constants.ts`). No coarse grouping — each
 * expense sub-event (added/edited/deleted) is gated independently. Types with
 * no mapped category map to `null`, meaning "no granular gate applies,
 * deliver exactly as before WI-041" (`FRIEND_ADDED`, `RECURRING_POSTED`, and
 * `BALANCE_REMINDER` — the latter already has its own upstream opt-in,
 * `staleBalanceRemindersEnabled`, checked before `sendSystemNotification` is
 * ever called).
 */
const NOTIFICATION_CATEGORY: Record<$Enums.NotificationType, NotificationCategory | null> = {
  EXPENSE_ADDED: 'EXPENSE_ADDED',
  EXPENSE_UPDATED: 'EXPENSE_EDITED',
  EXPENSE_DELETED: 'EXPENSE_DELETED',
  COMMENT_ADDED: 'COMMENT',
  SETTLEMENT_RECORDED: 'PAYMENT_RECEIVED',
  MEMBER_JOINED: 'GROUP_INVITE',
  ADDED_TO_GROUP: 'GROUP_INVITE',
  FRIEND_ADDED: null,
  RECURRING_POSTED: null,
  BALANCE_REMINDER: null,
};

export function categoryForNotificationType(
  type: $Enums.NotificationType,
): NotificationCategory | null {
  return NOTIFICATION_CATEGORY[type];
}

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
    // WI-073 / ADR-030: bump the activity-cache generation for every viewer
    // whose GET /activity result just changed, immediately after the
    // ActivityLog + ActivityRecipient rows are durably committed and before
    // the activity:new emit (spec §3).
    bumpUsers(recipientIds);
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
          // spec-WI-041 §5a / ADR-021 — granular per-category x per-channel
          // delivery gate, applied ONLY here (never to the rows/emits above,
          // which have already happened). `category === null` (ungated
          // NotificationTypes) delivers to the full `notifyIds` exactly as
          // before WI-041 — no lookup, no behavior change.
          const category = categoryForNotificationType(notify.type);
          let pushIds = notifyIds;
          let emailIds = notifyIds;
          if (category !== null) {
            const prefs = await getNotificationPreferences(notifyIds, category);
            pushIds = notifyIds.filter((id) => prefs.get(id)?.push ?? true);
            emailIds = notifyIds.filter((id) => prefs.get(id)?.email ?? true);
          }

          await sendPush(pushIds, notify.title, notify.body, notify.data);
          if (env.SMTP_HOST) {
            // The granular email preference is ANDed with (not a replacement
            // for) the existing SMTP_HOST + emailNotifications gate.
            const users = await prisma.user.findMany({
              where: { id: { in: emailIds }, emailNotifications: true },
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

/**
 * A system-originated (actor-less) notification to exactly ONE user.
 *
 * Unlike SideEffect there is deliberately no `recipientIds` array and no `actorId`:
 * this entry point can only ever target a single owner, by construction, so it can
 * never fan out to multiple users or leak into another user's room/row.
 */
export interface SystemNotification {
  /** The single owner/recipient. There is intentionally no list form. */
  userId: string;
  type: $Enums.NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Deliver a single-user, system-originated Notification (+ config-gated email/push),
 * WITHOUT writing to the activity feed or emitting to any group/friends room.
 *
 * A sibling of recordActivity for events that are NOT group activities (e.g. a
 * stale-balance reminder). Never throws — a failed delivery must never break or
 * delay the caller (an unattended cron scan with no request/response cycle).
 */
export async function sendSystemNotification(n: SystemNotification): Promise<void> {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId: n.userId,
        type: n.type,
        title: n.title,
        body: n.body,
        data: (n.data ?? {}) as Prisma.InputJsonValue,
      },
    });
    emitToUsers([n.userId], 'notification:new', toNotificationDto(notification));

    // Fire-and-forget: email + push never block the caller.
    void (async () => {
      try {
        // spec-WI-041 §5b — same gate hook as recordActivity, placed for
        // symmetry and future system-originated categories. Every existing
        // caller passes BALANCE_REMINDER, which maps to `null`, so this is a
        // no-op today: `allowPush`/`allowEmail` stay `true` and delivery is
        // byte-identical to pre-WI-041 behavior.
        const category = categoryForNotificationType(n.type);
        let allowPush = true;
        let allowEmail = true;
        if (category !== null) {
          const prefs = await getNotificationPreferences([n.userId], category);
          allowPush = prefs.get(n.userId)?.push ?? true;
          allowEmail = prefs.get(n.userId)?.email ?? true;
        }

        if (allowPush) {
          await sendPush([n.userId], n.title, n.body, n.data);
        }
        if (env.SMTP_HOST && allowEmail) {
          const user = await prisma.user.findFirst({
            where: { id: n.userId, emailNotifications: true },
            select: { email: true, name: true },
          });
          if (user) {
            await sendEmail(user.email, n.title, notificationEmailHtml(user.name, n.title, n.body));
          }
        }
      } catch (err) {
        log.error({ err, type: n.type }, 'sendSystemNotification delivery failed');
      }
    })();
  } catch (err) {
    log.error({ err, type: n.type }, 'sendSystemNotification failed');
  }
}
