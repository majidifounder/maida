import { prisma, type Prisma } from '@restaurant/db';
import { addLocalDays, formatLocalDate } from './timezone.js';
import {
  findContainingWindow,
  loadRestaurantSchedule,
  serviceWindowsForLocalDate,
  type RestaurantSchedule,
  type ServiceWindow,
} from './service-schedule.js';

export const AVAILABILITY_STEP_MINS = 15;
export const MIN_RESERVATION_MINS = 15;

export type BookableUnit = {
  kind: 'table' | 'combination';
  resourceId: string;
  tableIds: string[];
  minPartySize: number;
  maxPartySize: number;
};

type DbClient = Prisma.TransactionClient | typeof prisma;

export function deriveDisplayStatus(
  status: string,
  endsAt: Date,
): string {
  if (
    (status === 'SCHEDULED' || status === 'SEATED') &&
    endsAt.getTime() <= Date.now()
  ) {
    return 'COMPLETED';
  }
  return status;
}

export async function loadBookableUnits(
  restaurantId: string,
  seatingMode: 'LOCKED' | 'FLEXIBLE',
  db: DbClient = prisma,
): Promise<BookableUnit[]> {
  const tables = await db.diningTable.findMany({
    where: { restaurantId, isActive: true },
    select: { id: true, minPartySize: true, maxPartySize: true },
  });

  const units: BookableUnit[] = tables.map((t) => ({
    kind: 'table',
    resourceId: t.id,
    tableIds: [t.id],
    minPartySize: t.minPartySize,
    maxPartySize: t.maxPartySize,
  }));

  if (seatingMode === 'FLEXIBLE') {
    const combinations = await db.tableCombination.findMany({
      where: { restaurantId, isActive: true },
      select: {
        id: true,
        minPartySize: true,
        maxPartySize: true,
        members: { select: { tableId: true } },
      },
    });

    for (const c of combinations) {
      units.push({
        kind: 'combination',
        resourceId: c.id,
        tableIds: c.members.map((m) => m.tableId),
        minPartySize: c.minPartySize,
        maxPartySize: c.maxPartySize,
      });
    }
  }

  return units;
}

/** Best-fit: smallest maxPartySize that fits the party, then smallest minPartySize. */
export function sortUnitsBestFit(
  units: BookableUnit[],
  partySize: number,
): BookableUnit[] {
  return units
    .filter((u) => u.minPartySize <= partySize && u.maxPartySize >= partySize)
    .sort(
      (a, b) =>
        a.maxPartySize - b.maxPartySize || a.minPartySize - b.minPartySize,
    );
}

export async function getOccupiedTableIds(
  tableIds: string[],
  startsAt: Date,
  endsAt: Date,
  db: DbClient = prisma,
): Promise<Set<string>> {
  if (tableIds.length === 0) return new Set();

  const rows = await db.$queryRaw<Array<{ tableId: string }>>`
    SELECT DISTINCT "tableId"
    FROM "reservation_tables"
    WHERE "tableId" = ANY(${tableIds}::uuid[])
      AND "releasedAt" IS NULL
      AND tstzrange("startsAt", "endsAt", '[)')
          && tstzrange(${startsAt}::timestamptz, ${endsAt}::timestamptz, '[)')
  `;

  return new Set(rows.map((r) => r.tableId));
}

export async function isUnitAvailable(
  unit: BookableUnit,
  startsAt: Date,
  endsAt: Date,
  db: DbClient = prisma,
): Promise<boolean> {
  const occupied = await getOccupiedTableIds(
    unit.tableIds,
    startsAt,
    endsAt,
    db,
  );
  return unit.tableIds.every((id) => !occupied.has(id));
}

export async function findBestFitUnit(
  units: BookableUnit[],
  partySize: number,
  startsAt: Date,
  endsAt: Date,
  db: DbClient = prisma,
): Promise<BookableUnit | null> {
  const candidates = sortUnitsBestFit(units, partySize);
  for (const unit of candidates) {
    if (await isUnitAvailable(unit, startsAt, endsAt, db)) {
      return unit;
    }
  }
  return null;
}

