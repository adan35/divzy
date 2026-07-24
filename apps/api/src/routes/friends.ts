import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  computePairwiseBalances,
  computePairwiseBalancesByGroup,
  formatMoney,
  zAddFriendByCodeInput,
  zAddFriendInput,
  zId,
  type CurrencyAmount,
  type FriendBalanceBucket,
  type FriendCodeDto,
  type FriendDto,
  type GroupAttributedPairwiseDebt,
} from '@divzy/shared';
import { recordActivity } from '../lib/activity';
import { convertBalanceForViewer, type ConvertedBalance } from '../lib/balance-conversion';
import { bumpUsers, cached, cacheKey } from '../lib/cache';
import { env } from '../config/env';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { generateRandomCode, isUniqueViolation, RANDOM_CODE_ATTEMPTS } from '../lib/random-code';
import { resolveConversionRates } from '../lib/rates';
import { publicUserSelect, toPublicUser, type PublicUserPayload } from '../lib/serializers';
import { ensureFriendshipsAmong } from '../lib/social';

const zFriendParams = z.object({ userId: zId });

function toFriendCodeDto(code: string): FriendCodeDto {
  return { code, shareUrl: `${env.WEB_URL}/add-friend/${code}` };
}

/**
 * WI-066: pairwise settled-up gate for DELETE /friends/:userId. Deliberately
 * NOT the group-scoped assertSettledUp/loadGroupLedger (groups.ts) — a
 * friendship removal has no groupId. Reuses the exact GET /friends ledger
 * query shape (minus display-only fields), runs computePairwiseBalances
 * once, and filters to the single (callerId, targetId) pair.
 */
async function assertFriendPairSettled(
  callerId: string,
  targetId: string,
  friendship: { userAId: string; userA: PublicUserPayload; userB: PublicUserPayload },
): Promise<void> {
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: {
        deletedAt: null,
        OR: [
          { payers: { some: { userId: callerId } } },
          { splits: { some: { userId: callerId } } },
        ],
      },
      select: {
        currency: true,
        payers: { select: { userId: true, amount: true } },
        splits: { select: { userId: true, amount: true } },
      },
    }),
    prisma.settlement.findMany({
      where: { deletedAt: null, OR: [{ fromUserId: callerId }, { toUserId: callerId }] },
      select: { currency: true, fromUserId: true, toUserId: true, amount: true },
    }),
  ]);

  // computePairwiseBalances already drops entries that net to exactly 0
  // (signed === 0), so any remaining entry for this pair in any currency IS
  // an outstanding balance.
  const outstanding = computePairwiseBalances(expenses, settlements).filter(
    (d) =>
      (d.fromUserId === callerId && d.toUserId === targetId) ||
      (d.fromUserId === targetId && d.toUserId === callerId),
  );
  if (outstanding.length === 0) return;

  // Counterparty-named message, modelled on groups.ts buildOutstandingBalanceMessage:
  // pick the largest-magnitude debt; append an "(and N other...)" tail when multi-currency.
  const target = friendship.userAId === callerId ? friendship.userB : friendship.userA;
  const top = outstanding.reduce((best, e) =>
    !best || Math.abs(e.amount) > Math.abs(best.amount) ? e : best,
  );
  const line =
    top.fromUserId === callerId
      ? `You still owe ${target.name} ${formatMoney(top.amount, top.currency)}`
      : `${target.name} still owes you ${formatMoney(top.amount, top.currency)}`;
  let message = `${line} — settle up before removing them as a friend`;
  if (outstanding.length > 1) {
    const n = outstanding.length - 1;
    message += ` (and ${n} other outstanding balance${n === 1 ? '' : 's'})`;
  }
  throw new AppError(409, 'OUTSTANDING_BALANCE', message);
}

/**
 * Sort magnitude: converted figure (already normalized to one currency) plus
 * any native leftovers (still a rough cross-currency heuristic for the
 * leftover portion, same as the pre-WI-001 behavior) — display order only.
 * Using the converted amount here (rather than only the narrowed, mostly-empty
 * `balances` leftover list) keeps "biggest balance first" meaningful now that
 * `balances` itself typically collapses to [] once conversion succeeds.
 */
function balanceMagnitude(converted: ConvertedBalance | null, leftovers: CurrencyAmount[]): number {
  const convertedMagnitude = converted ? Math.abs(converted.amount) : 0;
  const leftoverMagnitude = leftovers.reduce((acc, b) => acc + Math.abs(b.amount), 0);
  return convertedMagnitude + leftoverMagnitude;
}

