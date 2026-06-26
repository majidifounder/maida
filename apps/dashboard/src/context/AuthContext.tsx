import {

  createContext,

  useContext,

  useState,

  useEffect,

  useCallback,

  useRef,

  type ReactNode,

} from 'react';

import { api } from '../lib/api.js';

import { setAccessToken } from '../lib/access-token.js';



interface AuthUser {

  id: string;

  email: string;

  role: string;

}



interface AuthCtx {

  user: AuthUser | null;

  token: string | null;

  login: (email: string, password: string) => Promise<void>;

  register: (email: string, password: string) => Promise<void>;

  logout: () => Promise<void>;

  loading: boolean;

}



const Ctx = createContext<AuthCtx | null>(null);



let bootstrapRefresh: Promise<void> | null = null;



function normalizeRole(role: string): string {

  return role.toLowerCase();

}



export function AuthProvider({ children }: { children: ReactNode }) {

  const tokenRef = useRef<string | null>(null);

  const [user, setUser] = useState<AuthUser | null>(null);

  const [token, setToken] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);



  const clearSession = useCallback(() => {

    tokenRef.current = null;

    setAccessToken(null);

    setToken(null);

    setUser(null);

  }, []);



  useEffect(() => {

    bootstrapRefresh ??= (async () => {

      try {

        const r = await api.post<{ accessToken: string }>('/auth/refresh', {});

        tokenRef.current = r.accessToken;

        setAccessToken(r.accessToken);

        setToken(r.accessToken);

        const me = await api.get<AuthUser>('/auth/me');

        if (normalizeRole(me.role) !== 'owner') {

          clearSession();

          return;

        }

        setUser({ ...me, role: normalizeRole(me.role) });

      } catch {

        clearSession();

      } finally {

        setLoading(false);

      }

    })();



    void bootstrapRefresh;

  }, [clearSession]);



  const login = useCallback(async (email: string, password: string) => {

    const r = await api.post<{ accessToken: string; user: AuthUser }>(

      '/auth/login',

      { email, password },

    );

    if (normalizeRole(r.user.role) !== 'owner') {

      throw new Error('Only owners may use this dashboard');

    }

    tokenRef.current = r.accessToken;

    setAccessToken(r.accessToken);

    setToken(r.accessToken);

    setUser({ ...r.user, role: normalizeRole(r.user.role) });

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

    <Ctx.Provider value={{ user, token, login, register, logout, loading }}>

      {children}

    </Ctx.Provider>

  );

}



export function useAuth(): AuthCtx {

  const ctx = useContext(Ctx);

  if (!ctx) throw new Error('useAuth must be used within AuthProvider');

  return ctx;

}


