import { useQuery } from '@tanstack/react-query';
import type { Plan } from '@restaurant/types';
import { api } from '../lib/api.js';
import { PLAN_LIMITS } from '../lib/plan-limits.js';

interface SubscriptionResponse {
  subscription: { plan: Plan };
}

export function useOwnerPlan() {
  const query = useQuery({
    queryKey: ['subscription'],
    queryFn: () =>
      api
        .get<SubscriptionResponse>('/subscriptions/me')
        .then((r) => r.subscription),
    staleTime: 5 * 60 * 1000,
  });

  const plan: Plan = query.data?.plan ?? 'STARTER';
  const limits = PLAN_LIMITS[plan];

  return { ...query, plan, limits };
}
