// WI-068 S1 (web foundation) — spec §3 / story AC-4: MoneyText keeps its
// existing rendering contract byte-for-byte (WI-055 semantics) and gains an
// additive, opt-in count-up (`animate` / `animateOnMount`) that:
//   - counts to the new value over ~600ms in integer minor units,
//   - takes its semantic color from the FINAL value for the whole animation,
//   - carries an aria-label with the final formatted value,
//   - snaps instantly (no rAF scheduled) under prefers-reduced-motion.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MoneyText } from './money-text';

type FrameCb = (time: number) => void;

let now = 0;
let rafQueue: FrameCb[] = [];
let rafCalls = 0;

function flushFrames(advanceMs: number) {
  now += advanceMs;
  const queue = rafQueue;
  rafQueue = [];
  act(() => {
    queue.forEach((cb) => cb(now));
  });
}

/** Run frames until the queue drains (animation finished). */
function finishAnimation(stepMs = 100, maxSteps = 50) {
  for (let i = 0; i < maxSteps && rafQueue.length > 0; i++) flushFrames(stepMs);
}

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

beforeEach(() => {
  now = 0;
  rafQueue = [];
  rafCalls = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameCb) => {
    rafCalls += 1;
    rafQueue.push(cb);
    return rafCalls;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  mockMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MoneyText — existing contract preserved (WI-055 / AC-4a/b)', () => {
  it('plain mode renders the formatted amount with tabular numerals', () => {
    render(<MoneyText amount={123456} currency="USD" />);
    const el = screen.getByText('$1,234.56');
    expect(el.className).toContain('tabular-nums');
  });

  it('signed-color: positive -> pos token with an explicit "+"', () => {
    render(<MoneyText amount={5000} currency="USD" mode="signed-color" />);
    const el = screen.getByText('+$50.00');
    expect(el.className).toContain('text-pos');
  });

  it('signed-color: negative -> neg token keeping the native minus', () => {
    render(<MoneyText amount={-5000} currency="USD" mode="signed-color" />);
    const el = screen.getByText('-$50.00');
    expect(el.className).toContain('text-neg');
  });

  it('signed-color: zero -> muted ink-3', () => {
    render(<MoneyText amount={0} currency="USD" mode="signed-color" />);
    const el = screen.getByText('$0.00');
    expect(el.className).toContain('text-ink-3');
  });

  it('does not animate by default: value change re-renders instantly, no rAF', () => {
    const { rerender } = render(<MoneyText amount={1000} currency="USD" />);
    rerender(<MoneyText amount={2000} currency="USD" />);
    expect(screen.getByText('$20.00')).toBeInTheDocument();
    expect(rafCalls).toBe(0);
  });
});

describe('MoneyText — count-up (spec §3 / AC-4c)', () => {
  it('animateOnMount counts up from zero to the final value', () => {
    render(
      <MoneyText amount={120000} currency="USD" mode="signed-color" animate animateOnMount />,
    );
    // Animation scheduled; drive it to completion.
    expect(rafQueue.length).toBeGreaterThan(0);
    finishAnimation();
    expect(screen.getByText('+$1,200.00')).toBeInTheDocument();
  });

  it('without animateOnMount the mount renders the final value immediately', () => {
    render(<MoneyText amount={120000} currency="USD" animate />);
    expect(screen.getByText('$1,200.00')).toBeInTheDocument();
    expect(rafCalls).toBe(0);
  });

  it('on value change it counts from the previous value to the new one', () => {
    const { rerender } = render(<MoneyText amount={0} currency="USD" animate />);
    rerender(<MoneyText amount={100000} currency="USD" animate />);
    // Halfway (300ms of 600ms): easeOutCubic progress 0.875 -> $875.00.
    flushFrames(0); // first frame at t=0 renders the start value
    flushFrames(300);
    expect(screen.getByText('$875.00')).toBeInTheDocument();
    finishAnimation();
    expect(screen.getByText('$1,000.00')).toBeInTheDocument();
  });

  it('semantic color comes from the FINAL value for the whole animation', () => {
    const { rerender, container } = render(
      <MoneyText amount={5000} currency="USD" mode="signed-color" animate />,
    );
    rerender(<MoneyText amount={-5000} currency="USD" mode="signed-color" animate />);
    // Mid-animation the displayed number may still be positive, but the color
    // must already be the final (negative) token — a figure never sweeps
    // through green<->red.
    flushFrames(0);
    flushFrames(100);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('text-neg');
    expect(span.className).not.toContain('text-pos');
    finishAnimation();
    expect(screen.getByText('-$50.00')).toBeInTheDocument();
  });

  it('carries an aria-label with the final formatted value while animating', () => {
    const { rerender, container } = render(
      <MoneyText amount={0} currency="USD" mode="signed-color" animate />,
    );
    rerender(<MoneyText amount={100000} currency="USD" mode="signed-color" animate />);
    flushFrames(0);
    flushFrames(100);
    const span = container.querySelector('span')!;
    expect(span.getAttribute('aria-label')).toBe('+$1,000.00');
  });

  it('prefers-reduced-motion: value snaps instantly, no animation frames scheduled', () => {
    mockMatchMedia(true);
    const { rerender } = render(
      <MoneyText amount={1000} currency="USD" animate animateOnMount />,
    );
    expect(screen.getByText('$10.00')).toBeInTheDocument();
    rerender(<MoneyText amount={2000} currency="USD" animate animateOnMount />);
    expect(screen.getByText('$20.00')).toBeInTheDocument();
    expect(rafCalls).toBe(0);
  });

  it('hard-applies tabular numerals in animate mode (no digit jitter)', () => {
    const { container } = render(
      <MoneyText amount={100} currency="USD" animate animateOnMount />,
    );
    expect(container.querySelector('span')!.className).toContain('tabular-nums');
  });
});
