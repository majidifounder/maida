import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { Card } from '../components/ui/Card.js';
import { Spinner } from '../components/ui/Spinner.js';

type Phase = 'verifying' | 'done' | 'failed';

/** Landing page for the email verification link (works logged out too). */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [phase, setPhase] = useState<Phase>(token ? 'verifying' : 'failed');
  const [message, setMessage] = useState<string | null>(
    token ? null : 'This link is missing its token — use the button in the email.',
  );
  const fired = useRef(false);

  useEffect(() => {
    if (!token || fired.current) return;
    fired.current = true; // StrictMode double-invoke guard — token is single-use
    api
      .post('/auth/verify-email', { token })
      .then(() => setPhase('done'))
      .catch((err: unknown) => {
        setPhase('failed');
        setMessage(
          err instanceof ApiError
            ? err.message
            : 'Something went wrong. Try the link again in a moment.',
        );
      });
  }, [token]);

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card className="text-center">
        {phase === 'verifying' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Spinner />
            <p className="text-sm text-gray-600">Confirming your email…</p>
          </div>
        )}
        {phase === 'done' && (
          <div className="py-4">
            <h1 className="text-xl font-semibold text-gray-900">
              Email confirmed
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              You&apos;re all set — you can book a table now.
            </p>
            <Link
              to="/restaurants"
              className="mt-5 inline-block rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white"
            >
              Find a table
            </Link>
          </div>
        )}
        {phase === 'failed' && (
          <div className="py-4">
            <h1 className="text-xl font-semibold text-gray-900">
              Link expired or already used
            </h1>
            <p className="mt-2 text-sm text-gray-600">{message}</p>
            <p className="mt-2 text-sm text-gray-600">
              Sign in and use “Resend link” in the banner to get a fresh one.
            </p>
            <Link
              to="/login"
              className="mt-5 inline-block rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white"
            >
              Sign in
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
