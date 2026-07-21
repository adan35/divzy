/**
 * Whether the `Avatar` component should render the photo (vs. the initials
 * fallback) — WI-035.
 *
 * A falsy `avatarUrl` (null/undefined/empty string — no photo set) always
 * falls back to initials. A url that previously failed to load
 * (`failedUrl`) also falls back — this is what turns a broken image into
 * the initials circle instead of a broken-image icon (never a broken image,
 * per the design's display requirement). Comparing against the *specific*
 * failed url (not a boolean "hasFailed" flag) means a different url — e.g.
 * after the user replaces their photo — always gets a fresh attempt even if
 * a prior photo's load had failed.
 */
export function shouldShowAvatarImage(
  avatarUrl: string | null | undefined,
  failedUrl: string | null,
): boolean {
  return !!avatarUrl && avatarUrl !== failedUrl;
}
