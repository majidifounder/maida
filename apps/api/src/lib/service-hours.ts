/** Shared service-hours conventions (minutes from local midnight). */

export const OPEN_24H_OPEN_MINUTES = 0;
export const OPEN_24H_CLOSE_MINUTES = 1440;

export function isOpen24Hours(openMinutes: number, closeMinutes: number): boolean {
  return openMinutes === OPEN_24H_OPEN_MINUTES && closeMinutes === OPEN_24H_CLOSE_MINUTES;
}

export function validateServiceHours(
  openMinutes: number | undefined,
  closeMinutes: number | undefined,
): string | null {
  if (openMinutes === undefined || closeMinutes === undefined) return null;
  if (isOpen24Hours(openMinutes, closeMinutes)) return null;
  if (closeMinutes <= openMinutes) {
    return 'Close time must be after open time, or enable "Open 24 hours".';
  }
  return null;
}

export function formatServiceHoursLabel(openMinutes: number, closeMinutes: number): string {
  if (isOpen24Hours(openMinutes, closeMinutes)) return '24 hours';
  const h1 = Math.floor(openMinutes / 60);
  const m1 = openMinutes % 60;
  const h2 = Math.floor(closeMinutes / 60);
  const m2 = closeMinutes % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h1)}:${pad(m1)} – ${pad(h2)}:${pad(m2)}`;
}
