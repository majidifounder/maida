import type { BillingTier, Plan, PlanLimits } from '@restaurant/types';

export const TRIAL_DAYS = 14;

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
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

/**
 * The trial is the full PRO experience for 14 days. A trial that hides the
 * features we want evaluated (flexible seating, custom reservations) or caps
 * volume below one busy weekend teaches prospects the product fails at
 * exactly the moment they're deciding — the old 25-reservation trial did
 * precisely that. Restriction is the wrong conversion lever; the deadline is.
 */
export const TRIAL_LIMITS: PlanLimits = PLAN_LIMITS.PRO;

export const PLAN_COMPARISON: Array<{
  tier: BillingTier;
  label: string;
  price: string | null;
  limits: PlanLimits;
}> = [
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

export function getPlanLimits(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export function planDisplayName(plan: Plan): string {
  return { STARTER: 'Starter', PRO: 'Pro', PREMIUM: 'Premium' }[plan];
}

export function billingTierLabel(tier: BillingTier): string {
  if (tier === 'TRIAL') return 'Free trial';
  return planDisplayName(tier);
}

export function computeTrialEndsAt(trialStartedAt: Date): Date {
  const end = new Date(trialStartedAt);
  end.setUTCDate(end.getUTCDate() + TRIAL_DAYS);
  return end;
}

export function isTrialPeriodExpired(
  trialStartedAt: Date,
  now: Date = new Date(),
): boolean {
  return now >= computeTrialEndsAt(trialStartedAt);
}

export function trialDaysRemaining(
  trialStartedAt: Date,
  now: Date = new Date(),
): number {
  const end = computeTrialEndsAt(trialStartedAt);
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function startOfCurrentMonth(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function formatLimit(value: number): string {
  return value === Infinity ? 'Unlimited' : String(value);
}
