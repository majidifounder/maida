import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';

/**
 * Shown while the signed-in diner's email is unverified. Booking is gated on
 * verification, so this banner is the recovery path — one tap to resend.
 */
export function VerifyEmailBanner() {
  const { user } = useAuth();
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');

  if (!user || user.emailVerified !== false) return null;

  const resend = async (): Promise<void> => {
    setState('sending');
    try {
      await api.post('/auth/resend-verification', {});
      setState('sent');
    } catch {
      setState('idle');
    }
  };

  return (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-sm text-amber-900"
    >
      Confirm your email to book a table — we sent a link to{' '}
      <strong>{user.email}</strong>.{' '}
      {state === 'sent' ? (
        <span className="font-medium">New link sent — check your inbox.</span>
      ) : (
        <button
          type="button"
          onClick={() => void resend()}
          disabled={state === 'sending'}
          className="font-medium underline underline-offset-2 disabled:opacity-60"
        >
          {state === 'sending' ? 'Sending…' : 'Resend link'}
        </button>
      )}
    </div>
  );
}
