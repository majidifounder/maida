import {

  createContext,

  useContext,

  useEffect,

  useState,

  useCallback,

  useRef,

  type ReactNode,

} from 'react';

import { api } from '../lib/api.js';

import { setAccessToken } from '../lib/access-token.js';

import type { User } from '@restaurant/types';

import type { LoginResponse, RefreshResponse } from '../types/api.js';



interface AuthState {

  user: User | null;

  token: string | null;

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



let bootstrapRefresh: Promise<void> | null = null;



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



export function AuthProvider({ children }: { children: ReactNode }) {

  const tokenRef = useRef<string | null>(null);

  const [state, setState] = useState<AuthState>({

    user: null,

    token: null,

    loading: true,

  });



  const applySession = useCallback((accessToken: string, user: User) => {

    tokenRef.current = accessToken;

    setAccessToken(accessToken);

    setState({ user, token: accessToken, loading: false });

  }, []);



  const clearSession = useCallback(() => {

    tokenRef.current = null;

    setAccessToken(null);

    setState({ user: null, token: null, loading: false });

  }, []);



  useEffect(() => {

    bootstrapRefresh ??= (async () => {

      try {

        const { accessToken } = await api.post<RefreshResponse>('/auth/refresh', {});

        tokenRef.current = accessToken;

        setAccessToken(accessToken);

        const me = await api.get<User>('/auth/me');

        setState({ user: me, token: accessToken, loading: false });

      } catch {

        clearSession();

      }

    })();



    void bootstrapRefresh;

  }, [clearSession]);



  const login = useCallback(

    async (email: string, password: string) => {

      const result = await api.post<LoginResponse>('/auth/login', {

        email,

        password,

      });

      applySession(result.accessToken, toUser(result.user));

    },

    [applySession],

  );



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

      // clear local session even if API call fails

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


