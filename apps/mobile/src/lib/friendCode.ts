/**
 * Pure friend-add-code helpers (spec-WI-040). Kept dependency-free so it's
 * unit-testable without a component renderer or camera, per this app's
 * existing convention (see `settleShareLink.ts`, `copyInvite.ts`).
 */

/** Manual-entry normalization: trim + uppercase (codes are case-insensitive, mirrors join-by-code). */
export function normalizeFriendCode(input: string): string {
  return input.trim().toUpperCase();
}

const SHARE_URL_CODE_RE = /\/add-friend\/([A-Za-z0-9]+)/;
/** A bare code has no path separators or whitespace of its own. */
const BARE_CODE_RE = /^[A-Za-z0-9]+$/;

/**
 * Decodes a scanned QR payload into a friend code. Accepts either the full
 * share URL (web `https://…/add-friend/<code>` or the `divzy://add-friend/<code>`
 * deep link, mirroring `/join/[code]`'s scheme) or a bare code with no
 * wrapper. Returns null for anything unrecognized — callers surface that as
 * an invalid-code error rather than guessing.
 */
export function extractFriendCodeFromScan(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const match = trimmed.match(SHARE_URL_CODE_RE);
  if (match) return match[1]!.toUpperCase();

  if (BARE_CODE_RE.test(trimmed)) return trimmed.toUpperCase();

  return null;
}
