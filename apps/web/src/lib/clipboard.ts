/**
 * WI-016 (Part B — settle-up link/QR): small shared clipboard helper.
 *
 * Extracted from the pattern already established locally in
 * `components/groups/invite-dialog.tsx` (`handleCopy`/`copyViaFallback`) —
 * no shared `copyToClipboard` util existed anywhere in `apps/web/src/lib`
 * before this, so this is the first promotion of that pattern to a reusable
 * home. `invite-dialog.tsx` itself is left untouched (social-groups-owned
 * surface, out of this domain's boundary) — only new call sites (this
 * domain's `settle-dialog.tsx`) use it.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // navigator.clipboard undefined — non-secure context / embedded webview /
    // iframe without clipboard-write permission. Fallback: hidden textarea +
    // legacy execCommand. Throws if this also fails, caught below.
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    el.setSelectionRange(0, text.length);
    try {
      const ok = document.execCommand('copy');
      if (!ok) throw new Error('execCommand(copy) returned false');
      return true;
    } finally {
      document.body.removeChild(el);
    }
  } catch (err) {
    console.error('[clipboard] copy failed', err);
    return false;
  }
}
