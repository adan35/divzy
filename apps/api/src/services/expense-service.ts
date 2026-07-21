import type { $Enums } from '@prisma/client';
import {
  computeSplits,
  formatMoney,
  isSupportedCurrency,
  type CreateExpenseInput,
  type ExpenseDto,
  type ExpenseFieldChange,
  type UpdateExpenseInput,
} from '@divzy/shared';
import { recordActivity } from '../lib/activity';
import { bumpGroupGeneration, bumpUsers } from '../lib/cache';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { expenseInclude, toExpenseDto } from '../lib/serializers';
import { ensureFriendshipsAmong } from '../lib/social';

// ---------------------------------------------------------------------------
// Expense domain service (docs/CONTRACTS.md §Expenses).
// All splits are computed server-side via the shared engine; the persisted
// split rows carry BOTH the computed amount and the raw inputs so editing an
// expense round-trips losslessly.
// ---------------------------------------------------------------------------

/** Minimum relation shape needed to decide whether a user may see an expense. */
export interface ExpenseAccessView {
  groupId: string | null;
  createdById: string;
  payers: ReadonlyArray<{ userId: string }>;
  splits: ReadonlyArray<{ userId: string }>;
}

/**
 * Visibility: involved (payer or split participant) OR creator OR — for group
 * expenses — an active member of the group. Fails with 404 (never leak that
 * the expense exists).
 */
export async function assertCanSeeExpense(
  userId: string,
  expense: ExpenseAccessView,
): Promise<void> {
  const involved =
    expense.createdById === userId ||
    expense.payers.some((p) => p.userId === userId) ||
    expense.splits.some((s) => s.userId === userId);
  if (involved) return;

  if (expense.groupId) {
    const member = await prisma.groupMember.findFirst({
      where: { groupId: expense.groupId, userId, leftAt: null },
      select: { id: true },
    });
    if (member) return;
  }

  throw new AppError(404, 'NOT_FOUND', 'Expense not found');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertSupportedCurrency(currency: string): void {
  if (!isSupportedCurrency(currency)) {
    throw new AppError(400, 'UNSUPPORTED_CURRENCY', `Currency ${currency} is not supported`);
  }
}

function collectInvolvedIds(input: {
  payers: Array<{ userId: string }>;
  participants: Array<{ userId: string }>;
}): string[] {
  return [
    ...new Set([...input.payers.map((p) => p.userId), ...input.participants.map((p) => p.userId)]),
  ];
}

/**
 * Validate the people on an expense.
 * - Group expense: the actor and every payer/participant must be ACTIVE
 *   members. Actor not a member → 404 (never leak the group); anyone else
 *   not a member → 400 NOT_A_MEMBER. Recipients = all active members.
 * - Non-group: at least 2 distinct users, all must exist, and (on create)
 *   the actor must be among them. Recipients = the involved users.
 */
async function validateInvolvedUsers(
  actorId: string,
  groupId: string | null,
  involvedIds: string[],
  opts: { requireActorInvolved: boolean },
): Promise<{ recipientIds: string[] }> {
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
    return { recipientIds: [...memberIds] };
  }

  if (opts.requireActorInvolved && !involvedIds.includes(actorId)) {
    throw new AppError(
      400,
      'NOT_INVOLVED',
      'You must be one of the payers or participants of a non-group expense',
    );
  }
  if (involvedIds.length < 2) {
    throw new AppError(
      400,
      'NOT_ENOUGH_PARTICIPANTS',
      'A shared expense needs at least two distinct people',
    );
  }
  const existing = await prisma.user.findMany({
    where: { id: { in: involvedIds } },
    select: { id: true },
  });
  if (existing.length !== involvedIds.length) {
    throw new AppError(400, 'USER_NOT_FOUND', 'One or more payers/participants do not exist');
  }
  return { recipientIds: involvedIds };
}

/**
 * Run the shared split engine and shape the ExpenseSplit rows: computed
 * amount + the raw inputs (shares/percentBps/adjustment) as sent.
 * SplitError bubbles to the global error handler (400 with its code).
 */
function buildSplitRows(input: CreateExpenseInput | UpdateExpenseInput): Array<{
  userId: string;
  amount: number;
  shares: number | null;
  percentBps: number | null;
  adjustment: number | null;
}> {
  const computed = computeSplits({
    splitType: input.splitType,
    amount: input.amount,
    participants: input.participants,
    items: input.items,
  });
  const amountByUser = new Map(computed.map((c) => [c.userId, c.amount]));
  // Persist every participant — even with a computed amount of 0 they were
  // included intentionally (per CONTRACTS).
  return input.participants.map((p) => ({
    userId: p.userId,
    amount: amountByUser.get(p.userId) ?? 0,
    shares: p.shares ?? null,
    percentBps: p.percentBps ?? null,
    adjustment: p.adjustment ?? null,
  }));
}