/** The {id,name,emoji} group label embed shape (mirrors SettlementDto.group). */
interface GroupLabel {
  id: string;
  name: string;
  emoji: string;
}

/**
 * WI-079 (spec §4 C3): the caller's group-label lookup for one compute pass.
 * One groupMember.findMany inside the existing Promise.all batch — zero new
 * SEQUENTIAL round-trips, no leftAt filter (membership rows are never
 * deleted; a left group's labels must still resolve). The `?.` tolerance
 * exists ONLY for legacy mocked-prisma test doubles that stub just the
 * models the pre-WI-079 route used (spec §8 T4 pins those suites to pass
 * unmodified); against the real client this is always the live query, and
 * the drb-security N1 rule stands: a missing label falls back to the static
 * "Unknown group" embed below — NEVER a group.findMany lookup.
 */
function fetchGroupLabels(userId: string) {
  return (
    prisma.groupMember?.findMany({
      where: { userId },
      select: { group: { select: { id: true, name: true, emoji: true } } },
    }) ?? Promise.resolve([])
  );
}

function toGroupLabelMap(rows: Array<{ group: GroupLabel }>): Map<string, GroupLabel> {
  return new Map(rows.map((row) => [row.group.id, row.group]));
}

/**
 * WI-079 (spec §4 C4, ADR-033 Decision 1): build the per-(group|direct)
 * buckets for one (caller, friend) pair from the group-attributed pairwise
 * engine output. Same sign convention as the top-level computation
 * (debt.fromUserId === callerId ? -amount : +amount; positive = friend owes
 * caller). Buckets whose native list nets to zero in every currency are
 * dropped (belt-and-braces on top of the engine's own zero-bucket drop, per
 * spec §1 scenario 4). Conversion reuses the request-scoped rates map — no
 * I/O here. Per-bucket usedFallbackRates is the D4 membership test against
 * fallbackCurrencies (UPPERCASED codes) with mandatory .toUpperCase()
 * normalization. Final sort is the owned DTO contract: magnitude desc,
 * direct (group: null) last on ties, then group name asc.
 */
function buildFriendBuckets(
  callerId: string,
  friendId: string,
  pairwiseByGroup: GroupAttributedPairwiseDebt[],
  groupLabels: Map<string, GroupLabel>,
  viewerCurrency: string,
  rates: Record<string, number>,
  fallbackCurrencies: string[],
): FriendBalanceBucket[] {
  const perGroup = new Map<string | null, Map<string, number>>();
  for (const debt of pairwiseByGroup) {
    const involvesPair =
      (debt.fromUserId === callerId && debt.toUserId === friendId) ||
      (debt.fromUserId === friendId && debt.toUserId === callerId);
    if (!involvesPair) continue;
    const delta = debt.fromUserId === callerId ? -debt.amount : debt.amount;
    let perCurrency = perGroup.get(debt.groupId);
    if (!perCurrency) {
      perCurrency = new Map();
      perGroup.set(debt.groupId, perCurrency);
    }
    perCurrency.set(debt.currency, (perCurrency.get(debt.currency) ?? 0) + delta);
  }

  const buckets: FriendBalanceBucket[] = [];
  for (const [groupId, perCurrency] of perGroup) {
    const balancesNative: CurrencyAmount[] = [...perCurrency.entries()]
      .filter(([, amount]) => amount !== 0)
      .map(([currency, amount]) => ({ currency, amount }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
    if (balancesNative.length === 0) continue; // settled bucket never renders
    const { converted, leftovers } = convertBalanceForViewer(balancesNative, viewerCurrency, rates);
    buckets.push({
      group:
        groupId === null
          ? null
          : (groupLabels.get(groupId) ?? { id: groupId, name: 'Unknown group', emoji: '🧾' }),
      balances: leftovers,
      balancesNative,
      balancesConverted: converted,
      usedFallbackRates: balancesNative.some((b) =>
        fallbackCurrencies.includes(b.currency.toUpperCase()),
      ),
    });
  }

  buckets.sort(
    (a, b) =>
      balanceMagnitude(b.balancesConverted, b.balances) -
        balanceMagnitude(a.balancesConverted, a.balances) ||
      (a.group === null
        ? b.group === null
          ? 0
          : 1
        : b.group === null
          ? -1
          : a.group.name.localeCompare(b.group.name)),
  );
  return buckets;
}

/**
 * Shared "add friend" flow behind both POST /friends (by email) and
 * POST /friends/add-by-code (WI-040) — same friendship semantics either way:
 * ensureFriendshipsAmong, FRIEND_ADDED activity+notify ONLY when genuinely
 * new, idempotent (silent) re-add otherwise. Caller has already checked
 * self-add.
 */
async function addFriendPair(callerId: string, target: PublicUserPayload): Promise<FriendDto> {
  const [userAId, userBId] = callerId < target.id ? [callerId, target.id] : [target.id, callerId];
  const existing = await prisma.friendship.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
  });

  await ensureFriendshipsAmong([callerId, target.id]);

  // Only announce NEW friendships — re-adding is idempotent and silent.
  if (!existing) {
    // WI-067 / ADR-030 (friends add-invalidation gap, closed by WI-070): bump
    // both parties only on the genuine-new-friendship path — matches the G1
    // join precedent (bump only past the idempotent short-circuit). An
    // idempotent re-add writes nothing (ensureFriendshipsAmong's
    // createMany({skipDuplicates}) is a no-op above), so nothing to invalidate.
    bumpUsers([callerId, target.id]);

    const actor = await prisma.user.findUnique({
      where: { id: callerId },
      select: { name: true },
    });
    const actorName = actor?.name ?? 'Someone';
    await recordActivity({
      type: 'FRIEND_ADDED',
      actorId: callerId,
      data: { friendId: target.id, friendName: target.name },
      recipientIds: [callerId, target.id],
      notify: {
        type: 'FRIEND_ADDED',
        title: `${actorName} added you as a friend`,
        body: `You can now split expenses with ${actorName} on Divzy`,
        data: { userId: callerId },
      },
    });
  }

  const friendship =
    existing ??
    (await prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
    }));

  return {
    user: toPublicUser(target),
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    balancesByGroup: [],
    lastActivityAt: friendship ? friendship.createdAt.toISOString() : null,
  };
}

