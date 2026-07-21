import { describe, expect, it } from 'vitest';
import { CURRENCIES } from '@divzy/shared';
import { FALLBACK_RATES } from '../src/lib/rates-fallback';

// TC-WB1-02 — the data-integrity check build-WI-001.md's "Notes for Test
// stage" recommended but did not build: "all CURRENCIES codes present in
// FALLBACK_RATES." Without this invariant, convertAmount's RATE_UNAVAILABLE
// path (via fallbackRatesFor throwing UNSUPPORTED_CURRENCY, or a missing
// patch) becomes reachable in production for a nominally-supported
// currency whenever both the live fetch and any cache are unavailable —
// this test is a permanent regression guard against that drift, run on
// plain data with no mocking.
//
// Test-plan: .company/domains/analytics/test-plans/test-plan-WI-001.md

describe('TC-WB1-02: FALLBACK_RATES data integrity vs. CURRENCIES', () => {
  it('has an entry for every supported currency code', () => {
    const missing = CURRENCIES.map((c) => c.code).filter((code) => FALLBACK_RATES[code] === undefined);
    expect(missing).toEqual([]);
  });

  it('every FALLBACK_RATES entry is a finite positive number', () => {
    const invalid = Object.entries(FALLBACK_RATES).filter(
      ([, rate]) => typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0,
    );
    expect(invalid).toEqual([]);
  });

  it('does not carry stale entries for codes no longer in CURRENCIES (keeps the table in lockstep)', () => {
    const supportedCodes = new Set(CURRENCIES.map((c) => c.code));
    const stale = Object.keys(FALLBACK_RATES).filter((code) => !supportedCodes.has(code));
    expect(stale).toEqual([]);
  });

  it('records the exact currency-code count observed, for visibility if the "52 supported currencies" figure in the stories drifts from the code', () => {
    // story-WI-001 and story-WI-002 both describe "the 52 supported
    // currencies" in prose. This is a non-failing visibility assertion: it
    // records the actual count so a reviewer can reconcile prose vs. code
    // rather than silently trusting the story's number.
    expect(CURRENCIES.length).toBe(FALLBACK_RATES ? Object.keys(FALLBACK_RATES).length : -1);
    // eslint-disable-next-line no-console
    console.log(`[TC-WB1-02] CURRENCIES.length = ${CURRENCIES.length} (stories say "52")`);
  });
});
