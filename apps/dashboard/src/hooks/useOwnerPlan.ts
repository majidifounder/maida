import { useQuery } from '@tanstack/react-query';
import type { BillingTier, Plan, PlanComparisonRow, PlanLimits } from '@restaurant/types';
import { api } from '../lib/api.js';
import { DEFAULT_PLAN_COMPARISON, PLAN_LIMITS, TRIAL_LIMITS } from '../lib/plan-limits.js';

interface SubscriptionPayload {
  plan: Plan;
  billingTier: BillingTier;
  status: string;
  trialDaysRemaining: number | null;
  trialEndsAt: string | null;
  isTrialActive: boolean;
  isTrialExpired: boolean;
  canOperate: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  renewsAt: string | null;
  lemonSqueezyId: string | null;
}

interface SubscriptionResponse {
  subscription: SubscriptionPayload;
  limits: PlanLimits;
  planComparison: PlanComparisonRow[];
}

export function useOwnerPlan() {
  const query = useQuery({
    queryKey: ['subscription'],
    queryFn: () =>
      api.get<SubscriptionResponse>('/subscriptions/me').then((r) => r),
    staleTime: 5 * 60 * 1000,
  });

  const subscription = query.data?.subscription;
  const billingTier: BillingTier = subscription?.billingTier ?? 'TRIAL';
  const plan: Plan = subscription?.plan ?? 'STARTER';
  const limits = query.data?.limits ?? TRIAL_LIMITS;
  const planComparison = query.data?.planComparison ?? DEFAULT_PLAN_COMPARISON;

  return {
    ...query,
    subscription,
    plan,
    billingTier,
    limits,
    planComparison,
    isTrialActive: subscription?.isTrialActive ?? false,
    isTrialExpired: subscription?.isTrialExpired ?? false,
    canOperate: subscription?.canOperate ?? true,
    trialDaysRemaining: subscription?.trialDaysRemaining ?? null,
    trialEndsAt: subscription?.trialEndsAt ?? null,
    paidLimits: PLAN_LIMITS[plan],
  };
}
