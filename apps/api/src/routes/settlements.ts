import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  computeNets,
  computePairwiseBalances,
  formatMoney,
  isSupportedCurrency,
  zCreateSettlementInput,
  zId,
  zListSettlementsQuery,
  type CreateSettlementInput,
} from '@divzy/shared';
import { recordActivity } from '../lib/activity';
import { bumpGroupGeneration, bumpUsers } from '../lib/cache';
import { AppError } from '../lib/errors';
import { loadGroupLedger } from '../lib/ledger';
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

/**
 * Ledger inputs for the pair's full cross-context balance (no `groupId`
 * scope) — matches how `GET /balance` aggregates. `deletedAt: null` on both
 * (ARCH invariant 6). Only expenses where BOTH parties have a stake (payer or
 * split) can create an A<->B pairwise debt.
 */
async function loadPairLedger(a: string, b: string) {
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: {
        deletedAt: null,
        AND: [
          { OR: [{ payers: { some: { userId: a } } }, { splits: { some: { userId: a } } }] },
          { OR: [{ payers: { some: { userId: b } } }, { splits: { some: { userId: b } } }] },
        ],
      },
      select: {
        currency: true,
        payers: { select: { userId: true, amount: true } },
        splits: { select: { userId: true, amount: true } },
      },
    }),
    prisma.settlement.findMany({
      where: { deletedAt: null, OR: betweenUsers(a, b) },
      select: { currency: true, fromUserId: true, toUserId: true, amount: true },
    }),
  ]);
  return { expenses, settlements };
}

/**
 * WI-012 (revised cycle 1, ADR-010) / WI-013 (revised, ADR-011): the last
 * validation before `prisma.settlement.create` — bounds the request to the
 * real, per-currency, direction-aware outstanding balance. The two scopes use
 * two different, each individually correct, representations (defect-WI-012.md;
 * ADR-010; ADR-011):
 *
 * - Group-scoped (`input.groupId` present): bounded by
 *   `max(netCeiling, bilateral)` (ADR-011) —
 *   `netCeiling` is **net-position reachability** over that group's own
 *   ledger (the same basis `suggestSettlements`/`simplifyDebts` use), and
 *   `bilateral` is the pair's own `computePairwiseBalances` entry within that
 *   same group ledger (the exact, as-incurred debt WI-013 makes individually
 *   actionable via the "Simplify debts" toggle OFF). Net reachability and
 *   bilateral pairwise debt are NOT point-wise comparable — a debt chain can
 *   make the net ceiling *tighter* than a genuinely-owed bilateral debt — so
 *   the union (max) is required: every min-cash-flow suggestion (which need
 *   not have a bilateral pairwise entry in a 3+-member debt chain) remains
 *   recordable via `netCeiling`, AND every real, incurred pairwise debt
 *   remains recordable via `bilateral`, even when it exceeds `netCeiling`.
 *   Partial payments included; a pair with neither a net relationship nor a
 *   bilateral debt, or an amount beyond both, still rejects.
 * - Non-group (`input.groupId` absent): unchanged — bounded by the pair's
 *   bilateral, cross-context `computePairwiseBalances`, matching what
 *   `GET /balance`/`FriendDto` expose (no min-cash-flow is ever surfaced for
 *   a friend pair, so there is no chain mismatch there).
 *
 * Never reads the WI-001 converted display figure (ARCH invariant 5).
 */
