/**
 * Fetch wrapper shared by every frontend app: attaches the bearer token,
 * normalizes errors, and — the part no app had before — recovers from access
 * token expiry by refreshing once and retrying the request.
 */

import {
  getAccessToken,
  getApiBaseUrl,
  refreshSession,
} from './session.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Structured extras (e.g. suggestedNextAvailableAt, zod details). */
    public details?: Record<string, unknown> | undefined,
    /** The raw parsed error body, for callers that need everything. */
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ParsedErrorBody {
  error?: string;
  message?: string;
  details?: {
    fieldErrors?: Record<string, string[] | undefined>;
    formErrors?: string[];
  };
  [key: string]: unknown;
}

/**
 * Human-facing message for an error body. Zod validation details beat the
 * generic "Validation failed" envelope; the API's `error` beats HTTP text.
 */
function resolveErrorMessage(body: ParsedErrorBody, statusText: string): string {
  const fieldError = Object.values(body.details?.fieldErrors ?? {}).find(
    (messages) => messages && messages.length > 0,
  );
  if (fieldError?.[0]) return fieldError[0];
  const formError = body.details?.formErrors?.[0];
  if (formError) return formError;
  return body.error ?? body.message ?? statusText;
}

function buildApiError(status: number, statusText: string, raw: unknown): ApiError {
  const body = (raw ?? {}) as ParsedErrorBody;
  const { error, message, details, ...rest } = body;
  void error;
  void message;
  const extras: Record<string, unknown> = { ...rest };
  if (details !== undefined) extras.details = details;
  return new ApiError(
    status,
    resolveErrorMessage(body, statusText),
    Object.keys(extras).length > 0 ? extras : undefined,
    raw,
  );
}

/**
 * Auth endpoints where a 401 is a definitive answer, not a stale token — never
 * refresh-and-retry these. `/auth/me` is deliberately retryable.
 */
function isNoRetryPath(path: string): boolean {
  if (path.startsWith('/admin/auth/')) return true;
  return path.startsWith('/auth/') && path !== '/auth/me';
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  isRetry = false,
): Promise<T> {
  const headers: Record<string, string> = {};

  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const init: RequestInit = {
    method,
    headers,
    credentials: 'include',
  };
  if (body !== undefined) {
    init.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  const res = await fetch(`${getApiBaseUrl()}${path}`, init);

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  const raw: unknown = await res.json().catch(() => ({}));

  // Access token expired mid-session: refresh once (single-flight across
  // concurrent requests) and replay. If the refresh itself fails, surface the
  // original 401 — session-death notification is the session module's job.
  if (res.status === 401 && token && !isRetry && !isNoRetryPath(path)) {
    try {
      await refreshSession();
    } catch {
      throw buildApiError(res.status, res.statusText, raw);
    }
    return request<T>(method, path, body, true);
  }

  throw buildApiError(res.status, res.statusText, raw);
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>('PUT', path, body),
  delete: <T>(path: string): Promise<T> => request<T>('DELETE', path),
};
