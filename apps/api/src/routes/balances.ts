import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  computeNets,
  computePairwiseBalances,
  netsForUser,
  suggestSettlements,
  zId,
  type CurrencyAmount,
  type GroupBalancesDto,
  type OverallBalanceDto,
  type PublicUserDto,
} from '@divzy/shared';
import { buildGroupCsv } from '../lib/csv';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { publicUserSelect, toPublicUser } from '../lib/serializers';

const zGroupParams = z.object({ groupId: zId });

/** Membership = GroupMember row with leftAt null. Non-members get 404 (never leak). */
async function assertActiveMember(groupId: string, userId: string): Promise<void> {
  const member = await prisma.groupMember.findFirst({
    where: { groupId, userId, leftAt: null },
    select: { id: true },
  });
  if (!member) throw new AppError(404, 'NOT_FOUND', 'Group not found');
}

/** Ledger inputs for the shared balance engine: one group, soft-deletes excluded. */
async function loadGroupLedger(groupId: string) {
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: { groupId, deletedAt: null },
      select: {
        currency: true,
        payers: { select: { userId: true, amount: true } },
        splits: { select: { userId: true, amount: true } },
      },
    }),
    prisma.settlement.findMany({
      where: { groupId, deletedAt: null },
      select: { currency: true, fromUserId: true, toUserId: true, amount: true },
    }),
  ]);
  return { expenses, settlements };
}

