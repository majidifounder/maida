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
};

export interface AvailabilityTime {
  startsAt: string;
  endsAt: string;
  durationMins: number;
}

export interface AvailabilityResponse {
  times: AvailabilityTime[];
  standardDurationMins: number;
  serviceWindow: { open: string; close: string };
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
