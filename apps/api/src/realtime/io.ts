import { Server } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import type { ClientToServerEvents, ServerToClientEvents } from '@divzy/shared';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';

interface SocketData {
  userId: string;
}

type DivzyIO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

let io: DivzyIO | null = null;

/**
 * Attach socket.io to the Fastify HTTP server (path /ws). Handshake auth
 * carries the access token (`auth: { token }`); each socket joins its
 * `user:<id>` room. Clients may subscribe to group rooms after a membership
 * check.
 */
export function setupRealtime(app: FastifyInstance): void {
  const server: DivzyIO = new Server(app.server, {
    path: '/ws',
    cors: { origin: env.CORS_ORIGINS, credentials: true },
  });

  server.use((socket, next) => {
    const token: unknown = socket.handshake.auth.token;
    if (typeof token !== 'string' || token.length === 0) {
      next(new Error('UNAUTHORIZED'));
      return;
    }
    try {
      const payload = app.jwt.verify<{ sub: string }>(token);
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  server.on('connection', (socket) => {
    const { userId } = socket.data;
    void socket.join(`user:${userId}`);

    socket.on('group:subscribe', (groupId) => {
      if (typeof groupId !== 'string' || groupId.length === 0) return;
      void (async () => {
        try {
          const membership = await prisma.groupMember.findFirst({
            where: { groupId, userId, leftAt: null },
            select: { id: true },
          });
          if (membership) {
            await socket.join(`group:${groupId}`);
          }
        } catch (err) {
          app.log.error({ err, groupId, userId }, 'group:subscribe failed');
        }
      })();
    });

    socket.on('group:unsubscribe', (groupId) => {
      if (typeof groupId !== 'string' || groupId.length === 0) return;
      void socket.leave(`group:${groupId}`);
    });
  });

  io = server;
}

export function getIO(): DivzyIO | null {
  return io;
}

export function emitToUsers<E extends keyof ServerToClientEvents>(
  userIds: string[],
  event: E,
  ...payload: Parameters<ServerToClientEvents[E]>
): void {
  if (!io || userIds.length === 0) return;
  io.to(userIds.map((id) => `user:${id}`)).emit(event, ...payload);
}

export function emitToGroup<E extends keyof ServerToClientEvents>(
  groupId: string,
  event: E,
  ...payload: Parameters<ServerToClientEvents[E]>
): void {
  if (!io) return;
  io.to(`group:${groupId}`).emit(event, ...payload);
}
