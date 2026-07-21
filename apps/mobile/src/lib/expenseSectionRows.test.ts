import { parseISO } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';
import type { ExpenseDto } from '@divzy/shared';
import { buildExpenseRows, computeMonthEntry, type SectionRow } from './expenseSectionRows';

// WI-074 — per-item memoization for ExpenseSectionList's month grouping.
// `buildExpenseRows`/`computeMonthEntry` are a pure extraction of the previous inline
// `useMemo` loop body (spec-WI-074.md §2), so they're unit-testable without this repo's
// missing RN component-render harness (mirrors the WI-062 `activitySentence.ts` precedent).

// Fixture-factory convention adapted from `expenseActions.test.ts` (lines 12-36): a fully
// defaulted `ExpenseDto`, overrides spread last, cast `as ExpenseDto`.
function makeExpense(overrides: Partial<ExpenseDto> = {}): ExpenseDto {
  return {
    id: 'exp-1',
    groupId: 'group-1',
    group: { id: 'group-1', name: 'Roommates', emoji: '🏠', currency: 'USD' },
    description: 'Dinner',
    amount: 4200,
    currency: 'USD',
    category: 'FOOD',
    date: '2026-07-01',
    splitType: 'EQUAL',
    notes: null,
    receiptUrl: null,
    payers: [],
    splits: [],
    items: [],
    createdBy: { id: 'u1', name: 'Alice', avatarColor: '#000' },
    updatedBy: null,
    commentCount: 0,
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  } as ExpenseDto;
}

type Row = SectionRow<ExpenseDto>;

