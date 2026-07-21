// WI-068 S1 (web foundation) — spec §7 / story AC-7a: `celebrate()` mounts a
// transient, aria-hidden, pointer-events-none particle layer (20-24 CSS
// particles in brand/pos/accent/ink-3 token colors), staggered <= 1200ms, that
// removes itself, and is a complete no-op under prefers-reduced-motion.
// (Wiring into settle-dialog onSuccess is slice S2's job — this only covers
// the foundation primitive.)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { celebrate } from './celebrate';

function mockMatchMedia(reduced: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? reduced : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

function getLayer(): HTMLElement | null {
  return document.querySelector('[data-divzy-celebrate]');
}

beforeEach(() => {
  vi.useFakeTimers();
  mockMatchMedia(false);
});

afterEach(() => {
  getLayer()?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('celebrate() — settle success particle burst (spec §7 web)', () => {
  it('mounts a full-viewport layer that is aria-hidden and pointer-events none', () => {
    celebrate();
    const layer = getLayer();
    expect(layer).not.toBeNull();
    expect(layer!.getAttribute('aria-hidden')).toBe('true');
    expect(layer!.style.pointerEvents).toBe('none');
  });

  it('renders 20-24 particles, colored only by token variables (no raw hex)', () => {
    celebrate();
    const particles = Array.from(getLayer()!.children) as HTMLElement[];
    expect(particles.length).toBeGreaterThanOrEqual(20);
    expect(particles.length).toBeLessThanOrEqual(24);
    for (const p of particles) {
      expect(p.style.backgroundColor).toMatch(
        /var\(--(brand|pos|accent|ink-3)\)/,
      );
    }
  });

  it('every particle finishes within the 1200ms budget (delay + duration)', () => {
    celebrate();
    const particles = Array.from(getLayer()!.children) as HTMLElement[];
    for (const p of particles) {
      const delay = parseFloat(p.style.animationDelay || '0');
      const duration = parseFloat(p.style.animationDuration || '0');
      expect(delay + duration).toBeLessThanOrEqual(1200);
      expect(duration).toBeGreaterThan(0);
    }
  });

  it('removes the layer after the animation window (jsdom fallback timer path)', () => {
    celebrate();
    expect(getLayer()).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(getLayer()).toBeNull();
  });

  it('never stacks two layers — a second call while playing restarts cleanly', () => {
    celebrate();
    celebrate();
    expect(document.querySelectorAll('[data-divzy-celebrate]').length).toBe(1);
  });

  it('is a complete no-op under prefers-reduced-motion (AC-7c)', () => {
    mockMatchMedia(true);
    celebrate();
    expect(getLayer()).toBeNull();
  });
});
