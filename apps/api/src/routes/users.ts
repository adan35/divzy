import type { FastifyPluginAsync } from 'fastify';
import type { Prisma } from '@prisma/client';
import {
  isSupportedCurrency,
  zChangePasswordInput,
  zRegisterPushTokenInput,
  zUpdateMeInput,
  zUserSearchQuery,
} from '@divzy/shared';
import { hashPassword, verifyPassword } from '../lib/auth';
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

    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.avatarColor !== undefined) data.avatarColor = input.avatarColor;
    if (input.defaultCurrency !== undefined) data.defaultCurrency = input.defaultCurrency;
    if (input.emailNotifications !== undefined) data.emailNotifications = input.emailNotifications;

    const user = await prisma.user.update({ where: { id: request.userId }, data });
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

  // -- GET /users/search?email= ------------------------------------------------------
  app.get('/users/search', { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = zUserSearchQuery.parse(request.query);
    const user = await prisma.user.findUnique({
      where: { email: query.email },
      select: publicUserSelect,
    });
    // Exact match or JSON null — never a list, never the email itself.
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
};

export default routes;
