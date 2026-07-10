import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '../../lib/api.js';
import type { OwnerRestaurant, SeatingMode } from '../../types/api.js';
import { resolveTimezone } from '../../lib/restaurant-time.js';
import { useOwnerPlan } from '../../hooks/useOwnerPlan.js';
import { Card } from '../ui/Card.js';
import { Input } from '../ui/Input.js';
import { Button } from '../ui/Button.js';
import { PlanGateNotice } from '../PlanGateNotice.js';
import { SeatingModeChoice } from './SeatingModeChoice.js';
import { TimezonePicker } from './TimezonePicker.js';

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
  const [defaultDurationMins, setDefaultDurationMins] = useState(
    String(config.defaultDurationMins),
  );
  const [customFee, setCustomFee] = useState(config.customFee ?? '');
  const [extraHourFee, setExtraHourFee] = useState(config.extraHourFee ?? '');
  const [feeCurrency, setFeeCurrency] = useState(config.feeCurrency);
  const [maxExtraHours, setMaxExtraHours] = useState(String(config.maxExtraHours ?? 2));

  useEffect(() => {
    setTimezone(config.timezone);
    setSeatingMode(config.seatingMode);
    setDefaultDurationMins(String(config.defaultDurationMins));
    setCustomFee(config.customFee ?? '');
    setExtraHourFee(config.extraHourFee ?? '');
    setFeeCurrency(config.feeCurrency);
    setMaxExtraHours(String(config.maxExtraHours ?? 2));
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const duration = Number(defaultDurationMins);
      if (!Number.isInteger(duration) || duration < 15 || duration > 720) {
        throw new ApiError(422, 'Default table turn must be between 15 and 720 minutes.');
      }

      // NOTE: openMinutes/closeMinutes are deliberately NOT sent here — the
      // server resets the weekly schedule to a uniform one whenever they are
      // included. Opening hours are managed by the WeeklySchedulePanel.
      const body: Record<string, unknown> = {
        timezone: resolveTimezone(timezone),
        seatingMode: limits.flexibleSeating ? seatingMode : 'LOCKED',
        defaultDurationMins: duration,
      };
      if (!feesLocked) {
        body.customFee = customFee.trim() === '' ? null : Number(customFee);
        body.extraHourFee = extraHourFee.trim() === '' ? null : Number(extraHourFee);
        body.feeCurrency = feeCurrency;
        const extraHours = Number(maxExtraHours);
        if (!Number.isInteger(extraHours) || extraHours < 0 || extraHours > 6) {
          throw new ApiError(422, 'Maximum extra time must be between 0 and 6 hours.');
        }
        body.maxExtraHours = extraHours;
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
        Controls how availability is calculated and how long guests stay at a
        table. Opening hours are managed in the &ldquo;Opening hours&rdquo;
        panel below.
      </p>

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
        <TimezonePicker value={timezone} onChange={setTimezone} />

        <SeatingModeChoice value={seatingMode} onChange={setSeatingMode} />

        <div className="max-w-xs">
          <Input
            label="Default table turn (minutes)"
            type="number"
            min={15}
            max={720}
            step={15}
            value={defaultDurationMins}
            onChange={(e) => setDefaultDurationMins(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-500">
            Used when no party-size turn-time rule matches (15–720 minutes).
          </p>
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
              <PlanGateNotice message="Custom reservation fees and custom-length bookings need a Pro or Premium plan. Upgrade on Billing to offer them." />
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

          {!feesLocked && (
            <div className="mt-4">
              <Input
                label="Maximum extra time diners can add (hours)"
                type="number"
                min={0}
                max={6}
                step={1}
                value={maxExtraHours}
                onChange={(e) => setMaxExtraHours(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">
                Applies to extended and reserve-until-close bookings (0–6 hours).
              </p>
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
