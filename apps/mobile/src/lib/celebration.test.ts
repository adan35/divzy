import { beforeEach, describe, expect, it } from 'vitest';
import {
  CELEBRATION_COLOR_KEYS,
  CELEBRATION_DURATION_MS,
  CELEBRATION_PARTICLE_MAX,
  CELEBRATION_PARTICLE_MIN,
  celebrate,
  createParticles,
  useCelebration,
} from './celebration';

/**
 * WI-068 AC-7b — the celebration store is a pure, unit-testable state
 * machine: idle -> celebrating (celebrate) -> idle (finish). The overlay is
 * the only finish() caller; settle.tsx (slice S5) is the celebrate() caller.
 */
describe('celebration store state machine', () => {
  beforeEach(() => {
    useCelebration.setState({ status: 'idle', celebrationId: 0 });
  });

  it('starts idle', () => {
    expect(useCelebration.getState().status).toBe('idle');
  });

  it('celebrate() transitions idle -> celebrating and bumps the id', () => {
    celebrate();
    const state = useCelebration.getState();
    expect(state.status).toBe('celebrating');
    expect(state.celebrationId).toBe(1);
  });

  it('finish() transitions celebrating -> idle (the AC-7b full cycle)', () => {
    celebrate();
    useCelebration.getState().finish();
    expect(useCelebration.getState().status).toBe('idle');
  });

  it('finish() while idle is a no-op (no spurious transitions)', () => {
    useCelebration.getState().finish();
    const state = useCelebration.getState();
    expect(state.status).toBe('idle');
    expect(state.celebrationId).toBe(0);
  });

  it('celebrate() while already celebrating stays celebrating and bumps the id (restart)', () => {
    celebrate();
    celebrate();
    const state = useCelebration.getState();
    expect(state.status).toBe('celebrating');
    expect(state.celebrationId).toBe(2);
  });

  it('a second settle after the first finished celebrates again with a fresh id', () => {
    celebrate();
    useCelebration.getState().finish();
    celebrate();
    const state = useCelebration.getState();
    expect(state.status).toBe('celebrating');
    expect(state.celebrationId).toBe(2);
  });
});

/** Spec §7 mobile: 18–24 particles, withTiming <= 1000ms, brand/pos/accent/ink3 colors. */
describe('celebration particle generation', () => {
  it('duration is within the spec ceiling (withTiming <= 1000ms)', () => {
    expect(CELEBRATION_DURATION_MS).toBeLessThanOrEqual(1000);
    expect(CELEBRATION_DURATION_MS).toBeGreaterThan(0);
  });

  it('default burst size is within the 18–24 band', () => {
    const particles = createParticles();
    expect(particles.length).toBeGreaterThanOrEqual(CELEBRATION_PARTICLE_MIN);
    expect(particles.length).toBeLessThanOrEqual(CELEBRATION_PARTICLE_MAX);
    expect(CELEBRATION_PARTICLE_MIN).toBe(18);
    expect(CELEBRATION_PARTICLE_MAX).toBe(24);
  });

  it('clamps out-of-band counts into 18–24', () => {
    expect(createParticles(3)).toHaveLength(18);
    expect(createParticles(100)).toHaveLength(24);
  });

  it('particles only wear the sanctioned theme color keys and use all four', () => {
    const particles = createParticles();
    const seen = new Set(particles.map((p) => p.colorKey));
    for (const key of seen) {
      expect(CELEBRATION_COLOR_KEYS).toContain(key);
    }
    expect(seen.size).toBe(CELEBRATION_COLOR_KEYS.length);
  });

  it('particle geometry: 6–8px rects that rise then fall, with a bounded stagger', () => {
    for (const p of createParticles(24)) {
      expect(p.size).toBeGreaterThanOrEqual(6);
      expect(p.size).toBeLessThanOrEqual(8);
      expect(p.riseY).toBeLessThan(0);
      expect(p.fallY).toBeGreaterThan(0);
      expect(Number.isFinite(p.dx)).toBe(true);
      expect(p.delayNorm).toBeGreaterThanOrEqual(0);
      expect(p.delayNorm).toBeLessThanOrEqual(0.3);
    }
  });

  it('is deterministic under an injected random source (pure)', () => {
    const seq = (start: number) => {
      let v = start;
      return () => {
        v = (v * 9301 + 49297) % 233280;
        return v / 233280;
      };
    };
    expect(createParticles(20, seq(7))).toEqual(createParticles(20, seq(7)));
  });
});
