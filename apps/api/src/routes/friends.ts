import type { FastifyPluginAsync } from 'fastify';
import {
  computePairwiseBalances,
  zAddFriendInput,
  type CurrencyAmount,
  type FriendDto,
} from '@divzy/shared';
import { recordActivity } from '../lib/activity';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { publicUserSelect, toPublicUser } from '../lib/serializers';
import { ensureFriendshipsAmong } from '../lib/social';

/** Sort magnitude: total absolute balance across currencies (display order only). */
function balanceMagnitude(balances: CurrencyAmount[]): number {
  return balances.reduce((acc, b) => acc + Math.abs(b.amount), 0);
}

const routes: FastifyPluginAsync = async (app) => {
  // -- GET /friends — friendship rows + per-friend pairwise balances ---------
  app.get('/friends', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.userId;

    // Same ledger queries as GET /balance (per CONTRACTS): every non-deleted
    // expense the caller is on + every settlement they are a party to. The
    // pairwise engine runs ONCE and is filtered per friend below.
    const [friendships, expenses, settlements] = await Promise.all([
      prisma.friendship.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
        include: {
          userA: { select: publicUserSelect },
          userB: { select: publicUserSelect },
        },
      }),
      prisma.expense.findMany({
        where: {
          deletedAt: null,
          OR: [{ payers: { some: { userId } } }, { splits: { some: { userId } } }],
        },
        select: {
          currency: true,
          createdAt: true,
          payers: { select: { userId: true, amount: true } },
          splits: { select: { userId: true, amount: true } },
        },
      }),
      prisma.settlement.findMany({
        where: { deletedAt: null, OR: [{ fromUserId: userId }, { toUserId: userId }] },
        select: {
          currency: true,
          fromUserId: true,
          toUserId: true,
          amount: true,
          createdAt: true,
        },
      }),
    ]);

    const pairwise = computePairwiseBalances(expenses, settlements);

    // friendId -> currency -> signed amount (positive = they owe the caller).
    const balancesByFriend = new Map<string, Map<string, number>>();
    const bump = (friendId: string, currency: string, delta: number) => {
      let perCurrency = balancesByFriend.get(friendId);
      if (!perCurrency) {
        perCurrency = new Map();
        balancesByFriend.set(friendId, perCurrency);
      }
      perCurrency.set(currency, (perCurrency.get(currency) ?? 0) + delta);
    };
    for (const debt of pairwise) {
      if (debt.fromUserId === userId) bump(debt.toUserId, debt.currency, -debt.amount);
      else if (debt.toUserId === userId) bump(debt.fromUserId, debt.currency, debt.amount);
    }

    // friendId -> latest createdAt of an expense/settlement shared with them.
    const lastSharedAt = new Map<string, Date>();
    const touch = (friendId: string, at: Date) => {
      const prev = lastSharedAt.get(friendId);
      if (!prev || at.getTime() > prev.getTime()) lastSharedAt.set(friendId, at);
    };
    for (const expense of expenses) {
      for (const person of [...expense.payers, ...expense.splits]) {
        if (person.userId !== userId) touch(person.userId, expense.createdAt);
      }
    }
    for (const settlement of settlements) {
      const otherId =
        settlement.fromUserId === userId ? settlement.toUserId : settlement.fromUserId;
      touch(otherId, settlement.createdAt);
    }

    const friends: FriendDto[] = friendships.map((friendship) => {
      const other = friendship.userAId === userId ? friendship.userB : friendship.userA;
      const perCurrency = balancesByFriend.get(other.id);
      const balances: CurrencyAmount[] = perCurrency
        ? [...perCurrency.entries()]
            .filter(([, amount]) => amount !== 0)
            .map(([currency, amount]) => ({ currency, amount }))
            .sort((a, b) => a.currency.localeCompare(b.currency))
        : [];
      const shared = lastSharedAt.get(other.id);
      const lastActivity =
        shared && shared.getTime() > friendship.createdAt.getTime()
          ? shared
          : friendship.createdAt;
      return {
        user: toPublicUser(other),
        balances,
        lastActivityAt: lastActivity.toISOString(),
      };
    });

    friends.sort(
      (a, b) =>
        balanceMagnitude(b.balances) - balanceMagnitude(a.balances) ||
        a.user.name.localeCompare(b.user.name),
    );

    return friends;
  });

  // -- POST /friends — add a friend by exact email ---------------------------
  app.post('/friends', { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = zAddFriendInput.parse(request.body);
    const userId = request.userId;

    const target = await prisma.user.findUnique({
      where: { email: input.email },
      select: publicUserSelect,
    });
    if (!target) {
      throw new AppError(404, 'USER_NOT_FOUND', 'No Divzy account exists with that email');
    }
    if (target.id === userId) {
      throw new AppError(400, 'CANNOT_ADD_SELF', 'You cannot add yourself as a friend');
    }

    const [userAId, userBId] = userId < target.id ? [userId, target.id] : [target.id, userId];
    const existing = await prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
    });

    await ensureFriendshipsAmong([userId, target.id]);

    // Only announce NEW friendships — re-adding is idempotent and silent.
    if (!existing) {
      const actor = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const actorName = actor?.name ?? 'Someone';
      await recordActivity({
        type: 'FRIEND_ADDED',
        actorId: userId,
        data: { friendId: target.id, friendName: target.name },
        recipientIds: [userId, target.id],
        notify: {
          type: 'FRIEND_ADDED',
          title: `${actorName} added you as a friend`,
          body: `You can now split expenses with ${actorName} on Divzy`,
          data: { userId },
        },
      });
    }

    const friendship =
      existing ??
      (await prisma.friendship.findUnique({
        where: { userAId_userBId: { userAId, userBId } },
      }));

    const dto: FriendDto = {
      user: toPublicUser(target),
      balances: [],
      lastActivityAt: friendship ? friendship.createdAt.toISOString() : null,
    };
    return reply.status(201).send(dto);
  });
};

export default routes;
