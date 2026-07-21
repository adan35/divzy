import { describe, expect, it } from 'vitest';
import { chartOtherColor, chartPalette, darkColors, lightColors } from './tokens';

/**
 * WI-068 AC-9a / spec §8.1 — the categorical palette slot order is the
 * validator-proven sequence, verbatim, for both schemes. Order is load-bearing
 * (adjacent-slot CVD distance was validated against these exact sequences on
 * 2026-07-19); any reorder or value change must re-run the dataviz validator
 * and update this test deliberately.
 */
describe('WI-068 AC-9a chartPalette slot order (spec §8.1)', () => {
  it('light palette is the §8.1 sequence, verbatim', () => {
    expect(chartPalette.light).toEqual([
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
    expect(chartPalette.dark).toEqual([
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

  it('both schemes expose exactly 8 slots', () => {
    expect(chartPalette.light).toHaveLength(8);
    expect(chartPalette.dark).toHaveLength(8);
  });

  it('the "Other" fold color is cool #7e8a9c (both modes, spec §8.1)', () => {
    expect(chartOtherColor).toBe('#7e8a9c');
  });

  it('chart1 (single-series token) matches slot 1 of each scheme (spec §1.1 + §8.2)', () => {
    expect(lightColors.chart1).toBe(chartPalette.light[0]);
    expect(darkColors.chart1).toBe(chartPalette.dark[0]);
  });
});
