import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { Card } from '../components/ui/Card.js';
import { Spinner } from '../components/ui/Spinner.js';
import { IconCheck, IconAlert } from '../components/ui/icons.js';

type Phase = 'verifying' | 'done' | 'failed';

/** Landing page for the owner verification link (works logged out too). */
export function VerifyEmailPage(): ReactNode {
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
    <div className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <Card className="w-full text-center">
        {phase === 'verifying' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Spinner />
            <p className="text-sm text-slate2">Confirming your email…</p>
          </div>
        )}
        {phase === 'done' && (
          <div className="py-4">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-success-bg text-success-text">
              <IconCheck size={20} />
            </span>
            <h1 className="mt-3 font-serif text-xl text-ink">Email confirmed</h1>
            <p className="mt-2 text-sm text-slate2">
              You&apos;re all set — let&apos;s get your restaurant taking bookings.
            </p>
            <Link
              to="/restaurants"
              className="mt-5 inline-block rounded-btn bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-charcoal"
            >
              Go to my restaurants
            </Link>
          </div>
        )}
        {phase === 'failed' && (
          <div className="py-4">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-notice-bg text-notice-text">
              <IconAlert size={20} />
            </span>
            <h1 className="mt-3 font-serif text-xl text-ink">
              Link expired or already used
            </h1>
            <p className="mt-2 text-sm text-slate2">{message}</p>
            <p className="mt-2 text-sm text-slate2">
              Sign in and use &ldquo;Resend link&rdquo; in the banner for a fresh one.
            </p>
            <Link
              to="/login"
              className="mt-5 inline-block rounded-btn bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-charcoal"
            >
              Sign in
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
