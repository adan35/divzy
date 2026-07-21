import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  computeNets,
  computePairwiseBalances,
  netsForUser,
  suggestSettlements,
  zId,
  type CurrencyAmount,
  type GroupBalancesDto,
  type LedgerSettlement,
  type OverallBalanceDto,
  type PublicUserDto,
} from '@divzy/shared';
import { cached, cacheKey, groupGeneration } from '../lib/cache';
import { buildGroupCsv } from '../lib/csv';
import { AppError } from '../lib/errors';
import { buildGroupPdf } from '../lib/pdf';
import { buildGroupXlsx } from '../lib/xlsx';
import { loadGroupLedger } from '../lib/ledger';
import { prisma } from '../lib/prisma';
import { convert, convertAmountForUser, resolveConversionRates } from '../lib/rates';
import { publicUserSelect, toPublicUser } from '../lib/serializers';

const zGroupParams = z.object({ groupId: zId });

/**
 * WI-071 §4 — stricter, per-user rate limit for the three export routes
 * (each render is far more CPU-bound than an average request). Replaces
 * (does not stack with) the global 300/min limiter for these routes, matching
 * `auth.ts`'s shipped per-route override precedent.
 *
 * `hook: 'preHandler'` so the check runs after `app.authenticate` (which is
 * first in each route's own `preHandler` array) — `request.userId` must be
 * populated before `keyGenerator` reads it. `keyGenerator` keys per-user, not
 * the plugin's per-IP default, so one shared-NAT household/office can't
 * exhaust the limit for every user behind that IP.
 */
const exportRateLimit = {
  rateLimit: {
    max: 5,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (request: FastifyRequest) => request.userId,
  },
} as const;

/** Current user's `defaultCurrency`, read fresh on every request (never cached). */
async function loadDefaultCurrency(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { defaultCurrency: true } });
  if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Account no longer exists');
  return user.defaultCurrency;
}

/**
 * Convert `amount` (native `from`) to `to`: the pre-resolved `rates` map first
 * (batched, synchronous, no I/O — WI-001's `convert()`), falling back to
 * `convertAmountForUser` (WI-002) — which re-tries the automatic chain, then
 * consults the caller's stored manual rate — only on `RATE_UNAVAILABLE`. Never
 * throws: returns `null` when neither chain resolves the pair, so callers fold
 * the failure into their own `unresolved` list instead of failing the request.
 * Never a second, domain-local rate table — every branch here calls into
 * analytics' `lib/rates.ts` (charter.md's "Currency conversion capability...
 * remains analytics'").
 */
async function tryConvert(
  userId: string,
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): Promise<{ amount: number; usedFallback: boolean } | null> {
  try {
    return { amount: convert(amount, from, to, rates), usedFallback: false };
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== 'RATE_UNAVAILABLE') throw err;
  }
  try {
    const result = await convertAmountForUser(userId, amount, from, to);
    return { amount: result.amount, usedFallback: result.source === 'fallback' };
  } catch (err) {
    if (err instanceof AppError && err.code === 'RATE_UNAVAILABLE') return null;
    throw err;
  }
}

/** Membership = GroupMember row with leftAt null. Non-members get 404 (never leak). */
async function assertActiveMember(groupId: string, userId: string): Promise<void> {
  const member = await prisma.groupMember.findFirst({
    where: { groupId, userId, leftAt: null },
    select: { id: true },
  });
  if (!member) throw new AppError(404, 'NOT_FOUND', 'Group not found');
}

