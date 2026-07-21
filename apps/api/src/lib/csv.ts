import { computeNets, type LedgerExpense, type LedgerSettlement } from '@divzy/shared';
import { decimalString } from './money-format';

// ---------------------------------------------------------------------------
// Group CSV export (docs/CONTRACTS.md §Groups → export.csv).
//
// Columns: Date,Description,Category,Currency,Amount,Paid by,Split type,
// then one column per active member holding that member's net effect for the
// row (paid − owed). Expenses come first in chronological order, followed by
// settlement rows (`Settlement: <from> → <to>`; payer +amount, recipient
// −amount — the same sign convention as the balance engine's computeNets).
//
// Additive balance-summary section (WI-030 / ADR-021, shared semantics with
// the WI-029 PDF export): appended after all expense/settlement rows, never
// altering them. Nets are computed once via `computeNets` over the same
// loaded expenses/settlements (never a second balance computation). "Total
// outstanding" per currency = sum of every positive per-member net in that
// currency (a naive signed sum is always 0 by the zero-sum invariant). The
// owed-vs-owes signal is a real *textual* signal (CSV cannot carry color):
// an explicit sign (+/-, 0 = "settled up") AND a direction label ("owed to
// them" / "they owe" / "settled up") — never a bare sign alone.
// ---------------------------------------------------------------------------

export interface CsvGroup {
  name: string;
  /** Group emoji, for the PDF export's branded header (WI-029). Never used by CSV. */
  emoji?: string;
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

  appendBalanceSummary(lines, members, expenses, settlements);

  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Signed, currency-decimal-formatted net: leading `+` for positive, the
 * `-` `decimalString` already emits for negative, no sign for exactly zero
 * (paired with the "settled up" label so zero is never ambiguous/blank).
 */
function signedDecimalString(minor: number, currency: string): string {
  const formatted = decimalString(minor, currency);
  return minor > 0 ? `+${formatted}` : formatted;
}

/** ADR-021 direction label: pairs with the sign, never a bare +/- alone. */
function directionLabel(minor: number): string {
  if (minor > 0) return 'owed to them';
  if (minor < 0) return 'they owe';
  return 'settled up';
}

/**
 * Appends the WI-030 balance-summary section (ADR-021, shared semantics with
 * the WI-029 PDF export): a blank-line separator, a `Balance summary` header,
 * one row per member per currency they have a net in (narrow `Member,
 * Currency, Net, Direction` shape, distinct from the wide expense/settlement
 * rows above), then one `Total outstanding` row per currency. Nets come from
 * `computeNets` over the same already-loaded/filtered data — never a second
 * balance computation. Currencies are sorted for deterministic output and
 * never combined/converted (ARCH invariant 5 is not touched: the WI-001
 * converted display figure is never read here).
 */
function appendBalanceSummary(
  lines: string[],
  members: CsvMember[],
  expenses: readonly LedgerExpense[],
  settlements: readonly LedgerSettlement[],
): void {
  const nets = computeNets(expenses, settlements);
  const currencies = [...nets.keys()].sort((a, b) => a.localeCompare(b));

  lines.push('');
  lines.push(escapeField('Balance summary'));
  lines.push(['Member', 'Currency', 'Net', 'Direction'].map(escapeField).join(','));

  for (const currency of currencies) {
    const perUser = nets.get(currency)!;
    for (const member of members) {
      if (!perUser.has(member.id)) continue;
      const net = perUser.get(member.id)!;
      const cells = [member.name, currency, signedDecimalString(net, currency), directionLabel(net)];
      lines.push(cells.map(escapeField).join(','));
    }
  }

  for (const currency of currencies) {
    const perUser = nets.get(currency)!;
    const totalOutstanding = [...perUser.values()]
      .filter((amount) => amount > 0)
      .reduce((sum, amount) => sum + amount, 0);
    const cells = ['Total outstanding', currency, decimalString(totalOutstanding, currency)];
    lines.push(cells.map(escapeField).join(','));
  }
}