export async function resolveDurationMins(
  restaurantId: string,
  partySize: number,
  defaultDurationMins: number,
  db: DbClient = prisma,
): Promise<number> {
  const rule = await db.turnTimeRule.findFirst({
    where: {
      restaurantId,
      minPartySize: { lte: partySize },
      maxPartySize: { gte: partySize },
    },
    orderBy: { minPartySize: 'asc' },
    select: { durationMins: true },
  });
  return rule?.durationMins ?? defaultDurationMins;
}

export function addMinutes(d: Date, mins: number): Date {
  return new Date(d.getTime() + mins * 60_000);
}

export type RestaurantScheduleContext = {
  id: string;
  seatingMode: 'LOCKED' | 'FLEXIBLE';
  defaultDurationMins: number;
  openMinutes: number;
  closeMinutes: number;
  timezone: string;
};

async function resolveSchedule(
  restaurant: RestaurantScheduleContext,
  schedule: RestaurantSchedule | undefined,
  db: DbClient = prisma,
): Promise<RestaurantSchedule> {
  return (
    schedule ??
    (await loadRestaurantSchedule(
      restaurant.id,
      {
        openMinutes: restaurant.openMinutes,
        closeMinutes: restaurant.closeMinutes,
      },
      db,
    ))
  );
}

function roundUpToStep(d: Date, stepMins: number): Date {
  const stepMs = stepMins * 60_000;
  return new Date(Math.ceil(d.getTime() / stepMs) * stepMs);
}

/**
 * Earliest bookable start on/after `requestedStart`, scanning the next two weeks
 * of the restaurant's weekly schedule (to skip closed days). One occupancy query
 * per open day, walked in memory — not one query per candidate slot.
 */
export async function findNextAvailableStart(
  restaurant: RestaurantScheduleContext,
  partySize: number,
  requestedStart: Date,
  customDurationMins?: number,
  schedule?: RestaurantSchedule,
): Promise<Date | null> {
  const units = await loadBookableUnits(restaurant.id, restaurant.seatingMode);
  if (units.length === 0) return null;

  const sched = await resolveSchedule(restaurant, schedule);
  const durationMins =
    customDurationMins ??
    (await resolveDurationMins(
      restaurant.id,
      partySize,
      restaurant.defaultDurationMins,
    ));

  const baseLocalDate = formatLocalDate(requestedStart, restaurant.timezone);

  for (let dayOffset = 0; dayOffset < SUGGESTION_SCAN_DAYS; dayOffset++) {
    const dateStr = addLocalDays(baseLocalDate, dayOffset, restaurant.timezone);
    const windows = serviceWindowsForLocalDate(
      dateStr,
      restaurant.timezone,
      sched,
    );
    if (windows.length === 0) continue;

    const occupancy = await loadDayOccupancy(
      restaurant.id,
      windows[0]!.start,
      windows[windows.length - 1]!.end,
    );

    for (const w of windows) {
      let cursor =
        dayOffset === 0
          ? new Date(Math.max(requestedStart.getTime(), w.start.getTime()))
          : w.start;
      cursor = roundUpToStep(cursor, AVAILABILITY_STEP_MINS);

      while (cursor < w.end) {
        const endsAt = addMinutes(cursor, durationMins);
        if (endsAt > w.end) break;

        const unit = findBestFitUnitInMemory(
          units,
          partySize,
          cursor,
          endsAt,
          occupancy,
        );
        if (unit) return cursor;

        cursor = addMinutes(cursor, AVAILABILITY_STEP_MINS);
      }
    }
  }

  return null;
}

const SUGGESTION_SCAN_DAYS = 14;

