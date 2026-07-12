import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma, type $Enums, type GroupMember } from '@prisma/client';
import {
  GROUP_TYPES,
  computeNets,
  isSupportedCurrency,
  netsForUser,
  zAddMemberInput,
  zCreateGroupInput,
  zId,
  zJoinGroupInput,
  zUpdateGroupInput,
  zUpdateMemberInput,
  type CreateGroupInput,
  type GroupDto,
  type GroupSummaryDto,
  type LedgerExpense,
  type LedgerSettlement,
} from '@divzy/shared';
import { recordActivity } from '../lib/activity';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import {
  groupInclude,
  publicUserSelect,
  toGroupDto,
  type GroupWithRelations,
} from '../lib/serializers';
import { ensureFriendshipsAmong } from '../lib/social';

const zGroupParams = z.object({ groupId: zId });
const zMemberParams = z.object({ groupId: zId, userId: zId });

// ---------------------------------------------------------------------------
// Invite codes — 10 chars from the base32 alphabet A-Z2-7, crypto random.
// 256 % 32 === 0, so byte % 32 is uniform.
// ---------------------------------------------------------------------------

const INVITE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const INVITE_CODE_LENGTH = 10;
const INVITE_CODE_ATTEMPTS = 5;

function generateInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
  return code;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function defaultEmojiForType(type: CreateGroupInput['type']): string {
  return GROUP_TYPES.find((t) => t.key === type)?.emoji ?? '🧾';
}

// ---------------------------------------------------------------------------
// Membership helpers. Membership = GroupMember row with leftAt null.
// Non-members get 404 (never leak that a group exists).
// ---------------------------------------------------------------------------

async function assertActiveMember(groupId: string, userId: string): Promise<GroupMember> {
  const member = await prisma.groupMember.findFirst({
    where: { groupId, userId, leftAt: null },
  });
  if (!member) throw new AppError(404, 'NOT_FOUND', 'Group not found');
  return member;
}

async function assertAdmin(groupId: string, userId: string): Promise<GroupMember> {
  const member = await assertActiveMember(groupId, userId);
  if (member.role !== 'ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Only group admins can do this');
  }
  return member;
}

async function loadGroupDto(groupId: string): Promise<GroupDto> {
  const group = await prisma.group.findUnique({ where: { id: groupId }, include: groupInclude });
  if (!group) throw new AppError(404, 'NOT_FOUND', 'Group not found');
  return toGroupDto(group);
}

/** Non-deleted expenses (payers+splits) and settlements of one group, for the balance engine. */
async function loadGroupLedger(
  groupId: string,
): Promise<{ expenses: LedgerExpense[]; settlements: LedgerSettlement[] }> {
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

/** 409 OUTSTANDING_BALANCE when the member's net ≠ 0 in ANY currency of the group. */
async function assertSettledUp(groupId: string, userId: string): Promise<void> {
  const { expenses, settlements } = await loadGroupLedger(groupId);
  const outstanding = netsForUser(computeNets(expenses, settlements), userId);
  if (outstanding.length > 0) {
    throw new AppError(
      409,
      'OUTSTANDING_BALANCE',
      'This member still has an outstanding balance in this group — settle up first',
    );
  }
}

/**
 * Create or reactivate a membership. Rejoining resets joinedAt (fair for
 * longest-standing-member promotion). If the group somehow has no active
 * admin, the joiner becomes one so the group is never left unmanaged.
 */
async function activateMembership(
  groupId: string,
  userId: string,
  groupHasActiveAdmin: boolean,
): Promise<void> {
  const role: $Enums.MemberRole = groupHasActiveAdmin ? 'MEMBER' : 'ADMIN';
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId, userId } },
    update: { leftAt: null, joinedAt: new Date(), role },
    create: { groupId, userId, role },
  });
}

/**
 * Set leftAt on the membership (rows are never deleted — history!) and, when
 * the last ADMIN just left, promote the longest-standing remaining member.
 */
async function deactivateMembership(groupId: string, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.groupMember.update({
      where: { groupId_userId: { groupId, userId } },
      data: { leftAt: new Date() },
    });
    const remaining = await tx.groupMember.findMany({
      where: { groupId, leftAt: null },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    });
    if (remaining.length > 0 && !remaining.some((m) => m.role === 'ADMIN')) {
      await tx.groupMember.update({ where: { id: remaining[0]!.id }, data: { role: 'ADMIN' } });
    }
  });
}

