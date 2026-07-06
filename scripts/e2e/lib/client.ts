import { fetch } from 'undici';
import type { E2eContext } from './context.js';

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
  cookies: string[];
}

function parseCookies(setCookie: string | string[] | null | undefined): string[] {
  if (!setCookie) return [];
  return Array.isArray(setCookie) ? setCookie : [setCookie];
}

export async function apiRequest<T = unknown>(
  ctx: E2eContext,
  method: string,
  path: string,
  opts: {
    body?: unknown;
    token?: string;
    query?: Record<string, string | number | undefined>;
    headers?: Record<string, string>;
    skipLoadTestHeader?: boolean;
  } = {},
): Promise<ApiResponse<T>> {
  let url = `${ctx.base}${path}`;
  if (opts.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.skipLoadTestHeader ? {} : ctx.loadTestHeaders),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });

  const text = await res.text();
  let body: T;
  try {
    body = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    body = text as T;
  }

  return {
    status: res.status,
    body,
    headers: res.headers,
    cookies: parseCookies(res.headers.getSetCookie?.() ?? res.headers.get('set-cookie')),
  };
}

export function refreshTokenFromCookies(cookies: string[]): string {
  const line = cookies.find((c) => c.startsWith('__Host-refresh='));
  return line?.split(';')[0]?.replace('__Host-refresh=', '') ?? '';
}
