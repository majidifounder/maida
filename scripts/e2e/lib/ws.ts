import WebSocket from 'ws';

export interface WsMessage {
  eventType: string;
  [key: string]: unknown;
}

export function connectOwnerWs(
  wsBase: string,
  token: string,
  restaurantId: string,
): Promise<{ ws: WebSocket; messages: WsMessage[] }> {
  return new Promise((resolve, reject) => {
    const url = `${wsBase}/ws?token=${encodeURIComponent(token)}&restaurantId=${encodeURIComponent(restaurantId)}`;
    const messages: WsMessage[] = [];
    const ws = new WebSocket(url);

    const timeout = setTimeout(() => {
      reject(new Error('WebSocket connection timed out'));
    }, 10_000);

    ws.on('open', () => {
      clearTimeout(timeout);
      resolve({ ws, messages });
    });

    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()) as WsMessage);
      } catch {
        // ignore non-json
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export function waitForEvent(
  messages: WsMessage[],
  eventType: string,
  timeoutMs = 8_000,
): Promise<WsMessage> {
  const existing = messages.find((m) => m.eventType === eventType);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const startLen = messages.length;
    const interval = setInterval(() => {
      const found = messages.find((m) => m.eventType === eventType);
      if (found) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve(found);
      }
    }, 100);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(
        new Error(
          `Timed out waiting for WS event "${eventType}" (got: ${messages.map((m) => m.eventType).join(', ')})`,
        ),
      );
    }, timeoutMs);

    // Also watch for new pushes after start
    void (async () => {
      while (messages.length >= startLen) {
        const found = messages.find((m) => m.eventType === eventType);
        if (found) return;
        await new Promise((r) => setTimeout(r, 50));
      }
    })();
  });
}

export function closeWs(ws: WebSocket): void {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close();
  }
}