/**
 * WI-008 / ADR-009 (reconciled 2026-07-14): attribute a pair's direct (`groupId: null`)
 * settlement pool to a group ONLY when that group is the pair's SOLE shared group
 * system-wide. If the pair shares 2+ groups anywhere, the pool is left unattributed
 * everywhere (today's behavior, a safe default) rather than resolved or spread across them.
 *
 * Local to this route — NOT a shared `packages/shared` export. Per ADR-009's
 * reconciliation, social-groups' `routes/groups.ts` implements the identical rule as its
 * own independent, private helper for its same-class bug; there is deliberately no
 * shared-code dependency between the two domains (a multi-step shared algorithm — the
 * original groups-first waterfall — was judged more likely to silently drift between two
 * independently-owned call sites than a one-line rule re-implemented twice).
 *
 * "Shared group, system-wide": a group counts as shared between two users if a
 * `GroupMember` row exists for BOTH users in that group, regardless of `leftAt` on either
 * row and regardless of the target group's own current member list (a system-wide count).
 *
 * @param targetGroupId       the group whose balances are being computed. When the rule
 *                            fires (`count === 1`), that sole shared group is necessarily
 *                            this one, since the pair are both members of it.
 * @param sharedGroupCountOf  (low, high) -> count of groups (system-wide, any membership
 *                            ever) both users belong to — includes the target group itself.
 * @param directSettlements   every non-deleted `groupId: null` settlement among the target
 *                            group's members.
 */
function attributeSoleGroupSettlements(
  targetGroupId: string,
  sharedGroupCountOf: (low: string, high: string) => number,
  directSettlements: readonly LedgerSettlement[],
): LedgerSettlement[] {
  void targetGroupId; // documents the contract (see JSDoc); not needed by the body itself.

  // Step 1: bucket the direct pool D per currency + unordered pair — the same signed
  // contribution these settlements make to the low-owes-high ledger in
  // computePairwiseBalances.
  const pools = new Map<string, { currency: string; low: string; high: string; d: number }>();
  for (const s of directSettlements) {
    const [low, high] = s.fromUserId < s.toUserId ? [s.fromUserId, s.toUserId] : [s.toUserId, s.fromUserId];
    const key = `${s.currency}|${low}|${high}`;
    const signed = s.fromUserId === low ? -s.amount : s.amount;
    const pool = pools.get(key);
    if (pool) {
      pool.d += signed;
    } else {
      pools.set(key, { currency: s.currency, low, high, d: signed });
    }
  }

  const out: LedgerSettlement[] = [];
  for (const { currency, low, high, d } of pools.values()) {
    if (d === 0) continue; // Step 2: nothing paid, nothing to attribute.
    if (sharedGroupCountOf(low, high) !== 1) continue; // Step 3: 2+ shared groups -> unattributed.
    // The pair's sole shared group is necessarily targetGroupId (both are members of it).
    out.push(
      d < 0
        ? { currency, fromUserId: low, toUserId: high, amount: -d }
        : { currency, fromUserId: high, toUserId: low, amount: d },
    );
  }
  return out;
}

/**
 * WI-008 / ADR-009 (reconciled): the pair's direct (`groupId: null`) settlement pool among
 * this group's members, plus a `sharedGroupCountOf` lookup built from membership *rows
 * only* (no other group's expenses/settlements are ever loaded — substantially lighter
 * than the original waterfall design's cross-group ledger loads). `deletedAt: null` on the
 * settlement load (story "Regression — soft-deleted settlements never influence group
 * balances").
 */
async function loadDirectSettlementPool(memberIds: string[]): Promise<{
  sharedGroupCountOf: (low: string, high: string) => number;
  directSettlements: LedgerSettlement[];
}> {
  const [membershipRows, directSettlements] = await Promise.all([
    // Every group (any of) the target's members are/were ever a member of, system-wide —
    // no `leftAt` filter, per the rule's "any membership ever" definition of "shared".
    prisma.groupMember.findMany({
      where: { userId: { in: memberIds } },
      select: { userId: true, groupId: true },
    }),
    prisma.settlement.findMany({
      where: { groupId: null, deletedAt: null, fromUserId: { in: memberIds }, toUserId: { in: memberIds } },
      select: { currency: true, fromUserId: true, toUserId: true, amount: true },
    }),
  ]);

  const groupIdsByUser = new Map<string, Set<string>>();
  for (const row of membershipRows) {
    const set = groupIdsByUser.get(row.userId) ?? new Set<string>();
    set.add(row.groupId);
    groupIdsByUser.set(row.userId, set);
  }
  const sharedGroupCountOf = (low: string, high: string): number => {
    const a = groupIdsByUser.get(low);
    const b = groupIdsByUser.get(high);
    if (!a || !b) return 0;
    let count = 0;
    for (const g of a) if (b.has(g)) count += 1;
    return count;
  };

  return { sharedGroupCountOf, directSettlements };
}

