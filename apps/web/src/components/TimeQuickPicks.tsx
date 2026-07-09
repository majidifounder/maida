import type { AvailabilityTime } from '../types/api.js';
import type { ScannedSlot } from '../lib/booking-availability.js';
import {
  formatQuickPickWhen,
  formatRestaurantTime,
  MEAL_PERIOD_LABELS,
  MEAL_PERIOD_ORDER,
  mealPeriodForLocalHour,
  restaurantLocalHour,
  type MealPeriod,
} from '../lib/restaurant-time.js';
import { Button } from './ui/Button.js';
import { Input } from './ui/Input.js';
import { Spinner } from './ui/Spinner.js';

const chipClass = (selected: boolean) =>
  `min-h-[44px] rounded-lg border px-4 py-2.5 text-sm font-medium transition ${
    selected
      ? 'border-brand-600 bg-brand-50 text-brand-800 ring-2 ring-brand-600 ring-offset-1'
      : 'border-gray-200 bg-white text-gray-800 hover:border-brand-300'
  }`;

interface TimeQuickPicksProps {
  timeZone: string;
  isLoading: boolean;
  showSpecificPicker: boolean;
  onToggleSpecificPicker: (show: boolean) => void;
  nextAvailable: ScannedSlot | null;
  in30Min: ScannedSlot | null;
  tonight: ScannedSlot | null;
  tomorrowSameTime: ScannedSlot | null;
  selectedSlot: AvailabilityTime | null;
  onSelectSlot: (entry: ScannedSlot) => void;
  onContinue: () => void;
  onBack: () => void;
  pickerDate: string;
  onPickerDateChange: (date: string) => void;
  minDate: string;
  pickerTimes: AvailabilityTime[];
  pickerServiceWindow: { open: string; close: string } | null;
  pickerStandardDurationMins: number;
  pickerLoading: boolean;
}

function groupTimesByMealPeriod(
  times: AvailabilityTime[],
  timeZone: string,
): Partial<Record<MealPeriod, AvailabilityTime[]>> {
  const groups: Partial<Record<MealPeriod, AvailabilityTime[]>> = {};
  for (const slot of times) {
    const period = mealPeriodForLocalHour(restaurantLocalHour(slot.startsAt, timeZone));
    groups[period] ??= [];
    groups[period].push(slot);
  }
  return groups;
}

export function TimeQuickPicks({
  timeZone,
  isLoading,
  showSpecificPicker,
  onToggleSpecificPicker,
  nextAvailable,
  in30Min,
  tonight,
  tomorrowSameTime,
  selectedSlot,
  onSelectSlot,
  onContinue,
  onBack,
  pickerDate,
  onPickerDateChange,
  minDate,
  pickerTimes,
  pickerServiceWindow,
  pickerStandardDurationMins,
  pickerLoading,
}: TimeQuickPicksProps) {
  const groupedPickerTimes = groupTimesByMealPeriod(pickerTimes, timeZone);

  const chips: Array<{ key: string; label: string; entry: ScannedSlot; ariaLabel: string }> =
    [];
  if (in30Min && in30Min.slot.startsAt !== nextAvailable?.slot.startsAt) {
    chips.push({
      key: '30min',
      label: 'In 30 min',
      entry: in30Min,
      ariaLabel: `Reserve in 30 minutes at ${formatRestaurantTime(in30Min.slot.startsAt, timeZone)}`,
    });
  }
  if (tonight) {
    chips.push({
      key: 'tonight',
      label: 'Tonight',
      entry: tonight,
      ariaLabel: `Reserve tonight at ${formatRestaurantTime(tonight.slot.startsAt, timeZone)}`,
    });
  }
  if (tomorrowSameTime) {
    chips.push({
      key: 'tomorrow',
      label: 'Tomorrow, same time',
      entry: tomorrowSameTime,
      ariaLabel: `Reserve tomorrow around ${formatRestaurantTime(tomorrowSameTime.slot.startsAt, timeZone)}`,
    });
  }

  return (
    <div className="space-y-6">
      {isLoading && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}

      {!isLoading && (
        <>
          {nextAvailable && (
            <Button
              className="w-full min-h-[48px] text-base"
              onClick={() => onSelectSlot(nextAvailable)}
              aria-label={`Next available reservation at ${formatQuickPickWhen(nextAvailable.slot.startsAt, timeZone)}`}
            >
              Next available — {formatQuickPickWhen(nextAvailable.slot.startsAt, timeZone)}
            </Button>
          )}

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.slice(0, 3).map((chip) => {
                const selected = selectedSlot?.startsAt === chip.entry.slot.startsAt;
                return (
                  <button
                    key={chip.key}
                    type="button"
                    aria-label={chip.ariaLabel}
                    className={chipClass(selected)}
                    onClick={() => onSelectSlot(chip.entry)}
                  >
                    {chip.label}
                    <span className="ml-1 text-gray-600">
                      · {formatRestaurantTime(chip.entry.slot.startsAt, timeZone)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {!nextAvailable && chips.length === 0 && !showSpecificPicker && (
            <p className="text-sm text-gray-500">
              No quick times available — pick a specific date below.
            </p>
          )}

          <button
            type="button"
            className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
            onClick={() => onToggleSpecificPicker(!showSpecificPicker)}
          >
            {showSpecificPicker ? 'Hide specific times' : 'Pick a specific time'}
          </button>
        </>
      )}

      {showSpecificPicker && (
        <div className="space-y-4 border-t border-gray-100 pt-4">
          <div className="w-full max-w-xs">
            <Input
              label="Date"
              type="date"
              value={pickerDate}
              min={minDate}
              onChange={(e) => onPickerDateChange(e.target.value)}
            />
          </div>

          {pickerLoading && (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          )}

          {!pickerLoading && pickerTimes.length === 0 && (
            <p className="text-sm text-gray-500">
              No tables available for this date and party size. Try another date.
            </p>
          )}

          {!pickerLoading && pickerTimes.length > 0 && pickerServiceWindow && (
            <div className="space-y-6">
              {MEAL_PERIOD_ORDER.filter((p) => groupedPickerTimes[p]?.length).map(
                (period) => (
                  <div key={period}>
                    <h3 className="mb-2 text-sm font-semibold text-gray-700">
                      {MEAL_PERIOD_LABELS[period]}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {groupedPickerTimes[period]!.map((slot) => {
                        const selected = selectedSlot?.startsAt === slot.startsAt;
                        return (
                          <button
                            key={slot.startsAt}
                            type="button"
                            aria-label={`Reserve at ${formatRestaurantTime(slot.startsAt, timeZone)}`}
                            onClick={() =>
                              onSelectSlot({
                                slot,
                                date: pickerDate,
                                standardDurationMins: pickerStandardDurationMins,
                                serviceWindow: pickerServiceWindow,
                              })
                            }
                            className={chipClass(selected)}
                          >
                            {formatRestaurantTime(slot.startsAt, timeZone)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button disabled={!selectedSlot} onClick={onContinue}>
          Continue
        </Button>
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}
