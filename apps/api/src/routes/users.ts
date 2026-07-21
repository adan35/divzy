import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import {
  NOTIFICATION_CATEGORIES,
  isSupportedCurrency,
  zChangePasswordInput,
  zRegisterPushTokenInput,
  zUpdateMeInput,
  zUpdateNotificationPreferencesInput,
  zUserSearchQuery,
  type NotificationPreferenceDto,
  type NotificationPreferencesDto,
} from '@divzy/shared';
import { hashPassword, verifyPassword } from '../lib/auth';
import { bumpUserGeneration } from '../lib/cache';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { publicUserSelect, toPublicUser, toUserDto } from '../lib/serializers';

const routes: FastifyPluginAsync = async (app) => {
  // -- PATCH /users/me ---------------------------------------------------------
  app.patch('/users/me', { preHandler: [app.authenticate] }, async (request) => {
    const input = zUpdateMeInput.parse(request.body);
    if (input.defaultCurrency && !isSupportedCurrency(input.defaultCurrency)) {
      throw new AppError(
        400,
        'UNSUPPORTED_CURRENCY',
        `Currency ${input.defaultCurrency} is not supported`,
      );
    }

    // WI-067 / ADR-030 site C1 (CEO gate ruling, required): a converted
    // /balance or /analytics/summary figure depends on the caller's
    // defaultCurrency, so a genuine change must bump — but ONLY when it
    // actually changes value (read the pre-update value first; TTL covers
    // any other field's staleness fine).
    const previous =
      input.defaultCurrency !== undefined
        ? await prisma.user.findUnique({
            where: { id: request.userId },
            select: { defaultCurrency: true },
          })
        : null;

    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.avatarColor !== undefined) data.avatarColor = input.avatarColor;
    // avatarUrl: string sets (already constrained server-side by zAvatarUrl to
    // a /uploads/avatars/<hex>.<ext> path this server's own upload handler
    // produced — WI-035 DRB security condition), null clears. Setting null
    // when already null is a no-op update, never an error (idempotent).
    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;
    if (input.defaultCurrency !== undefined) data.defaultCurrency = input.defaultCurrency;
    if (input.emailNotifications !== undefined) data.emailNotifications = input.emailNotifications;
    if (input.staleBalanceRemindersEnabled !== undefined)
      data.staleBalanceRemindersEnabled = input.staleBalanceRemindersEnabled;
    // phone: string sets, null clears, omitted leaves unchanged. Idempotent
    // no-op if already null/that value (WI-045).
    if (input.phone !== undefined) data.phone = input.phone;

    let user;
    try {
      user = await prisma.user.update({ where: { id: request.userId }, data });
    } catch (err) {
      // Concurrent phone-set race, same P2002 pattern as EMAIL_TAKEN (WI-045/ADR-024).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(409, 'PHONE_TAKEN', 'That phone number is already in use by another account');
      }
      throw err;
    }

    if (input.defaultCurrency !== undefined && previous?.defaultCurrency !== input.defaultCurrency) {
      bumpUserGeneration(request.userId);
    }

    return toUserDto(user);
  });

  // -- POST /users/me/password ----------------------------------------------------
  app.post('/users/me/password', { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = zChangePasswordInput.parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');

    const currentOk = await verifyPassword(user.passwordHash, input.currentPassword);
    // 400 (not 401) so API clients don't treat it as an expired session.
    if (!currentOk) {
      throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
    }

    const passwordHash = await hashPassword(input.newPassword);
    // The refresh token of THIS session is not sent on this route (cookie is
    // path-scoped to /auth; mobile keeps it in SecureStore), so keep the most
    // recently issued active token — the caller's session — and revoke the rest.
    const newest = await prisma.refreshToken.findFirst({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.refreshToken.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
          ...(newest ? { id: { not: newest.id } } : {}),
        },
        data: { revokedAt: new Date() },
      }),
    ]);

    return reply.code(204).send();
  });

  // -- GET /users/search?email=|phone= (WI-045) ---------------------------------------
  app.get('/users/search', { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = zUserSearchQuery.parse(request.query);
    const user = await prisma.user.findUnique({
      where: query.email ? { email: query.email } : { phone: query.phone! },
      select: publicUserSelect,
    });
    // Exact match or JSON null — never a list, never the email/phone itself
    // (publicUserSelect never includes phone — structurally enforced, WI-045).
    return reply.send(user ? toPublicUser(user) : null);
  });

  // -- POST /users/me/push-tokens -------------------------------------------------------
  app.post('/users/me/push-tokens', { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = zRegisterPushTokenInput.parse(request.body);
    // Upsert by token: a device that switches accounts moves its token over.
    await prisma.pushToken.upsert({
      where: { token: input.token },
      update: { userId: request.userId, platform: input.platform },
      create: { userId: request.userId, token: input.token, platform: input.platform },
    });
    return reply.code(204).send();
  });

  // -- GET /users/me/notification-preferences (WI-041, auth's slice) ----------------------
  // Returns the fully-resolved matrix (all 9 canonical categories, absent row
  // = both channels on) — auth's OWN read contract, distinct from
  // notifications-activity's send-time gating (which this route does not
  // implement, per DRB architecture condition C1). Scoped exclusively to
  // request.userId — never a userId from params/query (IDOR guard).
  app.get(
    '/users/me/notification-preferences',
    { preHandler: [app.authenticate] },
    async (request): Promise<NotificationPreferencesDto> => {
      const rows = await prisma.notificationPreference.findMany({
        where: { userId: request.userId },
      });
      const byCategory = new Map(rows.map((r) => [r.category, r]));

      const categories: NotificationPreferenceDto[] = NOTIFICATION_CATEGORIES.map((c) => {
        const row = byCategory.get(c.key);
        return {
          category: c.key,
          pushEnabled: row ? row.pushEnabled : true,
          emailEnabled: row ? row.emailEnabled : true,
          available: c.available,
        };
      });

      return { categories };
    },
  );

  // -- PATCH /users/me/notification-preferences (WI-041, auth's slice) --------------------
  // Partial per-cell upsert on (userId, category). The input schema carries
  // only { category, pushEnabled?, emailEnabled? } — no userId anywhere in the
  // body — and userId is derived exclusively from request.userId on every
  // upsert (both `where` and `create`), mirroring PATCH /users/me. This is the
  // DRB security IDOR guard: no request value can retarget another user's row.
  app.patch(
    '/users/me/notification-preferences',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const input = zUpdateNotificationPreferencesInput.parse(request.body);

      await Promise.all(
        input.preferences.map((pref) => {
          const update: { pushEnabled?: boolean; emailEnabled?: boolean } = {};
          if (pref.pushEnabled !== undefined) update.pushEnabled = pref.pushEnabled;
          if (pref.emailEnabled !== undefined) update.emailEnabled = pref.emailEnabled;

          return prisma.notificationPreference.upsert({
            where: { userId_category: { userId: request.userId, category: pref.category } },
            update,
            create: {
              userId: request.userId,
              category: pref.category,
              ...(pref.pushEnabled !== undefined ? { pushEnabled: pref.pushEnabled } : {}),
              ...(pref.emailEnabled !== undefined ? { emailEnabled: pref.emailEnabled } : {}),
            },
          });
        }),
      );

      return reply.code(204).send();
    },
  );
};

export default routes;
