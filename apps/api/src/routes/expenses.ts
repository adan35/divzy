import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  zCreateCommentInput,
  zCreateExpenseInput,
  zId,
  zListExpensesQuery,
  zUpdateExpenseInput,
  zUsedCategoriesQuery,
} from '@divzy/shared';
import { recordActivity } from '../lib/activity';
import { AppError } from '../lib/errors';
import { enrichExpensesWithConverted } from '../lib/expense-conversion';
import { paginate } from '../lib/pagination';
import { prisma } from '../lib/prisma';
import {
  commentInclude,
  expenseInclude,
  expenseRevisionInclude,
  toCommentDto,
  toExpenseDto,
  toExpenseRevisionDto,
  type ExpenseWithRelations,
} from '../lib/serializers';
import {
  assertCanSeeExpense,
  createExpense,
  deleteExpense,
  restoreExpense,
  updateExpense,
} from '../services/expense-service';

const zExpenseParams = z.object({ expenseId: zId });

/** Expenses where this user appears among payers or split participants. */
function involvementFilter(userId: string): Prisma.ExpenseWhereInput {
  return { OR: [{ payers: { some: { userId } } }, { splits: { some: { userId } } }] };
}

/** Load a non-deleted expense with full relations, enforcing visibility (404 otherwise). */
async function loadVisibleExpense(
  expenseId: string,
  userId: string,
): Promise<ExpenseWithRelations> {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, deletedAt: null },
    include: expenseInclude,
  });
  if (!expense) throw new AppError(404, 'NOT_FOUND', 'Expense not found');
  await assertCanSeeExpense(userId, expense);
  return expense;
}