async function assertWithinOutstanding(input: CreateSettlementInput): Promise<void> {
  if (input.groupId) {
    const { expenses, settlements } = await loadGroupLedger(input.groupId);
    const nets = computeNets(expenses, settlements);
    const netP = nets.get(input.currency)?.get(input.fromUserId) ?? 0;
    const netR = nets.get(input.currency)?.get(input.toUserId) ?? 0;
    const netCeiling = netP < 0 && netR > 0 ? Math.min(-netP, netR) : 0;

    const pairwise = computePairwiseBalances(expenses, settlements);
    const bilateral =
      pairwise.find(
        (d) =>
          d.currency === input.currency &&
          d.fromUserId === input.fromUserId &&
          d.toUserId === input.toUserId,
      )?.amount ?? 0;

    const settleable = Math.max(netCeiling, bilateral);

    if (settleable <= 0) {
      throw new AppError(
        400,
        'NO_OUTSTANDING_BALANCE',
        'You have nothing outstanding to record with this person in this group',
      );
    }
    if (input.amount > settleable) {
      throw new AppError(
        400,
        'EXCEEDS_BALANCE',
        `Only ${formatMoney(settleable, input.currency)} is outstanding`,
      );
    }
    return;
  }

  const { expenses, settlements } = await loadPairLedger(input.fromUserId, input.toUserId);
  const pairwise = computePairwiseBalances(expenses, settlements);
  const debt = pairwise.find(
    (d) =>
      d.currency === input.currency &&
      d.fromUserId === input.fromUserId &&
      d.toUserId === input.toUserId,
  );

  if (!debt) {
    throw new AppError(
      400,
      'NO_OUTSTANDING_BALANCE',
      'You have nothing outstanding to record with this person',
    );
  }
  if (debt.amount < input.amount) {
    throw new AppError(
      400,
      'EXCEEDS_BALANCE',
      `Only ${formatMoney(debt.amount, input.currency)} is outstanding`,
    );
  }
}

/**
 * Shared delete/restore authz (ADR-028 D2, extracted verbatim from the
 * DELETE handler's former inline block, `settlements.ts:315-344` at the time
 * of extraction) so the two mutation routes cannot silently drift. `isParty`
 * = payer/recipient/creator; if not a party and the settlement is
 * group-scoped, an active group ADMIN is also allowed — a visible non-admin
 * active member gets an explicit 403, and no/inactive membership falls
 * through to the shared 404 (existence never leaks). Runs identically
 * regardless of `deletedAt` — callers load the row with whatever filter is
 * appropriate for their own visibility rule before calling this.
 */
