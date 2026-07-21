'use client';

// WI-068 (spec §3/§4) — web motion primitives: reduced-motion detection and
// the rAF-driven money count-up. The per-frame math is exported pure
// (`easeOutCubic`, `frameValue`) so it is unit-testable without rAF.

import { useEffect, useRef, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Non-hook check (imperative call sites like `celebrate()`). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Reactive `prefers-reduced-motion` (story AC-8). SSR/jsdom-safe: treats a
 * missing `matchMedia` as "no preference".
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    setReduced(mql.matches);
    // Older Safari only supports the deprecated addListener/removeListener.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return reduced;
}

/** Spec §3 count-up easing: fast start, gentle landing. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Pure per-frame count-up value over integer minor units.
 * - `elapsed <= 0` -> `from`; `elapsed >= duration` (or `duration <= 0`) -> `to`.
 * - Intermediate frames are rounded so every rendered figure is a valid
 *   integer minor-unit amount for `formatMoney()`.
 */
export function frameValue(
  from: number,
  to: number,
  elapsed: number,
  duration: number,
  easing: (t: number) => number = easeOutCubic,
): number {
  if (duration <= 0 || elapsed >= duration) return to;
  const t = Math.max(0, elapsed) / duration;
  return Math.round(from + (to - from) * easing(t));
}

export interface CountUpOptions {
  /** Animation length in ms — defaults to the `--motion-count` tier (600ms). */
  duration?: number;
  easing?: (t: number) => number;
  /** `false` disables animation entirely (value snaps). Default `true`. */
  enabled?: boolean;
  /** Count up from 0 on first mount (Pulse hero). Default `false`. */
  animateOnMount?: boolean;
}

/**
 * rAF count-up toward `target` (spec §3). On value change it counts from the
 * previously rendered value; on mount it renders the final value unless
 * `animateOnMount`. Under reduced motion (or `enabled: false`) the value
 * snaps instantly and no frames are scheduled (story AC-4c/AC-8).
 */
export function useCountUp(target: number, options: CountUpOptions = {}): number {
  const {
    duration = 600,
    easing = easeOutCubic,
    enabled = true,
    animateOnMount = false,
  } = options;
  const reduced = usePrefersReducedMotion();
  const animate = enabled && !reduced;

  const [value, setValue] = useState(() => (animate && animateOnMount ? 0 : target));
  const valueRef = useRef(value);
  valueRef.current = value;
  /** Last target the effect handled; null distinguishes the mount run. */
  const handledTargetRef = useRef<number | null>(null);
  const easingRef = useRef(easing);
  easingRef.current = easing;

  useEffect(() => {
    const isMount = handledTargetRef.current === null;
    handledTargetRef.current = target;

    if (!animate || (isMount && !animateOnMount)) {
      if (valueRef.current !== target) setValue(target);
      return;
    }

    const from = isMount ? 0 : valueRef.current;
    if (from === target) return;

    const start = performance.now();
    let raf = 0;
    const tick = (nowMs: number) => {
      const elapsed = nowMs - start;
      setValue(frameValue(from, target, elapsed, duration, easingRef.current));
      if (elapsed < duration) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, animate, animateOnMount, duration]);

  return animate ? value : target;
}
