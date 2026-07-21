import { create } from 'zustand';

/**
 * WI-068 §7 — settle-celebration state machine + pure particle math.
 *
 * Flow (AC-7b): `app/settle.tsx` (slice S5) calls `celebrate()` in its
 * create-settlement onSuccess (idle -> celebrating), the root-mounted
 * `CelebrationOverlay` plays the burst and calls `finish()` when the
 * animation completes (celebrating -> idle). The store is pure and
 * unit-testable; the overlay is its only `finish()` caller.
 *
 * Trigger discipline: settle-up success ONLY — never expense save
 * (celebrating spending money is off-brand for "managed").
 */

export type CelebrationStatus = 'idle' | 'celebrating';

export interface CelebrationState {
  status: CelebrationStatus;
  /**
   * Monotonic per-trigger id. Bumps on every celebrate() — including while
   * already celebrating — so the overlay can key its burst on it and rapid
   * back-to-back settles restart the animation instead of being swallowed.
   */
  celebrationId: number;
  /** idle -> celebrating (or restart while celebrating). */
  celebrate: () => void;
  /** celebrating -> idle. No-op while idle. */
  finish: () => void;
}

export const useCelebration = create<CelebrationState>((set) => ({
  status: 'idle',
  celebrationId: 0,
  celebrate: () =>
    set((state) => ({ status: 'celebrating', celebrationId: state.celebrationId + 1 })),
  finish: () => set((state) => (state.status === 'celebrating' ? { status: 'idle' } : state)),
}));

/** Imperative trigger for non-component call sites (settle onSuccess). */
export function celebrate(): void {
  useCelebration.getState().celebrate();
}

// ---------------------------------------------------------------------------
// Particle burst model (pure — consumed by CelebrationOverlay)
// ---------------------------------------------------------------------------

/** Spec §7 mobile: 18–24 particles. */
export const CELEBRATION_PARTICLE_MIN = 18;
export const CELEBRATION_PARTICLE_MAX = 24;

/** Single withTiming pass, spec ceiling <= 1000ms. */
export const CELEBRATION_DURATION_MS = 900;

/** Theme color keys the particles may wear (web §7 parity: brand/pos/gold/ink-3). */
export const CELEBRATION_COLOR_KEYS = ['brand', 'pos', 'accent', 'ink3'] as const;
export type CelebrationColorKey = (typeof CELEBRATION_COLOR_KEYS)[number];

export interface CelebrationParticle {
  key: number;
  colorKey: CelebrationColorKey;
  /** Rounded-rect edge, 6–8px. */
  size: number;
  /** Final horizontal drift from the burst origin, px (radial spread). */
  dx: number;
  /** Burst apex offset, px (negative = upward). */
  riseY: number;
  /** Final fall offset, px (positive = downward — the gravity beat). */
  fallY: number;
  /** Final rotation, degrees. */
  rotation: number;
  /** Per-particle stagger as a fraction of the shared timeline, 0..0.3. */
  delayNorm: number;
}

/**
 * Build one burst worth of particle descriptors. Pure: inject `random` for
 * deterministic tests. Count is clamped into the spec's 18–24 band.
 */
export function createParticles(
  count = 21,
  random: () => number = Math.random,
): CelebrationParticle[] {
  const n = Math.min(
    CELEBRATION_PARTICLE_MAX,
    Math.max(CELEBRATION_PARTICLE_MIN, Math.trunc(count)),
  );
  return Array.from({ length: n }, (_, i) => {
    // Even radial fan with jitter so the burst reads organic, not mechanical.
    const angle = (i / n) * Math.PI * 2 + (random() - 0.5) * 0.6;
    const radius = 80 + random() * 120;
    return {
      key: i,
      colorKey: CELEBRATION_COLOR_KEYS[i % CELEBRATION_COLOR_KEYS.length]!,
      size: 6 + random() * 2,
      dx: Math.cos(angle) * radius,
      riseY: -(50 + random() * 90),
      fallY: 150 + random() * 170,
      rotation: (random() - 0.5) * 540,
      delayNorm: random() * 0.25,
    };
  });
}
