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
  maxExtraHours: number;
}

/** One service window on one weekday. closeMinute <= openMinute = overnight. */
export interface SchedulePeriod {
  id: string;
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday
  openMinute: number; // 0–1439, minutes from local midnight
  closeMinute: number; // 1–1440
}

export interface ScheduleClosure {
  id: string;
  date: string; // YYYY-MM-DD (restaurant-local calendar day)
  reason: string | null;
}

export interface RestaurantSchedule {
  periods: SchedulePeriod[];
  closures: ScheduleClosure[];
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
  /** Display status — past SCHEDULED/SEATED rows are shown as COMPLETED. */
  status: string;
  /** DB truth — decides which lifecycle actions are still legal. */
  rawStatus: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  cancelledAt: string | null;
  guestName: string | null;
  notes: string | null;
  source: 'ONLINE' | 'WALK_IN' | 'STAFF';
  reservationType: 'STANDARD' | 'CUSTOM';
  isOverride: boolean;
  diner: { email: string } | null;
  tables: Array<{
    tableId: string;
    table: { name: string; maxPartySize: number };
  }>;
}

export interface ReservationsResponse {
  reservations: OwnerReservation[];
  total: number;
  page: number;
  limit: number;
}

export type { Plan, SeatingMode };
