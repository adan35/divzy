import { describe, expect, it, vi } from 'vitest';
import { buildSettleShareLink, copySettleShareLink } from './settleShareLink';

const WEB_URL = 'http://localhost:3000';

describe('buildSettleShareLink — mobile settle-up share link/QR (spec-WI-016 §B, ADR-013)', () => {
  it('builds the canonical link shape with fromUserId/toUserId/amount/currency, no groupId', () => {
    const link = buildSettleShareLink(
      { fromUserId: 'user_ana', toUserId: 'user_bob', amount: 4250, currency: 'USD' },
      WEB_URL,
    );

    expect(link).toBe(
      'http://localhost:3000/settle?fromUserId=user_ana&toUserId=user_bob&amount=4250&currency=USD',
    );
  });

  it('appends groupId last, only when provided', () => {
    const link = buildSettleShareLink(
      {
        fromUserId: 'user_ana',
        toUserId: 'user_bob',
        amount: 4250,
        currency: 'USD',
        groupId: 'group_ski_trip',
      },
      WEB_URL,
    );

    expect(link).toBe(
      'http://localhost:3000/settle?fromUserId=user_ana&toUserId=user_bob&amount=4250&currency=USD&groupId=group_ski_trip',
    );
  });

  it('omits groupId entirely when null or undefined (never "groupId=null"/"groupId=undefined")', () => {
    const nullLink = buildSettleShareLink(
      { fromUserId: 'a', toUserId: 'b', amount: 100, currency: 'EUR', groupId: null },
      WEB_URL,
    );
    const undefinedLink = buildSettleShareLink(
      { fromUserId: 'a', toUserId: 'b', amount: 100, currency: 'EUR' },
      WEB_URL,
    );

    expect(nullLink).not.toContain('groupId');
    expect(undefinedLink).not.toContain('groupId');
  });

  it('amount stays an integer minor-units string — never float-formatted', () => {
    // Defensive: even if a stray float somehow reaches this function, the
    // URL must never carry a decimal point.
    const link = buildSettleShareLink(
      { fromUserId: 'a', toUserId: 'b', amount: 4250.9, currency: 'USD' },
      WEB_URL,
    );

    expect(link).toContain('amount=4250');
    expect(link).not.toMatch(/amount=\d+\.\d+/);
  });

  it('a whole-number amount never grows a trailing ".0"', () => {
    const link = buildSettleShareLink(
      { fromUserId: 'a', toUserId: 'b', amount: 100, currency: 'USD' },
      WEB_URL,
    );

    expect(link).toContain('amount=100');
    expect(link).not.toContain('amount=100.0');
  });

  it('percent-encodes party ids that need it, so the query string stays well-formed', () => {
    const link = buildSettleShareLink(
      { fromUserId: 'a b', toUserId: 'c&d', amount: 100, currency: 'USD' },
      WEB_URL,
    );

    expect(link).toContain('fromUserId=a%20b');
    expect(link).toContain('toUserId=c%26d');
  });

  it('strips a trailing slash from the web origin before appending /settle', () => {
    const link = buildSettleShareLink(
      { fromUserId: 'a', toUserId: 'b', amount: 100, currency: 'USD' },
      'http://localhost:3000/',
    );

    expect(link.startsWith('http://localhost:3000/settle?')).toBe(true);
    expect(link).not.toContain('//settle');
  });
});

describe('copySettleShareLink — Settle Up screen "Copy link" affordance (spec-WI-016 §B)', () => {
  const LINK = 'http://localhost:3000/settle?fromUserId=a&toUserId=b&amount=100&currency=USD';

  it('on success, resolves a visible success toast and fires the success haptic', async () => {
    const setClipboardText = vi.fn().mockResolvedValue(undefined);
    const notifySuccess = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    const result = await copySettleShareLink(LINK, { setClipboardText, notifySuccess, onError });

    expect(setClipboardText).toHaveBeenCalledWith(LINK);
    expect(notifySuccess).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ message: 'Settle link copied', tone: 'success' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('on failure, never throws, surfaces a visible error toast, and logs the real error', async () => {
    const clipboardError = new Error('clipboard unavailable');
    const setClipboardText = vi.fn().mockRejectedValue(clipboardError);
    const notifySuccess = vi.fn();
    const onError = vi.fn();

    const result = await copySettleShareLink(LINK, { setClipboardText, notifySuccess, onError });

    expect(result).toEqual({ message: 'Could not copy the link', tone: 'error' });
    expect(onError).toHaveBeenCalledWith(clipboardError);
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it('a haptic failure never turns an otherwise-successful copy into an error result', async () => {
    const setClipboardText = vi.fn().mockResolvedValue(undefined);
    const notifySuccess = vi.fn().mockRejectedValue(new Error('haptics unsupported'));
    const onError = vi.fn();

    const result = await copySettleShareLink(LINK, { setClipboardText, notifySuccess, onError });

    expect(result).toEqual({ message: 'Settle link copied', tone: 'success' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('works with no notifySuccess/onError provided at all (both optional)', async () => {
    const setClipboardText = vi.fn().mockResolvedValue(undefined);
    await expect(copySettleShareLink(LINK, { setClipboardText })).resolves.toEqual({
      message: 'Settle link copied',
      tone: 'success',
    });
  });
});
