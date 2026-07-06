import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '../../lib/api.js';
import type { OwnerRestaurant, SeatingMode } from '../../types/api.js';
import {
  COMMON_TIMEZONES,
  formatServiceWindow,
  minutesToTimeInput,
  resolveTimezone,
  timeInputToMinutes,
} from '../../lib/restaurant-time.js';
import { useOwnerPlan } from '../../hooks/useOwnerPlan.js';
import { Card } from '../ui/Card.js';
import { Input, Select } from '../ui/Input.js';
import { Button } from '../ui/Button.js';
import { PlanGateNotice } from '../PlanGateNotice.js';
import { SeatingModeChoice } from './SeatingModeChoice.js';

interface ReservationConfigPanelProps {
  restaurantId: string;
  config: OwnerRestaurant;
}

export function ReservationConfigPanel({
  restaurantId,
  config,
}: ReservationConfigPanelProps) {
  const queryClient = useQueryClient();
  const { limits } = useOwnerPlan();

  const [timezone, setTimezone] = useState(config.timezone);
  const [seatingMode, setSeatingMode] = useState<SeatingMode>(config.seatingMode);
  const [openTime, setOpenTime] = useState(minutesToTimeInput(config.openMinutes));
  const [closeTime, setCloseTime] = useState(minutesToTimeInput(config.closeMinutes));
  const [defaultDurationMins, setDefaultDurationMins] = useState(
    String(config.defaultDurationMins),
  );
  const [customFee, setCustomFee] = useState(config.customFee ?? '');
  const [extraHourFee, setExtraHourFee] = useState(config.extraHourFee ?? '');
  const [feeCurrency, setFeeCurrency] = useState(config.feeCurrency);

  useEffect(() => {
    setTimezone(config.timezone);
    setSeatingMode(config.seatingMode);
    setOpenTime(minutesToTimeInput(config.openMinutes));
    setCloseTime(minutesToTimeInput(config.closeMinutes));
    setDefaultDurationMins(String(config.defaultDurationMins));
    setCustomFee(config.customFee ?? '');
    setExtraHourFee(config.extraHourFee ?? '');
    setFeeCurrency(config.feeCurrency);
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const openMinutes = timeInputToMinutes(openTime);
      const closeMinutes = timeInputToMinutes(closeTime);
      const duration = Number(defaultDurationMins);

      if (openMinutes === null || closeMinutes === null) {
        throw new ApiError(422, 'Enter valid open and close times (HH:MM).');
      }
      if (closeMinutes <= openMinutes) {
        throw new ApiError(422, 'Close time must be after open time.');
      }
      if (!Number.isInteger(duration) || duration < 15 || duration > 720) {
        throw new ApiError(422, 'Default duration must be between 15 and 720 minutes.');
      }

      const body: Record<string, unknown> = {
        timezone: resolveTimezone(timezone),
        seatingMode: limits.flexibleSeating ? seatingMode : 'LOCKED',
        openMinutes,
        closeMinutes,
        defaultDurationMins: duration,
      };
      if (!feesLocked) {
        body.customFee = customFee.trim() === '' ? null : Number(customFee);
        body.extraHourFee = extraHourFee.trim() === '' ? null : Number(extraHourFee);
        body.feeCurrency = feeCurrency;
      }
      return api.patch<{ config: OwnerRestaurant }>(
        `/restaurants/${restaurantId}/reservation-config`,
        body,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['restaurant-config', restaurantId] });
      toast.success('Reservation settings saved');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Could not save settings');
    },
  });

  const feesLocked = !limits.customReservations;

  return (
    <Card>
      <h2 className="mb-1 text-xl font-semibold">Reservation settings</h2>
      <p className="mb-6 text-sm text-gray-500">
        Controls how availability is calculated and how long guests stay at a table.
        Current service window:{' '}
        <strong>{formatServiceWindow(config.openMinutes, config.closeMinutes)}</strong>{' '}
        ({config.timezone}).
      </p>

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
        <Select
          label="Timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        >
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </Select>

        <SeatingModeChoice value={seatingMode} onChange={setSeatingMode} />

        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Opens at"
            type="time"
            value={openTime}
            onChange={(e) => setOpenTime(e.target.value)}
          />
          <Input
            label="Closes at"
            type="time"
            value={closeTime}
            onChange={(e) => setCloseTime(e.target.value)}
          />
          <Input
            label="Default duration (minutes)"
            type="number"
            min={15}
            max={720}
            value={defaultDurationMins}
            onChange={(e) => setDefaultDurationMins(e.target.value)}
          />
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h3 className="text-sm font-semibold text-gray-900">
            Custom reservation fees (informational only)
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Shown to diners when custom-length reservations are offered. Paid at your
            restaurant — Maida never collects these fees.
          </p>

          {feesLocked ? (
            <div className="mt-3">
              <PlanGateNotice message="Custom reservation fees and custom-length bookings require a Pro or Premium plan." />
            </div>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Input
                label="Flat custom fee"
                type="number"
                min={0}
                step="0.01"
                value={customFee}
                onChange={(e) => setCustomFee(e.target.value)}
                placeholder="Optional"
              />
              <Input
                label="Extra hour rate"
                type="number"
                min={0}
                step="0.01"
                value={extraHourFee}
                onChange={(e) => setExtraHourFee(e.target.value)}
                placeholder="Optional"
              />
              <Input
                label="Currency"
                maxLength={3}
                value={feeCurrency}
                onChange={(e) => setFeeCurrency(e.target.value.toUpperCase())}
              />
            </div>
          )}
        </div>

        <Button type="submit" loading={saveMutation.isPending}>
          Save reservation settings
        </Button>
      </form>
    </Card>
  );
}