/**
 * Body of `GET /friends/:userId` (WI-070) — standalone helper, deliberately
 * NOT a shared `buildFriendDto` refactor of `computeFriendsList` (spec-WI-070
 * Decision 2b: minimal blast radius on the code being cache-wrapped in the
 * same change). Mirrors `assertFriendPairSettled`'s query shape (~L37-86
 * above): the caller's FULL non-deleted ledger (not a "both users" DB
 * filter — that would risk diverging from what GET /friends computes),
 * result-narrowed in-memory to this one pair. Adds `createdAt` to the
 * expense/settlement selects (needed for `lastActivityAt`, which
 * `computeFriendsList` also selects) and runs `resolveConversionRates`/
 * `convertBalanceForViewer` exactly as GET /friends does per-friend, so the
 * two paths return field-identical DTOs for the same pair at the same moment.
 * WI-079: both selects also gain `groupId`, and the same group-attributed
 * engine pass + batched label fetch populate `balancesByGroup` — the
 * WI-070 §2b "field-identical DTOs" parity rule makes this field mandatory
 * here too.
 */
async function computeFriendDto(
  callerId: string,
  friendship: {
    userAId: string;
    userA: PublicUserPayload;
    userB: PublicUserPayload;
    createdAt: Date;
  },
  viewerCurrency: string,
): Promise<FriendDto> {
  const target = friendship.userAId === callerId ? friendship.userB : friendship.userA;

  const [expenses, settlements, groupMemberships] = await Promise.all([
    prisma.expense.findMany({
      where: {
        deletedAt: null,
        OR: [
          { payers: { some: { userId: callerId } } },
          { splits: { some: { userId: callerId } } },
        ],
      },
      select: {
        currency: true,
        groupId: true,
        createdAt: true,
        payers: { select: { userId: true, amount: true } },
        splits: { select: { userId: true, amount: true } },
      },
    }),
    prisma.settlement.findMany({
      where: { deletedAt: null, OR: [{ fromUserId: callerId }, { toUserId: callerId }] },
      select: {
        currency: true,
        groupId: true,
        fromUserId: true,
        toUserId: true,
        amount: true,
        createdAt: true,
      },
    }),
    fetchGroupLabels(callerId),
  ]);
  const groupLabels = toGroupLabelMap(groupMemberships);

  // Result-narrow: run the pairwise engine over the caller's full ledger,
  // then filter to just the (callerId, target.id) pair — same shape as
  // assertFriendPairSettled, NOT a DB-level "both participate" filter.
  const pairwise = computePairwiseBalances(expenses, settlements).filter(
    (d) =>
      (d.fromUserId === callerId && d.toUserId === target.id) ||
      (d.fromUserId === target.id && d.toUserId === callerId),
  );
  // WI-079: the group-attributed pass over the SAME two arrays (its buckets
  // partition the collapsed result exactly — the reconciliation invariant).
  const pairwiseByGroup = computePairwiseBalancesByGroup(expenses, settlements);

  // Signed native per-currency for this pair (positive = target owes caller)
  // — identical sign convention to computeFriendsList's balancesByFriend map.
  const perCurrency = new Map<string, number>();
  for (const debt of pairwise) {
    const delta = debt.fromUserId === callerId ? -debt.amount : debt.amount;
    perCurrency.set(debt.currency, (perCurrency.get(debt.currency) ?? 0) + delta);
  }
  const nativeBalances: CurrencyAmount[] = [...perCurrency.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  const { rates, usedFallbackRates, fallbackCurrencies } = await resolveConversionRates(
    viewerCurrency,
    nativeBalances.map((b) => b.currency),
  );
  const { converted, leftovers } = convertBalanceForViewer(nativeBalances, viewerCurrency, rates);

  // lastActivityAt: latest createdAt of an expense/settlement the TARGET
  // participates in (in-memory filter over the caller's full ledger, mirrors
  // computeFriendsList's lastSharedAt map), else the friendship's own
  // createdAt — field-for-field match to GET /friends.
  let lastActivity = friendship.createdAt;
  const touch = (at: Date) => {
    if (at.getTime() > lastActivity.getTime()) lastActivity = at;
  };
  for (const expense of expenses) {
    const participates = [...expense.payers, ...expense.splits].some((p) => p.userId === target.id);
    if (participates) touch(expense.createdAt);
  }
  for (const settlement of settlements) {
    const otherId =
      settlement.fromUserId === callerId ? settlement.toUserId : settlement.fromUserId;
    if (otherId === target.id) touch(settlement.createdAt);
  }

  return {
    user: toPublicUser(target),
    balances: leftovers,
    balancesNative: nativeBalances,
    balancesConverted: converted,
    usedFallbackRates,
    balancesByGroup: buildFriendBuckets(
      callerId,
      target.id,
      pairwiseByGroup,
      groupLabels,
      viewerCurrency,
      rates,
      fallbackCurrencies,
    ),
    lastActivityAt: lastActivity.toISOString(),
  };
}

/**
 * Body of `GET /friends` — extracted so `cached()` (WI-067 / ADR-030 pattern,
 * reused per spec-WI-070 §2a) wraps exactly this compute function, 15s TTL.
 * Unchanged from the pre-WI-070 inline handler.
 */
async function computeFriendsList(userId: string): Promise<FriendDto[]> {
  // Same ledger queries as GET /balance (per CONTRACTS): every non-deleted
  // expense the caller is on + every settlement they are a party to. The
  // pairwise engine runs ONCE and is filtered per friend below.
  const [friendships, expenses, settlements, user, groupMemberships] = await Promise.all([
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
        groupId: true,
        createdAt: true,
        payers: { select: { userId: true, amount: true } },
        splits: { select: { userId: true, amount: true } },
      },
    }),
    prisma.settlement.findMany({
      where: { deletedAt: null, OR: [{ fromUserId: userId }, { toUserId: userId }] },
      select: {
        currency: true,
        groupId: true,
        fromUserId: true,
        toUserId: true,
        amount: true,
        createdAt: true,
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { defaultCurrency: true } }),
    fetchGroupLabels(userId),
  ]);
  if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Account no longer exists');
  const groupLabels = toGroupLabelMap(groupMemberships);

  const pairwise = computePairwiseBalances(expenses, settlements);
  // WI-079: the group-attributed pass over the SAME two arrays (its buckets
  // partition the collapsed result exactly — the reconciliation invariant).
  const pairwiseByGroup = computePairwiseBalancesByGroup(expenses, settlements);

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
    const otherId = settlement.fromUserId === userId ? settlement.toUserId : settlement.fromUserId;
    touch(otherId, settlement.createdAt);
  }

  // Native per-friend balance lists (nonzero only) first, collecting the
  // union of currencies to resolve — resolveConversionRates is called
  // exactly ONCE for the whole request (never per friend), same batching
  // discipline as GET /groups. See spec-WI-001's GET /friends addendum
  // (2026-07-14), "List friends with converted balances".
  const nativeBalancesByFriend = new Map<string, CurrencyAmount[]>();
  const distinctCurrencies = new Set<string>();
  for (const friendship of friendships) {
    const other = friendship.userAId === userId ? friendship.userB : friendship.userA;
    const perCurrency = balancesByFriend.get(other.id);
    const balances: CurrencyAmount[] = perCurrency
      ? [...perCurrency.entries()]
          .filter(([, amount]) => amount !== 0)
          .map(([currency, amount]) => ({ currency, amount }))
          .sort((a, b) => a.currency.localeCompare(b.currency))
      : [];
    nativeBalancesByFriend.set(other.id, balances);
    for (const entry of balances) distinctCurrencies.add(entry.currency);
  }

  const { rates, usedFallbackRates, fallbackCurrencies } = await resolveConversionRates(
    user.defaultCurrency,
    [...distinctCurrencies],
  );

  const friends: FriendDto[] = friendships.map((friendship) => {
    const other = friendship.userAId === userId ? friendship.userB : friendship.userA;
    const nativeBalances = nativeBalancesByFriend.get(other.id) ?? [];
    const { converted, leftovers } = convertBalanceForViewer(
      nativeBalances,
      user.defaultCurrency,
      rates,
    );
    const shared = lastSharedAt.get(other.id);
    const lastActivity =
      shared && shared.getTime() > friendship.createdAt.getTime() ? shared : friendship.createdAt;
    return {
      user: toPublicUser(other),
      balances: leftovers,
      balancesNative: nativeBalances,
      balancesConverted: converted,
      usedFallbackRates,
      balancesByGroup: buildFriendBuckets(
        userId,
        other.id,
        pairwiseByGroup,
        groupLabels,
        user.defaultCurrency,
        rates,
        fallbackCurrencies,
      ),
      lastActivityAt: lastActivity.toISOString(),
    };
  });

  friends.sort(
    (a, b) =>
      balanceMagnitude(b.balancesConverted, b.balances) -
        balanceMagnitude(a.balancesConverted, a.balances) || a.user.name.localeCompare(b.user.name),
  );

  return friends;
}

