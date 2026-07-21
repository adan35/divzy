import type { ToastTone } from './toast';

export interface CopyInviteResult {
  message: string;
  tone: ToastTone;
}

export interface CopyInviteDeps {
  /** Writes text to the system clipboard (e.g. `Clipboard.setStringAsync`). Rejects on failure. */
  setClipboardText: (text: string) => Promise<unknown>;
  /** Fire-and-forget success haptic. Its own failure never turns a successful copy into an error result. */
  notifySuccess?: () => void | Promise<void>;
  /** Called with the real error object when the copy fails, for dev visibility (never silently discarded). */
  onError?: (err: unknown) => void;
}

/**
 * Copies `text` to the clipboard and resolves to the toast to show —
 * success or failure — without ever throwing. Pure orchestration with
 * injected dependencies, so it's unit-testable without rendering the
 * `group/[id].tsx` screen. Mirrors spec-WI-005's `copyInvite` sequence
 * exactly: the success haptic only fires once the clipboard write itself
 * has resolved, and a haptic failure is swallowed without affecting the
 * (still successful) copy result.
 */
export async function copyInviteLink(text: string, deps: CopyInviteDeps): Promise<CopyInviteResult> {
  try {
    await deps.setClipboardText(text);
    try {
      await deps.notifySuccess?.();
    } catch {
      // Haptics are best-effort — never affect the copy result.
    }
    return { message: 'Invite link copied', tone: 'success' };
  } catch (err) {
    deps.onError?.(err);
    return { message: 'Could not copy the link', tone: 'error' };
  }
}
