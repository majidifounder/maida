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

export function verifyAccessToken(token: string): JWTPayload {
  const decoded = jwt.verify(token, env.JWT_PUBLIC_KEY, {
    algorithms: ['RS256'],
  }) as JWTPayload;
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
