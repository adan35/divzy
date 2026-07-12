import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { zId, zNotificationsQuery } from '@divzy/shared';
import { AppError } from '../lib/errors';
import { paginate } from '../lib/pagination';
import { prisma } from '../lib/prisma';
import { toNotificationDto } from '../lib/serializers';

const zNotificationParams = z.object({ notificationId: zId });

const routes: FastifyPluginAsync = async (app) => {
  // -- GET /notifications — the caller's own, cursor-paginated ---------------
  app.get('/notifications', { preHandler: [app.authenticate] }, async (request) => {
    const query = zNotificationsQuery.parse(request.query);

    const where: Prisma.NotificationWhereInput = {
      userId: request.userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    const rows = await prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const { items, nextCursor } = paginate(rows, query.limit);
    return { items: items.map(toNotificationDto), nextCursor };
  });

  // -- GET /notifications/unread-count — cheap badge count --------------------
  app.get('/notifications/unread-count', { preHandler: [app.authenticate] }, async (request) => {
    const count = await prisma.notification.count({
      where: { userId: request.userId, readAt: null },
    });
    return { count };
  });

  // -- POST /notifications/:id/read — mark one as read (own only) -------------
  app.post(
    '/notifications/:notificationId/read',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { notificationId } = zNotificationParams.parse(request.params);

      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, userId: request.userId },
        select: { id: true, readAt: true },
      });
      if (!notification) {
        throw new AppError(404, 'NOT_FOUND', 'Notification not found');
      }

      if (notification.readAt === null) {
        await prisma.notification.update({
          where: { id: notification.id },
          data: { readAt: new Date() },
        });
      }
      return reply.status(204).send();
    },
  );

  // -- POST /notifications/read-all — bulk mark read ---------------------------
  app.post('/notifications/read-all', { preHandler: [app.authenticate] }, async (request, reply) => {
    await prisma.notification.updateMany({
      where: { userId: request.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return reply.status(204).send();
  });
};

export default routes;
