// WI-023 — zCreateSettlementInput gains an optional proofUrl field, bound
// byte-identical to Expense.receiptUrl (ADR-020 Decision 3). Written before
// the field existed on the schema (red: `proofUrl` was stripped/absent and
// self-pay refinement was the only refinement present).
import { describe, expect, it } from 'vitest';
import { zCreateSettlementInput } from '../src/schemas';

const ME = 'user_me_001';
const ANA = 'user_ana_001';

function baseInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    fromUserId: ME,
    toUserId: ANA,
    amount: 100,
    currency: 'USD',
    date: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('zCreateSettlementInput — proofUrl (WI-023)', () => {
  it('accepts a valid proofUrl and preserves it', () => {
    const result = zCreateSettlementInput.parse(baseInput({ proofUrl: '/uploads/receipts/abc.jpg' }));
    expect(result.proofUrl).toBe('/uploads/receipts/abc.jpg');
  });

  it('is optional — absence parses cleanly with proofUrl undefined', () => {
    const result = zCreateSettlementInput.parse(baseInput());
    expect(result.proofUrl).toBeUndefined();
  });

  it('trims whitespace', () => {
    const result = zCreateSettlementInput.parse(baseInput({ proofUrl: '  /uploads/receipts/abc.jpg  ' }));
    expect(result.proofUrl).toBe('/uploads/receipts/abc.jpg');
  });

  it('rejects a proofUrl over 500 chars', () => {
    expect(() => zCreateSettlementInput.parse(baseInput({ proofUrl: 'a'.repeat(501) }))).toThrow();
  });

  it('does not disturb the existing self-pay superRefine', () => {
    expect(() =>
      zCreateSettlementInput.parse(baseInput({ toUserId: ME, proofUrl: '/uploads/receipts/abc.jpg' })),
    ).toThrow();
  });
});
