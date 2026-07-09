/** Format an ISO timestamp in the restaurant's IANA timezone. */
export function formatInRestaurantTz(
  iso: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone }).format(
    new Date(iso),
  );
}

export function formatRestaurantTime(iso: string, timeZone: string): string {
  return formatInRestaurantTz(iso, timeZone, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatRestaurantDateTime(iso: string, timeZone: string): string {
  return formatInRestaurantTz(iso, timeZone, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatRestaurantDate(iso: string, timeZone: string): string {
  return formatInRestaurantTz(iso, timeZone, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/** Compact label for quick-pick buttons, e.g. "Today, 8:15 PM". */
export function formatQuickPickWhen(
  iso: string,
  timeZone: string,
  now: Date = new Date(),
): string {
  const slotDay = restaurantLocalDateIso(iso, timeZone);
  const today = restaurantLocalDateIso(now, timeZone);
  const tomorrow = restaurantLocalDateIso(
    new Date(now.getTime() + 24 * 60 * 60_000),
    timeZone,
  );
  const time = formatRestaurantTime(iso, timeZone);
  if (slotDay === today) return `Today, ${time}`;
  if (slotDay === tomorrow) return `Tomorrow, ${time}`;
  return `${formatRestaurantDate(iso, timeZone)}, ${time}`;
}

function restaurantLocalDateIso(iso: string | Date, timeZone: string): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export { restaurantLocalDateIso };

/** Local hour (0–23) in the restaurant timezone for grouping meal periods. */
export function restaurantLocalHour(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date(iso));
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
}

export type MealPeriod = 'breakfast' | 'lunch' | 'dinner' | 'late';

export function mealPeriodForLocalHour(hour: number): MealPeriod {
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 15 && hour < 22) return 'dinner';
  return 'late';
}

export const MEAL_PERIOD_LABELS: Record<MealPeriod, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  late: 'Late night',
};

export const MEAL_PERIOD_ORDER: MealPeriod[] = [
  'breakfast',
  'lunch',
  'dinner',
  'late',
];

export function formatTimezoneLabel(timeZone: string): string {
  try {
    const city = timeZone.includes('/')
      ? timeZone.split('/').pop()!.replace(/_/g, ' ')
      : timeZone;
    const offset = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    return offset ? `${city} (${offset})` : city;
  } catch {
    return timeZone;
  }
}

export function isFullDayServiceWindow(openIso: string, closeIso: string): boolean {
  const open = new Date(openIso);
  const close = new Date(closeIso);
  const spanMs = close.getTime() - open.getTime();
  return spanMs >= 23 * 60 * 60 * 1000;
}

export function formatServiceWindowLabel(
  serviceWindow: { open: string; close: string },
  timeZone: string,
): string {
  if (isFullDayServiceWindow(serviceWindow.open, serviceWindow.close)) {
    return '24 hours';
  }
  return `${formatRestaurantTime(serviceWindow.open, timeZone)} – ${formatRestaurantTime(serviceWindow.close, timeZone)}`;
}
