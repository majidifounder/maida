import { prisma, type Prisma } from '@restaurant/db';
import { addLocalDays, formatLocalDate, zonedTimeToUtc } from './timezone.js';

type DbClient = Prisma.TransactionClient | typeof prisma;

export interface ServicePeriodRow {
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday
  openMinute: number; // minutes from local midnight, 0–1439
  closeMinute: number; // 1–1440; <= openMinute means the window runs past local midnight
}

export interface ServiceWindow {
  start: Date; // UTC instant (inclusive)
  end: Date; // UTC instant (exclusive), always > start
}

export interface RestaurantSchedule {
  periods: ServicePeriodRow[];
  closureDates: ReadonlySet<string>; // local 'YYYY-MM-DD' calendar days with no new service
}

/** JS weekday (0=Sun … 6=Sat) for a 'YYYY-MM-DD' calendar date. Timezone-independent. */
export function weekdayForDate(dateStr: string): number {
  const [y = 0, m = 1, d = 1] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** A stored DATE column (UTC midnight) → its 'YYYY-MM-DD' calendar string. */
function dateColumnToIso(date: Date): string {
  return formatLocalDate(date, 'UTC');
}

/**
 * Loads a restaurant's weekly schedule and blackout dates.
 *
 * If the restaurant has no ServicePeriod rows (pre-schedule data that predates the
 * backfill migration), the legacy single open/close window is synthesised for all
 * seven weekdays so the engine keeps working.
 */
export async function loadRestaurantSchedule(
  restaurantId: string,
  legacyWindow: { openMinutes: number; closeMinutes: number },
  db: DbClient = prisma,
): Promise<RestaurantSchedule> {
  const [periods, closures] = await Promise.all([
    db.servicePeriod.findMany({
      where: { restaurantId },
      select: { dayOfWeek: true, openMinute: true, closeMinute: true },
    }),
    db.restaurantClosure.findMany({
      where: { restaurantId },
      select: { date: true },
    }),
  ]);

  const effectivePeriods: ServicePeriodRow[] =
    periods.length > 0
      ? periods
      : Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          openMinute: legacyWindow.openMinutes,
          closeMinute: legacyWindow.closeMinutes,
        }));

  return {
    periods: effectivePeriods,
    closureDates: new Set(closures.map((c) => dateColumnToIso(c.date))),
  };
}

/**
 * Every service window that STARTS on the given local calendar date, as UTC
 * [start, end) ranges. Windows whose closeMinute is <= openMinute run past local
 * midnight into the following day. A closure date yields no windows.
 */
export function serviceWindowsForLocalDate(
  dateStr: string,
  timeZone: string,
  schedule: RestaurantSchedule,
): ServiceWindow[] {
  if (schedule.closureDates.has(dateStr)) return [];

  const weekday = weekdayForDate(dateStr);
  const windows: ServiceWindow[] = [];

  for (const p of schedule.periods) {
    if (p.dayOfWeek !== weekday) continue;
    const start = zonedTimeToUtc(dateStr, p.openMinute, timeZone);
    const end =
      p.closeMinute > p.openMinute
        ? zonedTimeToUtc(dateStr, p.closeMinute, timeZone)
        : zonedTimeToUtc(
            addLocalDays(dateStr, 1, timeZone),
            p.closeMinute,
            timeZone,
          );
    if (end.getTime() > start.getTime()) windows.push({ start, end });
  }

  return windows.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * The single service window that fully contains [startsAt, endsAt), or null when
 * the interval falls outside the restaurant's opening schedule. Checks windows
 * that start on the interval's local date and on the previous local date, so an
 * overnight window (e.g. a Friday-night service running to 02:00) correctly
 * covers early-morning instants.
 */
export function findContainingWindow(
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
  schedule: RestaurantSchedule,
): ServiceWindow | null {
  const localDate = formatLocalDate(startsAt, timeZone);
  const prevDate = addLocalDays(localDate, -1, timeZone);

  const candidates = [
    ...serviceWindowsForLocalDate(prevDate, timeZone, schedule),
    ...serviceWindowsForLocalDate(localDate, timeZone, schedule),
  ];

  for (const w of candidates) {
    if (
      w.start.getTime() <= startsAt.getTime() &&
      endsAt.getTime() <= w.end.getTime()
    ) {
      return w;
    }
  }
  return null;
}

/** Coarse day span [earliest window start, latest window end) for display, or null. */
export function daySpanForLocalDate(
  windows: ServiceWindow[],
): ServiceWindow | null {
  if (windows.length === 0) return null;
  return {
    start: windows[0]!.start,
    end: windows[windows.length - 1]!.end,
  };
}
