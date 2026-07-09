import { describe, it, expect } from 'vitest';
import {
  computeQuickPicks,
  findEarliestSlotAfter,
  flattenScannedSlots,
  type DayAvailability,
} from './booking-availability.js';
import { restaurantOffersCustomReservations } from './restaurant-display.js';

const TZ = 'UTC';

function day(date: string, times: string[], standard = 90): DayAvailability {
  return {
    date,
    standardDurationMins: standard,
    serviceWindow: {
      open: `${date}T11:00:00.000Z`,
      close: `${date}T23:00:00.000Z`,
    },
    times: times.map((startsAt) => ({
      startsAt,
      endsAt: startsAt,
      durationMins: standard,
    })),
  };
}

describe('booking-availability', () => {
  it('finds earliest slot after a threshold', () => {
    const slots = flattenScannedSlots([
      day('2026-08-01', ['2026-08-01T18:00:00.000Z', '2026-08-01T19:00:00.000Z']),
    ]);
    const found = findEarliestSlotAfter(
      slots,
      new Date('2026-08-01T18:30:00.000Z'),
    );
    expect(found?.slot.startsAt).toBe('2026-08-01T19:00:00.000Z');
  });

  it('computes next available and in-30-min picks', () => {
    const now = new Date('2026-08-01T17:00:00.000Z');
    const slots = flattenScannedSlots([
      day('2026-08-01', [
        '2026-08-01T17:15:00.000Z',
        '2026-08-01T17:45:00.000Z',
        '2026-08-01T12:00:00.000Z',
        '2026-08-01T19:00:00.000Z',
      ]),
    ]);
    const picks = computeQuickPicks(slots, TZ, null, now);
    expect(picks.nextAvailable?.slot.startsAt).toBe('2026-08-01T17:15:00.000Z');
    expect(picks.in30Min?.slot.startsAt).toBe('2026-08-01T17:45:00.000Z');
    expect(picks.tonight?.slot.startsAt).toBe('2026-08-01T17:15:00.000Z');
  });

  it('detects when custom reservations are unavailable from fees', () => {
    expect(
      restaurantOffersCustomReservations({ customFee: null, extraHourFee: null }),
    ).toBe(false);
    expect(
      restaurantOffersCustomReservations({ customFee: '10', extraHourFee: null }),
    ).toBe(true);
  });
});
