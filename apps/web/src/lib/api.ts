import { getAccessToken } from './access-token.js';

const BASE = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type TokenGetter = () => string | null;

let getToken: TokenGetter = getAccessToken;

/** @deprecated Prefer setAccessToken — kept for compatibility */
export function setTokenGetter(fn: TokenGetter): void {
  getToken = fn;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};

  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const init: RequestInit = {
    method,
    headers,
    credentials: 'include',
  };
  if (body !== undefined) {
    init.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, init);

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      suggestedNextAvailableAt?: string;
      [key: string]: unknown;
    };
    const { error, message, suggestedNextAvailableAt, ...rest } = err;
    const details =
      suggestedNextAvailableAt != null
        ? { suggestedNextAvailableAt, ...rest }
        : Object.keys(rest).length > 0
          ? rest
          : undefined;
    throw new ApiError(
      res.status,
      error ?? message ?? res.statusText,
      details,
    );
  }

  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
