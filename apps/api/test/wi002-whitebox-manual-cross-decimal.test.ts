import { beforeEach, describe, expect, it, vi } from 'vitest';

// TC-WB2-01 — the white-box case flagged explicitly in build-WI-002.md's
// "Notes for Test stage": the manual-rate synthetic map in
// convertAmountForUser (`{ [from]: 1, [to]: manualRow.rate }`) reuses
// convert()'s exact cross-rate/exponent-shift/single-round math, but the
// only test on file (rates-manual.test.ts) exercises it with PKR<->USD —
// both 2-decimal currencies, i.e. exponentShift = 1 always. This test picks
// a manual rate crossing a *different* minor-unit exponent (USD, 2dp ->
// KWD, 3dp) to independently verify the exponent shift still applies
// correctly through the synthetic 2-entry map.
//
// The reverse direction (KWD -> USD) is in the sibling file
// wi002-whitebox-manual-cross-decimal-reverse.test.ts: forcing genuine
// RATE_UNAVAILABLE requires omitting the `from` currency from the mocked
// fallback table while leaving the `to`/base currency intact (else
// fallbackRatesFor throws UNSUPPORTED_CURRENCY on the base itself instead —
// see the direction note in wi002-blackbox-independent.test.ts), and the two
// directions need opposite omissions, so they can't share one file's
// module-level vi.mock.
//
// Test-plan: .company/domains/analytics/test-plans/test-plan-WI-002.md

const findUniqueMock = vi.fn();
const manualFindUniqueMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      upsert: vi.fn(),
    },
    manualExchangeRate: {
      findUnique: (...args: unknown[]) => manualFindUniqueMock(...args),
    },
  },
}));

// USD->KWD direction: `to` (base for getRates) is KWD, so KWD must remain
// in the fallback table; USD (the `from`/extra currency) is omitted so the
// automatic chain genuinely cannot resolve it, forcing RATE_UNAVAILABLE.
vi.mock('../src/lib/rates-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates-fallback')>();
  const { USD: _omitted, ...rest } = actual.FALLBACK_RATES;
  return { FALLBACK_RATES: rest };
});

import { convertAmountForUser } from '../src/lib/rates';

beforeEach(() => {
  findUniqueMock.mockReset();
  manualFindUniqueMock.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
});

describe('TC-WB2-01: manual synthetic rate map applies the correct cross-decimal exponent shift (USD 2dp -> KWD 3dp)', () => {
  it('converts USD minor units to KWD minor units via a manual rate without dropping the third decimal', async () => {
    findUniqueMock.mockResolvedValue(null); // automatic chain exhausted for USD->KWD
    manualFindUniqueMock.mockResolvedValue({
      id: 'manual_kwd',
      userId: 'user_1',
      fromCurrency: 'USD',
      toCurrency: 'KWD',
      rate: 0.3057, // 1 USD = 0.3057 KWD
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await convertAmountForUser('user_1', 1999, 'USD', 'KWD'); // 19.99 USD

    // Hand-computed independent of convert(): synthetic map is
    // { USD: 1, KWD: 0.3057 }. cross = 0.3057/1 = 0.3057.
    // exponentShift = 10^(decimals(KWD) - decimals(USD)) = 10^(3-2) = 10.
    // 1999 * 0.3057 * 10 = 6110.943 -> round -> 6111 (6.111 KWD).
    // A missing/incorrect exponent shift would instead yield round(1999*0.3057)=611
    // (an order of magnitude off) — this test would fail loudly if that regressed.
    const expected = Math.round(1999 * 0.3057 * 10 ** (3 - 2));
    expect(expected).toBe(6111);
    expect(result.amount).toBe(6111);
    expect(result.source).toBe('manual');
  });
});
