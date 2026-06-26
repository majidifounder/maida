export const CUISINE_TYPES = [
  'ITALIAN',
  'FRENCH',
  'JAPANESE',
  'CHINESE',
  'INDIAN',
  'MEXICAN',
  'AMERICAN',
  'MEDITERRANEAN',
  'OTHER',
] as const;

export type CuisineType = (typeof CUISINE_TYPES)[number];

export interface PublicRestaurant {
  id: string;
  name: string;
  slug: string;
  cuisine: string;
  description: string;
  address: string;
  city: string;
  imageUrl: string | null;
  createdAt: string;
}

export interface SlotRow {
  id: string;
  startsAt: string;
  capacity: number;
  available: number;
}

export interface OwnerBooking {
  id: string;
  restaurantId: string;
  dinerId: string;
  slotId: string;
  partySize: number;
  status: string;
  createdAt: string;
  cancelledAt: string | null;
  slot: { startsAt: string; capacity: number };
  diner: { email: string };
}

export interface BookingsResponse {
  bookings: OwnerBooking[];
  total: number;
  page: number;
  limit: number;
}
