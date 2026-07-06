import type { Plan, SeatingMode } from '@restaurant/types';

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

/** Owner-facing restaurant record (GET /restaurants/:id/config or create response). */
export interface OwnerRestaurant {
  id: string;
  name: string;
  slug: string;
  cuisine: string;
  description: string;
  address: string;
  city: string;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  timezone: string;
  seatingMode: SeatingMode;
  defaultDurationMins: number;
  openMinutes: number;
  closeMinutes: number;
  customFee: string | null;
  extraHourFee: string | null;
  feeCurrency: string;
}

export interface DiningTableRow {
  id: string;
  name: string;
  minPartySize: number;
  maxPartySize: number;
  isActive: boolean;
}

export interface TableCombinationRow {
  id: string;
  restaurantId: string;
  name: string;
  minPartySize: number;
  maxPartySize: number;
  isActive: boolean;
  tableIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TurnTimeRuleRow {
  id: string;
  restaurantId: string;
  minPartySize: number;
  maxPartySize: number;
  durationMins: number;
}

export interface OwnerReservation {
  id: string;
  restaurantId: string;
  dinerId: string | null;
  partySize: number;
  status: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  cancelledAt: string | null;
  guestName: string | null;
  diner: { email: string } | null;
}

export interface ReservationsResponse {
  reservations: OwnerReservation[];
  total: number;
  page: number;
  limit: number;
}

export type { Plan, SeatingMode };
