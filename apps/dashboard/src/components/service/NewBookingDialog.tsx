import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '../../lib/api.js';
import type { OwnerReservation } from '../../types/api.js';
import {
  formatTimeInTz,
  restaurantTodayIso,
  zonedDateTimeToUtc,
} from '../../lib/restaurant-time.js';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { PartyStepper } from './PartyStepper.js';

/**
 * Phone booking: the host is holding a phone call, so the form reads top to
 * bottom in the order the conversation happens — name, party, when, notes.
 * A conflict (409) never dead-ends: the server's suggested time becomes a
 * one-tap "book that instead".
 */
export function NewBookingDialog({
  restaurantId,
  timezone,
  defaultDate,
  open,
  onClose,
}: {
  restaurantId: string;
  timezone: string;
  defaultDate: string;
  open: boolean;
  onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const [guestName, setGuestName] = useState('');
  const [partySize, setPartySize] = useState(2);
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('19:00');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const reset = (): void => {
    setGuestName('');
    setPartySize(2);
    setDate(defaultDate);
    setTime('19:00');
    setNotes('');
    setError(null);
    setSuggestion(null);
  };

  const mutation = useMutation({
    mutationFn: (startsAtIso: string) =>
      api.post<{ reservation: OwnerReservation }>(
        `/restaurants/${restaurantId}/reservations/staff`,
        {
          partySize,
          startsAt: startsAtIso,
          guestName: guestName.trim(),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      ),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({
        queryKey: ['service-reservations', restaurantId],
      });
      toast.success(
        `Booked — ${formatTimeInTz(res.reservation.startsAt, timezone)} for ${res.reservation.partySize}`,
        { duration: 3500 },
      );
      reset();
      onClose();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        const next = err.details?.['suggestedNextAvailableAt'];
        setSuggestion(typeof next === 'string' ? next : null);
        setError("That slot's already taken.");
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not create the booking. Try again.',
      );
    },
  });

  const submit = (): void => {
    setError(null);
    setSuggestion(null);
    if (!guestName.trim()) {
      setError('A guest name helps the floor recognise the party.');
      return;
    }
    const startsAt = zonedDateTimeToUtc(date, time, timezone);
    if (!startsAt) {
      setError('Enter a valid time (HH:MM).');
      return;
    }
    mutation.mutate(startsAt.toISOString());
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New booking"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          label="Guest name"
          value={guestName}
          maxLength={120}
          placeholder="e.g. Dubois"
          onChange={(e) => setGuestName(e.target.value)}
        />

        <div>
          <p className="mb-2 text-sm font-medium text-charcoal">Party size</p>
          <PartyStepper value={partySize} onChange={setPartySize} />
        </div>

        <div className="flex gap-3">
          <Input
            label="Date"
            type="date"
            value={date}
            min={restaurantTodayIso(timezone)}
            onChange={(e) => setDate(e.target.value)}
          />
          <Input
            label={`Time (${timezone.split('/').pop()?.replace('_', ' ') ?? 'local'})`}
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>

        <Input
          label="Notes (optional)"
          value={notes}
          maxLength={500}
          placeholder="Birthday, allergy, window seat…"
          onChange={(e) => setNotes(e.target.value)}
        />

        {error && (
          <div
            role="alert"
            className="rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-text"
          >
            {error}{' '}
            {suggestion && (
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                onClick={() => {
                  setError(null);
                  mutation.mutate(suggestion);
                }}
              >
                Book {formatTimeInTz(suggestion, timezone)} instead
              </button>
            )}
          </div>
        )}

        <Button type="submit" loading={mutation.isPending} className="w-full">
          Confirm booking
        </Button>
      </form>
    </Modal>
  );
}
