// __Host- prefix enforces: Secure=true, Path=/, no Domain attribute.
// This makes the refresh token cookie completely subdomain-proof.
export const REFRESH_COOKIE_NAME = '__Host-refresh';

export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,       // Required by __Host- prefix (always on, even in dev)
  sameSite: 'strict' as const,
  path: '/',          // Required by __Host- prefix (must be /)
  maxAge: 7 * 24 * 60 * 60,
} as const;
