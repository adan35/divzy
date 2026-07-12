import { format, formatDistanceToNowStrict, isThisYear, parseISO } from 'date-fns';
import { formatMoney, getCurrency } from '@divzy/shared';

export { formatMoney, getCurrency };

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? parseISO(value) : value;
}

/** Short date for list rows: "Mar 4" (adds the year when not this year). */
export function formatDate(value: string | Date): string {
  const date = toDate(value);
  return isThisYear(date) ? format(date, 'MMM d') : format(date, 'MMM d, yyyy');
}

/** Full date for detail views: "March 4, 2026". */
export function formatDateFull(value: string | Date): string {
  return format(toDate(value), 'MMMM d, yyyy');
}

/** Relative time for activity feeds: "3 hours ago", "just now". */
export function formatRelative(value: string | Date): string {
  const date = toDate(value);
  const seconds = Math.abs(Date.now() - date.getTime()) / 1000;
  if (seconds < 45) return 'just now';
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

/** 1–2 letter initials for avatars: "Sam Lee" -> "SL", "ana" -> "A". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

/**
 * Balance sentence per STYLE.md — balances read as sentences, never raw
 * signed numbers. `amount` is from the current user's perspective:
 * positive = `otherName` owes you; negative = you owe `otherName`.
 */
export function balanceSentence(
  otherName: string,
  amount: number,
  currency: string,
): string {
  if (amount === 0) return `You and ${otherName} are settled up`;
  if (amount > 0) return `${otherName} owes you ${formatMoney(amount, currency)}`;
  return `You owe ${otherName} ${formatMoney(-amount, currency)}`;
}
