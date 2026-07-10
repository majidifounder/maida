import { getAccessToken, setAccessToken } from './access-token.js';

const BASE = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  status: number;

  body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };

  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    const errorBody: unknown = await res.json().catch(() => ({}));
    if (res.status === 401) {
      setAccessToken(null);
      window.dispatchEvent(new CustomEvent('admin:unauthorized'));
    }
    const message =
      (errorBody as { error?: string }).error ?? res.statusText;
    throw new ApiError(res.status, message, errorBody);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => {
    const init: RequestInit = { method: 'PATCH' };
    if (body !== undefined) init.body = JSON.stringify(body);
    return request<T>(path, init);
  },
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
