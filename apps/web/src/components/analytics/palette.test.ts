// WI-068 AC-9a / spec §8.1 — the categorical palette slot order is the
// validator-proven sequence, verbatim, for both schemes on web. Mirrors the
// mobile-side lock-in test (apps/mobile/src/theme/wi068-chart-palette.test.ts)
// so a future accidental edit (e.g. reverting slots 7-8 to the pre-WI-068
// order, which failed the adjacent-slot ΔE floor per the spec) is caught here
// rather than only surfacing at the next manual `validate_palette.js` run.
//
// Gap this closes: pre-existing web tests (breakdown-rows.test.tsx) import
// CHART_PALETTE_LIGHT/CHART_OTHER_COLOR but only exercise BreakdownRows'
// consumption of whatever array is passed in — none of them pin the actual
// slot VALUES/ORDER against spec §8.1, unlike the mobile theme test.
import { describe, expect, it } from 'vitest';
import {
  CHART_OTHER_COLOR,
  CHART_PALETTE_DARK,
  CHART_PALETTE_LIGHT,
  CHART_SERIES,
} from './palette';

describe('WI-068 AC-9a chart palette slot order (spec §8.1)', () => {
  it('light palette is the §8.1 sequence, verbatim', () => {
    expect(CHART_PALETTE_LIGHT).toEqual([
      '#2a78d6',
      '#008300',
      '#e87ba4',
      '#eda100',
      '#1baf7a',
      '#eb6834',
      '#4a3aa7',
      '#e34948',
    ]);
  });

  it('dark palette is the §8.1 sequence, verbatim', () => {
    expect(CHART_PALETTE_DARK).toEqual([
      '#3987e5',
      '#008300',
      '#d55181',
      '#c98500',
      '#199e70',
      '#d95926',
      '#9085e9',
      '#e66767',
    ]);
  });

  it('both schemes expose exactly 8 slots, in fixed order (never cycled)', () => {
    expect(CHART_PALETTE_LIGHT).toHaveLength(8);
    expect(CHART_PALETTE_DARK).toHaveLength(8);
  });

  it('the "Other" fold color is cool #7e8a9c (both modes, spec §8.1)', () => {
    expect(CHART_OTHER_COLOR).toBe('#7e8a9c');
  });

  it('cross-platform parity: byte-identical to the mobile chartPalette sequences', () => {
    // Transcribed from apps/mobile/src/theme/tokens.ts's chartPalette — the
    // two modules can't share an import (different workspaces), so this pins
    // the exact values that must match, verbatim, on both platforms.
    const mobileLight = [
      '#2a78d6',
      '#008300',
      '#e87ba4',
      '#eda100',
      '#1baf7a',
      '#eb6834',
      '#4a3aa7',
      '#e34948',
    ];
    const mobileDark = [
      '#3987e5',
      '#008300',
      '#d55181',
      '#c98500',
      '#199e70',
      '#d95926',
      '#9085e9',
      '#e66767',
    ];
    expect(CHART_PALETTE_LIGHT).toEqual(mobileLight);
    expect(CHART_PALETTE_DARK).toEqual(mobileDark);
  });

  it('single-series marks resolve to the chart-1 CSS token, never a palette slot or --brand', () => {
    expect(CHART_SERIES).toBe('var(--chart-1)');
  });
});
