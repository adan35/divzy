/**
 * WI-065 — "Clear all" header-control gating (spec-WI-065 §4).
 *
 * Deliberately independent of unread state (unlike "Mark all read", which
 * gates on `hasUnread`): an all-read-but-uncleared list must still be
 * clearable. Gated only on there being something loaded to clear, and no
 * in-flight clear-all mutation — mirrors `handleClearAll`'s own guard in
 * apps/mobile/app/notifications.tsx so the guard is unit-testable without a
 * render harness (see apps/mobile agent-memory
 * feedback_extract-pure-fn-for-untestable-rn-ui.md).
 */
export function canClearAllNotifications(notificationsCount: number, isPending: boolean): boolean {
  return notificationsCount > 0 && !isPending;
}
