import type { FastifyPluginAsync } from 'fastify';
import type { $Enums, Prisma } from '@prisma/client';
import type { ActivityDto } from '@divzy/shared';
import { zActivityQuery } from '@divzy/shared';
import { cached, cacheKey } from '../lib/cache';
import { paginate } from '../lib/pagination';
import { prisma } from '../lib/prisma';
import { activityInclude, toActivityDto } from '../lib/serializers';

// spec-WI-054 §3 / ADR-027 D2 — terminal lifecycle types excluded from the
// main paginated feed query and queried separately for per-caller decoration.
const TERMINAL_ACTIVITY_TYPES: $Enums.ActivityType[] = [
  'EXPENSE_DELETED',
  'SETTLEMENT_DELETED',
  'EXPENSE_RESTORED',
  'SETTLEMENT_RESTORED',
];

const routes: FastifyPluginAsync = async (app) => {
  // -- GET /activity — the caller's fan-out feed, cursor-paginated ----------
  app.get('/activity', { preHandler: [app.authenticate] }, async (request) => {
    const query = zActivityQuery.parse(request.query);
    const viewerId = request.userId;
    // WI-073 / ADR-030: wrapped in cached() (8s TTL, spec §2). Query parsing
    // and key construction stay outside fn(); a cache hit skips both DB
    // round-trips and the deletedAt/colorHint decoration pass below.
    const key = cacheKey('activity', viewerId, {
      groupId: query.groupId,
      cursor: query.cursor,
      limit: query.limit,
    });
    return cached(key, 8_000, async () => {
      // (1) Anchor page — excludes terminal rows at the DB level; paginate() as
      // today. This is pagination-safe: excluded rows are simply never in the
      // result set, so take/cursor/skip/orderBy stay untouched (ADR-027 D2).
      const where: Prisma.ActivityLogWhereInput = {
        recipients: { some: { userId: viewerId } },
        ...(query.groupId ? { groupId: query.groupId } : {}),
        type: { notIn: TERMINAL_ACTIVITY_TYPES },
      };

      const rows = await prisma.activityLog.findMany({
        where,
        include: activityInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });

      const { items, nextCursor } = paginate(rows, query.limit);
      const dtos = items.map(toActivityDto);

      // (2) Companion decoration — caller's own terminal rows for THIS page's
      // anchor entities only (ADR-027 D2). Per-recipient scoping falls out of
      // the `recipients.some.userId` filter for free.
      const expenseIds = dtos
        .filter((d) => d.type === 'EXPENSE_ADDED' && d.expenseId)
        .map((d) => d.expenseId as string);
      const settlementIds = dtos
        .filter((d) => d.type === 'SETTLEMENT_ADDED' && d.settlementId)
        .map((d) => d.settlementId as string);

      const terminals =
        expenseIds.length || settlementIds.length
          ? await prisma.activityLog.findMany({
              where: {
                recipients: { some: { userId: viewerId } },
                type: { in: TERMINAL_ACTIVITY_TYPES },
                OR: [{ expenseId: { in: expenseIds } }, { settlementId: { in: settlementIds } }],
              },
              orderBy: [{ createdAt: 'desc' }],
              select: { type: true, expenseId: true, settlementId: true, createdAt: true },
            })
          : [];

      // Latest-terminal-wins per entity, first hit wins (already desc-ordered):
      // *_DELETED -> its createdAt ISO string; *_RESTORED -> null.
      const deletedAtByEntity = new Map<string, string | null>();
      for (const t of terminals) {
        const entityId = t.expenseId ?? t.settlementId;
        if (!entityId || deletedAtByEntity.has(entityId)) continue;
        const isDeleted = t.type === 'EXPENSE_DELETED' || t.type === 'SETTLEMENT_DELETED';
        deletedAtByEntity.set(entityId, isDeleted ? t.createdAt.toISOString() : null);
      }

      const enriched: ActivityDto[] = dtos.map((dto) => {
        const isAnchor = dto.type === 'EXPENSE_ADDED' || dto.type === 'SETTLEMENT_ADDED';
        const entityId = dto.expenseId ?? dto.settlementId;
        const deletedAt = isAnchor && entityId ? (deletedAtByEntity.get(entityId) ?? null) : null;

        // spec-WI-055 §3 — computed after deletedAt; a struck-through row is
        // forced neutral regardless of actor (precedence).
        let colorHint: ActivityDto['colorHint'] = null;
        if (dto.type === 'EXPENSE_ADDED' && deletedAt === null) {
          colorHint = dto.actor.id === viewerId ? 'green' : 'red';
        }

        return { ...dto, deletedAt, colorHint };
      });

      return { items: enriched, nextCursor };
    });
  });
};

export default routes;
