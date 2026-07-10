import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '../../lib/api.js';
import type { RestaurantSchedule } from '../../types/api.js';
import { minutesToTimeInput, timeInputToMinutes } from '../../lib/restaurant-time.js';
import { Card } from '../ui/Card.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { Spinner } from '../ui/Spinner.js';

interface WeeklySchedulePanelProps {
  restaurantId: string;
  timezone: string;
}

/** Editable window; times as HH:MM strings for the inputs. */
interface EditableWindow {
  open: string;
  close: string;
}

/** Monday-first display order over API dayOfWeek (0 = Sunday). */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function minutesToCloseInput(minutes: number): string {
  // 1440 (end of day) renders as midnight.
  return minutes >= 1440 ? '00:00' : minutesToTimeInput(minutes);
}

/**
 * Close input → closeMinute. "00:00" means midnight: when it would otherwise
 * equal the open time (or precede it), the API's overnight convention
 * (closeMinute <= openMinute) applies naturally — EXCEPT the exact value 0 is
 * invalid (min 1), so plain midnight becomes 1440 (end of the same day).
 */
function closeInputToMinutes(value: string): number | null {
  const mins = timeInputToMinutes(value);
  if (mins === null) return null;
  return mins === 0 ? 1440 : mins;
}

function isOvernight(w: EditableWindow): boolean {
  const open = timeInputToMinutes(w.open);
  const close = closeInputToMinutes(w.close);
  if (open === null || close === null) return false;
  return close !== 1440 && close <= open;
}

function schedToEditable(
  periods: RestaurantSchedule['periods'],
): Record<number, EditableWindow[]> {
  const byDay: Record<number, EditableWindow[]> = {};
  for (let d = 0; d <= 6; d++) byDay[d] = [];
  for (const p of [...periods].sort((a, b) => a.openMinute - b.openMinute)) {
    byDay[p.dayOfWeek]!.push({
      open: minutesToTimeInput(p.openMinute),
      close: minutesToCloseInput(p.closeMinute),
    });
  }
  return byDay;
}