/** Shared flow for DELETE /:groupId/members/:userId and POST /:groupId/leave. */
async function removeMemberFlow(
  groupId: string,
  actorId: string,
  targetUserId: string,
): Promise<void> {
  const isSelf = actorId === targetUserId;
  if (isSelf) await assertActiveMember(groupId, actorId);
  else await assertAdmin(groupId, actorId);

  const target = await prisma.groupMember.findFirst({
    where: { groupId, userId: targetUserId, leftAt: null },
    include: { user: { select: publicUserSelect }, group: { select: { name: true } } },
  });
  if (!target) throw new AppError(404, 'NOT_FOUND', 'Member not found');

  await assertSettledUp(groupId, targetUserId);
  await deactivateMembership(groupId, targetUserId);

  const remaining = await prisma.groupMember.findMany({
    where: { groupId, leftAt: null },
    select: { userId: true },
  });
  await recordActivity({
    type: isSelf ? 'MEMBER_LEFT' : 'MEMBER_REMOVED',
    actorId,
    groupId,
    data: { userId: targetUserId, userName: target.user.name, groupName: target.group.name },
    recipientIds: [...remaining.map((m) => m.userId), targetUserId],
  });
}

async function createGroupWithUniqueCode(
  creatorId: string,
  input: CreateGroupInput,
): Promise<GroupWithRelations> {
  for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.group.create({
        data: {
          name: input.name,
          emoji: input.emoji ?? defaultEmojiForType(input.type),
          type: input.type,
          currency: input.currency,
          simplifyDebts: input.simplifyDebts,
          inviteCode: generateInviteCode(),
          createdById: creatorId,
          members: { create: { userId: creatorId, role: 'ADMIN' } },
        },
        include: groupInclude,
      });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < INVITE_CODE_ATTEMPTS - 1) continue;
      throw err;
    }
  }
  throw new AppError(500, 'INTERNAL', 'Could not generate a unique invite code');
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const routes: FastifyPluginAsync = async (app) => {
  // -- GET /groups — the caller's groups with their net position in each ------
  app.get('/groups', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.userId;
    const groups = await prisma.group.findMany({
      where: { members: { some: { userId, leftAt: null } } },
      select: {
        id: true,
        name: true,
        emoji: true,
        type: true,
        currency: true,
        updatedAt: true,
        archivedAt: true,
        members: { where: { leftAt: null }, select: { userId: true } },
      },
    });
    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g.id);
    const [expenses, settlements] = await Promise.all([
      prisma.expense.findMany({
        where: { groupId: { in: groupIds }, deletedAt: null },
        select: {
          groupId: true,
          currency: true,
          createdAt: true,
          payers: { select: { userId: true, amount: true } },
          splits: { select: { userId: true, amount: true } },
        },
      }),
      prisma.settlement.findMany({
        where: { groupId: { in: groupIds }, deletedAt: null },
        select: {
          groupId: true,
          currency: true,
          createdAt: true,
          fromUserId: true,
          toUserId: true,
          amount: true,
        },
      }),
    ]);

    const expensesByGroup = new Map<string, typeof expenses>();
    for (const expense of expenses) {
      const key = expense.groupId ?? '';
      const list = expensesByGroup.get(key);
      if (list) list.push(expense);
      else expensesByGroup.set(key, [expense]);
    }
    const settlementsByGroup = new Map<string, typeof settlements>();
    for (const settlement of settlements) {
      const key = settlement.groupId ?? '';
      const list = settlementsByGroup.get(key);
      if (list) list.push(settlement);
      else settlementsByGroup.set(key, [settlement]);
    }

    const summaries: GroupSummaryDto[] = groups.map((group) => {
      const groupExpenses = expensesByGroup.get(group.id) ?? [];
      const groupSettlements = settlementsByGroup.get(group.id) ?? [];
      const nets = computeNets(groupExpenses, groupSettlements);

      let lastActivity = group.updatedAt;
      for (const e of groupExpenses) if (e.createdAt > lastActivity) lastActivity = e.createdAt;
      for (const s of groupSettlements) if (s.createdAt > lastActivity) lastActivity = s.createdAt;

      return {
        id: group.id,
        name: group.name,
        emoji: group.emoji,
        type: group.type,
        currency: group.currency,
        memberCount: group.members.length,
        yourBalances: netsForUser(nets, userId),
        lastActivityAt: lastActivity.toISOString(),
        archivedAt: group.archivedAt ? group.archivedAt.toISOString() : null,
      };
    });

    // Most recently active first (ISO strings sort lexicographically).
    summaries.sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));
    return summaries;
  });

  // -- POST /groups — create; creator becomes ADMIN ---------------------------
  app.post('/groups', { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = zCreateGroupInput.parse(request.body);
    if (!isSupportedCurrency(input.currency)) {
      throw new AppError(400, 'UNSUPPORTED_CURRENCY', `Currency ${input.currency} is not supported`);
    }

    const group = await createGroupWithUniqueCode(request.userId, input);
    await recordActivity({
      type: 'GROUP_CREATED',
      actorId: request.userId,
      groupId: group.id,
      data: { groupName: group.name },
      recipientIds: [request.userId],
    });
    return reply.code(201).send(toGroupDto(group));
  });

  // -- POST /groups/join — join by invite code (idempotent) --------------------
  app.post('/groups/join', { preHandler: [app.authenticate] }, async (request) => {
    const input = zJoinGroupInput.parse(request.body);
    const group = await prisma.group.findUnique({
      where: { inviteCode: input.code.toUpperCase() },
      include: { members: true },
    });
    if (!group || group.archivedAt) {
      throw new AppError(404, 'INVALID_CODE', 'Invalid invite code');
    }

    const existing = group.members.find((m) => m.userId === request.userId);
    if (existing && existing.leftAt === null) {
      // Already a member — succeed without duplicate side effects.
      return loadGroupDto(group.id);
    }

    const activeMembers = group.members.filter((m) => m.leftAt === null);
    await activateMembership(
      group.id,
      request.userId,
      activeMembers.some((m) => m.role === 'ADMIN'),
    );
    await ensureFriendshipsAmong([...activeMembers.map((m) => m.userId), request.userId]);

    const joiner = await prisma.user.findUniqueOrThrow({
      where: { id: request.userId },
      select: publicUserSelect,
    });
    await recordActivity({
      type: 'MEMBER_JOINED',
      actorId: request.userId,
      groupId: group.id,
      data: { userId: joiner.id, userName: joiner.name, groupName: group.name },
      recipientIds: [...activeMembers.map((m) => m.userId), request.userId],
      notify: {
        type: 'MEMBER_JOINED',
        title: `New member in ${group.name}`,
        body: `${joiner.name} joined ${group.name}`,
        data: { groupId: group.id },
      },
    });
    return loadGroupDto(group.id);
  });

  // -- GET /groups/:groupId — member-only --------------------------------------
  app.get('/groups/:groupId', { preHandler: [app.authenticate] }, async (request) => {
    const { groupId } = zGroupParams.parse(request.params);
    await assertActiveMember(groupId, request.userId);
    return loadGroupDto(groupId);
  });

  // -- PATCH /groups/:groupId — any member may edit -----------------------------
  app.patch('/groups/:groupId', { preHandler: [app.authenticate] }, async (request) => {
    const { groupId } = zGroupParams.parse(request.params);
    const input = zUpdateGroupInput.parse(request.body);
    await assertActiveMember(groupId, request.userId);
    if (input.currency && !isSupportedCurrency(input.currency)) {
      throw new AppError(400, 'UNSUPPORTED_CURRENCY', `Currency ${input.currency} is not supported`);
    }

    const updated = await prisma.group.update({
      where: { id: groupId },
      data: input,
      include: groupInclude,
    });

    const activeIds = updated.members.filter((m) => m.leftAt === null).map((m) => m.userId);
    await recordActivity({
      type: 'GROUP_UPDATED',
      actorId: request.userId,
      groupId,
      data: { groupName: updated.name, changedFields: Object.keys(input) },
      recipientIds: activeIds,
    });
    return toGroupDto(updated);
  });

  // -- DELETE /groups/:groupId — archive (ADMIN) ---------------------------------
  app.delete('/groups/:groupId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { groupId } = zGroupParams.parse(request.params);
    await assertAdmin(groupId, request.userId);

    const group = await prisma.group.update({
      where: { id: groupId },
      data: { archivedAt: new Date() },
      include: groupInclude,
    });

    const activeIds = group.members.filter((m) => m.leftAt === null).map((m) => m.userId);
    await recordActivity({
      type: 'GROUP_UPDATED',
      actorId: request.userId,
      groupId,
      data: { groupName: group.name, archived: true },
      recipientIds: activeIds,
    });
    return reply.code(204).send();
  });

  // -- POST /groups/:groupId/invite-code/rotate (ADMIN) ---------------------------
  app.post(
    '/groups/:groupId/invite-code/rotate',
    { preHandler: [app.authenticate] },
    async (request) => {
      const { groupId } = zGroupParams.parse(request.params);
      await assertAdmin(groupId, request.userId);

      for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt += 1) {
        try {
          const group = await prisma.group.update({
            where: { id: groupId },
            data: { inviteCode: generateInviteCode() },
            include: groupInclude,
          });
          return toGroupDto(group);
        } catch (err) {
          if (isUniqueViolation(err) && attempt < INVITE_CODE_ATTEMPTS - 1) continue;
          throw err;
        }
      }
      throw new AppError(500, 'INTERNAL', 'Could not generate a unique invite code');
    },
  );

  // -- POST /groups/:groupId/members — any member adds an existing user by email --
  app.post('/groups/:groupId/members', { preHandler: [app.authenticate] }, async (request) => {
    const { groupId } = zGroupParams.parse(request.params);
    const input = zAddMemberInput.parse(request.body);
    await assertActiveMember(groupId, request.userId);

    const target = await prisma.user.findUnique({
      where: { email: input.email },
      select: publicUserSelect,
    });
    if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'No Divzy account with that email');

    const group = await prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      include: { members: true },
    });
    const existing = group.members.find((m) => m.userId === target.id);
    if (existing && existing.leftAt === null) {
      // Already a member — succeed without duplicate side effects.
      return loadGroupDto(groupId);
    }

    const activeMembers = group.members.filter((m) => m.leftAt === null);
    await activateMembership(
      groupId,
      target.id,
      activeMembers.some((m) => m.role === 'ADMIN'),
    );
    await ensureFriendshipsAmong([...activeMembers.map((m) => m.userId), target.id]);

    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: request.userId },
      select: publicUserSelect,
    });
    await recordActivity({
      type: 'MEMBER_JOINED',
      actorId: request.userId,
      groupId,
      data: { userId: target.id, userName: target.name, groupName: group.name },
      recipientIds: [...activeMembers.map((m) => m.userId), target.id],
      notify: {
        type: 'ADDED_TO_GROUP',
        title: `Added to ${group.name}`,
        body: `${actor.name} added ${target.name} to ${group.name}`,
        data: { groupId },
      },
    });
    return loadGroupDto(groupId);
  });

  // -- PATCH /groups/:groupId/members/:userId — change role (ADMIN) ----------------
  app.patch(
    '/groups/:groupId/members/:userId',
    { preHandler: [app.authenticate] },
    async (request) => {
      const { groupId, userId: targetUserId } = zMemberParams.parse(request.params);
      const input = zUpdateMemberInput.parse(request.body);
      await assertAdmin(groupId, request.userId);

      const target = await prisma.groupMember.findFirst({
        where: { groupId, userId: targetUserId, leftAt: null },
      });
      if (!target) throw new AppError(404, 'NOT_FOUND', 'Member not found');

      if (target.role === 'ADMIN' && input.role === 'MEMBER') {
        const adminCount = await prisma.groupMember.count({
          where: { groupId, leftAt: null, role: 'ADMIN' },
        });
        if (adminCount <= 1) {
          throw new AppError(409, 'LAST_ADMIN', 'Cannot demote the only admin of the group');
        }
      }

      await prisma.groupMember.update({ where: { id: target.id }, data: { role: input.role } });
      return loadGroupDto(groupId);
    },
  );

  // -- DELETE /groups/:groupId/members/:userId — remove (ADMIN) or leave (self) ----
  app.delete(
    '/groups/:groupId/members/:userId',
    { preHandler: [app.authenticate] },
    async (request) => {
      const { groupId, userId: targetUserId } = zMemberParams.parse(request.params);
      await removeMemberFlow(groupId, request.userId, targetUserId);
      return loadGroupDto(groupId);
    },
  );

  // -- POST /groups/:groupId/leave — same as self-removal ---------------------------
  app.post('/groups/:groupId/leave', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { groupId } = zGroupParams.parse(request.params);
    await removeMemberFlow(groupId, request.userId, request.userId);
    return reply.code(204).send();
  });
};

export default routes;
