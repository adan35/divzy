import { getCurrency } from './currencies';

/**
 * All monetary amounts in Divzy are integers in the currency's minor unit
 * (cents for USD, yen for JPY, fils for KWD ...). Floating point never touches
 * money outside of display formatting.
 *
 * MAX_AMOUNT_MINOR keeps every amount safely inside Postgres INT4 range.
 */
export const MAX_AMOUNT_MINOR = 2_000_000_000;

export class MoneyError extends Error {
  readonly code = 'MONEY_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function isValidAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= MAX_AMOUNT_MINOR;
}

export function assertValidAmount(value: number, label = 'amount'): void {
  if (!isValidAmount(value)) {
    throw new MoneyError(`${label} must be an integer between -${MAX_AMOUNT_MINOR} and ${MAX_AMOUNT_MINOR}, got ${value}`);
  }
}

export function sumAmounts(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/**
 * Parse a user-entered decimal amount ("12.34", 12.34) into integer minor
 * units for the given currency. String math — no float rounding artifacts.
 * Rounds half-up on excess precision.
 */
export function toMinorUnits(input: string | number, currency: string): number {
  const { decimals } = getCurrency(currency);
  const raw = typeof input === 'number' ? input.toFixed(decimals + 4) : String(input).trim();
  const match = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(raw);
  if (!match) throw new MoneyError(`Invalid amount: "${input}"`);
  const [, sign, intPart, fracRaw = ''] = match;
  const kept = fracRaw.slice(0, decimals).padEnd(decimals, '0');
  const rest = fracRaw.slice(decimals);
  let minor = BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(kept === '' ? '0' : kept);
  if (rest.length > 0 && Number(rest[0]) >= 5) minor += 1n;
  const result = Number(minor) * (sign === '-' ? -1 : 1);
  if (!Number.isSafeInteger(result) || Math.abs(result) > MAX_AMOUNT_MINOR) {
    throw new MoneyError(`Amount out of range: "${input}"`);
  }
  return result;
}

/** Convert integer minor units to a decimal number for display math (charts). */
export function toMajorUnits(minor: number, currency: string): number {
  const { decimals } = getCurrency(currency);
  return minor / 10 ** decimals;
}

/**
 * Format minor units for display, e.g. formatMoney(123456, 'USD') => "$1,234.56".
 * Falls back to a symbol-prefixed fixed decimal when Intl lacks the currency.
 */
export function formatMoney(minor: number, currency: string, locale?: string): string {
  const info = getCurrency(currency);
  const major = toMajorUnits(minor, currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: info.code,
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    }).format(major);
  } catch {
    return `${info.symbol}${major.toFixed(info.decimals)}`;
  }
}

/**
 * Split `total` (integer minor units) proportionally to non-negative integer
 * `weights`, guaranteeing the parts sum exactly to `total`.
 *
 * Largest-remainder method: each part gets floor(total * w / W), then the
 * remaining units go to the entries with the largest remainders (ties broken
 * by lowest index, so the result is deterministic).
 *
 * Negative totals are allocated on the absolute value and negated.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  assertValidAmount(total, 'total');
  if (weights.length === 0) throw new MoneyError('allocate: weights must not be empty');
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) {
    throw new MoneyError('allocate: weights must be non-negative integers');
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) {
    if (total === 0) return weights.map(() => 0);
    throw new MoneyError('allocate: weights sum to zero for a non-zero total');
  }

  const negative = total < 0;
  const abs = BigInt(Math.abs(total));
  const W = BigInt(weightSum);

  const bases = weights.map((w) => (abs * BigInt(w)) / W);
  const remainders = weights.map((w, i) => ({ i, rem: (abs * BigInt(w)) % W }));
  let leftover = abs - bases.reduce((a, b) => a + b, 0n);

  remainders.sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    bases[i] = (bases[i] ?? 0n) + 1n;
    leftover -= 1n;
  }

  return bases.map((b) => (negative ? -Number(b) : Number(b)));
}
