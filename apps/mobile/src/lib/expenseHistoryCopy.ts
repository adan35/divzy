import { categoryInfo, formatMoney, type ExpenseFieldChange, type ExpenseRevisionKind } from '@divzy/shared';
import { formatDate } from './format';

/**
 * Truncates free-text values shown in the description change line (spec-WI-017
 * §5.1: "~40 chars each"). Adds a single ellipsis character when the value
 * exceeds `maxLen`; leaves shorter/equal-length strings untouched.
 */
export function truncate(value: string, maxLen = 40): string {
  return value.length > maxLen ? `${value.slice(0, maxLen - 1)}…` : value;
}

/** `CREATED`/`UPDATED` header line — UPDATED has no single line of its own (see formatHistoryChangeLine). */
export function formatHistoryKindLine(kind: ExpenseRevisionKind): string {
  return kind === 'CREATED' ? 'created this expense' : '';
}

/**
 * One line of copy per changed field, per spec-WI-017 §5.1's shared copy
 * templates — this text is a hard contract with the web build and must match
 * verbatim. `splitTypeLabels` is passed in (rather than owned here) so the
 * screen's existing `SPLIT_TYPE_LABELS` const stays the single source of truth.
 */
export function formatHistoryChangeLine(
  change: ExpenseFieldChange,
  splitTypeLabels: Record<string, string>,
): string {
  switch (change.field) {
    case 'description':
      return `changed description: "${truncate(change.from)}" → "${truncate(change.to)}"`;
    case 'amount':
      return `changed amount from ${formatMoney(change.from, change.fromCurrency)} to ${formatMoney(change.to, change.toCurrency)}`;
    case 'currency':
      return `changed currency from ${change.from} to ${change.to}`;
    case 'category':
      return `changed category from ${categoryInfo(change.from).label} to ${categoryInfo(change.to).label}`;
    case 'date':
      return `changed date from ${formatDate(change.from)} to ${formatDate(change.to)}`;
    case 'splitType':
      return `changed split from ${splitTypeLabels[change.from]} to ${splitTypeLabels[change.to]}`;
    case 'notes':
      return `notes ${change.change}`;
    case 'receiptUrl':
      return `receipt ${change.change}`;
    default:
      return '';
  }
}