/** Sorted CurrencyAmount list from a currency→amount map, zero entries dropped. */
function toCurrencyAmounts(map: Map<string, number>): CurrencyAmount[] {
  return [...map.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

const routes: FastifyPluginAsync = async (app) => {
  // -- GET /groups/:groupId/balances — full balance sheet for one group -------
  app.get(
    '/groups/:groupId/balances',
    { preHandler: [app.authenticate] },
    async (request): Promise<GroupBalancesDto> => {
      const { groupId } = zGroupParams.parse(request.params);
      await assertActiveMember(groupId, request.userId);

      const [members, { expenses, settlements }] = await Promise.all([
        // ALL memberships (incl. left) so pairwise rows can still name past members.
        prisma.groupMember.findMany({
          where: { groupId },
          include: { user: { select: publicUserSelect } },
          orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        }),
        loadGroupLedger(groupId),
      ]);

      const nets = computeNets(expenses, settlements);
      const pairwise = computePairwiseBalances(expenses, settlements);
      // Always computed; clients decide what to show based on group.simplifyDebts.
      const suggestions = suggestSettlements(nets);

      const userById = new Map<string, PublicUserDto>(
        members.map((m) => [m.userId, toPublicUser(m.user)]),
      );
      const missingIds = new Set<string>();
      for (const d of [...pairwise, ...suggestions]) {
        if (!userById.has(d.fromUserId)) missingIds.add(d.fromUserId);
        if (!userById.has(d.toUserId)) missingIds.add(d.toUserId);
      }
      if (missingIds.size > 0) {
        const extra = await prisma.user.findMany({
          where: { id: { in: [...missingIds] } },
          select: publicUserSelect,
        });
        for (const user of extra) userById.set(user.id, toPublicUser(user));
      }
      const publicUser = (id: string): PublicUserDto =>
        userById.get(id) ?? { id, name: 'Former member', avatarColor: '#898781' };

      return {
        groupId,
        // Every ACTIVE member appears, settled-up ones with empty balances.
        members: members
          .filter((m) => m.leftAt === null)
          .map((m) => ({ user: toPublicUser(m.user), balances: netsForUser(nets, m.userId) })),
        pairwise: pairwise.map((d) => ({
          ...d,
          from: publicUser(d.fromUserId),
          to: publicUser(d.toUserId),
        })),
        suggestions: suggestions.map((s) => ({
          ...s,
          from: publicUser(s.fromUserId),
          to: publicUser(s.toUserId),
        })),
      };
    },
  );

  // -- GET /balance — the caller's overall position across everything ----------
  app.get(
    '/balance',
    { preHandler: [app.authenticate] },
    async (request): Promise<OverallBalanceDto> => {
      const userId = request.userId;

      const [expenses, settlements] = await Promise.all([
        prisma.expense.findMany({
          where: {
            deletedAt: null,
            OR: [{ payers: { some: { userId } } }, { splits: { some: { userId } } }],
          },
          select: {
            currency: true,
            payers: { select: { userId: true, amount: true } },
            splits: { select: { userId: true, amount: true } },
          },
        }),
        prisma.settlement.findMany({
          where: { deletedAt: null, OR: [{ fromUserId: userId }, { toUserId: userId }] },
          select: { currency: true, fromUserId: true, toUserId: true, amount: true },
        }),
      ]);

      // Pairwise debts as incurred; only the caller's edges matter here (the
      // loaded ledger is complete for every pair that includes the caller).
      const pairwise = computePairwiseBalances(expenses, settlements);
      const owe = new Map<string, number>();
      const owed = new Map<string, number>();
      for (const debt of pairwise) {
        if (debt.fromUserId === userId) {
          owe.set(debt.currency, (owe.get(debt.currency) ?? 0) + debt.amount);
        } else if (debt.toUserId === userId) {
          owed.set(debt.currency, (owed.get(debt.currency) ?? 0) + debt.amount);
        }
      }

      const totals = new Map<string, number>();
      for (const [currency, amount] of owed) totals.set(currency, amount);
      for (const [currency, amount] of owe) {
        totals.set(currency, (totals.get(currency) ?? 0) - amount);
      }

      return {
        totals: toCurrencyAmounts(totals),
        youOwe: toCurrencyAmounts(owe),
        youAreOwed: toCurrencyAmounts(owed),
      };
    },
  );

  // -- GET /groups/:groupId/export.csv — spreadsheet-ready group history --------
  app.get(
    '/groups/:groupId/export.csv',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { groupId } = zGroupParams.parse(request.params);
      await assertActiveMember(groupId, request.userId);

      const group = await prisma.group.findUnique({
        where: { id: groupId },
        select: { name: true },
      });
      if (!group) throw new AppError(404, 'NOT_FOUND', 'Group not found');

      const [members, expenses, settlements] = await Promise.all([
        prisma.groupMember.findMany({
          where: { groupId, leftAt: null },
          include: { user: { select: publicUserSelect } },
          orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        }),
        prisma.expense.findMany({
          where: { groupId, deletedAt: null },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: {
            date: true,
            description: true,
            category: true,
            currency: true,
            amount: true,
            splitType: true,
            payers: {
              select: { userId: true, amount: true, user: { select: { name: true } } },
            },
            splits: { select: { userId: true, amount: true } },
          },
        }),
        prisma.settlement.findMany({
          where: { groupId, deletedAt: null },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: {
            date: true,
            currency: true,
            amount: true,
            fromUserId: true,
            toUserId: true,
            fromUser: { select: { name: true } },
            toUser: { select: { name: true } },
          },
        }),
      ]);

      const csv = buildGroupCsv(
        { name: group.name },
        members.map((m) => ({ id: m.userId, name: m.user.name })),
        expenses.map((e) => ({
          date: e.date,
          description: e.description,
          category: e.category,
          currency: e.currency,
          amount: e.amount,
          splitType: e.splitType,
          payers: e.payers.map((p) => ({ userId: p.userId, name: p.user.name, amount: p.amount })),
          splits: e.splits.map((s) => ({ userId: s.userId, amount: s.amount })),
        })),
        settlements.map((s) => ({
          date: s.date,
          currency: s.currency,
          amount: s.amount,
          fromUserId: s.fromUserId,
          fromName: s.fromUser.name,
          toUserId: s.toUserId,
          toName: s.toUser.name,
        })),
      );

      // ASCII-safe fallback filename plus RFC 5987 UTF-8 variant for non-ASCII names.
      const asciiName =
        group.name
          .replace(/[^\x20-\x7e]/g, '')
          .replace(/[\\/:*?"<>|]/g, '')
          .trim() || 'divzy-group';
      const utf8Name = encodeURIComponent(`${group.name}.csv`).replace(
        /['()*!]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      );
      return reply
        .header(
          'content-disposition',
          `attachment; filename="${asciiName}.csv"; filename*=UTF-8''${utf8Name}`,
        )
        .type('text/csv; charset=utf-8')
        .send(csv);
    },
  );
};

export default routes;