const routes: FastifyPluginAsync = async (app) => {
  // -- GET /expenses — cursor-paginated list, scoped per CONTRACTS ----------
  app.get('/expenses', { preHandler: [app.authenticate] }, async (request) => {
    const query = zListExpensesQuery.parse(request.query);
    const userId = request.userId;

    const where: Prisma.ExpenseWhereInput = { deletedAt: null };
    const and: Prisma.ExpenseWhereInput[] = [];

    if (query.groupId) {
      // Scope: one group — caller must be an active member (404 otherwise).
      const member = await prisma.groupMember.findFirst({
        where: { groupId: query.groupId, userId, leftAt: null },
        select: { id: true },
      });
      if (!member) throw new AppError(404, 'NOT_FOUND', 'Group not found');
      where.groupId = query.groupId;
    } else if (query.friendId) {
      // Scope: shared with a friend — BOTH users appear in payers ∪ splits
      // (any group or none).
      and.push(involvementFilter(userId), involvementFilter(query.friendId));
    } else {
      // Scope: all of the caller's expenses (involved or created by them).
      and.push({
        OR: [
          { payers: { some: { userId } } },
          { splits: { some: { userId } } },
          { createdById: userId },
        ],
      });
    }

    if (query.category) where.category = query.category;
    if (query.search) where.description = { contains: query.search, mode: 'insensitive' };
    if (and.length > 0) where.AND = and;

    const rows = await prisma.expense.findMany({
      where,
      include: expenseInclude,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const { items, nextCursor } = paginate(rows, query.limit);
    const dtos = await enrichExpensesWithConverted(items.map(toExpenseDto), userId);
    return { items: dtos, nextCursor };
  });

  // -- GET /expenses/used-categories — cheap distinct-category aggregate (WI-032) --
  app.get(
    '/expenses/used-categories',
    { preHandler: [app.authenticate] },
    async (request) => {
      const { groupId, friendId } = zUsedCategoriesQuery.parse(request.query);
      const userId = request.userId;

      const where: Prisma.ExpenseWhereInput = { deletedAt: null };
      if (groupId) {
        // Same active-member-or-404 gate as GET /expenses?groupId= (no existence leak).
        const member = await prisma.groupMember.findFirst({
          where: { groupId, userId, leftAt: null },
          select: { id: true },
        });
        if (!member) throw new AppError(404, 'NOT_FOUND', 'Group not found');
        where.groupId = groupId;
      } else if (friendId) {
        // friendId: same scope/gate as GET /expenses?friendId= — both users involved.
        where.AND = [involvementFilter(userId), involvementFilter(friendId)];
      } else {
        // WI-064 unscoped: the exact population GET /expenses' default branch returns —
        // every expense the caller is involved in or created, across all contexts.
        where.OR = [
          { payers: { some: { userId } } },
          { splits: { some: { userId } } },
          { createdById: userId },
        ];
      }

      const rows = await prisma.expense.groupBy({ by: ['category'], where });
      return { categories: rows.map((r) => r.category) };
    },
  );

  // -- POST /expenses ---------------------------------------------------------
  app.post('/expenses', { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = zCreateExpenseInput.parse(request.body);
    const dto = await createExpense(request.userId, input);
    const [enriched] = await enrichExpensesWithConverted([dto], request.userId);
    return reply.status(201).send(enriched);
  });

  // -- GET /expenses/:expenseId ------------------------------------------------
  // NO `deletedAt` filter (ADR-027 D6 / ADR-023 precedent): a soft-deleted-but-
  // visible expense returns 200 with `deletedAt` populated, never 404. The
  // visibility gate (assertCanSeeExpense) is unchanged and still governs
  // 404-vs-200.
  app.get('/expenses/:expenseId', { preHandler: [app.authenticate] }, async (request) => {
    const { expenseId } = zExpenseParams.parse(request.params);
    const expense = await prisma.expense.findUnique({
      where: { id: expenseId },
      include: expenseInclude,
    });
    if (!expense) throw new AppError(404, 'NOT_FOUND', 'Expense not found');
    await assertCanSeeExpense(request.userId, expense);
    const [enriched] = await enrichExpensesWithConverted([toExpenseDto(expense)], request.userId);
    return enriched;
  });

  // -- PATCH /expenses/:expenseId — full replacement of the payload fields ------
  app.patch('/expenses/:expenseId', { preHandler: [app.authenticate] }, async (request) => {
    const { expenseId } = zExpenseParams.parse(request.params);
    const input = zUpdateExpenseInput.parse(request.body);
    const dto = await updateExpense(request.userId, expenseId, input);
    const [enriched] = await enrichExpensesWithConverted([dto], request.userId);
    return enriched;
  });

  // -- DELETE /expenses/:expenseId — soft delete ---------------------------------
  app.delete('/expenses/:expenseId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { expenseId } = zExpenseParams.parse(request.params);
    await deleteExpense(request.userId, expenseId);
    return reply.status(204).send();
  });

  // -- POST /expenses/:expenseId/restore — undo a soft delete (ADR-027 D6) ------
  app.post('/expenses/:expenseId/restore', { preHandler: [app.authenticate] }, async (request) => {
    const { expenseId } = zExpenseParams.parse(request.params);
    const dto = await restoreExpense(request.userId, expenseId);
    const [enriched] = await enrichExpensesWithConverted([dto], request.userId);
    return enriched;
  });

  // -- GET /expenses/:expenseId/history -------------------------------------------
  app.get('/expenses/:expenseId/history', { preHandler: [app.authenticate] }, async (request) => {
    const { expenseId } = zExpenseParams.parse(request.params);
    await loadVisibleExpense(expenseId, request.userId);
    const rows = await prisma.expenseRevision.findMany({
      where: { expenseId },
      include: expenseRevisionInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toExpenseRevisionDto);
  });

  // -- GET /expenses/:expenseId/comments ------------------------------------------
  app.get('/expenses/:expenseId/comments', { preHandler: [app.authenticate] }, async (request) => {
    const { expenseId } = zExpenseParams.parse(request.params);
    await loadVisibleExpense(expenseId, request.userId);
    const comments = await prisma.comment.findMany({
      where: { expenseId, deletedAt: null },
      include: commentInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return comments.map(toCommentDto);
  });

  // -- POST /expenses/:expenseId/comments -------------------------------------------
  app.post(
    '/expenses/:expenseId/comments',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { expenseId } = zExpenseParams.parse(request.params);
      const input = zCreateCommentInput.parse(request.body);
      const expense = await loadVisibleExpense(expenseId, request.userId);

      const comment = await prisma.comment.create({
        data: { expenseId, authorId: request.userId, body: input.body },
        include: commentInclude,
      });

      // Recipients: everyone involved on the expense ∪ everyone who commented.
      const commenters = await prisma.comment.findMany({
        where: { expenseId, deletedAt: null },
        distinct: ['authorId'],
        select: { authorId: true },
      });
      const recipientIds = [
        ...new Set([
          expense.createdById,
          ...expense.payers.map((p) => p.userId),
          ...expense.splits.map((s) => s.userId),
          ...commenters.map((c) => c.authorId),
        ]),
      ];

      const preview = input.body.length > 120 ? `${input.body.slice(0, 117)}...` : input.body;
      await recordActivity({
        type: 'COMMENT_ADDED',
        actorId: request.userId,
        groupId: expense.groupId,
        expenseId,
        data: { description: expense.description, body: preview },
        recipientIds,
        notify: {
          type: 'COMMENT_ADDED',
          title: `${comment.author.name} commented on '${expense.description}'`,
          body: preview,
          data: { expenseId, groupId: expense.groupId },
        },
      });

      return reply.status(201).send(toCommentDto(comment));
    },
  );
};

export default routes;
