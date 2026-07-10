import { useEffect, useRef, useCallback, useState } from 'react';
import { getValidAccessToken, getWebSocketUrl } from '@restaurant/api-client';

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
  onEvent: (event: BookingWsEvent) => void;
  enabled?: boolean;
}

/** Server closes the socket with this code when the access token expires. */
const WS_CLOSE_TOKEN_EXPIRED = 4001;
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * Live reservation feed for one restaurant.
 *
 * The token is fetched (and refreshed if stale) on every connect, so the feed
 * survives access-token expiry: when the server closes with 4001 at token
 * expiry we immediately reconnect with a freshly minted token. Other abnormal
 * closes reconnect with jittered exponential backoff. Application-level close
 * codes >= 4000 other than 4001 (e.g. 4003 forbidden) are terminal — retrying
 * an auth rejection would just hammer the server.
 */
export function useBookingWebSocket({
  restaurantId,
  onEvent,
  enabled = true,
}: Options): { isConnected: boolean } {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const closedByUnmountRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const connect = useCallback(() => {
    if (!restaurantId || !enabled) return;

    void (async () => {
      let token: string;
      try {
        token = await getValidAccessToken();
      } catch {
        // Session is gone or the API is unreachable — retry with backoff; the
        // session module keeps trying to refresh in the background too.
        scheduleReconnect();
        return;
      }
      if (closedByUnmountRef.current) return;

      const url = `${getWebSocketUrl('/ws')}?token=${encodeURIComponent(token)}&restaurantId=${encodeURIComponent(restaurantId)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptsRef.current = 0;
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
        if (closedByUnmountRef.current) return;

        if (ev.code === WS_CLOSE_TOKEN_EXPIRED) {
          // Expected every ~15 min: reconnect right away with a fresh token.
          attemptsRef.current = 0;
          connect();
          return;
        }
        if (ev.code < 4000) {
          scheduleReconnect();
        }
        // Other 4xxx application codes: terminal (forbidden / bad request).
      };

      ws.onerror = () => {
        ws.close();
      };
    })();

    function scheduleReconnect(): void {
      if (closedByUnmountRef.current) return;
      const attempt = attemptsRef.current++;
      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * 2 ** attempt,
        MAX_RECONNECT_DELAY_MS,
      );
      const jittered = delay / 2 + Math.random() * (delay / 2);
      reconnectRef.current = setTimeout(connect, jittered);
    }
  }, [restaurantId, enabled]);

  useEffect(() => {
    closedByUnmountRef.current = false;
    connect();
    return () => {
      closedByUnmountRef.current = true;
      wsRef.current?.close(1000, 'component unmounted');
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      setIsConnected(false);
    };
  }, [connect]);

  return { isConnected };
}
