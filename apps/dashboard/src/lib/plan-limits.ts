import type { Plan, PlanLimits } from '@restaurant/types';

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

export function planLabel(plan: Plan): string {
  return { STARTER: 'Starter', PRO: 'Pro', PREMIUM: 'Premium' }[plan];
}
