import {
  createContext,
  useContext,
  useEffect,
  useState,
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
import type { User } from '@restaurant/types';
import type { LoginResponse } from '../types/api.js';

interface AuthState {
  user: User | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    role: 'diner' | 'owner',
    cfTurnstileResponse?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

let bootstrapRefresh: Promise<User | null> | null = null;

function toUser(raw: LoginResponse['user']): User {
  const createdAt =
    raw.createdAt == null
      ? new Date().toISOString()
      : typeof raw.createdAt === 'string'
        ? raw.createdAt
        : new Date(raw.createdAt).toISOString();

  return {
    id: raw.id,
    email: raw.email,
    role: raw.role.toLowerCase() as User['role'],
    createdAt,
  };
}

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  const clearSession = useCallback(() => {
    clearClientSession();
    setState({ user: null, loading: false });
  }, []);

  // The shared client refreshes the token proactively and after 401s; if the
  // refresh token itself is ever rejected, the session is over — reflect that
  // in the UI immediately instead of letting requests fail one by one.
  useEffect(() => {
    configureApiClient({
      onSessionExpired: () => setState({ user: null, loading: false }),
    });
    return () => configureApiClient({ onSessionExpired: undefined });
  }, []);

  useEffect(() => {
    bootstrapRefresh ??= (async (): Promise<User | null> => {
      try {
        await refreshSession();
        return await api.get<User>('/auth/me');
      } catch {
        return null;
      }
    })();

    void bootstrapRefresh.then((user) => {
      if (user) {
        setState({ user, loading: false });
      } else {
        clearSession();
      }
    });
  }, [clearSession]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<LoginResponse>('/auth/login', {
      email,
      password,
    });
    applySession(result.accessToken, result.accessTokenExpiresAt);
    setState({ user: toUser(result.user), loading: false });
    // The login payload doesn't carry emailVerified — refresh the profile in
    // the background so the verify banner is accurate immediately.
    void api
      .get<User>('/auth/me')
      .then((me) => setState({ user: me, loading: false }))
      .catch(() => {});
  }, []);

  const register = useCallback(
    async (
      email: string,
      password: string,
      role: 'diner' | 'owner',
      cfTurnstileResponse?: string,
    ) => {
      await api.post('/auth/register', {
        email,
        password,
        role,
        ...(cfTurnstileResponse ? { cfTurnstileResponse } : {}),
      });
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // clear local session even if the API call fails
    }
    bootstrapRefresh = null;
    clearSession();
  }, [clearSession]);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
