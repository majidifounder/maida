/** Minutes from local midnight (matches API openMinutes / closeMinutes). */
export function timeInputToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function isValidIanaTimezone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(timeZone: string): string {
  return isValidIanaTimezone(timeZone) ? timeZone : 'UTC';
}

export function minutesToTimeInput(minutes: number): string {
  if (minutes >= 1440) return '23:59';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const OPEN_24H_OPEN_MINUTES = 0;
export const OPEN_24H_CLOSE_MINUTES = 1440;

export function isOpen24Hours(openMinutes: number, closeMinutes: number): boolean {
  return openMinutes === OPEN_24H_OPEN_MINUTES && closeMinutes === OPEN_24H_CLOSE_MINUTES;
}

export function formatServiceWindow(openMinutes: number, closeMinutes: number): string {
  if (isOpen24Hours(openMinutes, closeMinutes)) return '24 hours';
  return `${minutesToTimeInput(openMinutes)} – ${minutesToTimeInput(closeMinutes)}`;
}

// ── Restaurant-local instants (service view) ─────────────────────────────────
// EVERY reservation time on the dashboard renders in the RESTAURANT's zone,
// never the device's — an owner checking from home must see service-floor time.

/** "7:30 PM" in the restaurant's timezone. */
export function formatTimeInTz(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** The restaurant's current local calendar date, YYYY-MM-DD. */
export function restaurantTodayIso(timeZone: string, now = new Date()): string {
  // en-CA reliably formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Calendar-date arithmetic on YYYY-MM-DD strings (timezone-independent). */
export function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Today" / "Tomorrow" / "Yesterday" / "Fri, Jul 12" for a local date. */
export function formatDayLabel(dateIso: string, todayIso: string): string {
  if (dateIso === todayIso) return 'Today';
  if (dateIso === addDaysIso(todayIso, 1)) return 'Tomorrow';
  if (dateIso === addDaysIso(todayIso, -1)) return 'Yesterday';
  const d = new Date(`${dateIso}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/** Combine a local calendar date + HH:MM in a tz into a UTC instant. */
export function zonedDateTimeToUtc(
  dateIso: string,
  timeInput: string,
  timeZone: string,
): Date | null {
  const mins = timeInputToMinutes(timeInput);
  if (mins === null) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  // Two-pass offset resolution (mirrors the API's zonedTimeToUtc).
  const naive = Date.UTC(
    Number(dateIso.slice(0, 4)),
    Number(dateIso.slice(5, 7)) - 1,
    Number(dateIso.slice(8, 10)),
    h,
    m,
  );
  let guess = naive;
  for (let i = 0; i < 2; i++) {
    const offset = tzOffsetMs(new Date(guess), timeZone);
    guess = naive - offset;
  }
  return new Date(guess);
}

function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - at.getTime();
}

export interface TimezoneOption {
  value: string;
  city: string;
  region: string;
}

/** Curated IANA zones — stored value is always a real timezone identifier. */
export const TIMEZONE_CATALOG: TimezoneOption[] = [
  { value: 'UTC', city: 'UTC', region: 'Global' },
  { value: 'Africa/Casablanca', city: 'Casablanca', region: 'Africa' },
  { value: 'Africa/Cairo', city: 'Cairo', region: 'Africa' },
  { value: 'Africa/Johannesburg', city: 'Johannesburg', region: 'Africa' },
  { value: 'Africa/Lagos', city: 'Lagos', region: 'Africa' },
  { value: 'Africa/Nairobi', city: 'Nairobi', region: 'Africa' },
  { value: 'America/Chicago', city: 'Chicago', region: 'Americas' },
  { value: 'America/Denver', city: 'Denver', region: 'Americas' },
  { value: 'America/Los_Angeles', city: 'Los Angeles', region: 'Americas' },
  { value: 'America/Mexico_City', city: 'Mexico City', region: 'Americas' },
  { value: 'America/New_York', city: 'New York', region: 'Americas' },
  { value: 'America/Sao_Paulo', city: 'São Paulo', region: 'Americas' },
  { value: 'America/Toronto', city: 'Toronto', region: 'Americas' },
  { value: 'America/Vancouver', city: 'Vancouver', region: 'Americas' },
  { value: 'Asia/Bangkok', city: 'Bangkok', region: 'Asia' },
  { value: 'Asia/Dubai', city: 'Dubai', region: 'Asia' },
  { value: 'Asia/Hong_Kong', city: 'Hong Kong', region: 'Asia' },
  { value: 'Asia/Jakarta', city: 'Jakarta', region: 'Asia' },
  { value: 'Asia/Kolkata', city: 'Mumbai / Delhi', region: 'Asia' },
  { value: 'Asia/Seoul', city: 'Seoul', region: 'Asia' },
  { value: 'Asia/Shanghai', city: 'Shanghai', region: 'Asia' },
  { value: 'Asia/Singapore', city: 'Singapore', region: 'Asia' },
  { value: 'Asia/Tokyo', city: 'Tokyo', region: 'Asia' },
  { value: 'Australia/Melbourne', city: 'Melbourne', region: 'Pacific' },
  { value: 'Australia/Sydney', city: 'Sydney', region: 'Pacific' },
  { value: 'Europe/Amsterdam', city: 'Amsterdam', region: 'Europe' },
  { value: 'Europe/Berlin', city: 'Berlin', region: 'Europe' },
  { value: 'Europe/Istanbul', city: 'Istanbul', region: 'Europe' },
  { value: 'Europe/London', city: 'London', region: 'Europe' },
  { value: 'Europe/Madrid', city: 'Madrid', region: 'Europe' },
  { value: 'Europe/Paris', city: 'Paris', region: 'Europe' },
  { value: 'Europe/Rome', city: 'Rome', region: 'Europe' },
  { value: 'Europe/Stockholm', city: 'Stockholm', region: 'Europe' },
  { value: 'Europe/Zurich', city: 'Zurich', region: 'Europe' },
  { value: 'Pacific/Auckland', city: 'Auckland', region: 'Pacific' },
];

export function formatTimezoneOffset(timeZone: string, now = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    });
    const part = formatter.formatToParts(now).find((p) => p.type === 'timeZoneName');
    return part?.value ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

export function formatTimezoneLabel(option: TimezoneOption, now = new Date()): string {
  const offset = formatTimezoneOffset(option.value, now);
  if (option.city === 'UTC') return `UTC (${offset})`;
  return `${option.city} (${offset})`;
}

export function findTimezoneOption(value: string): TimezoneOption | undefined {
  return TIMEZONE_CATALOG.find((t) => t.value === value);
}

export function buildTimezoneOptions(extraValue?: string): TimezoneOption[] {
  if (!extraValue || findTimezoneOption(extraValue)) {
    return TIMEZONE_CATALOG;
  }
  return [
    { value: extraValue, city: extraValue.replace(/_/g, ' '), region: 'Other' },
    ...TIMEZONE_CATALOG,
  ];
}

/** @deprecated use TIMEZONE_CATALOG */
export const COMMON_TIMEZONES = TIMEZONE_CATALOG.map((t) => ({
  value: t.value,
  label: t.city,
}));
