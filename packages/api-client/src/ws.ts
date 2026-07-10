import { getApiBaseUrl } from './session.js';

/**
 * WebSocket URL for an API path, derived from the SAME base URL as REST calls.
 * (Previously the dashboard hardcoded window.location.host, which silently
 * breaks when the API is deployed on a different origin than the SPA.)
 */
export function getWebSocketUrl(path: string): string {
  const base = getApiBaseUrl();

  if (/^https?:\/\//i.test(base)) {
    const url = new URL(base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = joinPaths(url.pathname, path);
    return url.toString();
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}${joinPaths(base, path)}`;
}

function joinPaths(a: string, b: string): string {
  const left = a.endsWith('/') ? a.slice(0, -1) : a;
  const right = b.startsWith('/') ? b : `/${b}`;
  return `${left}${right}`;
}
