import type { Restaurant } from '@restaurant/types';

/** Public restaurant fields returned by GET /restaurants and GET /restaurants/:id */
export type PublicRestaurant = Restaurant & {
  city: string;
  slug: string;
  imageUrl: string | null;
};

export interface SlotWithAvailability {
  id: string;
  startsAt: string;
  capacity: number;
  available: number;
}

export interface BookingWithDetails {
  id: string;
  restaurantId: string;
  slotId: string;
  partySize: number;
  status: string;
  createdAt: string;
  cancelledAt: string | null;
  slot: { startsAt: string; capacity: number };
  restaurant: { name: string; city: string; cuisine: string };
}

export interface RestaurantsListResponse {
  restaurants: PublicRestaurant[];
  total: number;
  page: number;
  limit: number;
}

export interface BookingsListResponse {
  bookings: BookingWithDetails[];
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