describe('expenseSectionRows (WI-074)', () => {
  describe('computeMonthEntry (white-box)', () => {
    it('parses a valid ISO date into monthKey/monthLabel', () => {
      expect(computeMonthEntry('2026-03-15')).toEqual({
        monthKey: '2026-03',
        monthLabel: 'March 2026',
      });
    });

    it('falls back to unknown/Earlier for a malformed date, without throwing', () => {
      expect(() => computeMonthEntry('not-a-date')).not.toThrow();
      expect(computeMonthEntry('not-a-date')).toEqual({ monthKey: 'unknown', monthLabel: 'Earlier' });
    });

    it('confirms the fallback is triggered by formatDate throwing on an Invalid Date, not by parseDate throwing', () => {
      // date-fns' real parseISO does NOT throw on garbage input — it returns an `Invalid
      // Date` object; `format` is what throws (`RangeError: Invalid time value`). This
      // matters for the memoization call-count tests below: a malformed-date entry still
      // consumes one `parseDate` call on every (re)computation.
      const parseDateSpy = vi.fn(parseISO);
      const result = computeMonthEntry('not-a-date', { parseDate: parseDateSpy });
      expect(parseDateSpy).toHaveBeenCalledTimes(1);
      expect(parseDateSpy).toHaveBeenCalledWith('not-a-date');
      expect(result).toEqual({ monthKey: 'unknown', monthLabel: 'Earlier' });
    });

    it('uses injected parseDate/formatDate instead of the real date-fns functions when provided', () => {
      const fakeDate = new Date('2020-01-01T00:00:00.000Z');
      const parseDate = vi.fn(() => fakeDate);
      const formatDate = vi.fn((_date: Date, pattern: string) =>
        pattern === 'yyyy-MM' ? 'fake-key' : 'fake-label',
      );
      const result = computeMonthEntry('irrelevant', { parseDate, formatDate });
      expect(parseDate).toHaveBeenCalledWith('irrelevant');
      expect(formatDate).toHaveBeenCalledWith(fakeDate, 'yyyy-MM');
      expect(formatDate).toHaveBeenCalledWith(fakeDate, 'MMMM yyyy');
      expect(result).toEqual({ monthKey: 'fake-key', monthLabel: 'fake-label' });
    });
  });

  describe('buildExpenseRows — equality/regression (byte-identical output)', () => {
    // 10 expenses, deliberately NOT date-sorted, spanning 4 real months plus one
    // malformed date, with two months (2026-01 and 2026-03) reappearing non-adjacently.
    // This exercises the exact "insert a header only when monthKey differs from the
    // *previous* expense's monthKey" rule from the pre-change inline loop — a header
    // must be re-emitted the second time a month key reappears, not deduped globally.
    const e1 = makeExpense({ id: 'e1', date: '2026-01-15' });
    const e2 = makeExpense({ id: 'e2', date: '2026-01-20' });
    const e3 = makeExpense({ id: 'e3', date: '2026-02-01' });
    const e4 = makeExpense({ id: 'e4', date: '2026-01-05' }); // 2026-01 reappears
    const e5 = makeExpense({ id: 'e5', date: '2026-03-10' });
    const e6 = makeExpense({ id: 'e6', date: 'not-a-date' }); // malformed
    const e7 = makeExpense({ id: 'e7', date: '2026-03-15' }); // 2026-03 reappears
    const e8 = makeExpense({ id: 'e8', date: '2026-03-20' });
    const e9 = makeExpense({ id: 'e9', date: '2026-04-01' });
    const e10 = makeExpense({ id: 'e10', date: '2026-04-02' });

    const fixture = [e1, e2, e3, e4, e5, e6, e7, e8, e9, e10];

    // Hand-computed baseline mirroring exactly what the pre-change inline loop produced
    // for this fixture, in fixture order (not sorted).
    const expected: Row[] = [
      { kind: 'month', key: 'month-2026-01', label: 'January 2026' },
      { kind: 'expense', expense: e1 },
      { kind: 'expense', expense: e2 },
      { kind: 'month', key: 'month-2026-02', label: 'February 2026' },
      { kind: 'expense', expense: e3 },
      { kind: 'month', key: 'month-2026-01', label: 'January 2026' },
      { kind: 'expense', expense: e4 },
      { kind: 'month', key: 'month-2026-03', label: 'March 2026' },
      { kind: 'expense', expense: e5 },
      { kind: 'month', key: 'month-unknown', label: 'Earlier' },
      { kind: 'expense', expense: e6 },
      { kind: 'month', key: 'month-2026-03', label: 'March 2026' },
      { kind: 'expense', expense: e7 },
      { kind: 'expense', expense: e8 },
      { kind: 'month', key: 'month-2026-04', label: 'April 2026' },
      { kind: 'expense', expense: e9 },
      { kind: 'expense', expense: e10 },
    ];

    it('deep-equals the hand-computed baseline (same order, headers, and fallback labels)', () => {
      const { rows } = buildExpenseRows(fixture, new Map());
      expect(rows).toEqual(expected);
      // No rendered-output difference vs. the pre-change component: the row list is
      // deep-equal to the fixture's month-boundary/fallback semantics with a fresh cache.
    });

    it('does not crash on the malformed-date entry and reports unknown/Earlier for it', () => {
      const { rows } = buildExpenseRows(fixture, new Map());
      const malformedRow = rows.find(
        (row): row is Row & { kind: 'expense' } => row.kind === 'expense' && row.expense.id === 'e6',
      );
      expect(malformedRow).toBeDefined();
      const headerBeforeMalformed = rows[rows.findIndex((row) => row === malformedRow) - 1];
      expect(headerBeforeMalformed).toEqual({
        kind: 'month',
        key: 'month-unknown',
        label: 'Earlier',
      });
    });

    it('re-emits a month header the second time a month key reappears (does not globally dedupe)', () => {
      const { rows } = buildExpenseRows(fixture, new Map());
      const januaryHeaders = rows.filter(
        (row) => row.kind === 'month' && row.key === 'month-2026-01',
      );
      const marchHeaders = rows.filter((row) => row.kind === 'month' && row.key === 'month-2026-03');
      expect(januaryHeaders).toHaveLength(2);
      expect(marchHeaders).toHaveLength(2);
    });
  });

  describe('buildExpenseRows — memoization call-count (proves reduced reparsing)', () => {
    it('only reparses the single new/changed item on a subsequent call, not the whole list', () => {
      const parseDateSpy = vi.fn(parseISO);

      const a1 = makeExpense({ id: 'a1', date: '2026-01-10' });
      const a2 = makeExpense({ id: 'a2', date: '2026-01-20' });
      const a3 = makeExpense({ id: 'a3', date: 'garbage-date' }); // malformed, still consumes a parseDate call
      const a4 = makeExpense({ id: 'a4', date: '2026-02-05' });
      const a5 = makeExpense({ id: 'a5', date: '2026-02-15' });
      const fixtureA = [a1, a2, a3, a4, a5];

      const first = buildExpenseRows(fixtureA, new Map(), { parseDate: parseDateSpy });
      // Fresh cache: every entry, including the malformed one, needs computeMonthEntry,
      // which always invokes parseDate (only formatDate throws on invalid input).
      expect(parseDateSpy).toHaveBeenCalledTimes(5);

      parseDateSpy.mockClear();
      const newExpense = makeExpense({ id: 'a6', date: '2026-03-01' });
      const second = buildExpenseRows(fixtureA.concat([newExpense]), first.cache, {
        parseDate: parseDateSpy,
      });

      // Load-bearing assertion: only the one new item gets reparsed, not the full
      // 6-item list (would be 6 calls if the cache weren't consulted at all).
      expect(parseDateSpy).toHaveBeenCalledTimes(1);
      expect(parseDateSpy).toHaveBeenCalledWith('2026-03-01');
      expect(second.rows).toHaveLength(first.rows.length + 2); // +1 expense row, +1 new month header (2026-03)
    });

    it('increases the running total by exactly the number of new items across two calls sharing one spy', () => {
      const parseDateSpy = vi.fn(parseISO);
      const b1 = makeExpense({ id: 'b1', date: '2026-05-01' });
      const b2 = makeExpense({ id: 'b2', date: '2026-05-02' });

      const first = buildExpenseRows([b1, b2], new Map(), { parseDate: parseDateSpy });
      const countAfterFirst = parseDateSpy.mock.calls.length;
      expect(countAfterFirst).toBe(2);

      const b3 = makeExpense({ id: 'b3', date: '2026-05-03' });
      buildExpenseRows([b1, b2, b3], first.cache, { parseDate: parseDateSpy });

      expect(parseDateSpy).toHaveBeenCalledTimes(countAfterFirst + 1);
    });
  });

  describe('buildExpenseRows — stale-cache-busting (changed date for an existing id)', () => {
    it('reruns the parse step and reflects the new date, not a stale cached entry', () => {
      const parseDateSpy = vi.fn(parseISO);
      const original = makeExpense({ id: 'c1', date: '2026-01-15' });

      const first = buildExpenseRows([original], new Map(), { parseDate: parseDateSpy });
      expect(first.rows).toEqual([
        { kind: 'month', key: 'month-2026-01', label: 'January 2026' },
        { kind: 'expense', expense: original },
      ]);
      expect(parseDateSpy).toHaveBeenCalledTimes(1);

      parseDateSpy.mockClear();
      const edited = makeExpense({ id: 'c1', date: '2026-06-20' }); // same id, different date
      const second = buildExpenseRows([edited], first.cache, { parseDate: parseDateSpy });

      // (a) the parse step reruns for that id — not served from the stale cache entry
      expect(parseDateSpy).toHaveBeenCalledTimes(1);
      expect(parseDateSpy).toHaveBeenCalledWith('2026-06-20');

      // (b) the returned grouping reflects the NEW date
      expect(second.rows).toEqual([
        { kind: 'month', key: 'month-2026-06', label: 'June 2026' },
        { kind: 'expense', expense: edited },
      ]);
      expect(second.cache.get('c1')).toEqual({
        date: '2026-06-20',
        monthKey: '2026-06',
        monthLabel: 'June 2026',
      });
    });
  });

  describe('buildExpenseRows — cache pruning (fresh Map, no unbounded growth)', () => {
    it('does not carry forward a stale entry for an id that dropped out of the expenses array', () => {
      const kept = makeExpense({ id: 'kept-1', date: '2026-01-01' });
      const dropped = makeExpense({ id: 'dropped-1', date: '2026-02-01' });

      const first = buildExpenseRows([dropped, kept], new Map());
      expect(first.cache.size).toBe(2);
      expect(first.cache.has('dropped-1')).toBe(true);

      const second = buildExpenseRows([kept], first.cache);

      expect(second.cache.size).toBe(1);
      expect(second.cache.has('kept-1')).toBe(true);
      expect(second.cache.has('dropped-1')).toBe(false);
    });
  });
});
