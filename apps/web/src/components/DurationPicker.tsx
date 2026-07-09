import type { PublicRestaurant } from '../types/api.js';
import {
  estimateCustomReservationFee,
  formatFee,
} from '../lib/restaurant-display.js';
import { formatRestaurantDateTime } from '../lib/restaurant-time.js';
import { estimateUntilCloseEndsAt } from '../lib/booking-availability.js';
import { Button } from './ui/Button.js';

export type DurationMode = 'standard' | 'extended' | 'untilClose';

interface DurationPickerProps {
  restaurant: PublicRestaurant;
  partySize: number;
  standardDurationMins: number;
  startsAt: string;
  serviceWindow: { open: string; close: string };
  mode: DurationMode;
  extraHours: number;
  onModeChange: (mode: DurationMode) => void;
  onExtraHoursChange: (hours: number) => void;
  onBack: () => void;
  onContinue: () => void;
}

const segmentClass = (selected: boolean) =>
  `rounded-lg border px-3 py-3 text-left text-sm transition min-h-[44px] ${
    selected
      ? 'border-brand-600 bg-brand-50 text-brand-800 ring-2 ring-brand-600 ring-offset-1'
      : 'border-gray-200 bg-white text-gray-800 hover:border-brand-300'
  }`;

export function DurationPicker({
  restaurant,
  partySize,
  standardDurationMins,
  startsAt,
  serviceWindow,
  mode,
  extraHours,
  onModeChange,
  onExtraHoursChange,
  onBack,
  onContinue,
}: DurationPickerProps) {
  const maxHours = Math.max(1, restaurant.maxExtraHours);
  const extendedDurationMins = standardDurationMins + extraHours * 60;
  const extendedFee = estimateCustomReservationFee(
    restaurant,
    extendedDurationMins,
    standardDurationMins,
  );
  const untilCloseEstimate = estimateUntilCloseEndsAt(
    startsAt,
    serviceWindow,
    standardDurationMins,
    restaurant.maxExtraHours,
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">How long do you need?</h3>
        <p className="mt-1 text-sm text-gray-500">
          Extra time fees are added to your bill at the restaurant — Maida never
          charges diners.
        </p>
      </div>

      <div
        className="grid gap-2 sm:grid-cols-1"
        role="radiogroup"
        aria-label="Reservation duration"
      >
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'standard'}
          className={segmentClass(mode === 'standard')}
          onClick={() => onModeChange('standard')}
        >
          <span className="font-medium">Standard</span>
          <span className="mt-0.5 block text-gray-600">
            ~{standardDurationMins} min for a party of {partySize}
          </span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={mode === 'extended'}
          className={segmentClass(mode === 'extended')}
          onClick={() => onModeChange('extended')}
        >
          <span className="font-medium">Add time</span>
          <span className="mt-0.5 block text-gray-600">
            Stay longer with whole extra hours (up to +{restaurant.maxExtraHours}h)
          </span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={mode === 'untilClose'}
          className={segmentClass(mode === 'untilClose')}
          onClick={() => onModeChange('untilClose')}
        >
          <span className="font-medium">Until close</span>
          <span className="mt-0.5 block text-gray-600">
            Hold the table as late as the restaurant allows
          </span>
        </button>
      </div>

      {mode === 'extended' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-900">Extra hours</p>
          <div className="mt-3 flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label="Remove one extra hour"
              disabled={extraHours <= 1}
              onClick={() => onExtraHoursChange(Math.max(1, extraHours - 1))}
            >
              −
            </Button>
            <span className="min-w-[4rem] text-center text-lg font-semibold" aria-live="polite">
              +{extraHours}h
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label="Add one extra hour"
              disabled={extraHours >= maxHours}
              onClick={() => onExtraHoursChange(Math.min(maxHours, extraHours + 1))}
            >
              +
            </Button>
          </div>
          <p className="mt-3 text-sm text-gray-700">
            +{extraHours}h
            {extendedFee ? (
              <>
                {' '}
                · adds ~{extendedFee} to your bill at the restaurant
              </>
            ) : (
              <>
                {' '}
                · no extra fee configured
                {formatFee(restaurant.customFee, restaurant.feeCurrency) && (
                  <> (base {formatFee(restaurant.customFee, restaurant.feeCurrency)} may still apply)</>
                )}
              </>
            )}
          </p>
        </div>
      )}

      {mode === 'untilClose' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <p>
            Reserved until approximately{' '}
            <span className="font-medium text-gray-900">
              {formatRestaurantDateTime(untilCloseEstimate, restaurant.timezone)}
            </span>
            , paid at the restaurant.
          </p>
          <p className="mt-2 text-xs text-gray-500">
            This is an estimate. Your table may end earlier if the restaurant has
            another reservation later that evening.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onContinue}>Continue to confirm</Button>
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}

export function durationModeLabel(
  mode: DurationMode,
  extraHours: number,
): string {
  if (mode === 'extended') {
    return `Extended by ${extraHours} hour${extraHours === 1 ? '' : 's'}`;
  }
  if (mode === 'untilClose') return 'Reserved until close';
  return 'Standard table time';
}
