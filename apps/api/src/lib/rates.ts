import { pino } from 'pino';
import { getCurrency } from '@divzy/shared';
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
 * Rates for `base`, resolved in order:
 * 1. Fresh cache row (< 12h old) — no network.
 * 2. Live fetch (5s timeout), cache upserted.
 * 3. Stale cache (live-origin data, better than static estimates).
 * 4. Bundled fallback table → source: 'fallback'.
 */
export async function getRates(baseInput: string): Promise<RatesResult> {
  const base = baseInput.toUpperCase();

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
