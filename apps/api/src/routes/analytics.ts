import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  isSupportedCurrency,
  zAnalyticsQuery,
  zCurrency,
  type AnalyticsSummaryDto,
  type ExpenseCategory,
} from '@divzy/shared';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { convert, fallbackRatesFor, getRates } from '../lib/rates';

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
  app.get('/rates', { preHandler: [app.authenticate] }, async (request) => {
    const { base } = zRatesQuery.parse(request.query);
    if (!isSupportedCurrency(base)) {
      throw new AppError(400, 'UNSUPPORTED_CURRENCY', `Currency ${base} is not supported`);
    }
    return getRates(base);
  });

  // -- GET /analytics/summary — the caller's spending, converted -------------
  app.get('/analytics/summary', { preHandler: [app.authenticate] }, async (request) => {
    const query = zAnalyticsQuery.parse(request.query);
    const userId = request.userId;

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

    const [current, previous, ratesResult] = await Promise.all([
      prisma.expense.findMany({
        where: { ...baseWhere, date: { gte: from, lte: to } },
        select: analyticsExpenseSelect,
      }),
      prisma.expense.findMany({
        where: { ...baseWhere, date: { gte: prevFrom, lt: from } },
        select: analyticsExpenseSelect,
      }),
      getRates(currency),
    ]);

    // Rates map keyed on the target currency. Any expense currency the live
    // map is missing gets patched from the bundled table (and flagged).
    const rates: Record<string, number> = { ...ratesResult.rates };
    rates[currency] = rates[currency] ?? 1;
    let usedFallbackRates = ratesResult.source === 'fallback';
    let fallbackMap: Record<string, number> | null = null;
    for (const expense of [...current, ...previous]) {
      const code = expense.currency.toUpperCase();
      if (rates[code] === undefined) {
        fallbackMap = fallbackMap ?? fallbackRatesFor(currency);
        const fallbackRate = fallbackMap[code];
        if (fallbackRate !== undefined) {
          rates[code] = fallbackRate;
          usedFallbackRates = true;
        }
      }
    }

    const shareOf = (expense: AnalyticsExpense): number =>
      expense.splits.find((s) => s.userId === userId)?.amount ?? 0;

    let yourSpend = 0;
    let totalActivity = 0;
    const byCategoryMap = new Map<string, number>();
    const byMonthMap = new Map<string, number>();
    const byGroupMap = new Map<string, { name: string; emoji: string; amount: number }>();

    for (const expense of current) {
      const shareConverted = convert(shareOf(expense), expense.currency, currency, rates);
      yourSpend += shareConverted;
      totalActivity += convert(expense.amount, expense.currency, currency, rates);

      byCategoryMap.set(expense.category, (byCategoryMap.get(expense.category) ?? 0) + shareConverted);

      const key = monthKey(expense.date);
      byMonthMap.set(key, (byMonthMap.get(key) ?? 0) + shareConverted);

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
};

export default routes;
