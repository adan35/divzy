import type { FastifyPluginAsync } from 'fastify';
import type { Prisma } from '@prisma/client';
import { zActivityQuery } from '@divzy/shared';
import { paginate } from '../lib/pagination';
import { prisma } from '../lib/prisma';
import { activityInclude, toActivityDto } from '../lib/serializers';

const routes: FastifyPluginAsync = async (app) => {
  // -- GET /activity — the caller's fan-out feed, cursor-paginated ----------
  app.get('/activity', { preHandler: [app.authenticate] }, async (request) => {
    const query = zActivityQuery.parse(request.query);

    const where: Prisma.ActivityLogWhereInput = {
      recipients: { some: { userId: request.userId } },
      ...(query.groupId ? { groupId: query.groupId } : {}),
    };

    const rows = await prisma.activityLog.findMany({
      where,
      include: activityInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const { items, nextCursor } = paginate(rows, query.limit);
    return { items: items.map(toActivityDto), nextCursor };
  });
};

export default routes;
