import { describe, expect, it, vi } from 'vitest';

// convertBalanceForViewer must only ever swallow AppError(RATE_UNAVAILABLE) — anything
// else convert() might throw has to propagate, not be silently treated as an
// unconvertible-currency leftover. convert() itself never throws anything else today,
// so this mocks it to simulate a hypothetical future/unexpected error type.
vi.mock('../src/lib/rates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates')>();
  return {
    ...actual,
    convert: vi.fn(() => {
      throw new Error('unexpected non-AppError failure');
    }),
  };
});

import { convertBalanceForViewer } from '../src/lib/balance-conversion';

describe('convertBalanceForViewer — error propagation', () => {
  it('re-throws a non-RATE_UNAVAILABLE error rather than treating it as an unconvertible leftover', () => {
    expect(() =>
      convertBalanceForViewer([{ currency: 'USD', amount: 100 }], 'GBP', { USD: 1, GBP: 1 }),
    ).toThrow('unexpected non-AppError failure');
  });
});
