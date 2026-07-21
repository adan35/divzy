// WI-068 S1 (web foundation) — TDD for the pure count-up math behind
// `useCountUp` (spec §3/§4: 600ms money count-up, easeOutCubic, integer minor
// units every frame). The rAF loop itself is exercised through the MoneyText
// component tests; here we pin the frame-value function and easing curve.
import { describe, expect, it } from 'vitest';
import { easeOutCubic, frameValue } from './motion';

describe('easeOutCubic (spec §3 count-up easing)', () => {
  it('starts at 0 and ends at 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('is the canonical 1 - (1 - t)^3 curve (fast start, slow finish)', () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
    expect(easeOutCubic(0.25)).toBeCloseTo(1 - 0.75 ** 3, 10);
  });

  it('is monotonically non-decreasing over [0, 1]', () => {
    let prev = easeOutCubic(0);
    for (let i = 1; i <= 100; i++) {
      const v = easeOutCubic(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('frameValue (pure per-frame count-up value)', () => {
  it('returns the start value at elapsed 0', () => {
    expect(frameValue(0, 100000, 0, 600)).toBe(0);
    expect(frameValue(500, 100000, 0, 600)).toBe(500);
  });

  it('returns the target exactly at and after the duration', () => {
    expect(frameValue(0, 123456, 600, 600)).toBe(123456);
    expect(frameValue(0, 123456, 601, 600)).toBe(123456);
    expect(frameValue(0, 123456, 10000, 600)).toBe(123456);
  });

  it('applies the easing curve at intermediate frames (easeOutCubic default)', () => {
    // At half time easeOutCubic progress is 0.875.
    expect(frameValue(0, 1000, 300, 600)).toBe(875);
    expect(frameValue(1000, 2000, 300, 600)).toBe(1875);
  });

  it('always returns integer minor units, never fractional cents', () => {
    for (let ms = 0; ms <= 600; ms += 7) {
      const v = frameValue(0, 33333, ms, 600);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('counts down toward negative targets (you-owe figures)', () => {
    expect(frameValue(0, -1000, 300, 600)).toBe(-875);
    expect(frameValue(-1000, -2000, 600, 600)).toBe(-2000);
  });

  it('counts from a previous non-zero value on value change', () => {
    // Live-update path: previous rendered value -> new target.
    expect(frameValue(500, 1500, 600, 600)).toBe(1500);
    expect(frameValue(500, 1500, 0, 600)).toBe(500);
  });

  it('clamps negative elapsed to the start value', () => {
    expect(frameValue(200, 900, -50, 600)).toBe(200);
  });

  it('snaps to the target for a non-positive duration (reduced-motion path)', () => {
    expect(frameValue(0, 4200, 0, 0)).toBe(4200);
    expect(frameValue(0, 4200, 10, -1)).toBe(4200);
  });

  it('accepts a custom easing function', () => {
    const linear = (t: number) => t;
    expect(frameValue(0, 1000, 300, 600, linear)).toBe(500);
  });
});
