import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetManualRatePromptSessionForTests,
  nextUnshownPair,
  pairKey,
} from './manualRatePrompt';

// WI-002 — manual FX rate fallback prompt: trigger + session dedupe logic
// (spec-WI-002 "Manual rate prompt — trigger and dedupe" / "— dismiss").
describe('manual rate prompt session dedupe (WI-002)', () => {
  beforeEach(() => {
    _resetManualRatePromptSessionForTests();
  });

  it('prompts once when a balance cannot be auto-converted', () => {
    const unresolved = [{ currency: 'USD', amount: 1200 }];
    expect(nextUnshownPair(unresolved, 'PKR')).toEqual({
      currency: 'USD',
      viewerCurrency: 'PKR',
    });
  });

  it('does not re-prompt for the same pair on a later render within the same session', () => {
    const unresolved = [{ currency: 'USD', amount: 1200 }];
    nextUnshownPair(unresolved, 'PKR');
    expect(nextUnshownPair(unresolved, 'PKR')).toBeNull();
  });

  it('collapses duplicate unresolved entries for the same pair into a single prompt', () => {
    const unresolved = [
      { currency: 'USD', amount: 500 },
      { currency: 'USD', amount: 700 },
    ];
    expect(nextUnshownPair(unresolved, 'PKR')).toEqual({
      currency: 'USD',
      viewerCurrency: 'PKR',
    });
    expect(nextUnshownPair(unresolved, 'PKR')).toBeNull();
  });

  it('queues a different unresolved pair once the first has already been shown', () => {
    const unresolved = [
      { currency: 'USD', amount: 1200 },
      { currency: 'EUR', amount: 300 },
    ];
    expect(nextUnshownPair(unresolved, 'PKR')).toEqual({
      currency: 'USD',
      viewerCurrency: 'PKR',
    });
    expect(nextUnshownPair(unresolved, 'PKR')).toEqual({
      currency: 'EUR',
      viewerCurrency: 'PKR',
    });
  });

  it('treats the same source currency converting to a different viewer currency as a distinct pair', () => {
    const unresolved = [{ currency: 'USD', amount: 1200 }];
    expect(nextUnshownPair(unresolved, 'PKR')).not.toBeNull();
    expect(nextUnshownPair(unresolved, 'GBP')).not.toBeNull();
  });

  it('is eligible to prompt again after a session reset, per a future app session', () => {
    const unresolved = [{ currency: 'USD', amount: 1200 }];
    nextUnshownPair(unresolved, 'PKR');
    _resetManualRatePromptSessionForTests();
    expect(nextUnshownPair(unresolved, 'PKR')).not.toBeNull();
  });

  it('returns null when there is nothing unresolved', () => {
    expect(nextUnshownPair([], 'PKR')).toBeNull();
  });

  it('pairKey is stable and direction-sensitive', () => {
    expect(pairKey('USD', 'PKR')).toBe('USD->PKR');
    expect(pairKey('USD', 'PKR')).not.toBe(pairKey('PKR', 'USD'));
  });
});
