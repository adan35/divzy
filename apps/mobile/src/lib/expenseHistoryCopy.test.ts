import { describe, expect, it } from 'vitest';
import type { ExpenseFieldChange } from '@divzy/shared';
import { formatHistoryChangeLine, formatHistoryKindLine, truncate } from './expenseHistoryCopy';

const SPLIT_TYPE_LABELS: Record<string, string> = {
  EQUAL: 'Split equally',
  EXACT: 'Exact amounts',
  PERCENT: 'By percentage',
  SHARES: 'By shares',
  ADJUSTMENT: 'With adjustments',
  ITEMIZED: 'Itemized',
};

describe('truncate', () => {
  it('leaves short strings untouched', () => {
    expect(truncate('Groceries')).toBe('Groceries');
  });

  it('leaves a string exactly at the limit untouched', () => {
    const exact = 'a'.repeat(40);
    expect(truncate(exact)).toBe(exact);
  });

  it('truncates strings past the limit with an ellipsis', () => {
    const long = 'a'.repeat(41);
    const result = truncate(long);
    expect(result).toBe(`${'a'.repeat(39)}…`);
    expect(result.length).toBe(40);
  });

  it('respects a custom max length', () => {
    expect(truncate('abcdefgh', 4)).toBe('abc…');
  });
});

describe('formatHistoryKindLine', () => {
  it('renders CREATED as "created this expense"', () => {
    expect(formatHistoryKindLine('CREATED')).toBe('created this expense');
  });
});

describe('formatHistoryChangeLine', () => {
  it('formats a description change, truncating both sides', () => {
    const change: ExpenseFieldChange = {
      field: 'description',
      from: 'a'.repeat(45),
      to: 'Dinner',
    };
    expect(formatHistoryChangeLine(change, SPLIT_TYPE_LABELS)).toBe(
      `changed description: "${'a'.repeat(39)}…" → "Dinner"`,
    );
  });

  it('formats an amount change using formatMoney for each currency', () => {
    const change: ExpenseFieldChange = {
      field: 'amount',
      from: 1000,
      fromCurrency: 'USD',
      to: 2550,
      toCurrency: 'EUR',
    };
    expect(formatHistoryChangeLine(change, SPLIT_TYPE_LABELS)).toBe(
      'changed amount from $10.00 to €25.50',
    );
  });

  it('formats a currency change', () => {
    const change: ExpenseFieldChange = { field: 'currency', from: 'USD', to: 'EUR' };
    expect(formatHistoryChangeLine(change, SPLIT_TYPE_LABELS)).toBe(
      'changed currency from USD to EUR',
    );
  });

  it('formats a category change using categoryInfo labels', () => {
    const change: ExpenseFieldChange = { field: 'category', from: 'GROCERIES', to: 'TRAVEL' };
    expect(formatHistoryChangeLine(change, SPLIT_TYPE_LABELS)).toBe(
      'changed category from Groceries to Travel',
    );
  });

  it('formats a date change using the short formatDate', () => {
    const change: ExpenseFieldChange = {
      field: 'date',
      from: '2026-01-05T00:00:00.000Z',
      to: '2026-03-04T00:00:00.000Z',
    };
    expect(formatHistoryChangeLine(change, SPLIT_TYPE_LABELS)).toMatch(
      /^changed date from .+ to .+$/,
    );
  });

  it('formats a splitType change using the caller-provided label map', () => {
    const change: ExpenseFieldChange = { field: 'splitType', from: 'EQUAL', to: 'PERCENT' };
    expect(formatHistoryChangeLine(change, SPLIT_TYPE_LABELS)).toBe(
      'changed split from Split equally to By percentage',
    );
  });

  it('formats a notes marker change', () => {
    const change: ExpenseFieldChange = { field: 'notes', change: 'added' };
    expect(formatHistoryChangeLine(change, SPLIT_TYPE_LABELS)).toBe('notes added');
  });

  it('formats a notes removed marker', () => {
    const change: ExpenseFieldChange = { field: 'notes', change: 'removed' };
    expect(formatHistoryChangeLine(change, SPLIT_TYPE_LABELS)).toBe('notes removed');
  });

  it('formats a receiptUrl marker change', () => {
    const change: ExpenseFieldChange = { field: 'receiptUrl', change: 'changed' };
    expect(formatHistoryChangeLine(change, SPLIT_TYPE_LABELS)).toBe('receipt changed');
  });
});
