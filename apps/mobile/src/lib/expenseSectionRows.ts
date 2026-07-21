import { format, parseISO } from 'date-fns';

export interface MonthEntry {
  date: string;
  monthKey: string;
  monthLabel: string;
}

export interface DateParsers {
  parseDate?: (iso: string) => Date;
  formatDate?: (date: Date, pattern: string) => string;
}

/** Pure; injectable parse/format fns exist solely so tests can spy on call counts
 *  without fighting ESM live-binding/mocking quirks. Defaults are the real date-fns fns. */
export function computeMonthEntry(
  dateStr: string,
  { parseDate = parseISO, formatDate = format }: DateParsers = {},
): { monthKey: string; monthLabel: string } {
  try {
    const date = parseDate(dateStr);
    return { monthKey: formatDate(date, 'yyyy-MM'), monthLabel: formatDate(date, 'MMMM yyyy') };
  } catch {
    return { monthKey: 'unknown', monthLabel: 'Earlier' };
  }
}

export type SectionRow<E> =
  | { kind: 'month'; key: string; label: string }
  | { kind: 'expense'; expense: E };

/**
 * Builds the month-grouped row list, reusing `prevCache` entries by id when the
 * expense's `date` hasn't changed. Returns the rows AND the cache to store for next call
 * (a fresh Map — stale ids that dropped out of `expenses` are not carried forward, so the
 * cache can't grow unboundedly across a long scroll/filter session).
 */
export function buildExpenseRows<E extends { id: string; date: string }>(
  expenses: E[],
  prevCache: ReadonlyMap<string, MonthEntry>,
  parsers?: DateParsers,
): { rows: SectionRow<E>[]; cache: Map<string, MonthEntry> } {
  const nextCache = new Map<string, MonthEntry>();
  const rows: SectionRow<E>[] = [];
  let currentMonth = '';
  for (const expense of expenses) {
    const cached = prevCache.get(expense.id);
    const entry: MonthEntry =
      cached && cached.date === expense.date
        ? cached
        : { date: expense.date, ...computeMonthEntry(expense.date, parsers) };
    nextCache.set(expense.id, entry);
    if (entry.monthKey !== currentMonth) {
      currentMonth = entry.monthKey;
      rows.push({ kind: 'month', key: `month-${entry.monthKey}`, label: entry.monthLabel });
    }
    rows.push({ kind: 'expense', expense });
  }
  return { rows, cache: nextCache };
}
