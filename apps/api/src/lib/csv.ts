import { getCurrency, toMajorUnits } from '@divzy/shared';

// ---------------------------------------------------------------------------
// Group CSV export (docs/CONTRACTS.md §Groups → export.csv).
//
// Columns: Date,Description,Category,Currency,Amount,Paid by,Split type,
// then one column per active member holding that member's net effect for the
// row (paid − owed). Expenses come first in chronological order, followed by
// settlement rows (`Settlement: <from> → <to>`; payer +amount, recipient
// −amount — the same sign convention as the balance engine's computeNets).
// ---------------------------------------------------------------------------

export interface CsvGroup {
  name: string;
}

export interface CsvMember {
  id: string;
  name: string;
}

export interface CsvExpenseRow {
  date: Date;
  description: string;
  category: string;
  currency: string;
  /** Total expense amount in minor units. */
  amount: number;
  splitType: string;
  payers: Array<{ userId: string; name: string; amount: number }>;
  splits: Array<{ userId: string; amount: number }>;
}

export interface CsvSettlementRow {
  date: Date;
  currency: string;
  /** Amount transferred in minor units. */
  amount: number;
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
}

/** RFC 4180 escaping: quote fields containing commas/quotes/newlines, double quotes. */
function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Minor units → fixed decimal string with the currency's decimals ("12.50", "1200"). */
function decimalString(minor: number, currency: string): string {
  const { decimals } = getCurrency(currency);
  return toMajorUnits(minor, currency).toFixed(decimals);
}

/** Calendar date part of an ISO timestamp (exports don't need times). */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Build the CSV body for one group. `members` defines the per-member columns
 * (active members, in display order); rows involving users outside that list
 * (e.g. members who left) still export their shared columns correctly, they
 * just have no personal column.
 */
export function buildGroupCsv(
  group: CsvGroup,
  members: CsvMember[],
  expenses: CsvExpenseRow[],
  settlements: CsvSettlementRow[],
): string {
  void group; // Reserved for future header metadata; filename uses it today.

  const header = [
    'Date',
    'Description',
    'Category',
    'Currency',
    'Amount',
    'Paid by',
    'Split type',
    ...members.map((m) => m.name),
  ];
  const lines: string[] = [header.map(escapeField).join(',')];

  for (const expense of expenses) {
    const paidBy = new Map(expense.payers.map((p) => [p.userId, p.amount]));
    const owedBy = new Map(expense.splits.map((s) => [s.userId, s.amount]));
    const cells = [
      isoDate(expense.date),
      expense.description,
      expense.category,
      expense.currency,
      decimalString(expense.amount, expense.currency),
      expense.payers.map((p) => p.name).join(', '),
      expense.splitType,
      ...members.map((m) =>
        decimalString((paidBy.get(m.id) ?? 0) - (owedBy.get(m.id) ?? 0), expense.currency),
      ),
    ];
    lines.push(cells.map(escapeField).join(','));
  }

  for (const settlement of settlements) {
    const cells = [
      isoDate(settlement.date),
      `Settlement: ${settlement.fromName} → ${settlement.toName}`,
      '',
      settlement.currency,
      decimalString(settlement.amount, settlement.currency),
      settlement.fromName,
      '',
      ...members.map((m) =>
        decimalString(
          m.id === settlement.fromUserId
            ? settlement.amount
            : m.id === settlement.toUserId
              ? -settlement.amount
              : 0,
          settlement.currency,
        ),
      ),
    ];
    lines.push(cells.map(escapeField).join(','));
  }

  return `${lines.join('\r\n')}\r\n`;
}
