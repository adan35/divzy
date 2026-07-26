import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { $Enums, GroupMember } from '@prisma/client';
import {
  GROUP_TYPES,
  computeNets,
  computePairwiseBalances,
  formatMoney,
  isSupportedCurrency,
  netsForUser,
  zAddMemberByFriendInput,
  zAddMemberInput,
  zCreateGroupInput,
  zId,
  zJoinGroupInput,
  zUpdateGroupInput,
  zUpdateMemberInput,
  zUpdateGroupWhiteboardInput,
  type CreateGroupInput,
  type CurrencyAmount,
  type GroupDto,
  type GroupSummaryDto,
  type GroupWhiteboardDto,
  type LedgerExpense,
  type LedgerSettlement,
  type NetsByCurrency,
  type PairwiseDebt,
} from '@divzy/shared';
import { recordActivity } from '../lib/activity';
import { convertBalanceForViewer } from '../lib/balance-conversion';
import { bumpGroupGeneration, bumpUsers, cached, cacheKey } from '../lib/cache';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { resolveConversionRates } from '../lib/rates';
import { generateRandomCode, isUniqueViolation, RANDOM_CODE_ATTEMPTS } from '../lib/random-code';
import {
  groupInclude,
  publicUserSelect,
  toGroupDto,
  toGroupWhiteboardDto,
  type GroupWithRelations,
} from '../lib/serializers';
import { ensureFriendshipsAmong } from '../lib/social';

const zGroupParams = z.object({ groupId: zId });
const zMemberParams = z.object({ groupId: zId, userId: zId });

// ---------------------------------------------------------------------------
// Invite codes — 10 chars from the base32 alphabet A-Z2-7, crypto random
// (shared generator in lib/random-code.ts; also backs WI-040's FriendCode).
// ---------------------------------------------------------------------------

const INVITE_CODE_ATTEMPTS = RANDOM_CODE_ATTEMPTS;
const generateInviteCode = generateRandomCode;

function defaultEmojiForType(type: CreateGroupInput['type']): string {
  return GROUP_TYPES.find((t) => t.key === type)?.emoji ?? '🧾';
}

// ---------------------------------------------------------------------------
// Membership helpers. Membership = GroupMember row with leftAt null.
// Non-members get 404 (never leak that a group exists).
// ---------------------------------------------------------------------------

