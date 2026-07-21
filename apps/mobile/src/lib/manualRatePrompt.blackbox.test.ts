// Test-stage functional/black-box coverage — story-WI-002 (settlements, mobile).
//
// Written by test-settlements directly from story-WI-002's Gherkin scenarios,
// independently of dev-mobile-settlements' own manualRatePrompt.test.ts
// (different fixture currencies/session sequencing). Same platform-harness
// limitation noted in settlements.blackbox.test.ts applies: this exercises
// the pure `nextUnshownPair`/`pairKey` functions the dialog hook wraps, not
// the rendered dialog itself.
import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetManualRatePromptSessionForTests,
  nextUnshownPair,
  pairKey,
} from './manualRatePrompt';

afterEach(() => {
  _resetManualRatePromptSessionForTests();
});

describe('story-WI-002 (mobile) · manual-rate prompt trigger and dedupe', () => {
  it('Happy path — prompted once when a balance can\'t be auto-converted', () => {
    const result = nextUnshownPair([{ currency: 'AUD', amount: 4400 }], 'CAD');
    expect(result).toEqual({ currency: 'AUD', viewerCurrency: 'CAD' });
  });

  it('the prompt does not reappear for the same pair on a later call within the same session', () => {
    nextUnshownPair([{ currency: 'AUD', amount: 4400 }], 'CAD');
    const second = nextUnshownPair([{ currency: 'AUD', amount: 4400 }], 'CAD');
    expect(second).toBeNull();
  });

  it('Edge case — multiple missing pairs: queues a different unresolved pair once the first has been shown', () => {
    nextUnshownPair([{ currency: 'AUD', amount: 4400 }], 'CAD');
    const next = nextUnshownPair(
      [
        { currency: 'AUD', amount: 4400 },
        { currency: 'NZD', amount: 900 },
      ],
      'CAD',
    );
    expect(next).toEqual({ currency: 'NZD', viewerCurrency: 'CAD' });
  });

  it('treats the same source currency converting to a different viewer currency as a distinct pair', () => {
    nextUnshownPair([{ currency: 'AUD', amount: 4400 }], 'CAD');
    const differentTarget = nextUnshownPair([{ currency: 'AUD', amount: 4400 }], 'NZD');
    expect(differentTarget).toEqual({ currency: 'AUD', viewerCurrency: 'NZD' });
  });

  it('Failure path — a session reset makes a pair eligible to prompt again (fresh app session, not "declined forever")', () => {
    nextUnshownPair([{ currency: 'AUD', amount: 4400 }], 'CAD');
    _resetManualRatePromptSessionForTests();
    const afterReset = nextUnshownPair([{ currency: 'AUD', amount: 4400 }], 'CAD');
    expect(afterReset).toEqual({ currency: 'AUD', viewerCurrency: 'CAD' });
  });

  it('pairKey is direction-sensitive: "AUD->CAD" differs from "CAD->AUD"', () => {
    expect(pairKey('AUD', 'CAD')).not.toBe(pairKey('CAD', 'AUD'));
  });

  it('returns null when there is nothing unresolved', () => {
    expect(nextUnshownPair([], 'CAD')).toBeNull();
  });
});
