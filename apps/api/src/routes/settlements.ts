import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  formatMoney,
  isSupportedCurrency,
  zCreateSettlementInput,
  zId,
  zListSettlementsQuery,
} from '@divzy/shared';
import { recordActivity } from '../lib/activity';
import { AppError } from '../lib/errors';
import { paginate } from '../lib/pagination';
import { prisma } from '../lib/prisma';
import { settlementInclude, toSettlementDto } from '../lib/serializers';
import { ensureFriendshipsAmong } from '../lib/social';

const zSettlementParams = z.object({ settlementId: zId });

/** Membership = GroupMember row with leftAt null. Non-members get 404 (never leak). */
async function assertActiveMember(groupId: string, userId: string): Promise<void> {
  const member = await prisma.groupMember.findFirst({
    where: { groupId, userId, leftAt: null },
    select: { id: true },
  });
  if (!member) throw new AppError(404, 'NOT_FOUND', 'Group not found');
}

/** Settlements strictly between two users, in either direction. */
function betweenUsers(a: string, b: string): Prisma.SettlementWhereInput[] {
  return [
    { fromUserId: a, toUserId: b },
    { fromUserId: b, toUserId: a },
  ];
}

const routes: FastifyPluginAsync = async (app) => {
  // -- GET /settlements — by group, by friend, or all of the caller's ---------
  app.get('/settlements', { preHandler: [app.authenticate] }, async (request) => {
    const query = zListSettlementsQuery.parse(request.query);
    const userId = request.userId;

    const where: Prisma.SettlementWhereInput = { deletedAt: null };
    if (query.groupId) {
      await assertActiveMember(query.groupId, userId);
      where.groupId = query.groupId;
      // groupId + friendId narrows to the pair within that group.
      if (query.friendId) where.OR = betweenUsers(userId, query.friendId);
    } else if (query.friendId) {
      where.OR = betweenUsers(userId, query.friendId);
    } else {
      where.OR = [{ fromUserId: userId }, { toUserId: userId }];
    }

    const rows = await prisma.settlement.findMany({
      where,
      include: settlementInclude,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const { items, nextCursor } = paginate(rows, query.limit);
    return { items: items.map(toSettlementDto), nextCursor };
  });

  // -- POST /settlements — record a payment (caller must be a party) -----------
  app.post('/settlements', { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = zCreateSettlementInput.parse(request.body);
    const userId = request.userId;

    if (userId !== input.fromUserId && userId !== input.toUserId) {
      throw new AppError(403, 'FORBIDDEN', 'You must be the payer or the recipient');
    }
    if (!isSupportedCurrency(input.currency)) {
      throw new AppError(400, 'UNSUPPORTED_CURRENCY', `Currency ${input.currency} is not supported`);
    }

    let recipientIds: string[];
    if (input.groupId) {
      // Group settlement: caller must be an active member (404 — never leak the
      // group), and BOTH parties must be active members.
      const members = await prisma.groupMember.findMany({
        where: { groupId: input.groupId, leftAt: null },
        select: { userId: true },
      });
      const memberIds = new Set(members.map((m) => m.userId));
      if (!memberIds.has(userId)) throw new AppError(404, 'NOT_FOUND', 'Group not found');
      if (!memberIds.has(input.fromUserId) || !memberIds.has(input.toUserId)) {
        throw new AppError(400, 'NOT_A_MEMBER', 'Both parties must be active members of the group');
      }
      recipientIds = [...memberIds];
    } else {
      // Non-group settlement: any registered counterpart is allowed; the pair
      // becomes friends so the payment shows up in their shared ledger.
      const counterpartId = input.fromUserId === userId ? input.toUserId : input.fromUserId;
      const counterpart = await prisma.user.findUnique({
        where: { id: counterpartId },
        select: { id: true },
      });
      if (!counterpart) throw new AppError(404, 'USER_NOT_FOUND', 'The other party has no Divzy account');
      recipientIds = [input.fromUserId, input.toUserId];
    }

    const settlement = await prisma.settlement.create({
      data: {
        groupId: input.groupId ?? null,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        amount: input.amount,
        currency: input.currency,
        method: input.method,
        note: input.note ?? null,
        date: new Date(input.date),
        createdById: userId,
      },
      include: settlementInclude,
    });

    if (!input.groupId) {
      await ensureFriendshipsAmong([input.fromUserId, input.toUserId]);
    }

    await recordActivity({
      type: 'SETTLEMENT_ADDED',
      actorId: userId,
      groupId: input.groupId ?? null,
      settlementId: settlement.id,
      data: {
        amount: settlement.amount,
        currency: settlement.currency,
        fromName: settlement.fromUser.name,
        toName: settlement.toUser.name,
      },
      recipientIds,
      notify: {
        type: 'SETTLEMENT_RECORDED',
        title: 'Settlement recorded',
        body: `${settlement.fromUser.name} paid ${settlement.toUser.name} ${formatMoney(settlement.amount, settlement.currency)}`,
        data: { settlementId: settlement.id, groupId: settlement.groupId },
      },
    });

    return reply.code(201).send(toSettlementDto(settlement));
  });

  // -- DELETE /settlements/:settlementId — soft delete (payer/recipient/creator) --
  app.delete(
    '/settlements/:settlementId',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { settlementId } = zSettlementParams.parse(request.params);
      const userId = request.userId;

      const settlement = await prisma.settlement.findFirst({
        where: { id: settlementId, deletedAt: null },
        include: settlementInclude,
      });
      if (!settlement) throw new AppError(404, 'NOT_FOUND', 'Settlement not found');

      const isParty =
        userId === settlement.fromUserId ||
        userId === settlement.toUserId ||
        userId === settlement.createdById;
      if (!isParty) {
        // Group members who can see it but aren't a party get an explicit 403;
        // everyone else gets 404 so the settlement's existence never leaks.
        if (settlement.groupId) {
          const member = await prisma.groupMember.findFirst({
            where: { groupId: settlement.groupId, userId, leftAt: null },
            select: { id: true },
          });
          if (member) {
            throw new AppError(
              403,
              'FORBIDDEN',
              'Only the payer, recipient, or creator can delete a settlement',
            );
          }
        }
        throw new AppError(404, 'NOT_FOUND', 'Settlement not found');
      }

      await prisma.settlement.update({
        where: { id: settlementId },
        data: { deletedAt: new Date() },
      });

      let recipientIds: string[];
      if (settlement.groupId) {
        const members = await prisma.groupMember.findMany({
          where: { groupId: settlement.groupId, leftAt: null },
          select: { userId: true },
        });
        // Parties still see the deletion even if they have since left the group.
        recipientIds = [
          ...members.map((m) => m.userId),
          settlement.fromUserId,
          settlement.toUserId,
        ];
      } else {
        recipientIds = [settlement.fromUserId, settlement.toUserId];
      }

      await recordActivity({
        type: 'SETTLEMENT_DELETED',
        actorId: userId,
        groupId: settlement.groupId,
        settlementId: settlement.id,
        data: {
          amount: settlement.amount,
          currency: settlement.currency,
          fromName: settlement.fromUser.name,
          toName: settlement.toUser.name,
        },
        recipientIds,
      });

      return reply.code(204).send();
    },
  );
};

export default routes;
