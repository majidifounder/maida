import { prisma, type Prisma } from '@restaurant/db';
import {
  addLocalDays,
  formatLocalDate,
  zonedTimeToUtc,
} from './timezone.js';

export const AVAILABILITY_STEP_MINS = 15;

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

export function serviceWindowBounds(
  date: string,
  openMinutes: number,
  closeMinutes: number,
  timeZone = 'UTC',
): { windowStart: Date; windowEnd: Date } {
  return {
    windowStart: zonedTimeToUtc(date, openMinutes, timeZone),
    windowEnd: zonedTimeToUtc(date, closeMinutes, timeZone),
  };
}

function roundUpToStep(d: Date, stepMins: number): Date {
  const stepMs = stepMins * 60_000;
  return new Date(Math.ceil(d.getTime() / stepMs) * stepMs);
}

export async function findNextAvailableStart(
  restaurant: {
    id: string;
    seatingMode: 'LOCKED' | 'FLEXIBLE';
    defaultDurationMins: number;
    openMinutes: number;
    closeMinutes: number;
    timezone: string;
  },
  partySize: number,
  requestedStart: Date,
  customDurationMins?: number,
): Promise<Date | null> {
  const units = await loadBookableUnits(restaurant.id, restaurant.seatingMode);
  if (units.length === 0) return null;

  const baseLocalDate = formatLocalDate(requestedStart, restaurant.timezone);

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const dateStr = addLocalDays(baseLocalDate, dayOffset, restaurant.timezone);
    const bounds = serviceWindowBounds(
      dateStr,
      restaurant.openMinutes,
      restaurant.closeMinutes,
      restaurant.timezone,
    );

    let cursor =
      dayOffset === 0
        ? new Date(
            Math.max(requestedStart.getTime(), bounds.windowStart.getTime()),
          )
        : bounds.windowStart;

    cursor = roundUpToStep(cursor, AVAILABILITY_STEP_MINS);

    while (cursor < bounds.windowEnd) {
      const durationMins =
        customDurationMins ??
        (await resolveDurationMins(
          restaurant.id,
          partySize,
          restaurant.defaultDurationMins,
        ));
      const endsAt = addMinutes(cursor, durationMins);
      if (endsAt > bounds.windowEnd) break;

      const unit = await findBestFitUnit(units, partySize, cursor, endsAt);
      if (unit) return cursor;

      cursor = addMinutes(cursor, AVAILABILITY_STEP_MINS);
    }
  }

  return null;
}

export async function computeAvailabilityTimes(
  restaurant: {
    id: string;
    seatingMode: 'LOCKED' | 'FLEXIBLE';
    defaultDurationMins: number;
    openMinutes: number;
    closeMinutes: number;
    timezone: string;
  },
  date: string,
  partySize: number,
): Promise<Array<{ startsAt: string; endsAt: string; durationMins: number }>> {
  const units = await loadBookableUnits(restaurant.id, restaurant.seatingMode);
  if (units.length === 0) return [];

  const bounds = serviceWindowBounds(
    date,
    restaurant.openMinutes,
    restaurant.closeMinutes,
    restaurant.timezone,
  );
  const occupancy = await loadDayOccupancy(
    restaurant.id,
    bounds.windowStart,
    bounds.windowEnd,
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

  let cursor = roundUpToStep(bounds.windowStart, AVAILABILITY_STEP_MINS);

  while (cursor < bounds.windowEnd) {
    if (cursor.getTime() <= now) {
      cursor = addMinutes(cursor, AVAILABILITY_STEP_MINS);
      continue;
    }

    const endsAt = addMinutes(cursor, durationMins);
    if (endsAt > bounds.windowEnd) break;

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

  return results;
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
