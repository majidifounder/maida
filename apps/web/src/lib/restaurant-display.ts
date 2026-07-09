import { formatServiceWindowLabel } from './restaurant-time.js';

export function minutesToTimeLabel(minutes: number): string {
  if (minutes >= 1440) return 'midnight';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0
    ? `${hour12}:00 ${period}`
    : `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

export function formatServiceHoursLabel(openMinutes: number, closeMinutes: number): string {
  if (openMinutes === 0 && closeMinutes === 1440) return '24 hours';
  return `${minutesToTimeLabel(openMinutes)} – ${minutesToTimeLabel(closeMinutes)}`;
}

export function formatFee(
  amount: string | null,
  currency: string,
): string | null {
  if (amount == null || amount === '') return null;
  const n = Number(amount);
  if (Number.isNaN(n)) return null;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'USD',
  }).format(n);
}

export function restaurantOffersCustomReservations(restaurant: {
  customFee: string | null;
  extraHourFee: string | null;
}): boolean {
  return (
    (restaurant.customFee != null && restaurant.customFee !== '') ||
    (restaurant.extraHourFee != null && restaurant.extraHourFee !== '')
  );
}

/** Informational fee estimate for a CUSTOM reservation (paid at restaurant). */
export function estimateCustomReservationFee(
  restaurant: {
    customFee: string | null;
    extraHourFee: string | null;
    feeCurrency: string;
  },
  durationMins: number,
  standardDurationMins: number,
): string | null {
  const flat = restaurant.customFee != null ? Number(restaurant.customFee) : 0;
  const perHour =
    restaurant.extraHourFee != null ? Number(restaurant.extraHourFee) : 0;
  if (Number.isNaN(flat) && Number.isNaN(perHour)) return null;

  let total = Number.isNaN(flat) ? 0 : flat;
  const extraMins = Math.max(0, durationMins - standardDurationMins);
  if (extraMins > 0 && !Number.isNaN(perHour) && perHour > 0) {
    total += Math.ceil(extraMins / 60) * perHour;
  }

  if (total <= 0) return null;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: restaurant.feeCurrency || 'USD',
  }).format(total);
}

export { formatServiceWindowLabel };