/** Sorted CurrencyAmount list from a currency→amount map, zero entries dropped. */
function toCurrencyAmounts(map: Map<string, number>): CurrencyAmount[] {
  return [...map.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Shared loader for the CSV and PDF group exports: same selects/orderings/
 * `deletedAt: null` filters for both, so the two export formats can never
 * silently diverge on which rows they include (WI-018 / ADR-014). Returns
 * `null` when the group no longer exists (caller throws 404).
 */
async function loadGroupExportData(groupId: string): Promise<{
  group: { name: string; emoji: string };
  members: Array<{ id: string; name: string }>;
  expenses: Array<{
    date: Date;
    description: string;
    category: string;
    currency: string;
    amount: number;
    splitType: string;
    payers: Array<{ userId: string; name: string; amount: number }>;
    splits: Array<{ userId: string; amount: number }>;
  }>;
  settlements: Array<{
    date: Date;
    currency: string;
    amount: number;
    fromUserId: string;
    fromName: string;
    toUserId: string;
    toName: string;
  }>;
} | null> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { name: true, emoji: true },
  });
  if (!group) return null;

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

  return {
    group,
    members: members.map((m) => ({ id: m.userId, name: m.user.name })),
    expenses: expenses.map((e) => ({
      date: e.date,
      description: e.description,
      category: e.category,
      currency: e.currency,
      amount: e.amount,
      splitType: e.splitType,
      payers: e.payers.map((p) => ({ userId: p.userId, name: p.user.name, amount: p.amount })),
      splits: e.splits.map((s) => ({ userId: s.userId, amount: s.amount })),
    })),
    settlements: settlements.map((s) => ({
      date: s.date,
      currency: s.currency,
      amount: s.amount,
      fromUserId: s.fromUserId,
      fromName: s.fromUser.name,
      toUserId: s.toUserId,
      toName: s.toUser.name,
    })),
  };
}

/**
 * Dual-filename `content-disposition`: ASCII-safe fallback plus the RFC 5987
 * UTF-8 variant for non-ASCII group names. Shared by the CSV and PDF export
 * routes so the pattern can't drift between them.
 */
function exportContentDisposition(groupName: string, extension: 'csv' | 'pdf' | 'xlsx'): string {
  const asciiName =
    groupName
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/[\\/:*?"<>|]/g, '')
      .trim() || 'divzy-group';
  const utf8Name = encodeURIComponent(`${groupName}.${extension}`).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiName}.${extension}"; filename*=UTF-8''${utf8Name}`;
}

/**
 * Body of `GET /balance` — extracted so `cached()` (WI-067 / ADR-030, spec
 * §5) wraps exactly this compute function, 15s TTL. Unchanged from the
 * pre-WI-067 inline handler.
 */
