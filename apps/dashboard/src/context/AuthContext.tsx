import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import {
  applySession,
  clearSession as clearClientSession,
  configureApiClient,
  refreshSession,
} from '@restaurant/api-client';
import { api } from '../lib/api.js';

interface AuthUser {
  id: string;
  email: string;
  role: string;
  /** False until the verification link is clicked; gates restaurant creation. */
  emailVerified?: boolean;
}

interface AuthCtx {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

let bootstrapRefresh: Promise<AuthUser | null> | null = null;

function normalizeRole(role: string): string {
  return role.toLowerCase();
}

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const clearSession = useCallback(() => {
    clearClientSession();
    setUser(null);
  }, []);

  // Session death (refresh token rejected) → drop to the login screen. The
  // shared client keeps the access token fresh while the session is alive, so
  // an open dashboard no longer dies silently after 15 minutes.
  useEffect(() => {
    configureApiClient({ onSessionExpired: () => setUser(null) });
    return () => configureApiClient({ onSessionExpired: undefined });
  }, []);

  useEffect(() => {
    bootstrapRefresh ??= (async (): Promise<AuthUser | null> => {
      try {
        await refreshSession();
        const me = await api.get<AuthUser>('/auth/me');
        if (normalizeRole(me.role) !== 'owner') return null;
        return { ...me, role: normalizeRole(me.role) };
      } catch {
        return null;
      }
    })();

    void bootstrapRefresh.then((me) => {
      if (me) {
        setUser(me);
      } else {
        clearSession();
      }
      setLoading(false);
    });
  }, [clearSession]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{
      accessToken: string;
      accessTokenExpiresAt: number;
      user: AuthUser;
    }>('/auth/login', { email, password });
    if (normalizeRole(r.user.role) !== 'owner') {
      throw new Error('Only owners may use this dashboard');
    }
    applySession(r.accessToken, r.accessTokenExpiresAt);
    setUser({ ...r.user, role: normalizeRole(r.user.role) });
    // Login payload lacks emailVerified — refresh the profile in the
    // background so the verify banner is accurate immediately.
    void api
      .get<AuthUser>('/auth/me')
      .then((me) => setUser({ ...me, role: normalizeRole(me.role) }))
      .catch(() => {});
  }, []);

  const register = useCallback(
    async (email: string, password: string) => {
      await api.post('/auth/register', { email, password, role: 'owner' });
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      /* ignore */
    }
    bootstrapRefresh = null;
    clearSession();
  }, [clearSession]);

  return (
    <Ctx.Provider value={{ user, login, register, logout, loading }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
