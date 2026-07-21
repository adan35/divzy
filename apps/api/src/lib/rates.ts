import { pino } from 'pino';
import { LRUCache } from 'lru-cache';
import { getCurrency, isSupportedCurrency } from '@divzy/shared';
import { env } from '../config/env';
import { AppError } from './errors';
import { prisma } from './prisma';
import { FALLBACK_RATES } from './rates-fallback';

const log = pino({ name: 'rates', level: env.NODE_ENV === 'test' ? 'silent' : 'info' });

/** Cached rates are considered fresh for 12 hours (per ARCHITECTURE.md). */
const RATES_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

export interface RatesResult {
  base: string;
  /** Units of each currency per 1 unit of `base` (major units, like open.er-api.com). */
  rates: Record<string, number>;
  /** ISO timestamp of when the rates were obtained. */
  fetchedAt: string;
  source: 'live' | 'fallback';
}

/** UTC calendar day (midnight UTC) as a Date — matches ExchangeRateSnapshot's @db.Date column. */
function utcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** YYYY-MM-DD UTC calendar-day key used to bucket batch items in convertAmountsAsOf. */
function utcDayKey(date: Date): string {
  return utcDateOnly(date).toISOString().slice(0, 10);
}

/** Narrow a Prisma Json value to a clean { CODE: positive number } map. */
function jsonToRates(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [code, rate] of Object.entries(value as Record<string, unknown>)) {
      if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
        out[code.toUpperCase()] = rate;
      }
    }
  }
  return out;
}

/**
 * Derive a base-keyed rates map from the bundled USD-based fallback table:
 * rate(X vs base) = FALLBACK_RATES[X] / FALLBACK_RATES[base].
 */
export function fallbackRatesFor(base: string): Record<string, number> {
  const baseCode = base.toUpperCase();
  const baseRate = FALLBACK_RATES[baseCode];
  if (!baseRate) {
    throw new AppError(400, 'UNSUPPORTED_CURRENCY', `Currency ${baseCode} is not supported`);
  }
  const out: Record<string, number> = {};
  for (const [code, usdRate] of Object.entries(FALLBACK_RATES)) {
    out[code] = usdRate / baseRate;
  }
  return out;
}