export async function computeAvailabilityTimes(
  restaurant: RestaurantScheduleContext,
  date: string,
  partySize: number,
  schedule?: RestaurantSchedule,
): Promise<Array<{ startsAt: string; endsAt: string; durationMins: number }>> {
  const units = await loadBookableUnits(restaurant.id, restaurant.seatingMode);
  if (units.length === 0) return [];

  const sched = await resolveSchedule(restaurant, schedule);
  const windows = serviceWindowsForLocalDate(date, restaurant.timezone, sched);
  if (windows.length === 0) return [];

  const occupancy = await loadDayOccupancy(
    restaurant.id,
    windows[0]!.start,
    windows[windows.length - 1]!.end,
  );

  const durationMins = await resolveDurationMins(
    restaurant.id,
    partySize,
    restaurant.defaultDurationMins,
  );

  const now = Date.now();
  const results: Array<{
    startsAt: string;
    endsAt: string;
    durationMins: number;
  }> = [];

  for (const w of windows) {
    let cursor = roundUpToStep(w.start, AVAILABILITY_STEP_MINS);

    while (cursor < w.end) {
      if (cursor.getTime() <= now) {
        cursor = addMinutes(cursor, AVAILABILITY_STEP_MINS);
        continue;
      }

      const endsAt = addMinutes(cursor, durationMins);
      if (endsAt > w.end) break;

      const unit = findBestFitUnitInMemory(
        units,
        partySize,
        cursor,
        endsAt,
        occupancy,
      );
      if (unit) {
        results.push({
          startsAt: cursor.toISOString(),
          endsAt: endsAt.toISOString(),
          durationMins,
        });
      }

      cursor = addMinutes(cursor, AVAILABILITY_STEP_MINS);
    }
  }

  return results;
}

/** UTC [start, end) windows the diner-facing availability endpoint should surface. */
export async function serviceWindowsForDate(
  restaurant: RestaurantScheduleContext,
  date: string,
  schedule?: RestaurantSchedule,
): Promise<ServiceWindow[]> {
  const sched = await resolveSchedule(restaurant, schedule);
  return serviceWindowsForLocalDate(date, restaurant.timezone, sched);
}

export function isExclusionViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes('23P01') ||
    message.includes('reservation_tables_no_overlap') ||
    message.includes('exclusion constraint')
  ) {
    return true;
  }
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  const code = (err as { code: string }).code;
  if (code === 'P2010') {
    const meta = (err as { meta?: { code?: string; message?: string } }).meta;
    return meta?.code === '23P01' || Boolean(meta?.message?.includes('23P01'));
  }
  return false;
}

function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

async function loadDayOccupancy(
  restaurantId: string,
  dayStart: Date,
  dayEnd: Date,
  db: DbClient = prisma,
): Promise<Map<string, Array<{ startsAt: Date; endsAt: Date }>>> {
  const rows = await db.$queryRaw<
    Array<{ tableId: string; startsAt: Date; endsAt: Date }>
  >`
    SELECT rt."tableId", rt."startsAt", rt."endsAt"
    FROM "reservation_tables" rt
    INNER JOIN "dining_tables" dt ON dt.id = rt."tableId"
    WHERE dt."restaurantId" = ${restaurantId}::uuid
      AND rt."releasedAt" IS NULL
      AND rt."startsAt" < ${dayEnd}
      AND rt."endsAt" > ${dayStart}
  `;

  const map = new Map<string, Array<{ startsAt: Date; endsAt: Date }>>();
  for (const row of rows) {
    const list = map.get(row.tableId) ?? [];
    list.push({ startsAt: row.startsAt, endsAt: row.endsAt });
    map.set(row.tableId, list);
  }
  return map;
}

function isUnitAvailableInMemory(
  unit: BookableUnit,
  startsAt: Date,
  endsAt: Date,
  occupancy: Map<string, Array<{ startsAt: Date; endsAt: Date }>>,
): boolean {
  for (const tableId of unit.tableIds) {
    const holds = occupancy.get(tableId) ?? [];
    for (const hold of holds) {
      if (intervalsOverlap(startsAt, endsAt, hold.startsAt, hold.endsAt)) {
        return false;
      }
    }
  }
  return true;
}

function findBestFitUnitInMemory(
  units: BookableUnit[],
  partySize: number,
  startsAt: Date,
  endsAt: Date,
  occupancy: Map<string, Array<{ startsAt: Date; endsAt: Date }>>,
): BookableUnit | null {
  for (const unit of sortUnitsBestFit(units, partySize)) {
    if (isUnitAvailableInMemory(unit, startsAt, endsAt, occupancy)) {
      return unit;
    }
  }
  return null;
}

export type RestaurantBookingContext = {
  id: string;
  seatingMode: 'LOCKED' | 'FLEXIBLE';
  defaultDurationMins: number;
  openMinutes: number;
  closeMinutes: number;
  timezone: string;
  maxExtraHours: number;
};

export type CustomReservationMode =
  | { kind: 'extended'; durationMins: number }
  | { kind: 'untilClose' };

