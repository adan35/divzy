/**
 * Pure link-construction logic backing the Settle Up screen's Share/QR
 * affordance (spec-WI-016 §B — shareable settle-up link/QR, ADR-013). Kept
 * dependency-free so it's unit-testable without a component renderer, per
 * this app's existing convention (see `copyInvite.ts`, `settlements.ts`).
 *
 * Deliberately builds the query string by hand instead of `URLSearchParams`
 * — React Native's URL polyfill coverage is inconsistent across engines/SDK
 * versions, and this needs no more than ordered key=value pairs.
 */

export interface SettleShareLinkParams {
  fromUserId: string;
  toUserId: string;
  /** Integer minor units — never formatted as a float in the resulting URL. */
  amount: number;
  currency: string;
  groupId?: string | null;
}

/**
 * Builds the canonical Divzy settle-up share link — identical shape to the
 * one web renders, so a single link/QR works on either platform (ADR-013):
 * `${webUrl}/settle?fromUserId=…&toUserId=…&amount=<minor units>&currency=<ISO>[&groupId=…]`.
 * No token, no server state — this only pre-fills the existing manual form;
 * `POST /settlements` remains the sole authority.
 */
export function buildSettleShareLink(params: SettleShareLinkParams, webUrl: string): string {
  const pairs: Array<[string, string]> = [
    ['fromUserId', params.fromUserId],
    ['toUserId', params.toUserId],
    ['amount', String(Math.trunc(params.amount))],
    ['currency', params.currency],
  ];
  if (params.groupId) pairs.push(['groupId', params.groupId]);

  const query = pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  const origin = webUrl.replace(/\/+$/, '');
  return `${origin}/settle?${query}`;
}

export interface CopySettleShareLinkDeps {
  /** Writes text to the system clipboard (e.g. `Clipboard.setStringAsync`). Rejects on failure. */
  setClipboardText: (text: string) => Promise<unknown>;
  /** Fire-and-forget success haptic. Its own failure never turns a successful copy into an error result. */
  notifySuccess?: () => void | Promise<void>;
  /** Called with the real error object when the copy fails, for dev visibility (never silently discarded). */
  onError?: (err: unknown) => void;
}

export interface CopySettleShareLinkResult {
  message: string;
  tone: 'success' | 'error';
}

/**
 * Copies the settle-up share link to the clipboard and resolves to the
 * toast to show — success or failure — without ever throwing. Mirrors
 * `copyInvite.ts`'s `copyInviteLink` sequence exactly (spec-WI-005
 * precedent), kept as a separate small function rather than a shared one so
 * each surface's toast copy stays accurate ("Settle link copied" vs
 * "Invite link copied").
 */
export async function copySettleShareLink(
  link: string,
  deps: CopySettleShareLinkDeps,
): Promise<CopySettleShareLinkResult> {
  try {
    await deps.setClipboardText(link);
    try {
      await deps.notifySuccess?.();
    } catch {
      // Haptics are best-effort — never affect the copy result.
    }
    return { message: 'Settle link copied', tone: 'success' };
  } catch (err) {
    deps.onError?.(err);
    return { message: 'Could not copy the link', tone: 'error' };
  }
}
