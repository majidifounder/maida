import type { BillingTier, PlanLimits, PlanComparisonRow } from '@restaurant/types';

export const TRIAL_DAYS = 14;

export const PLAN_LIMITS: Record<'STARTER' | 'PRO' | 'PREMIUM', PlanLimits> = {
  STARTER: {
    restaurants: 1,
    reservationsPerMonth: 200,
    tablesPerRestaurant: 10,
    combinationsPerRestaurant: 0,
    turnTimeRulesPerRestaurant: 1,
    flexibleSeating: false,
    customReservations: false,
  },
  PRO: {
    restaurants: 5,
    reservationsPerMonth: 1_000,
    tablesPerRestaurant: 30,
    combinationsPerRestaurant: 5,
    turnTimeRulesPerRestaurant: 5,
    flexibleSeating: true,
    customReservations: true,
  },
  PREMIUM: {
    restaurants: Infinity,
    reservationsPerMonth: Infinity,
    tablesPerRestaurant: Infinity,
    combinationsPerRestaurant: Infinity,
    turnTimeRulesPerRestaurant: Infinity,
    flexibleSeating: true,
    customReservations: true,
  },
};

/** Trial = full PRO for 14 days (R8). MUST mirror apps/api/src/lib/plan.ts —
 * this file is only the offline fallback; the server's planComparison wins. */
export const TRIAL_LIMITS: PlanLimits = PLAN_LIMITS.PRO;

export const DEFAULT_PLAN_COMPARISON: PlanComparisonRow[] = [
  {
    tier: 'TRIAL',
    label: 'Free trial',
    price: '14 days free — full Pro',
    limits: TRIAL_LIMITS,
  },
  {
    tier: 'STARTER',
    label: 'Starter',
    price: '€29/mo',
    limits: PLAN_LIMITS.STARTER,
  },
  {
    tier: 'PRO',
    label: 'Pro',
    price: '€79/mo',
    limits: PLAN_LIMITS.PRO,
  },
  {
    tier: 'PREMIUM',
    label: 'Premium',
    price: '€199/mo',
    limits: PLAN_LIMITS.PREMIUM,
  },
];

export function planLabel(plan: 'STARTER' | 'PRO' | 'PREMIUM'): string {
  return { STARTER: 'Starter', PRO: 'Pro', PREMIUM: 'Premium' }[plan];
}

export function billingTierLabel(tier: BillingTier): string {
  if (tier === 'TRIAL') return 'Free trial';
  return planLabel(tier);
}

export function formatLimit(value: number): string {
  return value === Infinity ? 'Unlimited' : String(value);
}

export function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}
