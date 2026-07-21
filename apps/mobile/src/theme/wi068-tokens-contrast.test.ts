import { describe, expect, it } from 'vitest';
import {
  darkColors,
  lightColors,
  motion,
  pressScale,
  spring,
  type ThemeColors,
} from './tokens';

/**
 * WI-068 AC-5 / spec §1.2 — the contrast table as a pure WCAG 2.1
 * relative-luminance test over the ACTUAL theme values. Any future retune
 * that drops a text token below 4.5:1 (in either scheme) fails here.
 */

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`contrast test needs a 6-digit hex, got: ${hex}`);
  const int = parseInt(m[1]!, 16);
  return (
    0.2126 * channel((int >> 16) & 255) +
    0.7152 * channel((int >> 8) & 255) +
    0.0722 * channel(int & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Spec §1.2 pairs: [label, foreground key, background key]. */
const PAIRS: ReadonlyArray<[string, keyof ThemeColors, keyof ThemeColors]> = [
  ['ink / surface', 'ink', 'surface'],
  ['ink2 / surface', 'ink2', 'surface'],
  ['ink3 / surface', 'ink3', 'surface'],
  ['ink3 / page', 'ink3', 'page'],
  ['brand (as text) / surface', 'brand', 'surface'],
  ['pos / surface', 'pos', 'surface'],
  ['neg / surface', 'neg', 'surface'],
  ['danger / surface', 'danger', 'surface'],
  ['warning / surface', 'warning', 'surface'],
  ['accent (as text) / surface', 'accent', 'surface'],
  ['onBrand / brandFill', 'onBrand', 'brandFill'],
];

describe.each([
  ['light', lightColors],
  ['dark', darkColors],
] as const)('WI-068 AC-5 contrast floor — %s scheme', (_scheme, colors) => {
  it.each(PAIRS)('%s is >= 4.5:1', (_label, fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('WI-068 AC-1 token completeness (spec §1.3)', () => {
  const REQUIRED_KEYS: ReadonlyArray<keyof ThemeColors> = [
    // every pre-existing ThemeColors key…
    'page',
    'surface',
    'surface2',
    'hairline',
    'ink',
    'ink2',
    'ink3',
    'brand',
    'brandHover',
    'onBrand',
    'pos',
    'neg',
    'danger',
    'warning',
    'overlay',
    // …plus the WI-068 additions
    'elevated',
    'hairlineStrong',
    'brandFill',
    'brandFillPressed',
    'accent',
    'accentSoft',
    'ring',
    'chart1',
    'chartGrid',
  ];

  it.each([
    ['light', lightColors],
    ['dark', darkColors],
  ] as const)('%s scheme defines every required token as a non-empty string', (_scheme, colors) => {
    for (const key of REQUIRED_KEYS) {
      expect(colors[key], `missing token: ${key}`).toBeTypeOf('string');
      expect(colors[key].length, `empty token: ${key}`).toBeGreaterThan(0);
    }
  });

  it('both schemes expose the identical key set (light/dark parity, AC-3)', () => {
    expect(Object.keys(lightColors).sort()).toEqual(Object.keys(darkColors).sort());
  });

  it('dark surfaces are never pure #000 (spec §0 "avoid pure #000")', () => {
    for (const key of ['page', 'surface', 'surface2', 'elevated'] as const) {
      expect(darkColors[key].toLowerCase()).not.toBe('#000000');
    }
  });
});

describe('WI-068 motion tokens (spec §1.3 / §4)', () => {
  it('exposes the spec durations', () => {
    expect(motion).toEqual({ fast: 120, base: 160, slow: 240, count: 600 });
  });

  it('exposes the sheet/modal spring (damping 20, stiffness 90)', () => {
    expect(spring).toEqual({ damping: 20, stiffness: 90 });
  });

  it('press scale is 0.97', () => {
    expect(pressScale).toBe(0.97);
  });
});
