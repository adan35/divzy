import { describe, expect, it } from 'vitest';
import { decimalString } from '../src/lib/money-format';

// WI-018 / ADR-014 binding condition #1: decimalString extracted to a shared
// location so csv.ts (buildGroupCsv) and pdf.ts (buildGroupPdf) format
// currency amounts identically and can never drift apart.
describe('decimalString', () => {
  it('formats a 2-decimal currency (USD) from minor units', () => {
    expect(decimalString(1250, 'USD')).toBe('12.50');
  });

  it('formats a 0-decimal currency (JPY) with no fractional part', () => {
    expect(decimalString(1200, 'JPY')).toBe('1200');
  });

  it('formats a 3-decimal currency (KWD)', () => {
    expect(decimalString(1234, 'KWD')).toBe('1.234');
  });

  it('preserves the minus sign on negative amounts', () => {
    expect(decimalString(-500, 'USD')).toBe('-5.00');
  });

  it('formats zero without a sign', () => {
    expect(decimalString(0, 'EUR')).toBe('0.00');
  });
});
