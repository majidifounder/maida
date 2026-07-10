import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { Plan } from '@restaurant/types';
import { api } from '../lib/api.js';
import { Spinner } from '../components/ui/Spinner.js';
import { Button } from '../components/ui/Button.js';
import { useOwnerPlan } from '../hooks/useOwnerPlan.js';
import { billingTierLabel, planLabel } from '../lib/plan-limits.js';
import { PlanComparisonTable } from '../components/PlanComparisonTable.js';

type Status = 'active' | 'cancelled' | 'past_due' | 'paused' | 'on_trial' | 'trial_expired';

const PAID_PLANS: Plan[] = ['STARTER', 'PRO', 'PREMIUM'];

const PLAN_PRICES: Record<Plan, string> = {
  STARTER: '€29/mo',
  PRO: '€79/mo',
  PREMIUM: '€199/mo',
};

const STATUS_BADGE: Record<Status, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-green-100 text-green-800' },
  cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-800' },
  past_due: {
    label: 'Past due',
    className: 'bg-yellow-100 text-yellow-800',
  },
  paused: { label: 'Paused', className: 'bg-gray-100 text-gray-600' },
  on_trial: { label: 'Free trial', className: 'bg-notice-bg text-notice-text' },
  trial_expired: {
    label: 'Trial ended',
    className: 'bg-red-100 text-red-800',
  },
};

