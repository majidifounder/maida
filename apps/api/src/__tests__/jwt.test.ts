import { describe, it, expect } from 'vitest';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../lib/jwt.js';

// Pure-unit suite (no DB/Redis): exercises the JWT trust boundary directly.
// Access and refresh tokens are signed with the SAME RS256 key, so a token of
// the wrong type presents a valid signature — the verify functions must reject
// cross-type use to prevent token-type confusion.
describe('JWT token-type isolation', () => {
  it('verifies a genuine access token and preserves its role', () => {
    const { token } = signAccessToken({ sub: 'user-1', role: 'owner' });
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.role).toBe('owner');
  });

  it('rejects a refresh token presented as a bearer access token', () => {
    const { token } = signRefreshToken({ sub: 'user-1' });
    // A refresh token carries `type: 'refresh'` and no `role`; it must never be
    // accepted on authenticated routes that only run the `authenticate` hook.
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it('still accepts a genuine refresh token via verifyRefreshToken', () => {
    const { token } = signRefreshToken({ sub: 'user-1' });
    const decoded = verifyRefreshToken(token);
    expect(decoded.sub).toBe('user-1');
  });

  it('rejects an access token presented as a refresh token', () => {
    const { token } = signAccessToken({ sub: 'user-1', role: 'diner' });
    expect(() => verifyRefreshToken(token)).toThrow();
  });
});
