import type { CurrencyAmount } from '@divzy/shared';

export interface ManualRatePair {
  currency: string;
  viewerCurrency: string;
}

/** "1 {currency} = ? {viewerCurrency}" — stable key for session-scoped dedupe. */
export function pairKey(currency: string, viewerCurrency: string): string {
  return `${currency}->${viewerCurrency}`;
}

/**
 * Session-scoped (in-memory only, never persisted) record of which
 * currency-pair prompts have already been shown this app session — per
 * spec-WI-002: dismissing must not re-prompt on re-render within the same
 * session, but a fresh session (cold start) is eligible to prompt again for
 * a pair that's still unresolved.
 */
const shownThisSession = new Set<string>();

/** Test-only escape hatch to reset the module-level session state between cases. */
export function _resetManualRatePromptSessionForTests(): void {
  shownThisSession.clear();
}

/**
 * Picks the first currency in `unresolved` that hasn't been prompted this
 * session for `viewerCurrency`, and marks it shown immediately — so a
 * second unresolved entry for the same pair in the same render, or a
 * re-render before the user responds, never opens a second prompt (spec-
 * WI-002, "Manual rate prompt — trigger and dedupe"). Returns null once
 * every unresolved currency has already been shown (or there's nothing
 * unresolved); the caller queues the next distinct pair, if any, once the
 * current prompt closes.
 */
export function nextUnshownPair(
  unresolved: CurrencyAmount[],
  viewerCurrency: string,
): ManualRatePair | null {
  for (const entry of unresolved) {
    const key = pairKey(entry.currency, viewerCurrency);
    if (!shownThisSession.has(key)) {
      shownThisSession.add(key);
      return { currency: entry.currency, viewerCurrency };
    }
  }
  return null;
}