async function assertCanMutateSettlement(
  settlement: {
    fromUserId: string;
    toUserId: string;
    createdById: string;
    groupId: string | null;
  },
  userId: string,
): Promise<void> {
  const isParty =
    userId === settlement.fromUserId ||
    userId === settlement.toUserId ||
    userId === settlement.createdById;

  let canMutate = isParty;
  if (!canMutate && settlement.groupId) {
    const member = await prisma.groupMember.findFirst({
      where: { groupId: settlement.groupId, userId, leftAt: null },
      select: { role: true },
    });
    if (member?.role === 'ADMIN') {
      canMutate = true;
    } else if (member) {
      // Visible non-admin member: explicit 403 (unchanged behavior).
      throw new AppError(
        403,
        'FORBIDDEN',
        'Only the payer, recipient, creator, or a group admin can delete or restore a settlement',
      );
    }
    // member === null -> fall through to the shared 404 below (existence never leaks).
  }
  if (!canMutate) {
    throw new AppError(404, 'NOT_FOUND', 'Settlement not found');
  }
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

  // -- GET /settlements/:settlementId — single-settlement detail (WI-039b) -----
  // DRB condition 2: NO `deletedAt` filter — a soft-deleted settlement returns
  // 200 with `deletedAt` populated, never 404 (do not repeat loadVisibleExpense's
  // anti-pattern, apps/api/src/routes/expenses.ts:45-46). Visibility authz mirrors
  // the list route above and runs identically regardless of `deletedAt`.
  app.get('/settlements/:settlementId', { preHandler: [app.authenticate] }, async (request) => {
    const { settlementId } = zSettlementParams.parse(request.params);
    const userId = request.userId;

    const settlement = await prisma.settlement.findUnique({
      where: { id: settlementId },
      include: settlementInclude,
    });
    if (!settlement) throw new AppError(404, 'NOT_FOUND', 'Settlement not found');

    if (settlement.groupId) {
      await assertActiveMember(settlement.groupId, userId);
    } else {
      const isVisible =
        userId === settlement.fromUserId ||
        userId === settlement.toUserId ||
        userId === settlement.createdById;
      if (!isVisible) throw new AppError(404, 'NOT_FOUND', 'Settlement not found');
    }

    return toSettlementDto(settlement);
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

    await assertWithinOutstanding(input);

    const settlement = await prisma.settlement.create({
      data: {
        groupId: input.groupId ?? null,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        amount: input.amount,
        currency: input.currency,
        method: input.method,
        note: input.note ?? null,
        proofUrl: input.proofUrl ?? null,
        date: new Date(input.date),
        createdById: userId,
      },
      include: settlementInclude,
    });

    // WI-067 / ADR-030 site S1: bump BOTH parties, not just the actor.
    bumpUsers([input.fromUserId, input.toUserId]);
    // WI-071 / ADR-031: additive group-wide invalidation for group-balances,
    // reaching uninvolved active members that bumpUsers structurally misses.
    if (input.groupId) bumpGroupGeneration(input.groupId);

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

      // WI-039b / ADR-023 (additive, group case ONLY — DRB condition 3): an
      // active group ADMIN may also delete, on top of the existing party
      // capability. Direct-settlement authz is byte-for-byte unchanged.
      // Extracted to `assertCanMutateSettlement` (ADR-028 D2) so restore
      // reuses the identical rule — no behavior change here.
      await assertCanMutateSettlement(settlement, userId);

      await prisma.settlement.update({
        where: { id: settlementId },
        data: { deletedAt: new Date() },
      });

      // WI-067 / ADR-030 site S2: bump BOTH parties (not the actor unless
      // they happen to be one — e.g. a group-admin-only delete never bumps
      // the admin).
      bumpUsers([settlement.fromUserId, settlement.toUserId]);
      // WI-071 / ADR-031: additive group-wide invalidation for group-balances.
      if (settlement.groupId) bumpGroupGeneration(settlement.groupId);

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

  // -- POST /settlements/:settlementId/restore — undo a soft delete (spec-WI-054b) --
  // Structural inverse of DELETE: loads WITHOUT a `deletedAt` filter (must
  // find the very row DELETE hides), authz is exactly
  // `assertCanMutateSettlement` (same rule as DELETE — no extra restriction),
  // and restoring an already-active settlement is an idempotent 200 no-op:
  // no update, no activity row. Returns 200 + the SettlementDto (DELETE
  // returns 204) to match expenses' shipped `restore` shape.
  app.post(
    '/settlements/:settlementId/restore',
    { preHandler: [app.authenticate] },
    async (request) => {
      const { settlementId } = zSettlementParams.parse(request.params);
      const userId = request.userId;

      const settlement = await prisma.settlement.findUnique({
        where: { id: settlementId },
        include: settlementInclude,
      });
      if (!settlement) throw new AppError(404, 'NOT_FOUND', 'Settlement not found');

      // Runs identically whether or not the row is deleted — a non-visible
      // caller still gets 404, a visible-unauthorized group member still
      // gets 403, before any idempotency branch below.
      await assertCanMutateSettlement(settlement, userId);

      // Idempotent no-op (ADR-028 D1): already active, nothing to do, no
      // activity row, nothing else touched.
      if (settlement.deletedAt === null) {
        return toSettlementDto(settlement);
      }

      const restored = await prisma.settlement.update({
        where: { id: settlementId },
        data: { deletedAt: null },
        include: settlementInclude,
      });

      // WI-067 / ADR-030 site S3: bump BOTH parties. Placed AFTER the
      // idempotent-no-op early-return above, so restoring an already-active
      // settlement bumps nobody.
      bumpUsers([settlement.fromUserId, settlement.toUserId]);
      // WI-071 / ADR-031: additive group-wide invalidation for group-balances.
      // Same placement as bumpUsers above — after the idempotent no-op.
      if (settlement.groupId) bumpGroupGeneration(settlement.groupId);

      // Recipients recomputed FRESH AT RESTORE TIME (not reused from delete
      // time) — mirrors DELETE's own recipient computation above.
      let recipientIds: string[];
      if (settlement.groupId) {
        const members = await prisma.groupMember.findMany({
          where: { groupId: settlement.groupId, leftAt: null },
          select: { userId: true },
        });
        recipientIds = [
          ...members.map((m) => m.userId),
          settlement.fromUserId,
          settlement.toUserId,
        ];
      } else {
        recipientIds = [settlement.fromUserId, settlement.toUserId];
      }

      // Deliberately no `notify` block — feed-only, no push/email/
      // Notification row (ADR-027 §D4 / ADR-028 D4).
      await recordActivity({
        type: 'SETTLEMENT_RESTORED',
        actorId: userId,
        groupId: settlement.groupId,
        settlementId: settlement.id,
        data: {
          amount: restored.amount,
          currency: restored.currency,
          fromName: restored.fromUser.name,
          toName: restored.toUser.name,
        },
        recipientIds,
      });

      return toSettlementDto(restored);
    },
  );
};

export default routes;
