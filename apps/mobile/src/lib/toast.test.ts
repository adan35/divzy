import { describe, expect, it } from 'vitest';
import {
  TOAST_DEFAULT_DURATION_MS,
  nextToastTriggerId,
  resolveToastDuration,
  resolveToastVisual,
} from './toast';

describe('resolveToastDuration', () => {
  it('defaults success toasts to 2000ms', () => {
    expect(resolveToastDuration('success')).toBe(2000);
    expect(resolveToastDuration('success')).toBe(TOAST_DEFAULT_DURATION_MS.success);
  });

  it('defaults error toasts to 3000ms — errors need more read time than success', () => {
    expect(resolveToastDuration('error')).toBe(3000);
    expect(resolveToastDuration('error')).toBe(TOAST_DEFAULT_DURATION_MS.error);
  });

  it('an explicit durationMs override always wins over the tone default', () => {
    expect(resolveToastDuration('success', 5000)).toBe(5000);
    expect(resolveToastDuration('error', 500)).toBe(500);
  });

  it('treats an explicit 0 as a real override, not a falsy "use the default"', () => {
    expect(resolveToastDuration('success', 0)).toBe(0);
  });
});

describe('resolveToastVisual', () => {
  it('maps success to the checkmark icon and the "pos" theme color role', () => {
    expect(resolveToastVisual('success')).toEqual({ icon: 'checkmark-circle', colorKey: 'pos' });
  });

  it('maps error to the alert icon and the "danger" theme color role', () => {
    expect(resolveToastVisual('error')).toEqual({ icon: 'alert-circle', colorKey: 'danger' });
  });
});

describe('nextToastTriggerId', () => {
  it('increments by one', () => {
    expect(nextToastTriggerId(0)).toBe(1);
    expect(nextToastTriggerId(1)).toBe(2);
    expect(nextToastTriggerId(41)).toBe(42);
  });

  it('produces a distinct id on every call, even for repeated/identical toasts (AC5)', () => {
    // Simulates two rapid, identical "Invite link copied" taps in a row: each
    // must get its own triggerId so Toast independently restarts its
    // animation/auto-dismiss timer for the second tap rather than merging
    // with or being suppressed by the first.
    let id = 0;
    id = nextToastTriggerId(id);
    const first = id;
    id = nextToastTriggerId(id);
    const second = id;
    expect(second).not.toBe(first);
    expect(second).toBeGreaterThan(first);
  });
});
