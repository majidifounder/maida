import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.js';
import { Input } from '../components/ui/Input.js';
import { Button } from '../components/ui/Button.js';
import { ApiError } from '../lib/api.js';

const credSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Required'),
});
const totpSchema = z.object({
  code: z
    .string()
    .length(6, 'Must be 6 digits')
    .regex(/^\d+$/, 'Digits only'),
});

type CredFields = z.infer<typeof credSchema>;
type TotpFields = z.infer<typeof totpSchema>;

export function LoginPage() {
  const {
    user,
    loginStep,
    submitCredentials,
    submitTotpCode,
    confirmTotpSetup,
    resetLoginStep,
  } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const credForm = useForm<CredFields>({ resolver: zodResolver(credSchema) });
  const totpForm = useForm<TotpFields>({ resolver: zodResolver(totpSchema) });

  useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);

  const handleCredentials = credForm.handleSubmit(async ({ email, password }) => {
    setBusy(true);
    try {
      const done = await submitCredentials(email, password);
      if (done) navigate('/', { replace: true });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Login failed',
      );
    } finally {
      setBusy(false);
    }
  });

  const handleTotpVerify = totpForm.handleSubmit(async ({ code }) => {
    setBusy(true);
    try {
      await submitTotpCode(code);
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Invalid code');
      totpForm.reset();
    } finally {
      setBusy(false);
    }
  });

  const handleTotpSetup = totpForm.handleSubmit(async ({ code }) => {
    setBusy(true);
    try {
      await confirmTotpSetup(code);
      toast.success('Authenticator app connected!');
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Invalid code — try again',
      );
      totpForm.reset();
    } finally {
      setBusy(false);
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Restaurant Platform
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white">Admin Access</h1>
        </div>

        <div className="rounded-2xl bg-slate-800 p-8 shadow-xl">
          {loginStep.phase === 'credentials' && (
            <form
              onSubmit={(e) => void handleCredentials(e)}
              className="flex flex-col gap-5"
            >
              <Input
                label="Email"
                type="email"
                autoComplete="username"
                placeholder="admin@example.com"
                className="border-slate-600 bg-slate-700 text-white placeholder-slate-400 focus:border-blue-500"
                {...credForm.register('email')}
                error={credForm.formState.errors.email?.message}
              />
              <Input
                label="Password"
                type="password"
                autoComplete="current-password"
                className="border-slate-600 bg-slate-700 text-white focus:border-blue-500"
                {...credForm.register('password')}
                error={credForm.formState.errors.password?.message}
              />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Checking…' : 'Continue →'}
              </Button>
            </form>
          )}

          {loginStep.phase === 'totp-verify' && (
            <form
              onSubmit={(e) => void handleTotpVerify(e)}
              className="flex flex-col gap-5"
            >
              <div className="text-center">
                <p className="text-sm font-medium text-slate-300">
                  Enter your authenticator code
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Open Google Authenticator, Authy, or 1Password
                </p>
              </div>
              <Input
                label="6-digit code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className="border-slate-600 bg-slate-700 text-center text-2xl tracking-[0.5em] text-white placeholder-slate-500 focus:border-blue-500"
                {...totpForm.register('code')}
                error={totpForm.formState.errors.code?.message}
              />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Verifying…' : 'Sign in'}
              </Button>
              <button
                type="button"
                className="text-xs text-slate-500 hover:text-slate-400"
                onClick={resetLoginStep}
              >
                ← Back to login
              </button>
            </form>
          )}

          {loginStep.phase === 'totp-setup' && (
            <form
              onSubmit={(e) => void handleTotpSetup(e)}
              className="flex flex-col gap-5"
            >
              <div className="text-center">
                <p className="text-sm font-semibold text-white">
                  Set up 2-factor authentication
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Scan this QR code with your authenticator app
                </p>
              </div>

              <div className="flex justify-center rounded-xl bg-white p-4">
                <img
                  src={loginStep.qrCodeDataUrl}
                  alt="TOTP QR code"
                  className="h-48 w-48"
                />
              </div>

              <p className="text-center text-xs text-slate-400">
                Then enter the 6-digit code to confirm:
              </p>
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className="border-slate-600 bg-slate-700 text-center text-2xl tracking-[0.5em] text-white placeholder-slate-500 focus:border-blue-500"
                {...totpForm.register('code')}
                error={totpForm.formState.errors.code?.message}
              />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Activating…' : 'Activate 2FA & Sign in'}
              </Button>
              <button
                type="button"
                className="text-xs text-slate-500 hover:text-slate-400"
                onClick={resetLoginStep}
              >
                ← Back to login
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          Admin accounts are created directly in the database.
        </p>
      </div>
    </div>
  );
}
