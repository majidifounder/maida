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
};

export interface AvailabilityTime {
  startsAt: string;
  endsAt: string;
  durationMins: number;
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
  accessTokenExpiresAt: number | string;
}

export interface RefreshResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
}
