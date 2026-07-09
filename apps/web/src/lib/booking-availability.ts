import type { AvailabilityTime } from '../types/api.js';
import {
  mealPeriodForLocalHour,
  restaurantLocalDateIso,
  restaurantLocalHour,
  type MealPeriod,
} from './restaurant-time.js';

export interface DayAvailability {
  date: string;
  times: AvailabilityTime[];
  standardDurationMins: number;
  serviceWindow: { open: string; close: string };
}

export interface ScannedSlot {
  slot: AvailabilityTime;
  date: string;
  standardDurationMins: number;
  serviceWindow: { open: string; close: string };
}

export function flattenScannedSlots(days: DayAvailability[]): ScannedSlot[] {
  const out: ScannedSlot[] = [];
  for (const day of days) {
    for (const slot of day.times) {
      out.push({
        slot,
        date: day.date,
        standardDurationMins: day.standardDurationMins,
        serviceWindow: day.serviceWindow,
      });
    }
  }
  return out.sort(
    (a, b) =>
      new Date(a.slot.startsAt).getTime() - new Date(b.slot.startsAt).getTime(),
  );
}

export function findEarliestSlotAfter(
  slots: ScannedSlot[],
  after: Date,
): ScannedSlot | null {
  for (const entry of slots) {
    if (new Date(entry.slot.startsAt).getTime() >= after.getTime()) {
      return entry;
    }
  }
  return null;
}

export function findTonightDinnerSlot(
  slots: ScannedSlot[],
  timeZone: string,
  now: Date = new Date(),
): ScannedSlot | null {
  const today = restaurantLocalDateIso(now, timeZone);
  const dinnerPeriod: MealPeriod = 'dinner';

  for (const entry of slots) {
    if (entry.date !== today) continue;
    const start = new Date(entry.slot.startsAt);
    if (start.getTime() < now.getTime()) continue;
    const hour = restaurantLocalHour(entry.slot.startsAt, timeZone);
    if (mealPeriodForLocalHour(hour) === dinnerPeriod) return entry;
  }
  return null;
}

export function findTomorrowSameTimeSlot(
  slots: ScannedSlot[],
  referenceIso: string,
  timeZone: string,
  now: Date = new Date(),
): ScannedSlot | null {
  const ref = new Date(referenceIso);
  const tomorrow = addLocalDays(restaurantLocalDateIso(now, timeZone), 1);
  const refMinutes = localMinutesFromMidnight(ref, timeZone);

  const candidates = slots.filter((e) => e.date === tomorrow);
  if (candidates.length === 0) return null;

  let best: ScannedSlot | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const entry of candidates) {
    const mins = localMinutesFromMidnight(new Date(entry.slot.startsAt), timeZone);
    const diff = Math.abs(mins - refMinutes);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry;
    }
  }
  return best;
}

function localMinutesFromMidnight(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

function addLocalDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function estimateUntilCloseEndsAt(
  startsAt: string,
  serviceWindow: { open: string; close: string },
  standardDurationMins: number,
  maxExtraHours: number,
): string {
  const start = new Date(startsAt);
  const capEnd = new Date(
    start.getTime() + (standardDurationMins + maxExtraHours * 60) * 60_000,
  );
  const close = new Date(serviceWindow.close);
  return new Date(Math.min(capEnd.getTime(), close.getTime())).toISOString();
}

export interface QuickPickResult {
  nextAvailable: ScannedSlot | null;
  in30Min: ScannedSlot | null;
  tonight: ScannedSlot | null;
  tomorrowSameTime: ScannedSlot | null;
}

export function computeQuickPicks(
  slots: ScannedSlot[],
  timeZone: string,
  referenceIso: string | null,
  now: Date = new Date(),
): QuickPickResult {
  const nextAvailable = findEarliestSlotAfter(slots, now);
  const in30Min = findEarliestSlotAfter(
    slots,
    new Date(now.getTime() + 30 * 60_000),
  );
  const tonight = findTonightDinnerSlot(slots, timeZone, now);
  const ref = referenceIso ?? nextAvailable?.slot.startsAt ?? now.toISOString();
  const tomorrowSameTime = findTomorrowSameTimeSlot(slots, ref, timeZone, now);

  return { nextAvailable, in30Min, tonight, tomorrowSameTime };
}

export function hasAnyQuickPick(picks: QuickPickResult): boolean {
  return Boolean(
    picks.nextAvailable ||
      picks.in30Min ||
      picks.tonight ||
      picks.tomorrowSameTime,
  );
}