async function computeOverallBalance(userId: string): Promise<OverallBalanceDto> {
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

  // -- WI-001/WI-002: caller-defaultCurrency conversion layered on top of -
  // -- the unmodified native totals/youOwe/youAreOwed computed above. -----
  const defaultCurrency = await loadDefaultCurrency(userId);

  const distinctCurrencies = [...new Set([...totals.keys(), ...owe.keys(), ...owed.keys()])];
  const { rates, usedFallbackRates: batchUsedFallback } = await resolveConversionRates(
    defaultCurrency,
    distinctCurrencies,
  );
  let usedFallbackRates = batchUsedFallback;
  const unresolved = new Map<string, number>();

  // WI-071 §1.3(a): parallelize the per-currency conversions WITHIN each
  // sumMap call via Promise.all (order preserved — Promise.all resolves in
  // input order), then reduce sequentially over the ordered results so
  // `unresolved`'s first-seen semantics and `usedFallbackRates` aggregation
  // stay byte-identical to the prior sequential `for...of`. The three
  // sumMap calls themselves stay sequential relative to each other (NOT
  // parallelized) — they share the outer `unresolved` map with ordering
  // semantics that depend on totals -> owe -> owed running in that order.
  const sumMap = async (map: Map<string, number>): Promise<number> => {
    const entries = [...map]; // deterministic (insertion) order
    const results = await Promise.all(
      entries.map(([currency, amount]) => tryConvert(userId, amount, currency, defaultCurrency, rates)),
    );
    let sum = 0;
    results.forEach((result, i) => {
      const [currency, amount] = entries[i];
      if (result === null) {
        if (!unresolved.has(currency)) unresolved.set(currency, totals.get(currency) ?? amount);
        return;
      }
      sum += result.amount;
      if (result.usedFallback) usedFallbackRates = true;
    });
    return sum;
  };

  const convertedTotal = await sumMap(totals);
  const convertedYouOwe = await sumMap(owe);
  const convertedYouAreOwed = await sumMap(owed);

  return {
    totals: toCurrencyAmounts(totals),
    youOwe: toCurrencyAmounts(owe),
    youAreOwed: toCurrencyAmounts(owed),
    converted: {
      currency: defaultCurrency,
      total: convertedTotal,
      youOwe: convertedYouOwe,
      youAreOwed: convertedYouAreOwed,
      unresolved: [...unresolved.entries()]
        .map(([currency, amount]) => ({ currency, amount }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      usedFallbackRates,
    },
  };
}

/**
 * Body of `GET /groups/:groupId/balances` — extracted so `cached()` (WI-071 /
 * ADR-031, spec §1.1) wraps exactly this compute function, 15s TTL. Excludes
 * the params parse and the membership check, which the caller runs fresh on
 * every request, before any cache lookup (charter "existence never leaks").
 * Otherwise unchanged from the pre-WI-071 inline handler beyond the loop
 * parallelization in §1.3.
 */
async function computeGroupBalances(groupId: string, userId: string): Promise<GroupBalancesDto> {
  const [members, { expenses, settlements }] = await Promise.all([
    // ALL memberships (incl. left) so pairwise rows can still name past members.
    prisma.groupMember.findMany({
      where: { groupId },
      include: { user: { select: publicUserSelect } },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    }),
    loadGroupLedger(groupId),
  ]);

  // WI-008 / ADR-009 (reconciled 2026-07-14): attribute a directly-recorded (groupId:
  // null) settlement to this group only when it's the pair's SOLE shared group
  // system-wide, so a payment made via a friend-scoped/dashboard "Record a payment"
  // flow is reflected here exactly as it already is in GET /balance and GET /friends —
  // for the pair-shares-2+-groups case, the pool is deliberately left unattributed
  // (documented limitation; see spec-WI-008.md's Worked examples A/B).
  const memberIds = [...new Set(members.map((m) => m.userId))];
  const { sharedGroupCountOf, directSettlements } = await loadDirectSettlementPool(memberIds);
  const syntheticSettlements = attributeSoleGroupSettlements(groupId, sharedGroupCountOf, directSettlements);
  const ledgerSettlements = [...settlements, ...syntheticSettlements];

  const nets = computeNets(expenses, ledgerSettlements);
  const pairwise = computePairwiseBalances(expenses, ledgerSettlements);
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

  // -- WI-001/ADR-008: viewer-currency conversion layered on top of the ---
  // -- unmodified per-currency computation above; the engine's output ----
  // -- (nets/pairwise/suggestions) is never altered by this section. -----
  const viewerCurrency = await loadDefaultCurrency(userId);

  const memberBalances = members
    .filter((m) => m.leftAt === null)
    .map((m) => ({ user: toPublicUser(m.user), balances: netsForUser(nets, m.userId) }));
  const pairwiseDto = pairwise.map((d) => ({
    ...d,
    from: publicUser(d.fromUserId),
    to: publicUser(d.toUserId),
  }));

  const distinctCurrencies = [
    ...new Set([
      ...memberBalances.flatMap((m) => m.balances.map((b) => b.currency)),
      ...pairwiseDto.map((d) => d.currency),
    ]),
  ];
  const { rates, usedFallbackRates: batchUsedFallback } = await resolveConversionRates(
    viewerCurrency,
    distinctCurrencies,
  );
  let usedFallbackRates = batchUsedFallback;

  // WI-071 §1.3(b): parallelize across members and within each member's
  // balances. Promise.all preserves input order, so `memberResults` stays in
  // `memberBalances` order and each member's `unresolved` stays in
  // `m.balances` order via the sequential `forEach` reduction below.
  const memberResults = await Promise.all(
    memberBalances.map(async (m) => {
      if (m.balances.length === 0) {
        // Settled up — omit convertedNet so the client never special-cases
        // "you owe 0.00" vs. the existing "settled up" string.
        return { entry: m, usedFallback: false };
      }
      const converted = await Promise.all(
        m.balances.map((b) => tryConvert(userId, b.amount, b.currency, viewerCurrency, rates)),
      );
      let amount = 0;
      let usedFallback = false;
      const unresolved: CurrencyAmount[] = [];
      converted.forEach((result, i) => {
        const b = m.balances[i];
        if (result === null) {
          unresolved.push(b); // preserves b.balances order
          return;
        }
        amount += result.amount;
        if (result.usedFallback) usedFallback = true;
      });
      return { entry: { ...m, convertedNet: { amount, unresolved } }, usedFallback };
    }),
  );
  const membersWithConverted: GroupBalancesDto['members'] = memberResults.map((r) => r.entry);
  if (memberResults.some((r) => r.usedFallback)) usedFallbackRates = true;

  // WI-071 §1.3(c): parallelize across pairwise rows; order preserved by index.
  const pairwiseResults = await Promise.all(
    pairwiseDto.map((row) => tryConvert(userId, row.amount, row.currency, viewerCurrency, rates)),
  );
  const pairwiseWithConverted: GroupBalancesDto['pairwise'] = pairwiseDto.map((row, i) => {
    const result = pairwiseResults[i];
    if (result === null) return row;
    if (result.usedFallback) usedFallbackRates = true;
    return { ...row, convertedAmount: result.amount };
  });

  return {
    groupId,
    viewerCurrency,
    usedFallbackRates,
    members: membersWithConverted,
    pairwise: pairwiseWithConverted,
    // Unchanged, no converted field — social-groups' WI-001 scopes suggested
    // amounts out; the "Record payment" prefill keeps using native fields.
    suggestions: suggestions.map((s) => ({
      ...s,
      from: publicUser(s.fromUserId),
      to: publicUser(s.toUserId),
    })),
  };
}

const routes: FastifyPluginAsync = async (app) => {
  // -- GET /groups/:groupId/balances — full balance sheet for one group -------
  // WI-071 / ADR-031: wrapped in cached() (15s TTL, spec §1.2). Membership
  // check ALWAYS runs fresh, before any cache lookup — never move it inside
  // computeGroupBalances or behind a cache hit (charter "existence never
  // leaks"): a former member gets a fresh 404 on their very next call
  // regardless of a warm cache entry. Cache key folds in the per-group
  // generation counter so any group-scoped settlement write invalidates
  // every active member's cached entry (ADR-031), on top of the mandatory
  // per-viewer `userId` + `userGeneration` isolation `cacheKey` already gives.
  app.get(
    '/groups/:groupId/balances',
    { preHandler: [app.authenticate] },
    async (request): Promise<GroupBalancesDto> => {
      const { groupId } = zGroupParams.parse(request.params);
      await assertActiveMember(groupId, request.userId);

      const key = cacheKey('group-balances', request.userId, { groupId, ggen: groupGeneration(groupId) });
      return cached(key, 15_000, () => computeGroupBalances(groupId, request.userId));
    },
  );

  // -- GET /balance — the caller's overall position across everything ----------
  // WI-067 / ADR-030: wrapped in cached() (15s TTL, spec §5). No query params
  // -> a constant paramsHash; `userId` + generation is the whole key.
  app.get(
    '/balance',
    { preHandler: [app.authenticate] },
    async (request): Promise<OverallBalanceDto> => {
      const userId = request.userId;
      const key = cacheKey('balance', userId, {});
      return cached(key, 15_000, () => computeOverallBalance(userId));
    },
  );

  // -- GET /groups/:groupId/export.csv — spreadsheet-ready group history --------
  app.get(
    '/groups/:groupId/export.csv',
    { preHandler: [app.authenticate], config: exportRateLimit },
    async (request, reply) => {
      const { groupId } = zGroupParams.parse(request.params);
      await assertActiveMember(groupId, request.userId);

      const data = await loadGroupExportData(groupId);
      if (!data) throw new AppError(404, 'NOT_FOUND', 'Group not found');
      const { group, members, expenses, settlements } = data;

      const csv = buildGroupCsv({ name: group.name }, members, expenses, settlements);

      return reply
        .header('content-disposition', exportContentDisposition(group.name, 'csv'))
        .type('text/csv; charset=utf-8')
        .send(csv);
    },
  );

  // -- GET /groups/:groupId/export.pdf — printable group history ----------------
  // Ownership note: this artifact is conceptually analytics-owned per the CSV
  // export precedent (see settlements charter); implemented under settlements per
  // explicit backlog routing, cto-accepted at Design (ADR-014) with the condition
  // that analytics review this before/at release.
  app.get(
    '/groups/:groupId/export.pdf',
    { preHandler: [app.authenticate], config: exportRateLimit },
    async (request, reply) => {
      const { groupId } = zGroupParams.parse(request.params);
      await assertActiveMember(groupId, request.userId);

      const data = await loadGroupExportData(groupId);
      if (!data) throw new AppError(404, 'NOT_FOUND', 'Group not found');
      const { group, members, expenses, settlements } = data;

      const pdf = await buildGroupPdf({ name: group.name, emoji: group.emoji }, members, expenses, settlements);

      return reply
        .header('content-disposition', exportContentDisposition(group.name, 'pdf'))
        .type('application/pdf')
        .send(pdf);
    },
  );

  // -- GET /groups/:groupId/export.xlsx — color-coded group history (WI-030) ---
  // Ownership note: analytics-owned formatter (lib/xlsx.ts, ADR-023), added
  // beside the existing CSV/PDF routes under settlements' file per the
  // ADR-014 co-location precedent; analytics reviews this before/at release.
  app.get(
    '/groups/:groupId/export.xlsx',
    { preHandler: [app.authenticate], config: exportRateLimit },
    async (request, reply) => {
      const { groupId } = zGroupParams.parse(request.params);
      await assertActiveMember(groupId, request.userId);

      const data = await loadGroupExportData(groupId);
      if (!data) throw new AppError(404, 'NOT_FOUND', 'Group not found');
      const { group, members, expenses, settlements } = data;

      const xlsx = await buildGroupXlsx({ name: group.name, emoji: group.emoji }, members, expenses, settlements);

      return reply
        .header('content-disposition', exportContentDisposition(group.name, 'xlsx'))
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(xlsx);
    },
  );
};

export default routes;