/** Pre-edit shape of the eight tracked scalar fields (WI-017 §3.2). */
export interface TrackedExpenseFields {
  description: string;
  amount: number;
  currency: string;
  category: $Enums.ExpenseCategory;
  date: Date;
  splitType: $Enums.SplitType;
  notes: string | null;
  receiptUrl: string | null;
}

/**
 * Pure diff of the eight top-level tracked scalar fields, old (DB) vs new
 * (input). Returns [] when nothing tracked changed — used to suppress
 * no-op revision rows even though payers/splits/items are always replaced
 * wholesale on update (spec §3.3-§3.4).
 */
export function diffTrackedFields(
  existing: TrackedExpenseFields,
  input: UpdateExpenseInput,
): ExpenseFieldChange[] {
  const changes: ExpenseFieldChange[] = [];

  if (existing.description !== input.description) {
    changes.push({ field: 'description', from: existing.description, to: input.description });
  }
  if (existing.amount !== input.amount) {
    changes.push({
      field: 'amount',
      from: existing.amount,
      fromCurrency: existing.currency,
      to: input.amount,
      toCurrency: input.currency,
    });
  }
  if (existing.currency !== input.currency) {
    changes.push({ field: 'currency', from: existing.currency, to: input.currency });
  }
  if (existing.category !== input.category) {
    changes.push({ field: 'category', from: existing.category, to: input.category });
  }
  if (new Date(input.date).getTime() !== existing.date.getTime()) {
    changes.push({
      field: 'date',
      from: existing.date.toISOString(),
      to: new Date(input.date).toISOString(),
    });
  }
  if (existing.splitType !== input.splitType) {
    changes.push({ field: 'splitType', from: existing.splitType, to: input.splitType });
  }

  const existingNotes = existing.notes ?? null;
  const nextNotes = input.notes ?? null;
  if (existingNotes !== nextNotes) {
    changes.push({
      field: 'notes',
      change: existingNotes === null ? 'added' : nextNotes === null ? 'removed' : 'changed',
    });
  }

  const existingReceiptUrl = existing.receiptUrl ?? null;
  const nextReceiptUrl = input.receiptUrl ?? null;
  if (existingReceiptUrl !== nextReceiptUrl) {
    changes.push({
      field: 'receiptUrl',
      change:
        existingReceiptUrl === null ? 'added' : nextReceiptUrl === null ? 'removed' : 'changed',
    });
  }

  return changes;
}

async function getActorName(actorId: string): Promise<string> {
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { name: true },
  });
  return actor?.name ?? 'Someone';
}

