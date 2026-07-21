import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import type { ClientToServerEvents, ServerToClientEvents } from '@divzy/shared';
import { API_BASE_URL, getAccessToken, onAuthEvent } from './api';
import { useAuth } from './auth';
import { invalidateForGroupChangedEvent, queryKeys } from './hooks';

const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? API_BASE_URL;

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

/** Keep a screen subscribed to a group's realtime room while mounted. */
export function useGroupRoom(groupId: string | undefined): void {
  useEffect(() => {
    if (!groupId) return;
    joinGroupRoom(groupId);
    return () => leaveGroupRoom(groupId);
  }, [groupId]);
}

function teardownSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

/**
 * Mount once in the root layout (inside Auth + QueryClient providers).
 * Connects a socket while the user is authenticated — reconnecting with a
 * fresh token whenever the stored tokens rotate — and translates server
 * events into TanStack Query invalidations per CONTRACTS. Refreshes are
 * silent; screens re-render from the cache.
 */
export function useRealtimeSync(): void {
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const [token, setToken] = useState<string | null>(() => getAccessToken());

  // Follow access-token rotation (login, refresh, logout).
  useEffect(() => onAuthEvent('tokens', () => setToken(getAccessToken())), []);

  useEffect(() => {
    if (status !== 'authed' || !token) {
      teardownSocket();
      return;
    }

    // Fresh token -> fresh connection (server authenticates the handshake).
    teardownSocket();
    const next: DivzySocket = io(WS_URL, {
      path: '/ws',
      auth: { token },
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

    next.on('notification:new', () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
    });

    return () => {
      if (socket === next) teardownSocket();
    };
  }, [status, token, queryClient]);
}
