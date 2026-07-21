import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// story-WI-016 AC "Push additionally sent when Expo push is enabled" / "Push
// withheld when Expo push is disabled": sendSystemNotification (like
// recordActivity before it) delegates to `sendPush` unconditionally and
// relies on `sendPush`'s OWN internal `EXPO_PUSH_ENABLED` gate (push.ts:20)
// rather than duplicating it. That delegation is covered by
// test/send-system-notification.test.ts, but the actual gating behavior
// inside `sendPush` itself had no test anywhere in the suite prior to this
// file — a genuine gap directly backing two of story-WI-016's 13 AC, since
// "no push send is attempted" is a claim about `sendPush`'s own behavior,
// not about whether `sendSystemNotification` called it.

const pushTokenFindManyMock = vi.fn();

const mockEnv = vi.hoisted(() => ({
  EXPO_PUSH_ENABLED: true,
}));

vi.mock('../src/config/env', () => ({
  get env() {
    return mockEnv;
  },
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    pushToken: {
      findMany: (...args: unknown[]) => pushTokenFindManyMock(...args),
    },
  },
}));

import { sendPush } from '../src/lib/push';

beforeEach(() => {
  pushTokenFindManyMock.mockReset().mockResolvedValue([{ token: 'ExponentPushToken[abc]' }]);
  mockEnv.EXPO_PUSH_ENABLED = true;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendPush — EXPO_PUSH_ENABLED gating (backs story-WI-016 push AC)', () => {
  it('sends no push and does not even look up PushToken rows when EXPO_PUSH_ENABLED is false', async () => {
    mockEnv.EXPO_PUSH_ENABLED = false;

    await sendPush(['user_1'], 'You have a stale balance', 'Settle up with Sam');

    expect(pushTokenFindManyMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends a push via the Expo API when EXPO_PUSH_ENABLED is true and the user has a registered token', async () => {
    await sendPush(['user_1'], 'You have a stale balance', 'Settle up with Sam');

    expect(pushTokenFindManyMock).toHaveBeenCalledWith({
      where: { userId: { in: ['user_1'] } },
      select: { token: true },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    const payload = JSON.parse(init.body as string);
    expect(payload).toEqual([
      {
        to: 'ExponentPushToken[abc]',
        title: 'You have a stale balance',
        body: 'Settle up with Sam',
        data: {},
        sound: 'default',
      },
    ]);
  });
});
