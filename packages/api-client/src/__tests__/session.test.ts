import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetSessionForTests,
  applySession,
  clearSession,
  configureApiClient,
  getAccessToken,
  getValidAccessToken,
  refreshSession,
  SessionExpiredError,
  SessionRefreshUnavailableError,
} from '../session.js';
import { api, ApiError } from '../client.js';

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  __resetSessionForTests();
  configureApiClient({ baseUrl: '/api' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('refreshSession', () => {
  it('stores the new token on success', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        accessToken: 'tok-1',
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 900,
      }),
    );

    const token = await refreshSession();
    expect(token).toBe('tok-1');
    expect(getAccessToken()).toBe('tok-1');
  });

  it('is single-flight: concurrent callers share one request', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { accessToken: 'tok-2', accessTokenExpiresAt: 0 }),
    );

    const [a, b, c] = await Promise.all([
      refreshSession(),
      refreshSession(),
      refreshSession(),
    ]);
    expect(a).toBe('tok-2');
    expect(b).toBe('tok-2');
    expect(c).toBe('tok-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('declares the session dead on 401 and notifies once', async () => {
    const onSessionExpired = vi.fn();
    configureApiClient({ onSessionExpired });
    applySession('old-token', Math.floor(Date.now() / 1000) + 900);

    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'nope' }));

    await expect(refreshSession()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(getAccessToken()).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('does NOT kill the session on 5xx or network failure', async () => {
    const onSessionExpired = vi.fn();
    configureApiClient({ onSessionExpired });
    applySession('alive-token', Math.floor(Date.now() / 1000) + 900);

    fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: 'redis down' }));
    await expect(refreshSession()).rejects.toBeInstanceOf(
      SessionRefreshUnavailableError,
    );

    fetchMock.mockRejectedValueOnce(new TypeError('network'));
    await expect(refreshSession()).rejects.toBeInstanceOf(
      SessionRefreshUnavailableError,
    );

    expect(getAccessToken()).toBe('alive-token');
    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});

describe('proactive refresh', () => {
  it('refreshes ~60s before expiry', async () => {
    applySession('short-token', Math.floor(Date.now() / 1000) + 900);

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        accessToken: 'renewed',
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 1800,
      }),
    );

    // 15 min token − 60s margin ⇒ fires at ~14 min.
    await vi.advanceTimersByTimeAsync(14 * 60_000 + 1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe('renewed');
  });

  it('stops after clearSession (logout)', async () => {
    applySession('bye-token', Math.floor(Date.now() / 1000) + 900);
    clearSession();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getValidAccessToken', () => {
  it('returns the current token when it has life left', async () => {
    applySession('fresh', Math.floor(Date.now() / 1000) + 900);
    await expect(getValidAccessToken()).resolves.toBe('fresh');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes first when the token is nearly dead', async () => {
    applySession('stale', Math.floor(Date.now() / 1000) + 10);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        accessToken: 'minted',
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 900,
      }),
    );
    await expect(getValidAccessToken()).resolves.toBe('minted');
  });
});

describe('api request retry', () => {
  it('on 401 with a token: refreshes once and replays the request', async () => {
    applySession('expired-token', Math.floor(Date.now() / 1000) + 900);

    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Invalid or expired token' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: 'new-token',
          accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 900,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await expect(api.get<{ ok: boolean }>('/restaurants')).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The replay carried the NEW token.
    const replayHeaders = (fetchMock.mock.calls[2]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(replayHeaders['Authorization']).toBe('Bearer new-token');
  });

  it('surfaces the original 401 when the refresh also fails', async () => {
    applySession('doomed-token', Math.floor(Date.now() / 1000) + 900);

    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Invalid or expired token' }))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'refresh dead' }));

    await expect(api.get('/restaurants')).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never refresh-retries login 401s', async () => {
    applySession('token', Math.floor(Date.now() / 1000) + 900);
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'Bad credentials' }));

    await expect(
      api.post('/auth/login', { email: 'a@b.c', password: 'x' }),
    ).rejects.toMatchObject({ status: 401, message: 'Bad credentials' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 401 when no token was attached', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'auth required' }));
    await expect(api.get('/reservations')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('ApiError shaping', () => {
  it('prefers zod field errors and keeps structured extras', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, {
        error: 'Validation failed',
        details: { fieldErrors: { partySize: ['Must be at least 1'] } },
      }),
    );

    const err = await api.post('/reservations', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Must be at least 1');
    expect((err as ApiError).status).toBe(422);
  });

  it('exposes conflict extras like suggestedNextAvailableAt', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: 'No table available for the requested time',
        suggestedNextAvailableAt: '2026-07-11T18:00:00.000Z',
      }),
    );

    const err = (await api.post('/reservations', {}).catch((e: unknown) => e)) as ApiError;
    expect(err.details).toMatchObject({
      suggestedNextAvailableAt: '2026-07-11T18:00:00.000Z',
    });
  });
});
