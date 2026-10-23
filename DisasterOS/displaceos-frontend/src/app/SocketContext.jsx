// Authenticated Socket.IO. Events only trigger REST refetches — REST stays the source of truth,
// and every screen keeps working (with polling) when the socket is down.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { getAccessToken, onTokenChange, refreshSession } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './Toast.jsx';

const SocketContext = createContext({ status: 'off', subscribe: () => () => {} });

const INVALIDATE = {
  'request:created': [['requests'], ['dashboard']],
  'request:updated': [['requests'], ['request'], ['tracking'], ['dashboard'], ['open-needs'], ['offers']],
  'request:verified': [['requests'], ['request'], ['tracking'], ['dashboard'], ['open-needs']],
  'alert:created': [['alerts'], ['dashboard']],
  'alert:updated': [['alerts'], ['dashboard']],
  'allocation:updated': [['allocations'], ['inventory'], ['tracking'], ['request']],
  'dispatch:assigned': [['dispatches'], ['tracking'], ['teams']],
  'dispatch:started': [['dispatches'], ['tracking']],
  'dispatch:updated': [['dispatches'], ['tracking'], ['teams']],
  'dispatch:location_updated': [['tracking'], ['dispatch-tracking'], ['map']],
  'dispatch:eta_updated': [['tracking'], ['dispatches'], ['dispatch-tracking']],
  'dispatch:delayed': [['tracking'], ['dispatches']],
  'dispatch:partially_delivered': [['tracking'], ['dispatches'], ['inventory']],
  'dispatch:completed': [['tracking'], ['dispatches'], ['inventory'], ['teams']],
  'notification:created': [['notifications']],
  'inventory:updated': [['inventory'], ['availability']],
  'team:updated': [['teams'], ['map']],
  'zone:updated': [['zones']],
  'supply:updated': [['donations'], ['inventory']],
};

export function SocketProvider({ children }) {
  const { status: authStatus } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('off'); // off | connecting | live | reconnecting
  const socketRef = useRef(null);

  useEffect(() => {
    if (authStatus !== 'authenticated') return undefined;
    const url = import.meta.env.VITE_SOCKET_URL || undefined;
    const socket = io(url, { auth: (cb) => cb({ token: getAccessToken() }), transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    setStatus('connecting');

    socket.on('connect', () => setStatus('live'));
    socket.on('disconnect', () => setStatus('reconnecting'));
    socket.on('connect_error', async (err) => {
      setStatus('reconnecting');
      if (err?.message === 'UNAUTHORIZED') {
        try {
          await refreshSession();
        } catch {
          socket.disconnect();
          setStatus('off');
        }
      }
    });
    for (const [event, keys] of Object.entries(INVALIDATE)) {
      socket.on(event, () => keys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey })));
    }
    socket.on('notification:created', (n) => n?.title && toast(n.title));

    // Reconnect with the new token after a refresh so the server sees a valid credential.
    const off = onTokenChange((token) => {
      if (token && socket.disconnected) socket.connect();
    });
    return () => {
      off();
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setStatus('off');
    };
  }, [authStatus, queryClient, toast]);

  // Ask the server to stream updates for one request/dispatch. The server checks scope; failures are silent.
  const subscribe = (type, id) => {
    const s = socketRef.current;
    if (!s || !id) return () => {};
    const send = () => s.emit('subscribe', { type, id }, () => {});
    if (s.connected) send();
    s.on('connect', send);
    return () => {
      s.off('connect', send);
      s.emit('unsubscribe', { type, id });
    };
  };

  return <SocketContext.Provider value={{ status, subscribe }}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);

export function useLiveRecord(type, id) {
  const { subscribe, status } = useSocket();
  useEffect(() => subscribe(type, id), [type, id, status]); // eslint-disable-line react-hooks/exhaustive-deps
}
