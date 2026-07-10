import { Link } from 'react-router-dom';
import { useOwnerPlan } from '../hooks/useOwnerPlan.js';
import { billingTierLabel } from '../lib/plan-limits.js';

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function TrialBanner() {
  const {
    isTrialActive,
    isTrialExpired,
    trialDaysRemaining,
    trialEndsAt,
    billingTier,
  } = useOwnerPlan();

  if (isTrialExpired) {
    return (
      <div className="border-b border-red-200 bg-red-50 px-6 py-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-red-900">Your free trial has ended</p>
            <p className="text-sm text-red-800">
              Your restaurants and data are safe, but new reservations and configuration
              changes are paused until you subscribe.
            </p>
          </div>
          <Link
            to="/billing"
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
          >
            Subscribe to continue →
          </Link>
        </div>
      </div>
    );
  }

  if (!isTrialActive || billingTier !== 'TRIAL') {
    return null;
  }

  const days = trialDaysRemaining ?? 0;
  const dayLabel = days === 1 ? '1 day' : `${days} days`;

  return (
    <div className="border-b border-notice/30 bg-notice-bg px-6 py-4">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-notice-text">
            {billingTierLabel('TRIAL')} — {dayLabel} remaining
          </p>
          <p className="text-sm text-notice-text">
            Trial ends {fmt(trialEndsAt)}. After that, subscribe to keep accepting
            reservations and editing your setup. Trial limits are lower than Starter.
          </p>
        </div>
        <Link
          to="/billing"
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          View plans →
        </Link>
      </div>
    </div>
  );
}