/** Fetch live rates from EXCHANGE_RATE_API_URL/<base> (open.er-api.com shape). */
async function fetchLiveRates(base: string): Promise<Record<string, number>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.EXCHANGE_RATE_API_URL}/${base}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Exchange rate API responded with status ${response.status}`);
    }
    const payload = (await response.json()) as { result?: unknown; rates?: unknown };
    if (payload.result !== 'success') {
      throw new Error('Exchange rate API did not return result=success');
    }
    const rates = jsonToRates(payload.rates);
    if (Object.keys(rates).length === 0) {
      throw new Error('Exchange rate API returned no usable rates');
    }
    rates[base] = rates[base] ?? 1;
    return rates;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rates for `base` (already uppercased by the getRates() wrapper below),
 * resolved in order:
 * 1. Fresh cache row (< 12h old) — no network.
 * 2. Live fetch (5s timeout), cache upserted.
 * 3. Stale cache (live-origin data, better than static estimates).
 * 4. Bundled fallback table → source: 'fallback'.
 */
async function getRatesUncached(base: string): Promise<RatesResult> {
  const cached = await prisma.exchangeRateCache.findUnique({ where: { base } });
  const cachedRates = cached ? jsonToRates(cached.rates) : null;
  const hasUsableCache = cachedRates !== null && Object.keys(cachedRates).length > 0;

  if (cached && hasUsableCache && Date.now() - cached.fetchedAt.getTime() < RATES_TTL_MS) {
    return {
      base,
      rates: cachedRates,
      fetchedAt: cached.fetchedAt.toISOString(),
      source: 'live',
    };
  }

  try {
    const rates = await fetchLiveRates(base);
    const fetchedAt = new Date();
    await prisma.exchangeRateCache.upsert({
      where: { base },
      update: { rates, fetchedAt },
      create: { base, rates, fetchedAt },
    });
    // Best-effort, additive: freeze today's snapshot on the first successful
    // live fetch of the UTC day (WI-014, ADR-012). create-if-absent via
    // skipDuplicates so later same-day fetches are no-ops and a past day's
    // snapshot is never overwritten. Wrapped so any failure is logged and
    // swallowed — must never break or slow the getRates() contract above.
    try {
      await prisma.exchangeRateSnapshot.createMany({
        data: [{ base, date: utcDateOnly(fetchedAt), rates }],
        skipDuplicates: true,
      });
    } catch (snapshotErr) {
      log.warn({ err: snapshotErr, base }, 'Failed to write exchange rate snapshot');
    }
    return { base, rates, fetchedAt: fetchedAt.toISOString(), source: 'live' };
  } catch (err) {
    log.warn({ err, base }, 'Live exchange rate fetch failed');
    if (cached && hasUsableCache) {
      return {
        base,
        rates: cachedRates,
        fetchedAt: cached.fetchedAt.toISOString(),
        source: 'live',
      };
    }
    return {
      base,
      rates: fallbackRatesFor(base),
      fetchedAt: new Date().toISOString(),
      source: 'fallback',
    };
  }
}

/** 60s in-process shield in front of the 12h ExchangeRateCache DB row. */
const RATES_MEMO_TTL_MS = 60_000;
/** Keyed by uppercased base; values are the in-flight/resolved RatesResult
 *  promise so concurrent misses coalesce (single-flight) rather than stampede. */
const ratesMemo = new LRUCache<string, Promise<RatesResult>>({
  max: 200,
  ttl: RATES_MEMO_TTL_MS,
});

/**
 * 60s in-process TTL memo + single-flight in front of getRatesUncached's DB
 * read (spec-WI-072 §1). Memoizes the in-flight/resolved PROMISE, set
 * synchronously before any await, so concurrent misses for the same base
 * coalesce into one findUnique + at most one live fetch + one upsert + one
 * snapshot write instead of stampeding. Never a second source of truth: the
 * 4-tier resolution chain, rounding, and fallback flags are all unchanged —
 * this only avoids re-hitting Postgres for repeat calls within the window.
 */
export function getRates(baseInput: string): Promise<RatesResult> {
  const base = baseInput.toUpperCase();
  const hit = ratesMemo.get(base);
  if (hit) return hit;
  const pending = getRatesUncached(base);
  ratesMemo.set(base, pending);
  // Never pin a rejection (mirrors lib/cache.ts's "never cache a rejection"):
  // drop the entry if resolution throws so the next caller re-runs the full
  // chain instead of inheriting a cached throw. getRatesUncached only throws
  // for an unsupported base via fallbackRatesFor(); the /rates route already
  // guards that with isSupportedCurrency before ever calling in.
  pending.catch(() => {
    if (ratesMemo.get(base) === pending) ratesMemo.delete(base);
  });
  return pending;
}

// ---------------------------------------------------------------------------
// Test-only support (NOT part of spec-WI-072 §1's public interface).
//
// `ratesMemo` is a process-wide singleton by design (mirrors lib/cache.ts's
// responseStore). That is correct for production, but any test file that
// mocks prisma and calls getRates()/resolveConversionRates()/convertAmount*
// more than once for the SAME base across different `it()` blocks (a common
// pattern in this suite: re-mocking `exchangeRateCache.findUnique` per test)
// will now observe a stale memoized result from an earlier test in the same
// file instead of hitting the fresh mock, unless it clears this state first.
// Call this in a `beforeEach` — see lib/cache.ts's resetCacheForTests() for
// the identical precedent.
// ---------------------------------------------------------------------------
export function resetRatesMemoForTests(): void {
  ratesMemo.clear();
}

/**
 * Convert `amount` (integer minor units of `from`) into integer minor units
 * of `to`, using the cross rate via the base the map is keyed on. The rate is
 * corrected for differing minor-unit exponents (e.g. JPY has 0 decimals) so
 * the result is minor units of the target currency. Single Math.round at the
 * end — money stays integer.
 */
export function convert(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number {
  const fromCode = from.toUpperCase();
  const toCode = to.toUpperCase();
  if (fromCode === toCode) return amount;

  const fromRate = rates[fromCode];
  const toRate = rates[toCode];
  if (!fromRate || !toRate) {
    throw new AppError(
      500,
      'RATE_UNAVAILABLE',
      `No exchange rate available to convert ${fromCode} to ${toCode}`,
    );
  }

  const exponentShift = 10 ** (getCurrency(toCode).decimals - getCurrency(fromCode).decimals);
  return Math.round(amount * (toRate / fromRate) * exponentShift);
}

/**
 * Fetch-once, reuse-many rates resolution for callers converting multiple
 * amounts to the same target currency in one request (dashboard totals,
 * friends list, group balances tab). Calls getRates(to) exactly once — never
 * a second rate source — then patches any of `extraCurrencies` missing from
 * that map from the bundled fallback table, flagging usedFallbackRates if any
 * patch occurred. Callers then loop convert(amount, itemCurrency, to, rates)
 * synchronously per item — no further I/O. See spec-WI-001 (analytics).
 */
export async function resolveConversionRates(
  to: string,
  extraCurrencies: string[] = [],
): Promise<{ rates: Record<string, number>; usedFallbackRates: boolean }> {
  const toCode = to.toUpperCase();
  const ratesResult = await getRates(toCode);
  const rates: Record<string, number> = { ...ratesResult.rates };
  rates[toCode] = rates[toCode] ?? 1;

  let usedFallbackRates = ratesResult.source === 'fallback';
  let fallbackMap: Record<string, number> | null = null;
  for (const currency of extraCurrencies) {
    const code = currency.toUpperCase();
    if (rates[code] === undefined) {
      fallbackMap = fallbackMap ?? fallbackRatesFor(toCode);
      const fallbackRate = fallbackMap[code];
      if (fallbackRate !== undefined) {
        rates[code] = fallbackRate;
        usedFallbackRates = true;
      }
    }
  }

  return { rates, usedFallbackRates };
}

/**
 * Convenience single-conversion wrapper for call sites converting exactly one
 * amount (e.g. a settle-dialog preview figure). Automatic-chain only — see
 * convertAmountForUser for the manual-rate-aware entry point (WI-002).
 */
export async function convertAmount(
  amount: number,
  from: string,
  to: string,
): Promise<{ amount: number; source: 'live' | 'fallback' }> {
  const fromCode = from.toUpperCase();
  const toCode = to.toUpperCase();

  if (!isSupportedCurrency(fromCode)) {
    throw new AppError(400, 'UNSUPPORTED_CURRENCY', `Currency ${fromCode} is not supported`);
  }
  if (!isSupportedCurrency(toCode)) {
    throw new AppError(400, 'UNSUPPORTED_CURRENCY', `Currency ${toCode} is not supported`);
  }

  if (fromCode === toCode) {
    return { amount, source: 'live' };
  }

  const { rates, usedFallbackRates } = await resolveConversionRates(toCode, [fromCode]);
  const converted = convert(amount, fromCode, toCode, rates);
  return { amount: converted, source: usedFallbackRates ? 'fallback' : 'live' };
}

/**
 * Manual-rate-aware conversion entry point (WI-002). Tries the automatic
 * chain first (convertAmount, unchanged); only on RATE_UNAVAILABLE does it
 * fall back to a stored ManualExchangeRate for this user+pair. The automatic
 * rate always takes precedence once available — a manual row is never
 * consulted while convertAmount can resolve the pair, and is never deleted
 * once superseded (ADR-006). UNSUPPORTED_CURRENCY rethrows immediately
 * without consulting the manual table.
 */
export async function convertAmountForUser(
  userId: string,
  amount: number,
  from: string,
  to: string,
): Promise<{ amount: number; source: 'live' | 'fallback' | 'manual' }> {
  const fromCode = from.toUpperCase();
  const toCode = to.toUpperCase();

  try {
    return await convertAmount(amount, fromCode, toCode);
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== 'RATE_UNAVAILABLE') {
      throw err;
    }

    const manual = await prisma.manualExchangeRate.findUnique({
      where: {
        userId_fromCurrency_toCurrency: { userId, fromCurrency: fromCode, toCurrency: toCode },
      },
    });
    if (!manual) {
      throw err;
    }

    const converted = convert(amount, fromCode, toCode, { [fromCode]: 1, [toCode]: manual.rate });
    return { amount: converted, source: 'manual' };
  }
}

/**
 * Quality of the rate behind an as-of-date conversion (WI-014, ADR-012
 * Decision 3). `'exact'` = a same-date ExchangeRateSnapshot existed (also the
 * same-currency short-circuit). `'approximated'` = no snapshot for that day,
 * so today's automatic-chain rate stands in for the past. `'fallback'` = no
 * snapshot *and* today's rate itself resolved to the bundled table — the
 * as-of equivalent of `usedFallbackRates: true`.
 */
export type RateBasis = 'exact' | 'approximated' | 'fallback';

/**
 * One result per input item to convertAmountsAsOf, in input order. A batch
 * degrades per item, never per call: a bad `from`/`asOfDate` on one item
 * yields `'unresolved'` for that item alone so a single future-dated or
 * malformed expense on a page cannot strip converted amounts from its
 * otherwise-valid siblings (spec-WI-014 §2.2, DRB R1 fix).
 */
export type AsOfResult =
  | { status: 'ok'; amount: number; rateBasis: RateBasis }
  | { status: 'unresolved'; reason: 'UNSUPPORTED_CURRENCY' | 'INVALID_AS_OF_DATE' };

interface ParsedAsOfDate {
  ok: true;
  /** UTC-midnight Date for this item's calendar day (matches snapshot rows). */
  day: Date;
  /** YYYY-MM-DD UTC calendar-day batching key. */
  dayKey: string;
}

/** Parse `input` and confirm its UTC calendar day is `<= today-UTC` (never a throw). */
function parseAsOfDate(input: Date | string): ParsedAsOfDate | { ok: false } {
  const parsed = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false };
  }
  const day = utcDateOnly(parsed);
  if (day.getTime() > utcDateOnly(new Date()).getTime()) {
    return { ok: false }; // future-dated — never coerced to "today"
  }
  return { ok: true, day, dayKey: utcDayKey(parsed) };
}

interface DayResolution {
  rates: Record<string, number>;
  /** true = backed by an exact same-date ExchangeRateSnapshot. */
  snapshot: boolean;
  usedFallbackRates: boolean;
}

/**
 * Batch as-of-date conversion (WI-014, spec §2.2/§2.3; ADR-012). Resolves
 * `(from, to, asOfDate)` per item using an exact same-date
 * ExchangeRateSnapshot when one exists, else today's rate via the automatic
 * chain (resolveConversionRates), flagged 'approximated' or 'fallback'.
 * Batches one rates-map resolution per distinct UTC day among the
 * still-resolvable items — never one lookup per row. Throws
 * 400 UNSUPPORTED_CURRENCY only for the shared `to`; a per-item unsupported
 * `from` or future/unparseable `asOfDate` degrades to an `'unresolved'`
 * result for that item alone and never fails the call (DRB R1).
 */
export async function convertAmountsAsOf(
  to: string,
  items: ReadonlyArray<{ amount: number; from: string; asOfDate: Date | string }>,
): Promise<AsOfResult[]> {
  const toCode = to.toUpperCase();
  if (!isSupportedCurrency(toCode)) {
    throw new AppError(400, 'UNSUPPORTED_CURRENCY', `Currency ${toCode} is not supported`);
  }

  interface Screened {
    unresolved?: 'UNSUPPORTED_CURRENCY' | 'INVALID_AS_OF_DATE';
    fromCode?: string;
    day?: Date;
    dayKey?: string;
  }

  // Step 2 — screen each item's asOfDate then from, per item, no throw.
  const screened: Screened[] = items.map((item) => {
    const parsedDate = parseAsOfDate(item.asOfDate);
    if (!parsedDate.ok) {
      return { unresolved: 'INVALID_AS_OF_DATE' };
    }
    const fromCode = item.from.toUpperCase();
    if (!isSupportedCurrency(fromCode)) {
      return { unresolved: 'UNSUPPORTED_CURRENCY' };
    }
    return { fromCode, day: parsedDate.day, dayKey: parsedDate.dayKey };
  });

  // Step 3 — group still-resolvable, non-same-currency items by distinct UTC
  // day; one rates-map resolution per distinct day, not per row.
  const daysToResolve = new Map<string, { day: Date; froms: Set<string> }>();
  for (const s of screened) {
    if (s.unresolved || !s.fromCode || s.fromCode === toCode) continue;
    const entry = daysToResolve.get(s.dayKey!);
    if (entry) {
      entry.froms.add(s.fromCode);
    } else {
      daysToResolve.set(s.dayKey!, { day: s.day!, froms: new Set([s.fromCode]) });
    }
  }

  const dayResolutions = new Map<string, DayResolution>();
  for (const [dayKey, { day, froms }] of daysToResolve) {
    const snapshotRow = await prisma.exchangeRateSnapshot.findUnique({
      where: { base_date: { base: toCode, date: day } },
    });
    if (snapshotRow) {
      const rates = jsonToRates(snapshotRow.rates);
      rates[toCode] = rates[toCode] ?? 1;
      dayResolutions.set(dayKey, { rates, snapshot: true, usedFallbackRates: false });
    } else {
      const { rates, usedFallbackRates } = await resolveConversionRates(toCode, [...froms]);
      dayResolutions.set(dayKey, { rates, snapshot: false, usedFallbackRates });
    }
  }

  // Step 4 — per item, synchronous (no further I/O).
  return screened.map((s, index) => {
    if (s.unresolved) {
      return { status: 'unresolved', reason: s.unresolved };
    }
    const item = items[index];
    if (s.fromCode === toCode) {
      return { status: 'ok', amount: item.amount, rateBasis: 'exact' };
    }
    const dayResolution = dayResolutions.get(s.dayKey!)!;
    const amount = convert(item.amount, s.fromCode!, toCode, dayResolution.rates);
    const rateBasis: RateBasis = dayResolution.snapshot
      ? 'exact'
      : dayResolution.usedFallbackRates
        ? 'fallback'
        : 'approximated';
    return { status: 'ok', amount, rateBasis };
  });
}

/**
 * Single-conversion convenience wrapper for convertAmountsAsOf (e.g. an
 * expense-detail route). Unwraps the sole result: an `'unresolved'` result is
 * re-thrown as its 400 code (INVALID_AS_OF_DATE / UNSUPPORTED_CURRENCY) so
 * this fn's throwing contract matches convertAmount's (a single-item caller
 * legitimately wants a hard error).
 */
export async function convertAmountAsOf(
  amount: number,
  from: string,
  to: string,
  asOfDate: Date | string,
): Promise<{ amount: number; rateBasis: RateBasis }> {
  const [result] = await convertAmountsAsOf(to, [{ amount, from, asOfDate }]);
  if (result.status === 'unresolved') {
    const message =
      result.reason === 'INVALID_AS_OF_DATE'
        ? 'asOfDate is invalid or in the future'
        : `Currency ${from.toUpperCase()} is not supported`;
    throw new AppError(400, result.reason, message);
  }
  return { amount: result.amount, rateBasis: result.rateBasis };
}
