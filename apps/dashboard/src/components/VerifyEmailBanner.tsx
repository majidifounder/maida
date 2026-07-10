import { useState, type ReactNode } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';

/**
 * Shown while the signed-in owner's email is unverified. Creating a restaurant
 * is gated on verification (bookings, billing and alerts go to this address),
 * so the banner carries the one-tap recovery. Semantic notice styling — this
 * is a "needs attention" state, per the brand's color rules.
 */
export function VerifyEmailBanner(): ReactNode {
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
      className="border-b border-notice/30 bg-notice-bg px-6 py-2.5 text-center text-sm text-notice-text"
    >
      Confirm your email to create a restaurant — we sent a link to{' '}
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
