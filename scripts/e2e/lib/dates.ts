export function futureDate(daysFromNow = 7): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

export function futureDatetime(daysFromNow = 7, hourUtc = 19, minuteUtc = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  d.setUTCHours(hourUtc, minuteUtc, 0, 0);
  return d.toISOString();
}

/** Re-export timezone helpers from the API for boundary tests. */
export {
  zonedTimeToUtc,
  formatLocalDate,
  addLocalDays,
  localDayBoundsUtc,
} from '../../../apps/api/src/lib/timezone.js';