const routes: FastifyPluginAsync = async (app) => {
  // -- GET /friends — friendship rows + per-friend pairwise balances ---------
  // WI-070: wrapped in cached() (15s TTL), the GET /balance pattern. No query
  // params -> a constant paramsHash; userId + generation is the whole key.
  app.get('/friends', { preHandler: [app.authenticate] }, async (request) =>
    cached(cacheKey('friends', request.userId, {}), 15_000, () =>
      computeFriendsList(request.userId),
    ),
  );

  // -- POST /friends — add a friend by exact email or phone (WI-045) ---------
  app.post('/friends', { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = zAddFriendInput.parse(request.body);
    const userId = request.userId;

    const target = await prisma.user.findUnique({
      // Exactly one targeted lookup per kind (never both) — mirrors
      // GET /users/search and POST /auth/login (WI-045). select stays
      // publicUserSelect: phone is never selected/serialized here.
      where: input.kind === 'email' ? { email: input.identifier } : { phone: input.identifier },
      select: publicUserSelect,
    });
    if (!target) {
      throw new AppError(
        404,
        'USER_NOT_FOUND',
        'No Divzy account exists with that email or phone number',
      );
    }
    if (target.id === userId) {
      throw new AppError(400, 'CANNOT_ADD_SELF', 'You cannot add yourself as a friend');
    }

    const dto = await addFriendPair(userId, target);
    return reply.status(201).send(dto);
  });

  // -- GET /friends/code — the caller's persistent friend-add code (WI-040) --
  app.get('/friends/code', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.userId;
    const existing = await prisma.friendCode.findUnique({ where: { userId } });
    if (existing) return toFriendCodeDto(existing.code);

    for (let attempt = 0; attempt < RANDOM_CODE_ATTEMPTS; attempt += 1) {
      try {
        const created = await prisma.friendCode.create({
          data: { userId, code: generateRandomCode() },
        });
        return toFriendCodeDto(created.code);
      } catch (err) {
        if (isUniqueViolation(err) && attempt < RANDOM_CODE_ATTEMPTS - 1) continue;
        throw err;
      }
    }
    throw new AppError(500, 'INTERNAL', 'Could not generate a unique friend code');
  });

  // -- POST /friends/code/rotate — overwrite, invalidating the old code (WI-040) --
  app.post('/friends/code/rotate', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.userId;
    for (let attempt = 0; attempt < RANDOM_CODE_ATTEMPTS; attempt += 1) {
      try {
        const updated = await prisma.friendCode.update({
          where: { userId },
          data: { code: generateRandomCode() },
        });
        return toFriendCodeDto(updated.code);
      } catch (err) {
        if (isUniqueViolation(err) && attempt < RANDOM_CODE_ATTEMPTS - 1) continue;
        throw err;
      }
    }
    throw new AppError(500, 'INTERNAL', 'Could not generate a unique friend code');
  });

  // -- POST /friends/add-by-code — resolve code -> user, then the shared add-friend flow (WI-040) --
  app.post('/friends/add-by-code', { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = zAddFriendByCodeInput.parse(request.body);
    const userId = request.userId;

    const friendCode = await prisma.friendCode.findUnique({
      where: { code: input.code.toUpperCase() },
    });
    if (!friendCode) throw new AppError(404, 'INVALID_CODE', 'Invalid friend code');

    const target = await prisma.user.findUnique({
      where: { id: friendCode.userId },
      select: publicUserSelect,
    });
    // Orphaned code (user deleted) resolves to no live user — treat as invalid.
    if (!target) throw new AppError(404, 'INVALID_CODE', 'Invalid friend code');
    if (target.id === userId) {
      throw new AppError(400, 'CANNOT_ADD_SELF', 'You cannot add yourself as a friend');
    }

    const dto = await addFriendPair(userId, target);
    return reply.status(201).send(dto);
  });

  // -- GET /friends/:userId — single-friend read (WI-070) ---------------------
  // Deliberately NOT wrapped in cached() — no audited bumpUsers coverage for
  // a 5th cache surface (spec-WI-070 Decision, Change C).
  app.get('/friends/:userId', { preHandler: [app.authenticate] }, async (request) => {
    const { userId: targetId } = zFriendParams.parse(request.params);
    const callerId = request.userId;

    // Same lexicographic-pair key as addFriendPair/DELETE above. Self-target
    // collapses to userAId === userBId, for which no row can ever exist, so
    // it naturally falls into the same 404 as a non-friend/nonexistent
    // target — no special-cased branch, no existence-enumeration oracle.
    const [userAId, userBId] = callerId < targetId ? [callerId, targetId] : [targetId, callerId];
    const friendship = await prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
      include: {
        userA: { select: publicUserSelect },
        userB: { select: publicUserSelect },
      },
    });
    if (!friendship) {
      throw new AppError(404, 'FRIENDSHIP_NOT_FOUND', "This person isn't in your friends list");
    }

    const user = await prisma.user.findUnique({
      where: { id: callerId },
      select: { defaultCurrency: true },
    });
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Account no longer exists');

    return computeFriendDto(callerId, friendship, user.defaultCurrency);
  });

  // -- DELETE /friends/:userId — hard-remove the friendship (WI-066) ---------
  app.delete('/friends/:userId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { userId: targetId } = zFriendParams.parse(request.params);
    const callerId = request.userId;

    // Same lexicographic-pair key as addFriendPair (~L46 above). Self-target
    // collapses to userAId === userBId, for which no row can exist → 404 below.
    const [userAId, userBId] = callerId < targetId ? [callerId, targetId] : [targetId, callerId];
    const friendship = await prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
      include: {
        userA: { select: publicUserSelect },
        userB: { select: publicUserSelect },
      },
    });
    if (!friendship) {
      throw new AppError(404, 'FRIENDSHIP_NOT_FOUND', 'You are not friends with this user');
    }

    await assertFriendPairSettled(callerId, targetId, friendship);

    try {
      await prisma.friendship.delete({ where: { userAId_userBId: { userAId, userBId } } });
    } catch (err) {
      // Concurrent double-DELETE: the loser's delete throws P2025, which the
      // global handler would otherwise map to a generic 404 NOT_FOUND — but
      // the client's "already removed, treat gracefully" branch keys on the
      // domain-specific FRIENDSHIP_NOT_FOUND code (DRB security note N1).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new AppError(404, 'FRIENDSHIP_NOT_FOUND', 'You are not friends with this user');
      }
      throw err;
    }

    // WI-067 / ADR-030 (friends remove-invalidation gap, closed by WI-070):
    // bump both parties ONLY on genuine success — the no-row 404 path returns
    // above the try, the 409 (assertFriendPairSettled) path throws above the
    // try, and the concurrent-double-delete P2025 path re-throws inside the
    // catch (404) — control only reaches here once the row is truly gone.
    bumpUsers([callerId, targetId]);
    return reply.code(204).send();
  });
};

export default routes;
