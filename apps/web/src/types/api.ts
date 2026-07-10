import type { Restaurant } from '@restaurant/types';

export type PublicRestaurant = Restaurant & {
  city: string;
  slug: string;
  imageUrl: string | null;
  seatingMode: 'LOCKED' | 'FLEXIBLE';
  timezone: string;
  defaultDurationMins: number;
  openMinutes: number;
  closeMinutes: number;
  customFee: string | null;
  extraHourFee: string | null;
  feeCurrency: string;
  maxExtraHours: number;
  /**
   * Server-computed: owner's plan allows custom-length reservations AND the
   * restaurant permits extra time. Present on the detail endpoint; list
   * endpoints omit it (undefined = fall back to the fee heuristic).
   */
  offersCustomReservations?: boolean;
};

export interface AvailabilityTime {
  startsAt: string;
  endsAt: string;
  durationMins: number;
}

export interface AvailabilityResponse {
  times: AvailabilityTime[];
  standardDurationMins: number;
  /** Coarse day span; null when the restaurant is closed that day. */
  serviceWindow: { open: string; close: string } | null;
  /** Every service window that starts on the requested local date. */
  serviceWindows: Array<{ open: string; close: string }>;
  /** False when the owner cannot currently accept online reservations. */
  bookable: boolean;
  /** Diner-safe explanation shown when bookable is false. */
  notice?: string;
}

export interface ReservationWithDetails {
  id: string;
  restaurantId: string;
  partySize: number;
  status: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  cancelledAt: string | null;
  restaurant: { name: string; city: string; cuisine: string };
}

export interface RestaurantsListResponse {
  restaurants: PublicRestaurant[];
  total: number;
  page: number;
  limit: number;
}

export interface ReservationsListResponse {
  reservations: ReservationWithDetails[];
  total: number;
  page: number;
  limit: number;
}

export interface LoginResponse {
  user: { id: string; email: string; role: string; createdAt?: string };
  accessToken: string;
  /** Epoch seconds (JWT exp) — used to schedule the proactive refresh. */
  accessTokenExpiresAt: number;
}

export interface RefreshResponse {
  accessToken: string;
  /** Epoch seconds (JWT exp). */
  accessTokenExpiresAt: number;
}
