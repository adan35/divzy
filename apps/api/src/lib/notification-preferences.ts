/**
 * spec-WI-041 §4.2 / ADR-021 (rev. 2026-07-17) — the real, read-only send-time
 * lookup of auth's shipped `NotificationPreference` table.
 *
 * Auth owns the storage model + Settings UI (`NotificationPreference`,
 * `PATCH /users/me/notification-preferences`); this domain reads it
 * READ-ONLY at delivery time, same trust model as `User.emailNotifications`.
 *
 * Contract:
 *  - Batched: ONE query per fan-out for the whole `userIds` list (mirrors the
 *    existing single `prisma.user.findMany` in the email delivery block),
 *    never N per-user round trips.
 *  - Read-only: never accepts or is influenced by caller-supplied preference
 *    input; reads fresh at delivery time.
 *  - Fail-open by ABSENCE: a userId with no row for `category` is simply
 *    omitted from the returned Map. Callers apply the fail-open default
 *    (`?? true`) — absence means both channels are enabled (auth's §5
 *    resolution formula). This helper does not synthesize defaults itself.
 */
import type { NotificationCategory } from '@divzy/shared';
import { prisma } from './prisma';

export interface ChannelPrefs {
  push: boolean;
  email: boolean;
}

/**
 * Batched, read-only lookup of the per-(user, category) toggle matrix.
 * Users with no row for `category` are absent from the returned Map — call
 * sites apply the fail-open default (`?? true`).
 */
export async function getNotificationPreferences(
  userIds: string[],
  category: NotificationCategory,
): Promise<Map<string, ChannelPrefs>> {
  if (userIds.length === 0) return new Map();

  const rows = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds }, category },
    select: { userId: true, pushEnabled: true, emailEnabled: true },
  });

  return new Map(rows.map((r) => [r.userId, { push: r.pushEnabled, email: r.emailEnabled }]));
}
