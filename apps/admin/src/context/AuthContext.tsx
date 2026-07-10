import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  applySession,
  clearSession as clearClientSession,
  configureApiClient,
  refreshSession,
} from '@restaurant/api-client';
import { api } from '../lib/api.js';
import type {
  AdminUser,
  LoginResponse,
  LoginSuccessResponse,
} from '../types/api.js';
import {
  isLoginSuccess,
  isTotpSetup,
  isTotpVerify,
} from '../types/api.js';

export type LoginStep =
  | { phase: 'credentials' }
  | { phase: 'totp-setup'; pendingToken: string; qrCodeDataUrl: string }
  | { phase: 'totp-verify'; email: string; password: string };

interface AuthState {
  user: AdminUser | null;
  isLoading: boolean;
  loginStep: LoginStep;
  submitCredentials: (email: string, password: string) => Promise<boolean>;
  submitTotpCode: (code: string) => Promise<void>;
  confirmTotpSetup: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  resetLoginStep: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

let bootstrapRefresh: Promise<void> | null = null;

function normalizeRole(role: string): string {
  return role.toLowerCase();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loginStep, setLoginStep] = useState<LoginStep>({
    phase: 'credentials',
  });
  const credentialsRef = useRef<{ email: string; password: string } | null>(
    null,
  );

  const clearSession = useCallback(() => {
    clearClientSession();
    setUser(null);
  }, []);

  const completeLogin = useCallback((res: LoginSuccessResponse) => {
    applySession(res.accessToken, res.accessTokenExpiresAt);
    setUser({ ...res.user, role: normalizeRole(res.user.role) });
    setLoginStep({ phase: 'credentials' });
    credentialsRef.current = null;
  }, []);

  // Session death (refresh token rejected) → back to the login screen.
  useEffect(() => {
    configureApiClient({ onSessionExpired: () => setUser(null) });
    return () => configureApiClient({ onSessionExpired: undefined });
  }, []);

  useEffect(() => {
    bootstrapRefresh ??= (async () => {
      try {
        await refreshSession();
        const me = await api.get<{ id: string; email: string; role: string }>(
          '/auth/me',
        );
        if (normalizeRole(me.role) !== 'admin') {
          clearSession();
          return;
        }
        setUser({ ...me, role: normalizeRole(me.role) });
      } catch {
        clearSession();
      } finally {
        setIsLoading(false);
      }
    })();

    void bootstrapRefresh;
  }, [clearSession]);

  const submitCredentials = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      const res = await api.post<LoginResponse>('/admin/auth/login', {
        email,
        password,
      });

      if (isLoginSuccess(res)) {
        completeLogin(res);
        return true;
      }

      credentialsRef.current = { email, password };

      if (isTotpSetup(res)) {
        setLoginStep({
          phase: 'totp-setup',
          pendingToken: res.pendingToken,
          qrCodeDataUrl: res.qrCodeDataUrl,
        });
        return false;
      }

      if (isTotpVerify(res)) {
        setLoginStep({ phase: 'totp-verify', email, password });
        return false;
      }

      return false;
    },
    [completeLogin],
  );

  const submitTotpCode = useCallback(
    async (code: string) => {
      const creds =
        loginStep.phase === 'totp-verify'
          ? { email: loginStep.email, password: loginStep.password }
          : credentialsRef.current;

      if (!creds) throw new Error('Session expired — sign in again');

      const res = await api.post<LoginSuccessResponse>('/admin/auth/login', {
        email: creds.email,
        password: creds.password,
        totpToken: code,
      });
      completeLogin(res);
    },
    [loginStep, completeLogin],
  );

  const confirmTotpSetup = useCallback(
    async (code: string) => {
      if (loginStep.phase !== 'totp-setup') return;
      const creds = credentialsRef.current;
      if (!creds) throw new Error('Session expired — sign in again');

      const res = await api.post<LoginSuccessResponse>(
        '/admin/auth/totp/setup',
        {
          email: creds.email,
          password: creds.password,
          pendingToken: loginStep.pendingToken,
          totpToken: code,
        },
      );
      completeLogin(res);
    },
    [loginStep, completeLogin],
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

  const resetLoginStep = useCallback(() => {
    setLoginStep({ phase: 'credentials' });
    credentialsRef.current = null;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        loginStep,
        submitCredentials,
        submitTotpCode,
        confirmTotpSetup,
        logout,
        resetLoginStep,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