export function WeeklySchedulePanel({
  restaurantId,
  timezone,
}: WeeklySchedulePanelProps): ReactNode {
  const queryClient = useQueryClient();

  const scheduleQuery = useQuery({
    queryKey: ['restaurant-schedule', restaurantId],
    queryFn: () =>
      api
        .get<{ schedule: RestaurantSchedule }>(
          `/restaurants/${restaurantId}/schedule`,
        )
        .then((r) => r.schedule),
  });

  const [byDay, setByDay] = useState<Record<number, EditableWindow[]>>({});
  const [dirty, setDirty] = useState(false);
  const [closureDate, setClosureDate] = useState('');
  const [closureReason, setClosureReason] = useState('');

  useEffect(() => {
    if (scheduleQuery.data && !dirty) {
      setByDay(schedToEditable(scheduleQuery.data.periods));
    }
  }, [scheduleQuery.data, dirty]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const periods: Array<{
        dayOfWeek: number;
        openMinute: number;
        closeMinute: number;
      }> = [];
      for (let day = 0; day <= 6; day++) {
        for (const w of byDay[day] ?? []) {
          const openMinute = timeInputToMinutes(w.open);
          const closeMinute = closeInputToMinutes(w.close);
          if (openMinute === null || closeMinute === null) {
            throw new ApiError(
              422,
              `${DAY_NAMES[day]}: enter valid times (HH:MM).`,
            );
          }
          periods.push({ dayOfWeek: day, openMinute, closeMinute });
        }
      }
      return api.put<{ schedule: RestaurantSchedule }>(
        `/restaurants/${restaurantId}/schedule`,
        { periods },
      );
    },
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({
        queryKey: ['restaurant-schedule', restaurantId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['restaurant-config', restaurantId],
      });
      toast.success('Weekly schedule saved');
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof ApiError ? err.message : 'Could not save the schedule',
      );
    },
  });

  const addClosureMutation = useMutation({
    mutationFn: () =>
      api.post(`/restaurants/${restaurantId}/closures`, {
        date: closureDate,
        ...(closureReason.trim() ? { reason: closureReason.trim() } : {}),
      }),
    onSuccess: () => {
      setClosureDate('');
      setClosureReason('');
      void queryClient.invalidateQueries({
        queryKey: ['restaurant-schedule', restaurantId],
      });
      toast.success('Closure added');
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof ApiError && err.status === 409
          ? 'That date is already marked as closed.'
          : err instanceof ApiError
            ? err.message
            : 'Could not add the closure',
      );
    },
  });

  const deleteClosureMutation = useMutation({
    mutationFn: (closureId: string) =>
      api.delete(`/restaurants/${restaurantId}/closures/${closureId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['restaurant-schedule', restaurantId],
      });
      toast.success('Closure removed');
    },
    onError: () => toast.error('Could not remove the closure'),
  });

  const updateWindow = (
    day: number,
    index: number,
    patch: Partial<EditableWindow>,
  ): void => {
    setDirty(true);
    setByDay((prev) => ({
      ...prev,
      [day]: (prev[day] ?? []).map((w, i) =>
        i === index ? { ...w, ...patch } : w,
      ),
    }));
  };

  const addWindow = (day: number): void => {
    setDirty(true);
    setByDay((prev) => {
      const existing = prev[day] ?? [];
      const defaults: EditableWindow =
        existing.length === 0
          ? { open: '11:00', close: '23:00' }
          : { open: '18:00', close: '23:00' };
      return { ...prev, [day]: [...existing, defaults] };
    });
  };

  const removeWindow = (day: number, index: number): void => {
    setDirty(true);
    setByDay((prev) => ({
      ...prev,
      [day]: (prev[day] ?? []).filter((_, i) => i !== index),
    }));
  };

  const copyToAllDays = (day: number): void => {
    setDirty(true);
    setByDay((prev) => {
      const source = (prev[day] ?? []).map((w) => ({ ...w }));
      const next: Record<number, EditableWindow[]> = {};
      for (let d = 0; d <= 6; d++) next[d] = source.map((w) => ({ ...w }));
      return next;
    });
  };

  if (scheduleQuery.isLoading) {
    return (
      <Card>
        <h2 className="mb-4 text-xl font-semibold">Opening hours</h2>
        <Spinner />
      </Card>
    );
  }

  const closures = scheduleQuery.data?.closures ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const upcomingClosures = closures.filter((c) => c.date >= today);

  return (
    <Card>
      <h2 className="mb-1 text-xl font-semibold">Opening hours</h2>
      <p className="mb-6 text-sm text-gray-500">
        Per-day service windows in the restaurant&apos;s timezone ({timezone}).
        Days without windows are closed for online bookings. A window ending at
        or before its start time runs past midnight (e.g. 18:00 – 02:00).
      </p>

      <div className="space-y-3">
        {DAY_ORDER.map((day) => {
          const windows = byDay[day] ?? [];
          return (
            <div
              key={day}
              className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 sm:flex-row sm:items-start"
            >
              <div className="w-28 shrink-0 pt-1.5 text-sm font-medium text-gray-900">
                {DAY_NAMES[day]}
              </div>
              <div className="flex-1 space-y-2">
                {windows.length === 0 && (
                  <p className="pt-1.5 text-sm text-gray-400">Closed</p>
                )}
                {windows.map((w, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input
                      type="time"
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={w.open}
                      onChange={(e) =>
                        updateWindow(day, i, { open: e.target.value })
                      }
                      aria-label={`${DAY_NAMES[day]} window ${i + 1} opens`}
                    />
                    <span className="text-sm text-gray-500">–</span>
                    <input
                      type="time"
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={w.close}
                      onChange={(e) =>
                        updateWindow(day, i, { close: e.target.value })
                      }
                      aria-label={`${DAY_NAMES[day]} window ${i + 1} closes`}
                    />
                    {isOvernight(w) && (
                      <span className="rounded bg-fog px-2 py-0.5 text-xs text-charcoal">
                        past midnight
                      </span>
                    )}
                    <button
                      type="button"
                      className="text-sm text-gray-400 hover:text-red-600"
                      onClick={() => removeWindow(day, i)}
                      aria-label={`Remove ${DAY_NAMES[day]} window ${i + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="text-sm font-medium text-ink underline-offset-2 hover:underline"
                    onClick={() => addWindow(day)}
                  >
                    + Add hours
                  </button>
                  {windows.length > 0 && (
                    <button
                      type="button"
                      className="text-sm text-gray-500 hover:text-gray-700"
                      onClick={() => copyToAllDays(day)}
                    >
                      Copy to all days
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          onClick={() => saveMutation.mutate()}
          loading={saveMutation.isPending}
          disabled={!dirty}
        >
          Save weekly schedule
        </Button>
        {dirty && (
          <span className="text-sm text-amber-600">Unsaved changes</span>
        )}
      </div>

      <div className="mt-8 border-t border-gray-200 pt-6">
        <h3 className="text-sm font-semibold text-gray-900">
          Closed dates (holidays, private events)
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          No online bookings will start on these dates.
        </p>

        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (closureDate) addClosureMutation.mutate();
          }}
        >
          <Input
            label="Date"
            type="date"
            value={closureDate}
            min={today}
            onChange={(e) => setClosureDate(e.target.value)}
          />
          <Input
            label="Reason (optional)"
            value={closureReason}
            maxLength={200}
            placeholder="e.g. Christmas Day"
            onChange={(e) => setClosureReason(e.target.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            loading={addClosureMutation.isPending}
            disabled={!closureDate}
          >
            Add closure
          </Button>
        </form>

        {upcomingClosures.length > 0 && (
          <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {upcomingClosures.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{c.date}</span>
                  {c.reason && (
                    <span className="ml-2 text-gray-500">{c.reason}</span>
                  )}
                </span>
                <button
                  type="button"
                  className="text-gray-400 hover:text-red-600"
                  onClick={() => deleteClosureMutation.mutate(c.id)}
                  aria-label={`Remove closure on ${c.date}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
