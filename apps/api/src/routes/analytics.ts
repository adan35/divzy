import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  isSupportedCurrency,
  zAnalyticsQuery,
  zCurrency,
  zManualRateInput,
  type AnalyticsSummaryDto,
  type ExpenseCategory,
  type ManualExchangeRateDto,
} from '@divzy/shared';
import { bumpUserGeneration, cached, cacheKey } from '../lib/cache';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { convert, getRates, resolveConversionRates } from '../lib/rates';

const zRatesQuery = z.object({ base: zCurrency.default('USD') });

/** Guard against pathological date ranges blowing up the month grid. */
const MAX_RANGE_MS = 10 * 366 * 24 * 60 * 60 * 1000;

const analyticsExpenseSelect = {
  id: true,
  amount: true,
  currency: true,
  category: true,
  date: true,
  groupId: true,
  group: { select: { id: true, name: true, emoji: true } },
  payers: { select: { userId: true, amount: true } },
  splits: { select: { userId: true, amount: true } },
} as const satisfies Prisma.ExpenseSelect;

type AnalyticsExpense = Prisma.ExpenseGetPayload<{ select: typeof analyticsExpenseSelect }>;

/** 'YYYY-MM' bucket key (UTC, matching the ISO dates in DTOs). */
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Zero-filled calendar months covering [from, to]. */
function monthGrid(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const last = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1);
  while (cursor.getTime() <= last) {
    keys.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

const routes: FastifyPluginAsync = async (app) => {
  // -- GET /rates?base=USD — cached rates map (12h TTL, fallback-aware) ------
  // WI-072 §2: wrapped in the shared response cache (60s TTL), matching
  // /analytics/summary. `base` is already upper-cased by zCurrency's
  // .transform, so no second normalization is needed in the cache key.
  app.get('/rates', { preHandler: [app.authenticate] }, async (request) => {
    const { base } = zRatesQuery.parse(request.query);
    if (!isSupportedCurrency(base)) {
      throw new AppError(400, 'UNSUPPORTED_CURRENCY', `Currency ${base} is not supported`);
    }
    const key = cacheKey('rates', request.userId, { base });
    return cached(key, 60_000, () => getRates(base));
  });

  // -- POST /rates/manual — persist a user-supplied "1 from = ? to" rate -----
  // (WI-002; storage/fallback layered by convertAmountForUser in lib/rates.ts)
  app.post('/rates/manual', { preHandler: [app.authenticate] }, async (request) => {
    const input = zManualRateInput.parse(request.body);
    const from = input.from;
    const to = input.to;
    if (!isSupportedCurrency(from)) {
      throw new AppError(400, 'UNSUPPORTED_CURRENCY', `Currency ${from} is not supported`);
    }
    if (!isSupportedCurrency(to)) {
      throw new AppError(400, 'UNSUPPORTED_CURRENCY', `Currency ${to} is not supported`);
    }

    // Upsert: a resubmission for the same pair overwrites the stored rate
    // rather than erroring — lets a user correct a manual rate later.
    const row = await prisma.manualExchangeRate.upsert({
      where: {
        userId_fromCurrency_toCurrency: { userId: request.userId, fromCurrency: from, toCurrency: to },
      },
      create: { userId: request.userId, fromCurrency: from, toCurrency: to, rate: input.rate },
      update: { rate: input.rate },
    });

    // WI-067 / ADR-030 §4.5 site C2 (CEO ruling, required — not optional):
    // a manual rate changes this user's fallback conversions for both wrapped
    // reads, so ALWAYS bump (unlike C1, there is no "did it actually change"
    // guard here — a resubmission of the identical rate is still cheap and
    // correctness-safe to over-invalidate).
    bumpUserGeneration(request.userId);

    const dto: ManualExchangeRateDto = {
      from: row.fromCurrency,
      to: row.toCurrency,
      rate: row.rate,
      createdAt: row.createdAt.toISOString(),
    };
    return dto;
  });

  // -- GET /analytics/summary — the caller's spending, converted -------------
  // WI-067 / ADR-030: wrapped in cached() (60s TTL, spec §5). The cache key's
  // params are built from the VALIDATED query, with `currency` upper-cased
  // up front (spec §3.2 gap-closure) so `?currency=usd` and `?currency=USD`
  // share one entry instead of splitting the cache.
  app.get('/analytics/summary', { preHandler: [app.authenticate] }, async (request) => {
    const query = zAnalyticsQuery.parse(request.query);
    const userId = request.userId;

    const keyParams = {
      currency: query.currency ? query.currency.toUpperCase() : undefined,
      from: query.from,
      to: query.to,
      groupId: query.groupId,
    };
    const key = cacheKey('analytics/summary', userId, keyParams);

    return cached(key, 60_000, async (): Promise<AnalyticsSummaryDto> => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { defaultCurrency: true },
      });
      if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Account no longer exists');

      const currency = (query.currency ?? user.defaultCurrency).toUpperCase();
      if (!isSupportedCurrency(currency)) {
        throw new AppError(400, 'UNSUPPORTED_CURRENCY', `Currency ${currency} is not supported`);
      }

      // Range: default = start of the month 5 months back → now (6 calendar months).
      const now = new Date();
      const to = query.to ? new Date(query.to) : now;
      const from = query.from
        ? new Date(query.from)
        : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 5, 1));
      if (from.getTime() > to.getTime()) {
        throw new AppError(400, 'INVALID_DATE_RANGE', 'from must be before to');
      }
      if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
        throw new AppError(400, 'RANGE_TOO_LARGE', 'Analytics ranges are limited to 10 years');
      }

      if (query.groupId) {
        const member = await prisma.groupMember.findFirst({
          where: { groupId: query.groupId, userId, leftAt: null },
          select: { id: true },
        });
        if (!member) throw new AppError(404, 'NOT_FOUND', 'Group not found');
      }

      // Caller's non-deleted expenses: payer or split participant.
      const baseWhere: Prisma.ExpenseWhereInput = {
        deletedAt: null,
        ...(query.groupId ? { groupId: query.groupId } : {}),
        OR: [{ payers: { some: { userId } } }, { splits: { some: { userId } } }],
      };
      const rangeMs = to.getTime() - from.getTime();
      const prevFrom = new Date(from.getTime() - rangeMs);

      const [current, previous] = await Promise.all([
        prisma.expense.findMany({
          where: { ...baseWhere, date: { gte: from, lte: to } },
          select: analyticsExpenseSelect,
        }),
        prisma.expense.findMany({
          where: { ...baseWhere, date: { gte: prevFrom, lt: from } },
          select: analyticsExpenseSelect,
        }),
      ]);

      // Rates map keyed on the target currency, fetched once and reused across
      // every expense converted below (see resolveConversionRates, WI-001).
      const distinctCurrencies = [
        ...new Set([...current, ...previous].map((expense) => expense.currency.toUpperCase())),
      ];
      const { rates, usedFallbackRates } = await resolveConversionRates(currency, distinctCurrencies);

      const shareOf = (expense: AnalyticsExpense): number =>
        expense.splits.find((s) => s.userId === userId)?.amount ?? 0;

      let yourSpend = 0;
      let totalActivity = 0;
      const byCategoryMap = new Map<string, number>();
      const byMonthMap = new Map<string, number>();
      const byMonthTotalMap = new Map<string, number>();
      const byGroupMap = new Map<string, { name: string; emoji: string; amount: number }>();

      for (const expense of current) {
        const shareConverted = convert(shareOf(expense), expense.currency, currency, rates);
        const activityConverted = convert(expense.amount, expense.currency, currency, rates);
        yourSpend += shareConverted;
        totalActivity += activityConverted;

        byCategoryMap.set(expense.category, (byCategoryMap.get(expense.category) ?? 0) + shareConverted);

        const key = monthKey(expense.date);
        byMonthMap.set(key, (byMonthMap.get(key) ?? 0) + shareConverted);
        byMonthTotalMap.set(key, (byMonthTotalMap.get(key) ?? 0) + activityConverted);

        if (expense.group) {
          const entry = byGroupMap.get(expense.group.id) ?? {
            name: expense.group.name,
            emoji: expense.group.emoji,
            amount: 0,
          };
          entry.amount += shareConverted;
          byGroupMap.set(expense.group.id, entry);
        }
      }

      let previousYourSpend = 0;
      for (const expense of previous) {
        previousYourSpend += convert(shareOf(expense), expense.currency, currency, rates);
      }

      const summary: AnalyticsSummaryDto = {
        currency,
        from: from.toISOString(),
        to: to.toISOString(),
        yourSpend,
        totalActivity,
        previousYourSpend,
        byCategory: [...byCategoryMap.entries()]
          .filter(([, amount]) => amount !== 0)
          .map(([category, amount]) => ({ category: category as ExpenseCategory, amount }))
          .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category)),
        byMonth: monthGrid(from, to).map((month) => ({
          month,
          amount: byMonthMap.get(month) ?? 0,
          totalActivity: byMonthTotalMap.get(month) ?? 0,
        })),
        byGroup: [...byGroupMap.entries()]
          .filter(([, entry]) => entry.amount !== 0)
          .map(([groupId, entry]) => ({
            groupId,
            name: entry.name,
            emoji: entry.emoji,
            amount: entry.amount,
          }))
          .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
        usedFallbackRates,
      };
      return summary;
    });
  });
};

export default routes;
