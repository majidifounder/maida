import type { Plan } from '@restaurant/types';

export const PLAN_LIMITS: Record<
  Plan,
  { restaurants: number; bookingsPerMonth: number }
> = {
  STARTER: { restaurants: 1, bookingsPerMonth: 200 },
  PRO: { restaurants: 5, bookingsPerMonth: 1_000 },
  PREMIUM: { restaurants: Infinity, bookingsPerMonth: Infinity },
};

export function getPlanLimits(plan: Plan) {
  return PLAN_LIMITS[plan];
}

export function planDisplayName(plan: Plan): string {
  return { STARTER: 'Starter', PRO: 'Pro', PREMIUM: 'Premium' }[plan];
}

export function startOfCurrentMonth(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
