import { pino } from 'pino';
import { env } from '../config/env';
import { prisma } from './prisma';

const log = pino({ name: 'push', level: env.NODE_ENV === 'test' ? 'silent' : 'info' });

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;

/**
 * Send an Expo push notification to every registered device of `userIds`.
 * Disabled via EXPO_PUSH_ENABLED=false. Never throws — push is best-effort.
 */
export async function sendPush(
  userIds: string[],
  title: string,
  body: string,
  data?: object,
): Promise<void> {
  if (!env.EXPO_PUSH_ENABLED || userIds.length === 0) return;
  try {
    const tokens = await prisma.pushToken.findMany({
      where: { userId: { in: userIds } },
      select: { token: true },
    });
    if (tokens.length === 0) return;

    const messages = tokens.map((t) => ({
      to: t.token,
      title,
      body,
      data: data ?? {},
      sound: 'default' as const,
    }));

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(batch),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        log.warn(
          { status: response.status, body: text.slice(0, 500) },
          'Expo push batch rejected',
        );
      }
    }
  } catch (err) {
    log.error({ err }, 'Failed to send push notifications');
  }
}
