import { describe, expect, it } from 'vitest';
import { zManualRateInput } from '../src/schemas';

// Traces to story-WI-002 (analytics) scenario "Manual rate input validation".
describe('zManualRateInput', () => {
  it('accepts a valid "1 from = ? to" input and uppercases codes', () => {
    const parsed = zManualRateInput.parse({ from: 'usd', to: 'pkr', rate: 278.5 });
    expect(parsed).toEqual({ from: 'USD', to: 'PKR', rate: 278.5 });
  });

  it('rejects a non-numeric rate', () => {
    expect(() => zManualRateInput.parse({ from: 'USD', to: 'PKR', rate: 'abc' })).toThrow();
  });

  it('rejects a zero rate', () => {
    expect(() => zManualRateInput.parse({ from: 'USD', to: 'PKR', rate: 0 })).toThrow();
  });

  it('rejects a negative rate', () => {
    expect(() => zManualRateInput.parse({ from: 'USD', to: 'PKR', rate: -5 })).toThrow();
  });

  it('rejects a non-finite rate', () => {
    expect(() => zManualRateInput.parse({ from: 'USD', to: 'PKR', rate: Infinity })).toThrow();
    expect(() => zManualRateInput.parse({ from: 'USD', to: 'PKR', rate: NaN })).toThrow();
  });

  it('rejects from === to', () => {
    expect(() => zManualRateInput.parse({ from: 'USD', to: 'USD', rate: 1 })).toThrow();
    // Case-insensitive: uppercases before comparing.
    expect(() => zManualRateInput.parse({ from: 'usd', to: 'USD', rate: 1 })).toThrow();
  });

  it('rejects malformed currency codes', () => {
    expect(() => zManualRateInput.parse({ from: 'US', to: 'PKR', rate: 1 })).toThrow();
    expect(() => zManualRateInput.parse({ from: 'US1', to: 'PKR', rate: 1 })).toThrow();
  });
});
