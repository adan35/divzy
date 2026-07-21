import { describe, expect, it } from 'vitest';
import { canClearAllNotifications } from './notificationHeaderActions';

// Tests written from spec-WI-065 §4 ("Clear all" gating — independent of
// unread state, `notifications.length > 0`, no in-flight mutation) before
// `canClearAllNotifications` existed in this module.

describe('canClearAllNotifications (WI-065)', () => {
  it('is enabled when the list has at least one notification and no mutation is pending', () => {
    expect(canClearAllNotifications(1, false)).toBe(true);
    expect(canClearAllNotifications(20, false)).toBe(true);
  });

  it('is disabled when the loaded list is empty, regardless of pending state', () => {
    expect(canClearAllNotifications(0, false)).toBe(false);
    expect(canClearAllNotifications(0, true)).toBe(false);
  });

  it('is disabled while a clear-all mutation is in flight, even with a non-empty list', () => {
    expect(canClearAllNotifications(5, true)).toBe(false);
  });

  it('is independent of read/unread state — an all-read-but-uncleared list is still clearable', () => {
    // The gate takes only a count, never a readAt-derived flag, so an
    // all-read list (count > 0) still yields true — this is the behavior
    // that disambiguates it from "Mark all read"'s hasUnread gate.
    expect(canClearAllNotifications(3, false)).toBe(true);
  });
});
