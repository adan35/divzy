// Test-stage functional/black-box coverage — story-WI-004 (settlements, mobile).
//
// Written by test-settlements directly from story-WI-004's Gherkin scenarios,
// with different fixture ids than dev-mobile-settlements' own
// settlements.test.ts, before reading that file's assertions in depth — an
// independent pass at the same contract. NOTE (limitation, recorded in the
// test plan): apps/mobile has no React Native component-test harness
// (confirmed absent repo-wide, per build-WI-004.md), so this exercises the
// public function `canRecordSuggestion` that `GroupBalancesTab.tsx` calls per
// row, not the rendered row/button itself — the closest automatable
// approximation of "as a caller would" for this platform. Real
// disabled-button rendering is a manual/E2E gap flagged in the test plan.
import { describe, expect, it } from 'vitest';
import { canRecordSuggestion } from './settlements';

describe('story-WI-004 (mobile) · gate "Record" to the current user', () => {
  it('Happy path — suggestion where I\'m the payer stays actionable', () => {
    expect(canRecordSuggestion('mem_alpha', 'mem_alpha', 'mem_beta')).toBe(true);
  });

  it('Happy path — suggestion where I\'m the recipient stays actionable', () => {
    expect(canRecordSuggestion('mem_alpha', 'mem_beta', 'mem_alpha')).toBe(true);
  });

  it('Edge case (mobile) — suggestion between two other members is not actionable', () => {
    expect(canRecordSuggestion('mem_alpha', 'mem_beta', 'mem_gamma')).toBe(false);
  });

  it('is not fooled by a partial/substring id match (exact-equality gate, not includes())', () => {
    expect(canRecordSuggestion('mem_al', 'mem_alpha', 'mem_beta')).toBe(false);
  });
});
