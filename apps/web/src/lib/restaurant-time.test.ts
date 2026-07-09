import { describe, it, expect } from 'vitest';
import {
  formatServiceWindowLabel,
  isFullDayServiceWindow,
  mealPeriodForLocalHour,
  restaurantLocalHour,
} from './restaurant-time.js';
import {
  estimateCustomReservationFee,
  restaurantOffersCustomReservations,
} from './restaurant-display.js';

describe('restaurant-time', () => {
  it('formats service window in restaurant timezone', () => {
    const label = formatServiceWindowLabel(
      {
        open: '2026-07-15T15:00:00.000Z',
        close: '2026-07-16T02:00:00.000Z',
      },
      'America/New_York',
    );
    expect(label).toMatch(/11:00 AM/);
    expect(label).toMatch(/10:00 PM/);
  });

  it('detects 24-hour service windows', () => {
    expect(
      isFullDayServiceWindow(
        '2026-07-15T00:00:00.000Z',
        '2026-07-16T00:00:00.000Z',
      ),
    ).toBe(true);
  });

  it('groups meal periods from restaurant-local hour', () => {
    expect(mealPeriodForLocalHour(8)).toBe('breakfast');
    expect(mealPeriodForLocalHour(12)).toBe('lunch');
    expect(mealPeriodForLocalHour(19)).toBe('dinner');
    expect(mealPeriodForLocalHour(23)).toBe('late');
  });

  it('reads local hour in restaurant timezone', () => {
    const hour = restaurantLocalHour('2026-07-15T16:00:00.000Z', 'America/New_York');
    expect(hour).toBe(12);
  });
});

describe('restaurant-display', () => {
  it('detects custom reservation availability from fees', () => {
    expect(
      restaurantOffersCustomReservations({ customFee: '25', extraHourFee: null }),
    ).toBe(true);
    expect(
      restaurantOffersCustomReservations({ customFee: null, extraHourFee: null }),
    ).toBe(false);
  });

  it('estimates custom reservation fees', () => {
    const fee = estimateCustomReservationFee(
      { customFee: '25', extraHourFee: '10', feeCurrency: 'USD' },
      180,
      90,
    );
    expect(fee).toMatch(/\$45\.00/);
  });
});