export function maxCustomDurationMins(
  standardDurationMins: number,
  maxExtraHours: number,
): number {
  return standardDurationMins + maxExtraHours * 60;
}

export function computeEstimatedFee(
  customFee: { toString(): string } | null | undefined,
  extraHourFee: { toString(): string } | null | undefined,
  startsAt: Date,
  endsAt: Date,
  standardDurationMins: number,
): number {
  const flat = customFee != null ? Number(customFee) : 0;
  const perHour = extraHourFee != null ? Number(extraHourFee) : 0;
  const actualMins = (endsAt.getTime() - startsAt.getTime()) / 60_000;
  const extraMins = Math.max(0, actualMins - standardDurationMins);
  const extraHours = Math.ceil(extraMins / 60);
  return (Number.isNaN(flat) ? 0 : flat) + extraHours * (Number.isNaN(perHour) ? 0 : perHour);
}

async function findEarliestFollowingReservationStart(
  tableIds: string[],
  startsAt: Date,
  searchUntil: Date,
  db: DbClient = prisma,
): Promise<Date | null> {
  if (tableIds.length === 0) return null;

  const rows = await db.$queryRaw<Array<{ startsAt: Date }>>`
    SELECT MIN(rt."startsAt") AS "startsAt"
    FROM "reservation_tables" rt
    WHERE rt."tableId" = ANY(${tableIds}::uuid[])
      AND rt."releasedAt" IS NULL
      AND rt."startsAt" > ${startsAt}::timestamptz
      AND rt."startsAt" < ${searchUntil}::timestamptz
  `;

  return rows[0]?.startsAt ?? null;
}

/** Resolves table assignment and end time for CUSTOM (Extended or Until-close) bookings. */
export async function resolveCustomReservationWindow(
  restaurant: RestaurantBookingContext,
  partySize: number,
  startsAt: Date,
  mode: CustomReservationMode,
  db: DbClient = prisma,
  schedule?: RestaurantSchedule,
): Promise<{
  tableIds: string[];
  endsAt: Date;
  wasCapped: boolean;
  standardDurationMins: number;
} | null> {
  const standardDurationMins = await resolveDurationMins(
    restaurant.id,
    partySize,
    restaurant.defaultDurationMins,
    db,
  );
  const capEndsAt = addMinutes(
    startsAt,
    maxCustomDurationMins(standardDurationMins, restaurant.maxExtraHours),
  );

  const sched = await resolveSchedule(restaurant, schedule, db);
  // Until-close is bounded by the close of the service window the booking starts
  // in. A probe interval is used because until-close resolves its own end time.
  const probeWindow = findContainingWindow(
    startsAt,
    addMinutes(startsAt, MIN_RESERVATION_MINS),
    restaurant.timezone,
    sched,
  );
  if (!probeWindow) return null;
  const serviceCloseAt = probeWindow.end;

  const units = await loadBookableUnits(restaurant.id, restaurant.seatingMode, db);
  if (units.length === 0) return null;

  if (mode.kind === 'extended') {
    const endsAt = addMinutes(startsAt, mode.durationMins);
    const unit = await findBestFitUnit(units, partySize, startsAt, endsAt, db);
    if (!unit) return null;

    return {
      tableIds: unit.tableIds,
      endsAt,
      wasCapped: false,
      standardDurationMins,
    };
  }

  const probeEndsAt = addMinutes(startsAt, MIN_RESERVATION_MINS);
  const unit = await findBestFitUnit(units, partySize, startsAt, probeEndsAt, db);
  if (!unit) return null;

  const theoreticalMax = new Date(
    Math.min(serviceCloseAt.getTime(), capEndsAt.getTime()),
  );
  const followingStart = await findEarliestFollowingReservationStart(
    unit.tableIds,
    startsAt,
    theoreticalMax,
    db,
  );

  const endsAt = new Date(
    Math.min(
      theoreticalMax.getTime(),
      followingStart?.getTime() ?? Number.POSITIVE_INFINITY,
    ),
  );

  const durationMins = (endsAt.getTime() - startsAt.getTime()) / 60_000;
  if (durationMins < MIN_RESERVATION_MINS) return null;

  return {
    tableIds: unit.tableIds,
    endsAt,
    wasCapped: endsAt.getTime() < serviceCloseAt.getTime(),
    standardDurationMins,
  };
}
