import { beforeEach, describe, expect, it, vi } from 'vitest';

// TC-WB2-02 — reverse direction of TC-WB2-01: KWD (3dp) -> USD (2dp), via
// convertAmountForUser's manual synthetic map. See the direction note in
// wi002-whitebox-manual-cross-decimal.test.ts for why this needs its own
// file (opposite fallback-table omission from the forward-direction test).
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

// KWD->USD direction: `to` (base for getRates) is USD, so USD must remain
// in the fallback table; KWD (the `from`/extra currency) is omitted.
vi.mock('../src/lib/rates-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates-fallback')>();
  const { KWD: _omitted, ...rest } = actual.FALLBACK_RATES;
  return { FALLBACK_RATES: rest };
});

import { convertAmountForUser } from '../src/lib/rates';

beforeEach(() => {
  findUniqueMock.mockReset();
  manualFindUniqueMock.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
});

describe('TC-WB2-02: manual synthetic rate map applies the correct cross-decimal exponent shift (KWD 3dp -> USD 2dp)', () => {
  it('converts KWD minor units to USD minor units via a manual rate correctly scaling down a decimal place', async () => {
    findUniqueMock.mockResolvedValue(null); // automatic chain exhausted for KWD->USD
    manualFindUniqueMock.mockResolvedValue({
      id: 'manual_kwd_2',
      userId: 'user_1',
      fromCurrency: 'KWD',
      toCurrency: 'USD',
      rate: 3.27, // 1 KWD = 3.27 USD
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await convertAmountForUser('user_1', 6111, 'KWD', 'USD'); // 6.111 KWD

    // exponentShift = 10^(decimals(USD) - decimals(KWD)) = 10^(2-3) = 0.1.
    // 6111 * 3.27 * 0.1 = 1998.297 -> round -> 1998.
    const expected = Math.round(6111 * 3.27 * 10 ** (2 - 3));
    expect(expected).toBe(1998);
    expect(result.amount).toBe(1998);
    expect(result.source).toBe('manual');
  });
});
