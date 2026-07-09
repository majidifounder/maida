import { getAccessToken } from './access-token.js';

const BASE = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type TokenGetter = () => string | null;
let getToken: TokenGetter = getAccessToken;

/** @deprecated Prefer setAccessToken — kept for compatibility */
export function setTokenGetter(fn: TokenGetter): void {
  getToken = fn;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };

  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      details?: {
        fieldErrors?: Record<string, string[]>;
        formErrors?: string[];
      };
    };
    let message = body.error ?? res.statusText;
    const fieldError = Object.entries(body.details?.fieldErrors ?? {}).find(
      ([, messages]) => messages?.length,
    );
    if (fieldError) {
      message = fieldError[1]![0] ?? message;
    } else if (body.details?.formErrors?.[0]) {
      message = body.details.formErrors[0];
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  patch: <T>(path: string, body?: unknown) => {
    const init: RequestInit = { method: 'PATCH' };
    if (body !== undefined) init.body = JSON.stringify(body);
    return request<T>(path, init);
  },
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
