import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  computeSplits,
  isSupportedCurrency,
  zCreateRecurringInput,
  zExpenseParticipantInput,
  zExpensePayerInput,
  zId,
  zUpdateRecurringInput,
} from '@divzy/shared';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { recurringInclude, toRecurringDto, type RecurringWithRelations } from '../lib/serializers';

const zRecurringParams = z.object({ recurringId: zId });

const zStoredPayers = z.array(zExpensePayerInput);
const zStoredParticipants = z.array(zExpenseParticipantInput);

/**
 * Same people-validation as the expenses service (per CONTRACTS §Recurring),
 * re-implemented locally because the expense service keeps it private:
 * - Group: actor + every payer/participant must be ACTIVE members. Actor not
 *   a member → 404 (never leak the group); anyone else → 400 NOT_A_MEMBER.
 * - Non-group: actor must be involved, >= 2 distinct users, all must exist.
 */
async function validateInvolvedUsers(
  actorId: string,
  groupId: string | null,
  involvedIds: string[],
): Promise<void> {
  if (groupId) {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { members: { where: { leftAt: null }, select: { userId: true } } },
    });
    const memberIds = new Set(group?.members.map((m) => m.userId) ?? []);
    if (!group || !memberIds.has(actorId)) {
      throw new AppError(404, 'NOT_FOUND', 'Group not found');
    }
    if (involvedIds.some((id) => !memberIds.has(id))) {
      throw new AppError(
        400,
        'NOT_A_MEMBER',
        'Every payer and participant must be an active member of the group',
      );
    }
    return;
  }

  if (!involvedIds.includes(actorId)) {
    throw new AppError(
      400,
      'NOT_INVOLVED',
      'You must be one of the payers or participants of a non-group recurring expense',
    );
  }
  if (involvedIds.length < 2) {
    throw new AppError(
      400,
      'NOT_ENOUGH_PARTICIPANTS',
      'A shared recurring expense needs at least two distinct people',
    );
  }
  const existing = await prisma.user.findMany({
    where: { id: { in: involvedIds } },
    select: { id: true },
  });
  if (existing.length !== involvedIds.length) {
    throw new AppError(400, 'USER_NOT_FOUND', 'One or more payers/participants do not exist');
  }
}

/**
 * Load a recurring expense the caller is allowed to MUTATE: the creator, or —
 * for group recurring — an active group ADMIN. Invisible rows → 404; visible
 * but not mutable (plain group member) → 403.
 */
async function loadForMutation(
  recurringId: string,
  userId: string,
): Promise<RecurringWithRelations> {
  const row = await prisma.recurringExpense.findUnique({
    where: { id: recurringId },
    include: recurringInclude,
  });
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Recurring expense not found');
  if (row.createdById === userId) return row;

  if (!row.groupId) throw new AppError(404, 'NOT_FOUND', 'Recurring expense not found');
  const membership = await prisma.groupMember.findFirst({
    where: { groupId: row.groupId, userId, leftAt: null },
    select: { role: true },
  });
  if (!membership) throw new AppError(404, 'NOT_FOUND', 'Recurring expense not found');
  if (membership.role !== 'ADMIN') {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Only the creator or a group admin can modify this recurring expense',
    );
  }
  return row;
}

const routes: FastifyPluginAsync = async (app) => {
  // -- GET /recurring — created by the caller + any in the caller's groups ---
  app.get('/recurring', { preHandler: [app.authenticate] }, async (request) => {
    const rows = await prisma.recurringExpense.findMany({
      where: {
        OR: [
          { createdById: request.userId },
          { group: { members: { some: { userId: request.userId, leftAt: null } } } },
        ],
      },
      include: recurringInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toRecurringDto);
  });

  // -- POST /recurring — create a schedule (validated like a real expense) ---
  app.post('/recurring', { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = zCreateRecurringInput.parse(request.body);
    const userId = request.userId;

    if (!isSupportedCurrency(input.currency)) {
      throw new AppError(400, 'UNSUPPORTED_CURRENCY', `Currency ${input.currency} is not supported`);
    }

    const startDate = new Date(input.startDate);
    const endDate = input.endDate ? new Date(input.endDate) : null;
    if (endDate && endDate.getTime() < startDate.getTime()) {
      throw new AppError(400, 'INVALID_DATE_RANGE', 'The end date must be on or after the start date');
    }

    const involvedIds = [
      ...new Set([
        ...input.payers.map((p) => p.userId),
        ...input.participants.map((p) => p.userId),
      ]),
    ];
    await validateInvolvedUsers(userId, input.groupId ?? null, involvedIds);

    // Dry-run the split engine so invalid inputs are rejected NOW, not when
    // the cron job posts the first occurrence. SplitError → 400.
    computeSplits({
      splitType: input.splitType,
      amount: input.amount,
      participants: input.participants,
    });

    const row = await prisma.recurringExpense.create({
      data: {
        groupId: input.groupId ?? null,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        category: input.category,
        splitType: input.splitType,
        payers: input.payers as unknown as Prisma.InputJsonValue,
        participants: input.participants as unknown as Prisma.InputJsonValue,
        notes: input.notes ?? null,
        frequency: input.frequency,
        nextRunAt: startDate,
        endDate,
        createdById: userId,
      },
      include: recurringInclude,
    });

    return reply.status(201).send(toRecurringDto(row));
  });

  // -- PATCH /recurring/:id — creator or group admin ---------------------------
  app.patch('/recurring/:recurringId', { preHandler: [app.authenticate] }, async (request) => {
    const { recurringId } = zRecurringParams.parse(request.params);
    const input = zUpdateRecurringInput.parse(request.body);
    const row = await loadForMutation(recurringId, request.userId);

    const data: Prisma.RecurringExpenseUpdateInput = {};
    if (input.active !== undefined) data.active = input.active;
    if (input.description !== undefined) data.description = input.description;
    if (input.frequency !== undefined) data.frequency = input.frequency;
    if (input.endDate !== undefined) {
      data.endDate = input.endDate === null ? null : new Date(input.endDate);
    }

    if (input.amount !== undefined && input.amount !== row.amount) {
      const storedPayers = zStoredPayers.parse(row.payers);
      const storedParticipants = zStoredParticipants.parse(row.participants);

      // Payer amounts must keep summing to the total. With a single payer we
      // can rewrite it; with several the caller must recreate the schedule.
      if (storedPayers.length !== 1) {
        throw new AppError(
          400,
          'MULTI_PAYER_AMOUNT',
          'This recurring expense has multiple payers — recreate it to change the amount',
        );
      }
      // Dry-run with the new amount so EXACT/ADJUSTMENT inputs that no longer
      // add up are rejected here instead of failing inside the cron job.
      computeSplits({
        splitType: row.splitType,
        amount: input.amount,
        participants: storedParticipants,
      });

      data.amount = input.amount;
      data.payers = [
        { userId: storedPayers[0]!.userId, amount: input.amount },
      ] as unknown as Prisma.InputJsonValue;
    }

    const updated = await prisma.recurringExpense.update({
      where: { id: row.id },
      data,
      include: recurringInclude,
    });
    return toRecurringDto(updated);
  });

  // -- DELETE /recurring/:id — creator or group admin; hard delete -------------
  app.delete(
    '/recurring/:recurringId',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { recurringId } = zRecurringParams.parse(request.params);
      const row = await loadForMutation(recurringId, request.userId);
      // Hard delete is fine: posted expenses keep history via their own rows
      // (Expense.recurringExpenseId is ON DELETE SET NULL).
      await prisma.recurringExpense.delete({ where: { id: row.id } });
      return reply.status(204).send();
    },
  );
};

export default routes;
