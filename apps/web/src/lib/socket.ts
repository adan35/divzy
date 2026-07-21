'use client';

import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ClientToServerEvents, ServerToClientEvents } from '@divzy/shared';
import { useAuthStore } from './auth-store';
import { invalidateForGroupChangedEvent, queryKeys } from './hooks';

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4000';

type DivzySocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: DivzySocket | null = null;

/** Group rooms we want to be in — re-subscribed after every (re)connect. */
const subscribedGroups = new Set<string>();

export function getSocket(): DivzySocket | null {
  return socket;
}

/** Subscribe to a group's realtime room (server verifies membership). */
export function joinGroupRoom(groupId: string): void {
  subscribedGroups.add(groupId);
  if (socket?.connected) socket.emit('group:subscribe', groupId);
}

export function leaveGroupRoom(groupId: string): void {
  subscribedGroups.delete(groupId);
  if (socket?.connected) socket.emit('group:unsubscribe', groupId);
}

function teardownSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

/**
 * Mount once in the authed app shell. Connects a socket while the user is
 * authenticated (reconnecting with a fresh token whenever it changes) and
 * translates server events into TanStack Query invalidations per CONTRACTS.
 * Data refreshes are silent; only brand-new notifications toast.
 */
export function useRealtimeSync(): void {
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (status !== 'authed' || !accessToken) {
      teardownSocket();
      return;
    }

    // Fresh token -> fresh connection (server authenticates the handshake).
    teardownSocket();
    const next: DivzySocket = io(WS_URL, {
      path: '/ws',
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 10_000,
    });
    socket = next;

    next.on('connect', () => {
      for (const groupId of subscribedGroups) {
        next.emit('group:subscribe', groupId);
      }
    });

    next.on('group:changed', (payload) => {
      invalidateForGroupChangedEvent(queryClient, payload);
    });

    next.on('friends:changed', () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
      void queryClient.invalidateQueries({ queryKey: queryKeys.balance });
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['expense'] });
      void queryClient.invalidateQueries({ queryKey: ['settlements'] });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    });

    next.on('activity:new', () => {
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    });

    next.on('notification:new', (notification) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
      toast(notification.title, {
        description: notification.body || undefined,
      });
    });

    return () => {
      if (socket === next) teardownSocket();
    };
  }, [status, accessToken, queryClient]);
}
