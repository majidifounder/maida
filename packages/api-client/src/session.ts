/**
 * In-memory session state shared by every frontend app.
 *
 * The access token is NEVER persisted (no localStorage/sessionStorage) — the
 * HttpOnly `__Host-refresh` cookie is the only durable credential. This module
 * owns:
 *
 *  - the current access token + its expiry
 *  - single-flight refresh (concurrent callers share one /auth/refresh)
 *  - proactive refresh ~60s before expiry, so an open tab never goes stale
 *  - recovery on tab focus (background-tab timers are throttled by browsers)
 *
 * A session is only declared dead when the SERVER says the refresh token is
 * invalid (401/403/422). Network failures and 5xx — including the API's 503
 * "backing store unavailable" — never destroy a session: the timer retries and
 * in-flight requests surface their own errors.
 */

export interface SessionConfig {
  /** API base URL, e.g. '/api' or 'https://api.example.com'. */
  baseUrl: string;
  /** Called exactly once per session death (refresh token rejected). */
  onSessionExpired?: (() => void) | undefined;
}

/** Refresh failed because the server rejected the refresh token. */
export class SessionExpiredError extends Error {
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/** Refresh failed for a transient reason (network, 5xx) — session may survive. */
export class SessionRefreshUnavailableError extends Error {
  constructor(message = 'Could not refresh session — service unavailable') {
    super(message);
    this.name = 'SessionRefreshUnavailableError';
  }
}

/** Fire the proactive refresh this long before the token expires. */
const PROACTIVE_REFRESH_MARGIN_MS = 60_000;
/** Retry delay when a proactive refresh fails transiently. */
const PROACTIVE_RETRY_DELAY_MS = 30_000;
/** On tab focus, refresh if the token has less life than this left. */
const FOCUS_REFRESH_THRESHOLD_MS = 120_000;
/** For getValidAccessToken(): treat tokens with less than this as stale. */
const MIN_USABLE_TOKEN_LIFE_MS = 30_000;

let config: SessionConfig = { baseUrl: '/api' };

let accessToken: string | null = null;
let accessTokenExpiresAtMs: number | null = null;
/** True once a session existed — gates focus-refresh so logged-out tabs stay quiet. */
let hadSession = false;

let refreshInFlight: Promise<string> | null = null;
let proactiveTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityHookInstalled = false;

export function configureApiClient(next: Partial<SessionConfig>): void {
  config = { ...config, ...next };
  installVisibilityHook();
}

export function getApiBaseUrl(): string {
  return config.baseUrl;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Epoch ms the current access token expires at, or null when logged out. */
export function getAccessTokenExpiresAtMs(): number | null {
  return accessTokenExpiresAtMs;
}

/**
 * Store a fresh access token and schedule its proactive refresh.
 * `expiresAtEpochSeconds` is the API's `accessTokenExpiresAt` field.
 */
export function applySession(
  token: string,
  expiresAtEpochSeconds?: number,
): void {
  accessToken = token;
  accessTokenExpiresAtMs =
    typeof expiresAtEpochSeconds === 'number'
      ? expiresAtEpochSeconds * 1000
      : null;
  hadSession = true;
  scheduleProactiveRefresh();
}

/**
 * Back-compat setter (the old per-app `setAccessToken`). Prefer applySession —
 * without an expiry the proactive refresh cannot be scheduled.
 */
export function setAccessToken(token: string | null): void {
  if (token === null) {
    clearSession();
    return;
  }
  applySession(token);
}

export function clearSession(): void {
  accessToken = null;
  accessTokenExpiresAtMs = null;
  hadSession = false;
  if (proactiveTimer) {
    clearTimeout(proactiveTimer);
    proactiveTimer = null;
  }
}

function expireSession(): void {
  const notify = hadSession;
  clearSession();
  if (notify) config.onSessionExpired?.();
}

/**
 * Exchange the refresh cookie for a new access token. Single-flight: concurrent
 * callers await the same request. Resolves with the new access token.
 *
 * @throws SessionExpiredError when the server rejects the refresh token
 * @throws SessionRefreshUnavailableError on network errors / 5xx
 */
export function refreshSession(): Promise<string> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'include',
    });
  } catch {
    throw new SessionRefreshUnavailableError();
  }

  if (res.ok) {
    const data = (await res.json().catch(() => null)) as {
      accessToken?: string;
      accessTokenExpiresAt?: number;
    } | null;
    if (!data?.accessToken) {
      throw new SessionRefreshUnavailableError(
        'Malformed refresh response from API',
      );
    }
    applySession(data.accessToken, data.accessTokenExpiresAt);
    return data.accessToken;
  }

  // 401/403/422: the server examined the refresh token and rejected it — the
  // session is over. Anything else (429, 5xx, gateway errors) is transient.
  if (res.status === 401 || res.status === 403 || res.status === 422) {
    expireSession();
    throw new SessionExpiredError();
  }
  throw new SessionRefreshUnavailableError(
    `Refresh failed with status ${res.status}`,
  );
}

/**
 * A token guaranteed usable for at least ~30s (refreshing first if needed).
 * Use for WebSocket connects and anything that can't retry on 401 mid-stream.
 */
export async function getValidAccessToken(): Promise<string> {
  if (
    accessToken &&
    (accessTokenExpiresAtMs === null ||
      accessTokenExpiresAtMs - Date.now() > MIN_USABLE_TOKEN_LIFE_MS)
  ) {
    return accessToken;
  }
  return refreshSession();
}

function scheduleProactiveRefresh(): void {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  if (accessTokenExpiresAtMs === null) return;

  const delay = Math.max(
    accessTokenExpiresAtMs - Date.now() - PROACTIVE_REFRESH_MARGIN_MS,
    5_000,
  );

  proactiveTimer = setTimeout(() => {
    proactiveTimer = null;
    refreshSession().catch((err: unknown) => {
      if (err instanceof SessionExpiredError) return; // handled by expireSession
      // Transient failure — keep trying while the token is still alive.
      if (
        accessTokenExpiresAtMs !== null &&
        accessTokenExpiresAtMs > Date.now()
      ) {
        proactiveTimer = setTimeout(() => {
          proactiveTimer = null;
          scheduleProactiveRefresh();
        }, PROACTIVE_RETRY_DELAY_MS);
      }
    });
  }, delay);
}

/**
 * Browsers throttle timers in background tabs, so a dashboard left open all
 * evening may miss its proactive refresh. When the tab becomes visible again,
 * refresh immediately if the token is stale or nearly so.
 */
function installVisibilityHook(): void {
  if (visibilityHookInstalled) return;
  if (typeof document === 'undefined') return; // non-browser (tests, SSR)
  visibilityHookInstalled = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!hadSession) return;
    const msLeft =
      accessTokenExpiresAtMs === null
        ? Infinity
        : accessTokenExpiresAtMs - Date.now();
    if (msLeft < FOCUS_REFRESH_THRESHOLD_MS) {
      refreshSession().catch(() => {
        /* SessionExpiredError already notified; transient errors retry later */
      });
    }
  });
}

/** Test-only: reset every module-level state. */
export function __resetSessionForTests(): void {
  clearSession();
  refreshInFlight = null;
  visibilityHookInstalled = false;
  config = { baseUrl: '/api' };
}
