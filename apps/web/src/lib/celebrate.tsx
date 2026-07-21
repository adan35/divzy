'use client';

// WI-068 (spec §7, web) — the settle-success celebration primitive.
// `celebrate()` mounts a transient full-viewport layer (aria-hidden,
// pointer-events-none, above dialogs) with 20-24 CSS particles in
// brand/pos/accent/ink-3 token colors bursting radially with a gravity fall,
// staggered so everything lands within 1200ms, then removes the layer once
// every particle's animation ends. Complete no-op under reduced motion
// (story AC-7c). Foundation-only: wiring into settle-dialog onSuccess is
// slice S2's job — nothing imports this yet.

import { prefersReducedMotion } from './motion';

const PARTICLE_COUNT = 22; // spec: 20-24
const PARTICLE_COLORS = [
  'var(--brand)',
  'var(--pos)',
  'var(--accent)',
  'var(--ink-3)',
] as const;
const MAX_DELAY_MS = 240;
const DURATION_MS = 900; // 240 + 900 <= the 1200ms budget
const CLEANUP_FALLBACK_MS = 1500; // jsdom/interrupted-animation safety net

let activeLayer: HTMLDivElement | null = null;

/**
 * Fire the settle celebration once. Triggered ONLY from settle-up success
 * (never expense save — celebrating spending is off-brand for "managed").
 */
export function celebrate(): void {
  if (typeof document === 'undefined') return;
  if (prefersReducedMotion()) return;

  // Never stack layers — a re-trigger while playing restarts cleanly.
  activeLayer?.remove();

  const layer = document.createElement('div');
  layer.dataset.divzyCelebrate = 'true';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '100', // above dialogs (z-50)
    overflow: 'hidden',
  });

  let remaining = PARTICLE_COUNT;
  const teardown = () => {
    window.clearTimeout(fallbackTimer);
    layer.remove();
    if (activeLayer === layer) activeLayer = null;
  };

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const particle = document.createElement('div');
    // Radial burst: evenly spread directions with a little jitter.
    const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + Math.random() * 0.5;
    const burst = 90 + Math.random() * 130; // px to the apex
    const mx = Math.cos(angle) * burst;
    const my = Math.sin(angle) * burst * 0.75 - 60; // biased upward
    const fall = 160 + Math.random() * 140; // gravity drop below the apex
    const size = 6 + Math.round(Math.random() * 2); // 6-8px rounded rects
    const delay = Math.round((i / PARTICLE_COUNT) * MAX_DELAY_MS);

    particle.style.setProperty('--celebrate-mx', `${mx.toFixed(1)}px`);
    particle.style.setProperty('--celebrate-my', `${my.toFixed(1)}px`);
    particle.style.setProperty('--celebrate-mr', `${Math.round(Math.random() * 300 - 150)}deg`);
    particle.style.setProperty('--celebrate-x', `${(mx * 1.15).toFixed(1)}px`);
    particle.style.setProperty('--celebrate-y', `${(my + fall).toFixed(1)}px`);
    particle.style.setProperty('--celebrate-r', `${Math.round(Math.random() * 720 - 360)}deg`);
    Object.assign(particle.style, {
      position: 'absolute',
      left: '50%',
      top: '52%',
      width: `${size}px`,
      height: `${size + 2}px`,
      borderRadius: '2px',
      backgroundColor: PARTICLE_COLORS[i % PARTICLE_COLORS.length]!,
      willChange: 'transform, opacity',
      opacity: '0',
      animationName: 'divzy-celebrate',
      animationDuration: `${DURATION_MS}ms`,
      animationDelay: `${delay}ms`,
      animationTimingFunction: 'cubic-bezier(0.22, 0.9, 0.35, 1)',
      animationFillMode: 'both',
    });
    particle.addEventListener(
      'animationend',
      () => {
        remaining -= 1;
        if (remaining <= 0) teardown();
      },
      { once: true },
    );
    layer.appendChild(particle);
  }

  // jsdom never fires animationend; browsers can skip it for hidden tabs.
  const fallbackTimer = window.setTimeout(teardown, CLEANUP_FALLBACK_MS);

  document.body.appendChild(layer);
  activeLayer = layer;
}
