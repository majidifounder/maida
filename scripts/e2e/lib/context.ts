import type { Reporter } from './report.js';

export const E2E_EMAIL_DOMAIN = '@e2e-test.local';

export interface E2eContext {
  base: string;
  report: Reporter;
  loadTestHeaders: Record<string, string>;
  userIds: Set<string>;
  restaurantIds: Set<string>;
  reservationIds: Set<string>;
  trackUser(id: string): void;
  trackRestaurant(id: string): void;
  trackReservation(id: string): void;
}

export function createContext(base: string, report: Reporter): E2eContext {
  const userIds = new Set<string>();
  const restaurantIds = new Set<string>();
  const reservationIds = new Set<string>();

  return {
    base,
    report,
    loadTestHeaders: { 'X-Load-Test': '1' },
    userIds,
    restaurantIds,
    reservationIds,
    trackUser(id) {
      userIds.add(id);
    },
    trackRestaurant(id) {
      restaurantIds.add(id);
    },
    trackReservation(id) {
      reservationIds.add(id);
    },
  };
}

export function uniqueEmail(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${E2E_EMAIL_DOMAIN}`;
}
