
export function isValidIanaTimezone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

function getTimeZoneOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = Object.fromEntries(
    dtf
      .formatToParts(instant)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asUtc - instant.getTime();
}

/** Wall-clock moment on a local calendar day → UTC instant. */
export function zonedTimeToUtc(
  dateStr: string,
  minutesFromMidnight: number,
  timeZone: string,
): Date {
  const hours = Math.floor(minutesFromMidnight / 60);
  const minutes = minutesFromMidnight % 60;
  const [year, month, day] = dateStr.split('-').map(Number);

  let utcMs = Date.UTC(year!, month! - 1, day, hours, minutes, 0, 0);
  for (let i = 0; i < 2; i++) {
    utcMs -= getTimeZoneOffsetMs(new Date(utcMs), timeZone);
  }

  return new Date(utcMs);
}

export function formatLocalDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);
}

export function addLocalDays(
  dateStr: string,
  days: number,
  timeZone: string,
): string {
  const anchor = zonedTimeToUtc(dateStr, 12 * 60, timeZone);
  return formatLocalDate(
    new Date(anchor.getTime() + days * 86_400_000),
    timeZone,
  );
}

/** Half-open local-day bounds [start, end) in UTC. */
export function localDayBoundsUtc(
  dateStr: string,
  timeZone: string,
): { start: Date; end: Date } {
  return {
    start: zonedTimeToUtc(dateStr, 0, timeZone),
    end: zonedTimeToUtc(addLocalDays(dateStr, 1, timeZone), 0, timeZone),
  };
}
