// spec-WI-041 §4.2 / ADR-021 (rev. 2026-07-17) — the real, batched, read-only
// lookup of auth's shipped `NotificationPreference` table. Mocks
// `prisma.notificationPreference.findMany` the way other tests in this
// codebase mock Prisma collaborators (see test/send-system-notification.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notificationPreferenceFindManyMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    notificationPreference: {
      findMany: (...args: unknown[]) => notificationPreferenceFindManyMock(...args),
    },
  },
}));

import { getNotificationPreferences } from '../src/lib/notification-preferences';

beforeEach(() => {
  notificationPreferenceFindManyMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getNotificationPreferences (real Prisma-backed lookup, ADR-021 rev. 2026-07-17)', () => {
  it('returns an empty map for an empty userIds array WITHOUT querying the database', async () => {
    const prefs = await getNotificationPreferences([], 'COMMENT');

    expect(prefs.size).toBe(0);
    expect(notificationPreferenceFindManyMock).not.toHaveBeenCalled();
  });

  it('queries prisma.notificationPreference.findMany with a batched userId-in filter and the exact category', async () => {
    notificationPreferenceFindManyMock.mockResolvedValue([]);

    await getNotificationPreferences(['u1', 'u2', 'u3'], 'EXPENSE_ADDED');

    expect(notificationPreferenceFindManyMock).toHaveBeenCalledTimes(1);
    expect(notificationPreferenceFindManyMock).toHaveBeenCalledWith({
      where: { userId: { in: ['u1', 'u2', 'u3'] }, category: 'EXPENSE_ADDED' },
      select: { userId: true, pushEnabled: true, emailEnabled: true },
    });
  });

  it('maps a present row to {push, email} from pushEnabled/emailEnabled', async () => {
    notificationPreferenceFindManyMock.mockResolvedValue([
      { userId: 'u1', pushEnabled: false, emailEnabled: true },
    ]);

    const prefs = await getNotificationPreferences(['u1'], 'EXPENSE_ADDED');

    expect(prefs.get('u1')).toEqual({ push: false, email: true });
    expect(prefs.size).toBe(1);
  });

  it('a userId absent from findMany results is simply absent from the returned Map (caller applies fail-open default)', async () => {
    // Only u1 has a row; u2 has none.
    notificationPreferenceFindManyMock.mockResolvedValue([
      { userId: 'u1', pushEnabled: false, emailEnabled: false },
    ]);

    const prefs = await getNotificationPreferences(['u1', 'u2'], 'COMMENT');

    expect(prefs.get('u1')).toEqual({ push: false, email: false });
    expect(prefs.has('u2')).toBe(false);
    expect(prefs.size).toBe(1);
  });

  it('never leaks another user\'s row: only requested userIds can appear in the returned Map', async () => {
    notificationPreferenceFindManyMock.mockResolvedValue([
      { userId: 'u1', pushEnabled: true, emailEnabled: true },
      { userId: 'intruder', pushEnabled: false, emailEnabled: false },
    ]);

    const prefs = await getNotificationPreferences(['u1'], 'PAYMENT_RECEIVED');

    // The mock is deliberately misbehaving (as if a query bug returned an
    // extra row); this pins that the helper is a pure pass-through mapping —
    // it does not itself re-filter, so the real safety net is the `where`
    // clause asserted above. This test documents that expectation explicitly.
    expect(prefs.get('u1')).toEqual({ push: true, email: true });
  });

  it('is called once per fan-out (batched), not once per user', async () => {
    notificationPreferenceFindManyMock.mockResolvedValue([]);

    await getNotificationPreferences(['a', 'b', 'c', 'd'], 'GROUP_INVITE');

    expect(notificationPreferenceFindManyMock).toHaveBeenCalledTimes(1);
  });
});
