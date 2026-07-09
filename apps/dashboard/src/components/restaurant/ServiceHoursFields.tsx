import { Input } from '../ui/Input.js';
import {
  isOpen24Hours,
  OPEN_24H_CLOSE_MINUTES,
  OPEN_24H_OPEN_MINUTES,
  timeInputToMinutes,
} from '../../lib/restaurant-time.js';

interface ServiceHoursFieldsProps {
  openTime: string;
  closeTime: string;
  defaultDurationMins: string;
  open24Hours: boolean;
  onOpenTimeChange: (value: string) => void;
  onCloseTimeChange: (value: string) => void;
  onDefaultDurationChange: (value: string) => void;
  onOpen24HoursChange: (value: boolean) => void;
  durationLabel?: string;
}

export function validateServiceHoursInput(
  openTime: string,
  closeTime: string,
  open24Hours: boolean,
): string | null {
  if (open24Hours) return null;
  const openMinutes = timeInputToMinutes(openTime);
  const closeMinutes = timeInputToMinutes(closeTime);
  if (openMinutes === null || closeMinutes === null) {
    return 'Enter valid open and close times (HH:MM), or enable "Open 24 hours".';
  }
  if (closeMinutes <= openMinutes) {
    return 'Close time must be after open time, or enable "Open 24 hours".';
  }
  return null;
}

export function resolveServiceHoursPayload(
  openTime: string,
  closeTime: string,
  open24Hours: boolean,
): { openMinutes: number; closeMinutes: number } | null {
  if (open24Hours) {
    return { openMinutes: OPEN_24H_OPEN_MINUTES, closeMinutes: OPEN_24H_CLOSE_MINUTES };
  }
  const openMinutes = timeInputToMinutes(openTime);
  const closeMinutes = timeInputToMinutes(closeTime);
  if (openMinutes === null || closeMinutes === null) return null;
  if (closeMinutes <= openMinutes) return null;
  return { openMinutes, closeMinutes };
}

export function isRestaurantOpen24Hours(openMinutes: number, closeMinutes: number): boolean {
  return isOpen24Hours(openMinutes, closeMinutes);
}

export function ServiceHoursFields({
  openTime,
  closeTime,
  defaultDurationMins,
  open24Hours,
  onOpenTimeChange,
  onCloseTimeChange,
  onDefaultDurationChange,
  onOpen24HoursChange,
  durationLabel = 'Default table turn (minutes)',
}: ServiceHoursFieldsProps) {
  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={open24Hours}
          onChange={(e) => onOpen24HoursChange(e.target.checked)}
          className="rounded border-gray-300 text-brand focus:ring-brand"
        />
        Open 24 hours (midnight to midnight, local time)
      </label>

      {!open24Hours && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Opens at"
            type="time"
            value={openTime}
            onChange={(e) => onOpenTimeChange(e.target.value)}
          />
          <Input
            label="Closes at"
            type="time"
            value={closeTime}
            onChange={(e) => onCloseTimeChange(e.target.value)}
          />
        </div>
      )}

      <Input
        label={durationLabel}
        type="number"
        min={15}
        max={720}
        value={defaultDurationMins}
        onChange={(e) => onDefaultDurationChange(e.target.value)}
      />
      <p className="text-xs text-gray-500">
        Used when no turn-time rule matches a party size. Turn-time rules override this
        for specific party sizes.
      </p>
    </div>
  );
}