async function assertActiveMember(groupId: string, userId: string): Promise<GroupMember> {
  const member = await prisma.groupMember.findFirst({
    where: { groupId, userId, leftAt: null, group: { deletedAt: null } },
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

/**
 * Personalized 403 for POST /groups/:groupId/unarchive (WI-053): names the
 * group's actual active admin(s) instead of the generic assertAdmin message.
 * assertAdmin itself and its five other call sites are untouched.
 */
async function forbiddenUnarchiveError(groupId: string): Promise<AppError> {
  const admins = await prisma.groupMember.findMany({
    where: { groupId, role: 'ADMIN', leftAt: null },
    select: { user: { select: publicUserSelect } },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
  });
  const names = admins.map((a) => a.user.name);

  let message: string;
  if (names.length === 1) {
    message = `Only ${names[0]} can unarchive this group.`;
  } else if (names.length > 1) {
    const last = names[names.length - 1];
    const joined = names.slice(0, -1).join(', ');
    message = `Only ${joined} or ${last} can unarchive this group.`;
  } else {
    message = 'Only group admins can do this';
  }
  return new AppError(403, 'FORBIDDEN', message);
}

async function loadGroupDto(groupId: string): Promise<GroupDto> {
  const group = await prisma.group.findUnique({ where: { id: groupId }, include: groupInclude });
  if (!group) throw new AppError(404, 'NOT_FOUND', 'Group not found');
  return toGroupDto(group);
}

async function loadGroupWhiteboardDto(groupId: string): Promise<GroupWhiteboardDto> {
  const whiteboard = await prisma.groupWhiteboard.findUnique({ where: { groupId } });
  if (!whiteboard) {
    return { body: '', updatedBy: null, updatedAt: null };
  }
  const editor = whiteboard.updatedById
    ? await prisma.user.findUnique({ where: { id: whiteboard.updatedById }, select: publicUserSelect })
    : null;
  return toGroupWhiteboardDto(whiteboard, editor);
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

/**
 * Builds the counterparty-named 409 message for `assertSettledUp` (WI-052).
 * Reuses the already-loaded ledger — no second `loadGroupLedger` fetch. Runs
 * only on the failure branch, so the common settled-up path pays nothing.
 */
async function buildOutstandingBalanceMessage(
  groupId: string,
  userId: string,
  expenses: LedgerExpense[],
  settlements: LedgerSettlement[],
): Promise<string> {
  const pairwise = computePairwiseBalances(expenses, settlements);
  const mine = pairwise.filter((p) => p.fromUserId === userId || p.toUserId === userId);

  const top = mine.reduce<PairwiseDebt | null>((best, entry) => {
    if (!best) return entry;
    if (entry.amount !== best.amount) return entry.amount > best.amount ? entry : best;
    if (entry.currency !== best.currency) return entry.currency < best.currency ? entry : best;
    const bestCounterparty = best.fromUserId === userId ? best.toUserId : best.fromUserId;
    const entryCounterparty = entry.fromUserId === userId ? entry.toUserId : entry.fromUserId;
    return entryCounterparty < bestCounterparty ? entry : best;
  }, null)!;

  const counterpartyIds = new Set(mine.flatMap((p) => [p.fromUserId, p.toUserId]));
  const members = await prisma.groupMember.findMany({
    where: { groupId, userId: { in: [userId, ...counterpartyIds] } },
    select: { userId: true, user: { select: publicUserSelect } },
  });
  const names = new Map(members.map((m) => [m.userId, m.user.name]));

  const debtorName = names.get(top.fromUserId) ?? 'A member';
  const creditorName = names.get(top.toUserId) ?? 'a member';
  let message = `${debtorName} still owes ${creditorName} ${formatMoney(top.amount, top.currency)} in this group — settle up first`;
  if (mine.length > 1) {
    const n = mine.length - 1;
    message += ` (and ${n} other outstanding balance${n === 1 ? '' : 's'} in this group)`;
  }
  return message;
}

/** 409 OUTSTANDING_BALANCE when the member's net ≠ 0 in ANY currency of the group. */
async function assertSettledUp(groupId: string, userId: string): Promise<void> {
  const { expenses, settlements } = await loadGroupLedger(groupId);
  const outstanding = netsForUser(computeNets(expenses, settlements), userId);
  if (outstanding.length > 0) {
    const message = await buildOutstandingBalanceMessage(groupId, userId, expenses, settlements);
    throw new AppError(409, 'OUTSTANDING_BALANCE', message);
  }
}

/**
 * Pure predicate (WI-028/WI-046): true iff EVERY member's net is zero in
 * EVERY currency — the group-wide "everyone settled" check. Native,
 * pre-conversion nets only (invariant 5).
 */
function isLedgerSettled(nets: NetsByCurrency): boolean {
  for (const perUser of nets.values()) {
    for (const amount of perUser.values()) {
      if (amount !== 0) return false;
    }
  }
  return true;
}

/** 409 OUTSTANDING_BALANCE (WI-046) when ANY member's net ≠ 0 in ANY currency of the group. */
async function assertGroupSettled(groupId: string): Promise<void> {
  const { expenses, settlements } = await loadGroupLedger(groupId);
  const nets = computeNets(expenses, settlements);
  if (!isLedgerSettled(nets)) {
    throw new AppError(
      409,
      'OUTSTANDING_BALANCE',
      'This group still has an outstanding balance — everyone must settle up first',
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

  // WI-067 / ADR-030 site G4 (load-bearing — analytics `?groupId=` authz):
  // bump the departing member + everyone still active. Placed inside this
  // shared flow so BOTH DELETE /:groupId/members/:userId (admin-remove) and
  // POST /:groupId/leave (self-leave) get it from one call site.
  bumpUsers([targetUserId, ...remaining.map((m) => m.userId)]);

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

/**
 * Body of `GET /groups` — extracted so `cached()` (WI-067 / ADR-030 pattern,
 * reused per spec-WI-070 §2a) wraps exactly this compute function, 15s TTL.
 * Unchanged from the pre-WI-070 inline handler.
 */
async function computeGroupsList(userId: string): Promise<GroupSummaryDto[]> {
  const groups = await prisma.group.findMany({
    where: { deletedAt: null, members: { some: { userId, leftAt: null } } },
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
  const allMemberIds = new Set<string>();
  for (const g of groups) for (const m of g.members) allMemberIds.add(m.userId);

  const [user, expenses, settlements, nullGroupSettlements] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { defaultCurrency: true } }),
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
    // WI-008: candidate friend-level (groupId: null) settlements between
    // pairs where both parties are active in at least one of the caller's
    // own groups — bounded to the caller's own social circle, never a
    // full-table scan. See "Step 2" below for how each candidate's true
    // shared-group count is resolved before it is folded in.
    prisma.settlement.findMany({
      where: {
        groupId: null,
        deletedAt: null,
        fromUserId: { in: [...allMemberIds] },
        toUserId: { in: [...allMemberIds] },
      },
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
  if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Account no longer exists');

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

  // WI-008 Step 2: resolve each null-groupId candidate's true shared-group
  // count, system-wide for the pair (not just among the caller's own
  // groups) — required for correctness so two different members of the
  // same pair always compute the same fold-in decision. Deliberately
  // ANY-EVER membership (leftAt unfiltered), not active-only: this is a
  // narrow, deliberate exception scoped to this one calculation (see
  // spec-WI-008 "Decisions (continued)" for the full worked example of why
  // active-only undercounting can corrupt an unrelated active group's
  // balance). This does not change assertActiveMember/assertSettledUp's
  // active-membership definition anywhere else.
  const groupsByUser = new Map<string, Set<string>>();
  if (nullGroupSettlements.length > 0) {
    const pairUserIds = new Set<string>();
    for (const s of nullGroupSettlements) {
      pairUserIds.add(s.fromUserId);
      pairUserIds.add(s.toUserId);
    }
    const memberships = await prisma.groupMember.findMany({
      where: { userId: { in: [...pairUserIds] } },
      select: { userId: true, groupId: true },
    });
    for (const m of memberships) {
      const set = groupsByUser.get(m.userId) ?? new Set<string>();
      set.add(m.groupId);
      groupsByUser.set(m.userId, set);
    }
  }

  // WI-008 Step 3: fold a candidate into the one group the pair shares,
  // only when they share exactly one group system-wide; otherwise leave it
  // unattributed (today's existing safe behavior) — see spec-WI-008
  // "Multi-shared-group resolution" for why exclude beats attribute-to-all
  // or attribute-to-any.
  for (const s of nullGroupSettlements) {
    const fromGroups = groupsByUser.get(s.fromUserId) ?? new Set<string>();
    const toGroups = groupsByUser.get(s.toUserId) ?? new Set<string>();
    const shared = [...fromGroups].filter((id) => toGroups.has(id));

    if (shared.length === 1) {
      const targetGroupId = shared[0]!;
      const folded = { ...s, groupId: targetGroupId };
      const list = settlementsByGroup.get(targetGroupId);
      if (list) list.push(folded);
      else settlementsByGroup.set(targetGroupId, [folded]);
    }
    // shared.length === 0 (the pair belongs to caller-visible groups but
    // shares none with each other) and shared.length > 1 (multi-shared-
    // group) both fall through here intentionally — the settlement stays
    // unfolded/excluded from every group's ledger, unchanged from today's
    // behavior (see spec-WI-008 "Multi-shared-group resolution").
  }

  // First pass: compute each group's native nets for the caller + the
  // union of currencies to resolve. resolveConversionRates is called
  // exactly ONCE for the whole request (never per group) — see
  // spec-WI-001 (social-groups) "List groups with converted balances".
  interface GroupCalc {
    userNets: CurrencyAmount[];
    lastActivityAt: Date;
    /** WI-028: true iff EVERY member's net is zero in EVERY currency (group-wide). */
    settled: boolean;
  }
  const calcByGroup = new Map<string, GroupCalc>();
  const distinctCurrencies = new Set<string>();
  for (const group of groups) {
    const groupExpenses = expensesByGroup.get(group.id) ?? [];
    const groupSettlements = settlementsByGroup.get(group.id) ?? [];
    const nets = computeNets(groupExpenses, groupSettlements);
    const userNets = netsForUser(nets, userId);
    for (const entry of userNets) distinctCurrencies.add(entry.currency);

    // WI-028: computed on the SAME native `nets` map computeNets already
    // returns for all members — no second balance concept, no settlements
    // API addition (see spec-WI-028 Proposed ADR). Native, pre-conversion
    // (invariant 5) — never derived from a converted figure. WI-046:
    // delegates to the shared isLedgerSettled predicate rather than
    // re-deriving the nested loop (also backs assertGroupSettled).
    const settled = isLedgerSettled(nets);

    let lastActivityAt = group.updatedAt;
    for (const e of groupExpenses) if (e.createdAt > lastActivityAt) lastActivityAt = e.createdAt;
    for (const s of groupSettlements)
      if (s.createdAt > lastActivityAt) lastActivityAt = s.createdAt;

    calcByGroup.set(group.id, { userNets, lastActivityAt, settled });
  }

  const { rates, usedFallbackRates } = await resolveConversionRates(user.defaultCurrency, [
    ...distinctCurrencies,
  ]);

  const summaries: GroupSummaryDto[] = groups.map((group) => {
    const calc = calcByGroup.get(group.id)!;
    const { converted, leftovers } = convertBalanceForViewer(
      calc.userNets,
      user.defaultCurrency,
      rates,
    );

    return {
      id: group.id,
      name: group.name,
      emoji: group.emoji,
      type: group.type,
      currency: group.currency,
      memberCount: group.members.length,
      yourBalances: leftovers,
      yourBalancesNative: calc.userNets,
      yourBalanceConverted: converted,
      usedFallbackRates,
      lastActivityAt: calc.lastActivityAt.toISOString(),
      archivedAt: group.archivedAt ? group.archivedAt.toISOString() : null,
      settled: calc.settled,
    };
  });

  // Most recently active first (ISO strings sort lexicographically).
  summaries.sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));
  return summaries;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const routes: FastifyPluginAsync = async (app) => {
  // -- GET /groups — the caller's groups with their net position in each ------
  // WI-070: wrapped in cached() (15s TTL), the GET /balance pattern. No query
  // params -> a constant paramsHash; userId + generation is the whole key.
  app.get('/groups', { preHandler: [app.authenticate] }, async (request) =>
    cached(cacheKey('groups', request.userId, {}), 15_000, () => computeGroupsList(request.userId)),
  );

  // -- POST /groups — create; creator becomes ADMIN ---------------------------
  app.post('/groups', { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = zCreateGroupInput.parse(request.body);
    if (!isSupportedCurrency(input.currency)) {
      throw new AppError(
        400,
        'UNSUPPORTED_CURRENCY',
        `Currency ${input.currency} is not supported`,
      );
    }

    const group = await createGroupWithUniqueCode(request.userId, input);
    // WI-067 / ADR-030 site G8: bump the creator (sole member) — closes the
    // GET /groups create-invalidation gap now that that route is cached.
    bumpUsers([request.userId]);
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
    if (!group || group.archivedAt || group.deletedAt) {
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

    // WI-067 / ADR-030 site G1: bump the joiner + the members who were
    // already active (defensive — GET /balance is membership-independent,
    // but bumping is cheap and honors the client's full membership list).
    bumpUsers([request.userId, ...activeMembers.map((m) => m.userId)]);

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
      throw new AppError(
        400,
        'UNSUPPORTED_CURRENCY',
        `Currency ${input.currency} is not supported`,
      );
    }

    const updated = await prisma.group.update({
      where: { id: groupId },
      data: input,
      include: groupInclude,
    });

    const activeIds = updated.members.filter((m) => m.leftAt === null).map((m) => m.userId);
    // WI-067 / ADR-030 site (PATCH metadata): bump every active member —
    // closes the GET /groups edit-invalidation gap now that that route is
    // cached (name/emoji/type/currency are all GroupSummaryDto fields).
    bumpUsers(activeIds);
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
    // WI-067 / ADR-030 site G7: bump every active member (defensive).
    bumpUsers(activeIds);
    await recordActivity({
      type: 'GROUP_UPDATED',
      actorId: request.userId,
      groupId,
      data: { groupName: group.name, archived: true },
      recipientIds: activeIds,
    });
    return reply.code(204).send();
  });

  // -- POST /groups/:groupId/unarchive (ADMIN) — reverse of DELETE, idempotent ----
  app.post('/groups/:groupId/unarchive', { preHandler: [app.authenticate] }, async (request) => {
    const { groupId } = zGroupParams.parse(request.params);
    const member = await assertActiveMember(groupId, request.userId);
    if (member.role !== 'ADMIN') {
      throw await forbiddenUnarchiveError(groupId);
    }

    const group = await prisma.group.findUnique({ where: { id: groupId }, include: groupInclude });
    if (!group) throw new AppError(404, 'NOT_FOUND', 'Group not found');

    if (group.archivedAt === null) {
      // Idempotent: already active, no write, no activity.
      return toGroupDto(group);
    }

    const updated = await prisma.group.update({
      where: { id: groupId },
      data: { archivedAt: null },
      include: groupInclude,
    });

    const activeIds = updated.members.filter((m) => m.leftAt === null).map((m) => m.userId);
    // WI-067 / ADR-030 site G6: bump every active member. Placed AFTER the
    // idempotent-no-op early-return above, so unarchiving an already-active
    // group bumps nobody.
    bumpUsers(activeIds);
    await recordActivity({
      type: 'GROUP_UPDATED',
      actorId: request.userId,
      groupId,
      data: { groupName: updated.name, archived: false },
      recipientIds: activeIds,
    });
    return toGroupDto(updated);
  });

  // -- POST /groups/:groupId/delete — terminal soft-delete (ADMIN, group-wide settled) --
  app.post(
    '/groups/:groupId/delete',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { groupId } = zGroupParams.parse(request.params);
      await assertAdmin(groupId, request.userId);
      await assertGroupSettled(groupId);

      const now = new Date();
      // Same transaction: set Group.deletedAt AND bulk-deactivate every
      // currently-active membership row (WI-046-1 security fix). Every
      // sibling domain's own membership guard keys off GroupMember.leftAt
      // (never Group.deletedAt directly), so this is the one in-domain
      // write that closes the deleted-group read/write reachability gap
      // without touching any sibling-owned route. Direct bulk updateMany —
      // not a loop over deactivateMembership/removeMemberFlow, which would
      // each redundantly re-check per-member settlement (already confirmed
      // group-wide by assertGroupSettled above) and fire a MEMBER_LEFT
      // activity per member; the single GROUP_UPDATED below is the only
      // activity this action should emit.
      const group = await prisma.$transaction(async (tx) => {
        const updated = await tx.group.update({
          where: { id: groupId },
          data: { deletedAt: now },
          include: groupInclude,
        });
        await tx.groupMember.updateMany({
          where: { groupId, leftAt: null },
          data: { leftAt: now },
        });
        return updated;
      });

      const activeIds = group.members.filter((m) => m.leftAt === null).map((m) => m.userId);
      // WI-067 / ADR-030 site G5 (load-bearing — terminal delete revokes
      // membership, so a stale group-scoped analytics entry must not survive
      // it): bump every formerly-active member.
      bumpUsers(activeIds);
      await recordActivity({
        type: 'GROUP_UPDATED',
        actorId: request.userId,
        groupId,
        data: { groupName: group.name, deleted: true },
        recipientIds: activeIds,
      });
      return reply.code(204).send();
    },
  );

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

    // WI-067 / ADR-030 site G2: bump the target + the already-active members.
    bumpUsers([target.id, ...activeMembers.map((m) => m.userId)]);

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

  // -- POST /groups/:groupId/members/by-friend — active member adds an existing friend --
  app.post(
    '/groups/:groupId/members/by-friend',
    { preHandler: [app.authenticate] },
    async (request) => {
      const { groupId } = zGroupParams.parse(request.params);
      const input = zAddMemberByFriendInput.parse(request.body);
      const callerId = request.userId;
      await assertActiveMember(groupId, callerId);

      const [userAId, userBId] =
        callerId < input.userId ? [callerId, input.userId] : [input.userId, callerId];
      const friendship = await prisma.friendship.findUnique({
        where: { userAId_userBId: { userAId, userBId } },
      });
      if (!friendship) {
        throw new AppError(403, 'NOT_FRIENDS', 'You can only directly add your own friends');
      }

      const group = await prisma.group.findUniqueOrThrow({
        where: { id: groupId },
        include: { members: true },
      });
      const existing = group.members.find((m) => m.userId === input.userId);
      if (existing && existing.leftAt === null) {
        // Already an active member — succeed without duplicate side effects.
        return loadGroupDto(groupId);
      }

      const activeMembers = group.members.filter((m) => m.leftAt === null);
      await activateMembership(
        groupId,
        input.userId,
        activeMembers.some((m) => m.role === 'ADMIN'),
      );

      // WI-067 / ADR-030 site G3: bump the target + the already-active members.
      bumpUsers([input.userId, ...activeMembers.map((m) => m.userId)]);

      await ensureFriendshipsAmong([...activeMembers.map((m) => m.userId), input.userId]);

      const [actor, target] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: callerId }, select: publicUserSelect }),
        prisma.user.findUniqueOrThrow({ where: { id: input.userId }, select: publicUserSelect }),
      ]);
      await recordActivity({
        type: 'MEMBER_JOINED',
        actorId: callerId,
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
    },
  );

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

  // -- GET /groups/:groupId/whiteboard — any active member ---------------------------
  app.get('/groups/:groupId/whiteboard', { preHandler: [app.authenticate] }, async (request) => {
    const { groupId } = zGroupParams.parse(request.params);
    await assertActiveMember(groupId, request.userId);
    return loadGroupWhiteboardDto(groupId);
  });

  // -- PUT /groups/:groupId/whiteboard — any active member, full replacement ---------
  app.put('/groups/:groupId/whiteboard', { preHandler: [app.authenticate] }, async (request) => {
    const { groupId } = zGroupParams.parse(request.params);
    const input = zUpdateGroupWhiteboardInput.parse(request.body);
    await assertActiveMember(groupId, request.userId);

    await prisma.groupWhiteboard.upsert({
      where: { groupId },
      update: { body: input.body, updatedById: request.userId },
      create: { groupId, body: input.body, updatedById: request.userId },
    });

    // Defensive invalidation per ADR-031; today only group-balances keys on this,
    // but any future group-scoped cache inherits correct invalidation.
    bumpGroupGeneration(groupId);

    // Deliberately silent: no recordActivity call, no notification, no socket event.
    // This is the charter-carved exception for whiteboard edits (WI-087).
    return loadGroupWhiteboardDto(groupId);
  });
};

export default routes;
