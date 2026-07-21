/**
 * Pure logic backing the `Toast` UI primitive (`src/components/ui/Toast.tsx`)
 * and its call sites. Kept dependency-free from React/React Native so it is
 * unit-testable without a component renderer, per this app's existing
 * convention of putting non-trivial logic in `src/lib` (see
 * `convertedBalance.ts`, `settlements.ts`) and leaving UI components thin.
 */

export type ToastTone = 'success' | 'error';

/** Auto-dismiss duration per tone. Errors get more read time than success. */
export const TOAST_DEFAULT_DURATION_MS: Record<ToastTone, number> = {
  success: 2000,
  error: 3000,
};

/** Resolves the auto-dismiss duration for a toast: explicit override wins, else the tone default. */
export function resolveToastDuration(tone: ToastTone, durationMs?: number): number {
  return durationMs ?? TOAST_DEFAULT_DURATION_MS[tone];
}

export interface ToastVisual {
  icon: 'checkmark-circle' | 'alert-circle';
  /** Theme color key to resolve the tone-colored background against. */
  colorKey: 'pos' | 'danger';
}

/** Icon + color-role mapping per tone (success -> pos/checkmark, error -> danger/alert). */
export function resolveToastVisual(tone: ToastTone): ToastVisual {
  return tone === 'success'
    ? { icon: 'checkmark-circle', colorKey: 'pos' }
    : { icon: 'alert-circle', colorKey: 'danger' };
}

/**
 * Next monotonically-increasing trigger id, given the previous one. Used to
 * bump `Toast`'s `triggerId` prop on every call so repeated taps each
 * restart the enter animation/auto-dismiss timer independently, even when
 * message/tone are identical to the previous call (AC5).
 */
export function nextToastTriggerId(previousId: number): number {
  return previousId + 1;
}
