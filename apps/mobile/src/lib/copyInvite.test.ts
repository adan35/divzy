import { describe, expect, it, vi } from 'vitest';
import { copyInviteLink } from './copyInvite';

describe('copyInviteLink — mobile invite-link copy flow (spec-WI-005)', () => {
  it('on success, resolves a visible success toast and fires the success haptic', async () => {
    const setClipboardText = vi.fn().mockResolvedValue(undefined);
    const notifySuccess = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    const result = await copyInviteLink('divzy://join/ABC123', {
      setClipboardText,
      notifySuccess,
      onError,
    });

    expect(setClipboardText).toHaveBeenCalledWith('divzy://join/ABC123');
    expect(notifySuccess).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ message: 'Invite link copied', tone: 'success' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('on failure, never throws, surfaces a visible error toast, and logs the real error (never silently discarded)', async () => {
    const clipboardError = new Error('clipboard unavailable');
    const setClipboardText = vi.fn().mockRejectedValue(clipboardError);
    const notifySuccess = vi.fn();
    const onError = vi.fn();

    const result = await copyInviteLink('divzy://join/ABC123', {
      setClipboardText,
      notifySuccess,
      onError,
    });

    expect(result).toEqual({ message: 'Could not copy the link', tone: 'error' });
    // The real error object reaches the caller for dev visibility — not swallowed.
    expect(onError).toHaveBeenCalledWith(clipboardError);
    // The success haptic must never fire on a failed copy.
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it('a haptic failure never turns an otherwise-successful copy into an error result', async () => {
    const setClipboardText = vi.fn().mockResolvedValue(undefined);
    const notifySuccess = vi.fn().mockRejectedValue(new Error('haptics unsupported'));
    const onError = vi.fn();

    const result = await copyInviteLink('divzy://join/ABC123', {
      setClipboardText,
      notifySuccess,
      onError,
    });

    expect(result).toEqual({ message: 'Invite link copied', tone: 'success' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('works with no notifySuccess/onError provided at all (both optional)', async () => {
    const setClipboardText = vi.fn().mockResolvedValue(undefined);
    await expect(copyInviteLink('divzy://join/ABC123', { setClipboardText })).resolves.toEqual({
      message: 'Invite link copied',
      tone: 'success',
    });

    const failing = vi.fn().mockRejectedValue(new Error('nope'));
    await expect(
      copyInviteLink('divzy://join/ABC123', { setClipboardText: failing }),
    ).resolves.toEqual({ message: 'Could not copy the link', tone: 'error' });
  });

  it('repeated calls each independently reflect their own outcome (AC5 — success then failure then success)', async () => {
    const onError = vi.fn();
    const succeed = vi.fn().mockResolvedValue(undefined);
    const fail = vi.fn().mockRejectedValue(new Error('transient'));

    const first = await copyInviteLink('link', { setClipboardText: succeed, onError });
    const second = await copyInviteLink('link', { setClipboardText: fail, onError });
    const third = await copyInviteLink('link', { setClipboardText: succeed, onError });

    expect(first.tone).toBe('success');
    expect(second.tone).toBe('error');
    expect(third.tone).toBe('success');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
