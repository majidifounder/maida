import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from '../env.js';
import type { JWTPayload, Role } from '@restaurant/types';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export function signAccessToken(payload: { sub: string; role: Role }): {
  token: string;
  jti: string;
  expiresAt: number;
} {
  const jti = randomUUID();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ACCESS_TOKEN_TTL_SECONDS;

  const token = jwt.sign(
    { sub: payload.sub, role: payload.role, jti, iat, exp },
    env.JWT_PRIVATE_KEY,
    { algorithm: 'RS256', noTimestamp: true },
  );

  return { token, jti, expiresAt: exp };
}

export function signRefreshToken(payload: { sub: string }): {
  token: string;
  jti: string;
  expiresAt: number;
} {
  const jti = randomUUID();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + REFRESH_TOKEN_TTL_SECONDS;

  const token = jwt.sign(
    { sub: payload.sub, jti, iat, exp, type: 'refresh' },
    env.JWT_PRIVATE_KEY,
    { algorithm: 'RS256', noTimestamp: true },
  );

  return { token, jti, expiresAt: exp };
}

const VALID_ROLES: ReadonlySet<Role> = new Set<Role>(['diner', 'owner', 'admin']);

export function verifyAccessToken(token: string): JWTPayload {
  const decoded = jwt.verify(token, env.JWT_PUBLIC_KEY, {
    algorithms: ['RS256'],
  }) as JWTPayload & { type?: string };

  // Access and refresh tokens are signed with the SAME RS256 key, so a refresh
  // token presents a valid signature here. Reject it explicitly (token-type
  // confusion): a refresh token carries `type: 'refresh'` and no `role`, and
  // must never be accepted as a bearer access token on authenticated routes.
  // verifyRefreshToken enforces the symmetric guard for the other direction.
  if (decoded.type === 'refresh' || !VALID_ROLES.has(decoded.role)) {
    throw new Error('Not an access token');
  }

  return decoded;
}

export function verifyRefreshToken(token: string): {
  sub: string;
  jti: string;
  exp: number;
} {
  const decoded = jwt.verify(token, env.JWT_PUBLIC_KEY, {
    algorithms: ['RS256'],
  }) as { sub: string; jti: string; exp: number; type: string };

  if (decoded.type !== 'refresh') {
    throw new Error('Not a refresh token');
  }

  return { sub: decoded.sub, jti: decoded.jti, exp: decoded.exp };
}
