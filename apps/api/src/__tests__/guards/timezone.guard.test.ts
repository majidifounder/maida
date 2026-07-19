/**
 * INVARIANT GUARDS · Timestamp / Timezone Math
 *
 * Regression guards for INV-2 (docs/architecture/INVARIANTS.md). Pure — no
 * server, no DB.
 *
 * ⚠ KNOWN DEFECT — BACKLOG NEW-H1 (discovered while writing these guards):
 * `zonedTimeToUtc` (apps/api/src/lib/timezone.ts:52-57) double-subtracts the
 * zone offset. Its loop runs `utcMs -= offset(utcMs)` twice CUMULATIVELY, so
 * the result is wall-time − 2×offset instead of wall-time − offset:
 *
 *     Paris    2026-01-15 12:00 local → returns 10:00Z (correct: 11:00Z)
 *     New York 2026-01-15 12:00 local → returns 22:00Z (correct: 17:00Z)
 *     UTC      any                    → correct (offset 0 — why tests never saw it)
 *
 * Every consumer (service windows, closures, localDayBoundsUtc, engine day
 * scans) is shifted by one extra offset for non-UTC restaurants. Per protocol,
 * guards must not encode aspiration: the PASSING tests below pin only the
 * behavior that is genuinely correct today (UTC identity, determinism); the
 * SKIPPED tests encode the correct conversions and must be un-skipped in the
 * PR that fixes NEW-H1 (which must also assess existing rows + frontend).
 */
import { describe, it, expect } from 'vitest';
import {
  zonedTimeToUtc,
  localDayBoundsUtc,
  formatLocalDate,
  addLocalDays,
  isValidIanaTimezone,
} from '../../lib/timezone.js';

describe('INV-2 · verified-true timezone behavior', () => {
  it('UTC wall time converts identically (offset 0)', () => {
    expect(zonedTimeToUtc('2026-07-15', 12 * 60, 'UTC').toISOString()).toBe(
      '2026-07-15T12:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-01-15', 0, 'UTC').toISOString()).toBe(
      '2026-01-15T00:00:00.000Z',
    );
  });

  it('localDayBoundsUtc yields half-open 24h bounds for UTC', () => {
    const { start, end } = localDayBoundsUtc('2026-07-15', 'UTC');
    expect(start.toISOString()).toBe('2026-07-15T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-16T00:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(24 * 3600 * 1000);
  });

  it('DST spring-forward gap resolves deterministically without throwing (CI-G6)', () => {
    // 2026-03-29 02:30 does not exist in Europe/Paris. The two-pass loop must
    // return SOME instant, identically on every call — bookings shift, never
    // crash. (The absolute value is currently NEW-H1-shifted; determinism is
    // the invariant pinned here.)
    const a = zonedTimeToUtc('2026-03-29', 150, 'Europe/Paris');
    const b = zonedTimeToUtc('2026-03-29', 150, 'Europe/Paris');
    expect(a.toISOString()).toBe(b.toISOString());
    expect(Number.isNaN(a.getTime())).toBe(false);
  });

  it('formatLocalDate is the inverse of zonedTimeToUtc for UTC days', () => {
    const noon = zonedTimeToUtc('2026-02-03', 12 * 60, 'UTC');
    expect(formatLocalDate(noon, 'UTC')).toBe('2026-02-03');
    expect(addLocalDays('2026-02-28', 1, 'UTC')).toBe('2026-03-01');
  });

  it('isValidIanaTimezone accepts real zones and rejects junk', () => {
    expect(isValidIanaTimezone('Europe/Paris')).toBe(true);
    expect(isValidIanaTimezone('UTC')).toBe(true);
    expect(isValidIanaTimezone('Not/AZone')).toBe(false);
  });
});

describe('NEW-H1 — correct offset conversion (skipped until fixed, do not delete)', () => {
  // These encode the CORRECT wall-clock→UTC conversions. They fail today
  // because of the cumulative double subtraction (see file header). Un-skip
  // them in the PR that fixes NEW-H1.
  it.skip('NEW-H1: Paris winter noon → 11:00Z', () => {
    expect(zonedTimeToUtc('2026-01-15', 12 * 60, 'Europe/Paris').toISOString()).toBe(
      '2026-01-15T11:00:00.000Z',
    );
  });

  it.skip('NEW-H1: Paris summer noon → 10:00Z (DST honored once, not twice)', () => {
    expect(zonedTimeToUtc('2026-07-15', 12 * 60, 'Europe/Paris').toISOString()).toBe(
      '2026-07-15T10:00:00.000Z',
    );
  });

  it.skip('NEW-H1: New York winter noon → 17:00Z (negative offsets too)', () => {
    expect(zonedTimeToUtc('2026-01-15', 12 * 60, 'America/New_York').toISOString()).toBe(
      '2026-01-15T17:00:00.000Z',
    );
  });

  it.skip('NEW-H1: localDayBoundsUtc spans exactly the local day for non-UTC zones', () => {
    const { start, end } = localDayBoundsUtc('2026-01-15', 'Europe/Paris');
    expect(start.toISOString()).toBe('2026-01-14T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-15T23:00:00.000Z');
  });
});