function participantsPhrase(count: number): string {
  return count === 1 ? '1 person' : `${count} people`;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createExpense(
  actorId: string,
  input: CreateExpenseInput,
  opts?: { recurringExpenseId?: string },
): Promise<ExpenseDto> {
  assertSupportedCurrency(input.currency);

  const groupId = input.groupId ?? null;
  const involvedIds = collectInvolvedIds(input);
  const { recipientIds } = await validateInvolvedUsers(actorId, groupId, involvedIds, {
    requireActorInvolved: true,
  });

  const splitRows = buildSplitRows(input);

  // Nested createMany writes are atomic — the expense and all of its payer/
  // split/item rows land in one transaction.
  const expense = await prisma.expense.create({
    data: {
      groupId,
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      category: input.category,
      date: new Date(input.date),
      splitType: input.splitType,
      notes: input.notes ?? null,
      receiptUrl: input.receiptUrl ?? null,
      createdById: actorId,
      recurringExpenseId: opts?.recurringExpenseId ?? null,
      revisions: { create: { actorId, kind: 'CREATED', changes: [] } },
      payers: {
        createMany: { data: input.payers.map((p) => ({ userId: p.userId, amount: p.amount })) },
      },
      splits: { createMany: { data: splitRows } },
      items:
        input.splitType === 'ITEMIZED' && input.items
          ? {
              createMany: {
                data: input.items.map((i) => ({
                  name: i.name,
                  amount: i.amount,
                  participantIds: i.participantIds,
                })),
              },
            }
          : undefined,
    },
    include: expenseInclude,
  });

  // WI-067 / ADR-030 site E1: invalidate every payer/participant's cached
  // /balance and /analytics/summary — not just the actor. Placed here (not
  // the route) so the recurring job (which calls createExpense directly,
  // bypassing the route) is covered for free.
  bumpUsers(involvedIds);
  if (groupId) bumpGroupGeneration(groupId);

  await ensureFriendshipsAmong(involvedIds);

  const isRecurringPost = Boolean(opts?.recurringExpenseId);
  const type: $Enums.ActivityType = isRecurringPost ? 'RECURRING_POSTED' : 'EXPENSE_ADDED';
  const notifyType: $Enums.NotificationType = isRecurringPost
    ? 'RECURRING_POSTED'
    : 'EXPENSE_ADDED';
  const actorName = await getActorName(actorId);

  await recordActivity({
    type,
    actorId,
    groupId,
    expenseId: expense.id,
    data: { description: input.description, amount: input.amount, currency: input.currency },
    recipientIds,
    notify: {
      type: notifyType,
      title: isRecurringPost
        ? `Recurring expense '${input.description}' was posted`
        : `${actorName} added '${input.description}'`,
      body: `Total ${formatMoney(input.amount, input.currency)} split between ${participantsPhrase(
        input.participants.length,
      )}`,
      data: { expenseId: expense.id, groupId },
    },
  });

  return toExpenseDto(expense);
}

// ---------------------------------------------------------------------------
// Update (full replacement of the splittable payload)
// ---------------------------------------------------------------------------

export async function updateExpense(
  actorId: string,
  expenseId: string,
  input: UpdateExpenseInput,
): Promise<ExpenseDto> {
  const existing = await prisma.expense.findFirst({
    where: { id: expenseId, deletedAt: null },
    select: {
      id: true,
      groupId: true,
      createdById: true,
      payers: { select: { userId: true } },
      splits: { select: { userId: true } },
      description: true,
      amount: true,
      currency: true,
      category: true,
      date: true,
      splitType: true,
      notes: true,
      receiptUrl: true,
    },
  });
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Expense not found');
  await assertCanSeeExpense(actorId, existing);

  assertSupportedCurrency(input.currency);
  const involvedIds = collectInvolvedIds(input);
  const { recipientIds } = await validateInvolvedUsers(actorId, existing.groupId, involvedIds, {
    requireActorInvolved: false,
  });

  const splitRows = buildSplitRows(input);
  const changes = diffTrackedFields(existing, input);

  // Atomic replacement: nested deleteMany runs before createMany inside the
  // same Prisma write, so payers/splits/items are swapped in one transaction.
  const expense = await prisma.expense.update({
    where: { id: expenseId },
    data: {
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      category: input.category,
      date: new Date(input.date),
      splitType: input.splitType,
      notes: input.notes ?? null,
      receiptUrl: input.receiptUrl ?? null,
      updatedById: actorId,
      ...(changes.length > 0
        ? { revisions: { create: { actorId, kind: 'UPDATED', changes } } }
        : {}),
      payers: {
        deleteMany: {},
        createMany: { data: input.payers.map((p) => ({ userId: p.userId, amount: p.amount })) },
      },
      splits: { deleteMany: {}, createMany: { data: splitRows } },
      items: {
        deleteMany: {},
        ...(input.splitType === 'ITEMIZED' && input.items
          ? {
              createMany: {
                data: input.items.map((i) => ({
                  name: i.name,
                  amount: i.amount,
                  participantIds: i.participantIds,
                })),
              },
            }
          : {}),
      },
    },
    include: expenseInclude,
  });

  // Non-group: users edited OFF the expense should still learn about it.
  const previousInvolved = [
    ...existing.payers.map((p) => p.userId),
    ...existing.splits.map((s) => s.userId),
  ];

  // WI-067 / ADR-030 site E2: bump the UNION of OLD and NEW payers/splits —
  // a user REMOVED from the expense must also be invalidated, not just the
  // people left on it after the edit.
  bumpUsers([...previousInvolved, ...involvedIds]);
  if (existing.groupId) bumpGroupGeneration(existing.groupId);

  await ensureFriendshipsAmong(involvedIds);
  const activityRecipients = existing.groupId
    ? recipientIds
    : [...new Set([...recipientIds, ...previousInvolved, existing.createdById])];

  const actorName = await getActorName(actorId);
  await recordActivity({
    type: 'EXPENSE_UPDATED',
    actorId,
    groupId: existing.groupId,
    expenseId,
    data: { description: input.description, amount: input.amount, currency: input.currency },
    recipientIds: activityRecipients,
    notify: {
      type: 'EXPENSE_UPDATED',
      title: `${actorName} updated '${input.description}'`,
      body: `Total is now ${formatMoney(input.amount, input.currency)}`,
      data: { expenseId, groupId: existing.groupId },
    },
  });

  return toExpenseDto(expense);
}

// ---------------------------------------------------------------------------
// Delete (soft)
// ---------------------------------------------------------------------------

export async function deleteExpense(actorId: string, expenseId: string): Promise<void> {
  const existing = await prisma.expense.findFirst({
    where: { id: expenseId, deletedAt: null },
    select: {
      id: true,
      groupId: true,
      createdById: true,
      description: true,
      amount: true,
      currency: true,
      payers: { select: { userId: true } },
      splits: { select: { userId: true } },
    },
  });
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Expense not found');
  await assertCanSeeExpense(actorId, existing);

  await prisma.expense.update({
    where: { id: expenseId },
    data: { deletedAt: new Date(), updatedById: actorId },
  });

  // WI-067 / ADR-030 site E3: invalidate every payer/split participant.
  bumpUsers([...existing.payers.map((p) => p.userId), ...existing.splits.map((s) => s.userId)]);
  if (existing.groupId) bumpGroupGeneration(existing.groupId);

  const recipientIds = existing.groupId
    ? (
        await prisma.groupMember.findMany({
          where: { groupId: existing.groupId, leftAt: null },
          select: { userId: true },
        })
      ).map((m) => m.userId)
    : [
        ...new Set([
          ...existing.payers.map((p) => p.userId),
          ...existing.splits.map((s) => s.userId),
          existing.createdById,
        ]),
      ];

  const actorName = await getActorName(actorId);
  await recordActivity({
    type: 'EXPENSE_DELETED',
    actorId,
    groupId: existing.groupId,
    expenseId,
    data: {
      description: existing.description,
      amount: existing.amount,
      currency: existing.currency,
    },
    recipientIds,
    notify: {
      type: 'EXPENSE_DELETED',
      title: `${actorName} deleted '${existing.description}'`,
      body: `${formatMoney(existing.amount, existing.currency)} was removed`,
      data: { expenseId, groupId: existing.groupId },
    },
  });
}

// ---------------------------------------------------------------------------
// Restore (undo a soft delete) — ADR-027 D6 / spec-WI-054b
// ---------------------------------------------------------------------------

/**
 * Structural inverse of `deleteExpense`. Two deliberate departures from
 * delete: (1) it loads with NO `deletedAt` filter — it must find the very
 * rows delete hides; (2) it returns the updated `ExpenseDto` (delete returns
 * void). Authz is exactly `assertCanSeeExpense`, same as delete — no
 * creator/admin restriction. Restoring an already-active expense is an
 * idempotent 200 no-op: no second `EXPENSE_RESTORED` row, no other field
 * touched.
 */
export async function restoreExpense(actorId: string, expenseId: string): Promise<ExpenseDto> {
  const existing = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: expenseInclude,
  });
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Expense not found');
  await assertCanSeeExpense(actorId, existing);

  // Idempotent no-op: already active, nothing to do, no activity row.
  if (existing.deletedAt === null) {
    return toExpenseDto(existing);
  }

  const restored = await prisma.expense.update({
    where: { id: expenseId },
    data: { deletedAt: null, updatedById: actorId },
    include: expenseInclude,
  });

  // WI-067 / ADR-030 site E4: invalidate every payer/split participant.
  // Placed AFTER the idempotent-no-op early-return above, so restoring an
  // already-active expense bumps nobody (spec §4.1 note).
  bumpUsers([...existing.payers.map((p) => p.userId), ...existing.splits.map((s) => s.userId)]);
  if (existing.groupId) bumpGroupGeneration(existing.groupId);

  // Recipients recomputed AT RESTORE TIME (not reused from delete time) —
  // same intentional per-recipient asymmetry `deleteExpense` relies on.
  const recipientIds = existing.groupId
    ? (
        await prisma.groupMember.findMany({
          where: { groupId: existing.groupId, leftAt: null },
          select: { userId: true },
        })
      ).map((m) => m.userId)
    : [
        ...new Set([
          ...existing.payers.map((p) => p.userId),
          ...existing.splits.map((s) => s.userId),
          existing.createdById,
        ]),
      ];

  // Deliberately no `notify` block — feed-only, no push/email/Notification
  // row (ADR-027 D4).
  await recordActivity({
    type: 'EXPENSE_RESTORED',
    actorId,
    groupId: existing.groupId,
    expenseId,
    data: {
      description: restored.description,
      amount: restored.amount,
      currency: restored.currency,
    },
    recipientIds,
  });

  return toExpenseDto(restored);
}
