import { useEffect, useRef, useCallback, useState } from 'react';

export interface BookingWsEvent {
  eventType: string;
  reservationId?: string;
  bookingId?: string;
  restaurantId: string;
  partySize?: number;
  startsAt?: string;
  cancelledBy?: string;
}

interface Options {
  restaurantId: string;
  token: string | null;
  onEvent: (event: BookingWsEvent) => void;
  enabled?: boolean;
}

export function useBookingWebSocket({
  restaurantId,
  token,
  onEvent,
  enabled = true,
}: Options) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const connect = useCallback(() => {
    if (!token || !restaurantId || !enabled) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/api/ws?token=${encodeURIComponent(token)}&restaurantId=${encodeURIComponent(restaurantId)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      setIsConnected(true);
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as BookingWsEvent;
        if (data.eventType === 'ws.connected') return;
        onEventRef.current(data);
      } catch {
        /* ignore malformed */
      }
    };

    ws.onclose = (ev) => {
      setIsConnected(false);
      if (ev.code < 4000) {
        reconnectRef.current = setTimeout(connect, 3_000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [token, restaurantId, enabled]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close(1000, 'component unmounted');
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      setIsConnected(false);
    };
  }, [connect]);

  return { isConnected };
}