function normalizeStatus(raw: string, isTrialExpired: boolean): Status {
  if (isTrialExpired) return 'trial_expired';
  const map: Record<string, Status> = {
    ACTIVE: 'active',
    CANCELLED: 'cancelled',
    PAST_DUE: 'past_due',
    PAUSED: 'paused',
    TRIALING: 'on_trial',
    EXPIRED: 'cancelled',
  };
  return map[raw] ?? map[raw.toUpperCase()] ?? 'active';
}

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function BillingPage() {
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const {
    subscription: sub,
    billingTier,
    planComparison,
    isTrialActive,
    isTrialExpired,
    trialDaysRemaining,
    trialEndsAt,
    isLoading,
  } = useOwnerPlan();

  const checkoutMutation = useMutation({
    mutationFn: (plan: Plan) =>
      api
        .post<{ checkoutUrl: string }>('/subscriptions/checkout', { plan })
        .then((r) => {
          window.location.href = r.checkoutUrl;
        }),
    onError: () => toast.error('Could not start checkout. Please try again.'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.post('/subscriptions/cancel', {}),
    onSuccess: () => {
      toast.success(
        'Subscription will cancel at the end of the current period.',
      );
      void queryClient.invalidateQueries({ queryKey: ['subscription'] });
      setConfirmCancel(false);
    },
    onError: () =>
      toast.error('Could not cancel subscription. Please try again.'),
  });

  const resumeMutation = useMutation({
    mutationFn: () => api.post('/subscriptions/resume', {}),
    onSuccess: () => {
      toast.success('Subscription reactivated!');
      void queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
    onError: () =>
      toast.error('Could not resume subscription. Please try again.'),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const currentPlan = sub?.plan ?? 'STARTER';
  const status = normalizeStatus(sub?.status ?? 'ACTIVE', isTrialExpired);
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.active;
  const isCancelling = sub?.cancelAtPeriodEnd ?? false;
  const onPaidPlan = billingTier !== 'TRIAL';

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Billing</h1>
        <p className="mt-1 text-gray-600">
          Manage your subscription, trial, and plan limits
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="mb-1 text-sm text-gray-500">Current tier</p>
            <h2 className="text-2xl font-bold text-gray-900">
              {billingTierLabel(billingTier)}
            </h2>
            {onPaidPlan && (
              <p className="mt-1 text-sm text-gray-500">
                Paid plan: {planLabel(currentPlan)}
              </p>
            )}
          </div>
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium ${badge.className}`}
          >
            {badge.label}
          </span>
        </div>

        {isTrialActive && trialDaysRemaining != null && (
          <div className="mt-4 rounded-lg border border-mist bg-fog p-4 text-sm text-charcoal">
            <p className="font-medium text-ink">
              {trialDaysRemaining} day{trialDaysRemaining === 1 ? '' : 's'} left
              in your free trial
            </p>
            <p className="mt-1">
              Trial ends {fmt(trialEndsAt)}. Subscribe before then to keep operating
              without interruption. Trial limits are stricter than Starter — see the
              comparison below.
            </p>
          </div>
        )}

        {isTrialExpired && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium text-red-900">Your trial has ended</p>
            <p className="mt-1">
              Your restaurants, tables, and past reservations are unchanged. Choose a
              paid plan below to accept new bookings and edit configuration again.
            </p>
          </div>
        )}

        {isCancelling && sub?.currentPeriodEnd && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <span className="text-lg text-amber-500">⚠️</span>
            <div>
              <p className="text-sm font-medium text-amber-800">
                Subscription ends {fmt(sub.currentPeriodEnd)}
              </p>
              <p className="mt-1 text-sm text-amber-700">
                You have access until then. Resume anytime to continue.
              </p>
              <button
                type="button"
                onClick={() => resumeMutation.mutate()}
                disabled={resumeMutation.isPending}
                className="mt-2 text-sm font-medium text-amber-800 underline hover:no-underline disabled:opacity-50"
              >
                {resumeMutation.isPending
                  ? 'Resuming…'
                  : 'Resume subscription →'}
              </button>
            </div>
          </div>
        )}

        {status === 'past_due' && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Your payment failed. Please update your payment method to keep
            access.
          </div>
        )}

        {!isCancelling && sub?.renewsAt && onPaidPlan && (
          <p className="mt-4 text-sm text-gray-500">
            Renews on <strong>{fmt(sub.renewsAt)}</strong>
          </p>
        )}
      </div>

      <div>
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          Plan comparison
        </h3>
        <PlanComparisonTable rows={planComparison} highlightTier={billingTier} />
      </div>

      <div>
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          {isCancelling || status === 'cancelled' || isTrialExpired || isTrialActive
            ? 'Subscribe'
            : 'Change plan'}
        </h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {PAID_PLANS.map((planKey) => {
            const isCurrent =
              planKey === currentPlan && onPaidPlan && !isCancelling;
            const highlight = planKey === 'PRO';
            return (
              <div
                key={planKey}
                className={`relative flex flex-col gap-4 rounded-xl border p-5 ${
                  highlight
                    ? 'border-brand shadow-md shadow-brand/10'
                    : 'border-gray-200'
                } ${isCurrent ? 'bg-gray-50' : 'bg-white'}`}
              >
                {highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white">
                    Most popular
                  </span>
                )}

                <div>
                  <p className="text-lg font-bold text-gray-900">
                    {planLabel(planKey)}
                  </p>
                  <p className="mt-1 text-2xl font-extrabold text-brand">
                    {PLAN_PRICES[planKey]}
                  </p>
                </div>

                {isCurrent ? (
                  <span className="w-full rounded-lg bg-gray-100 py-2 text-center text-sm font-medium text-gray-500">
                    Current plan
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant={highlight ? 'primary' : 'secondary'}
                    className="w-full"
                    loading={checkoutMutation.isPending}
                    onClick={() => checkoutMutation.mutate(planKey)}
                  >
                    {checkoutMutation.isPending
                      ? 'Redirecting…'
                      : isTrialActive || isTrialExpired
                        ? `Subscribe to ${planLabel(planKey)}`
                        : planKey === 'STARTER'
                          ? 'Downgrade'
                          : `Upgrade to ${planLabel(planKey)}`}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-center text-xs text-gray-400">
          All prices exclude VAT. Charged via Lemon Squeezy. Upgrades take effect
          immediately; downgrades at the next renewal.
        </p>
      </div>

      {!isCancelling &&
        status === 'active' &&
        sub?.lemonSqueezyId && (
          <div className="rounded-xl border border-red-200 p-5">
            <h3 className="mb-1 text-base font-semibold text-gray-900">
              Cancel subscription
            </h3>
            <p className="mb-4 text-sm text-gray-500">
              You will keep access until the end of the current billing period.
              You can resume anytime before then.
            </p>

            {!confirmCancel ? (
              <button
                type="button"
                onClick={() => setConfirmCancel(true)}
                className="text-sm font-medium text-red-600 underline hover:text-red-700"
              >
                Cancel subscription
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="danger"
                  loading={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate()}
                >
                  Yes, cancel
                </Button>
                <button
                  type="button"
                  onClick={() => setConfirmCancel(false)}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Keep subscription
                </button>
              </div>
            )}
          </div>
        )}
    </div>
  );
}
