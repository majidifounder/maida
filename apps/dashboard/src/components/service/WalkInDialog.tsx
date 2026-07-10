import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '../../lib/api.js';
import type { OwnerReservation } from '../../types/api.js';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { PartyStepper } from './PartyStepper.js';

/**
 * Walk-in: the highest-pressure moment in the product — a party is standing at
 * the stand. One required decision (party size, prefilled to 2), everything
 * else optional. Submit seats them immediately; the row appears in "Seated
 * now" before the guests reach the table.
 */
export function WalkInDialog({
  restaurantId,
  open,
  onClose,
}: {
  restaurantId: string;
  open: boolean;
  onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const [partySize, setPartySize] = useState(2);
  const [guestName, setGuestName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setPartySize(2);
    setGuestName('');
    setError(null);
  };

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ reservation: OwnerReservation }>(
        `/restaurants/${restaurantId}/reservations/walk-in`,
        {
          partySize,
          guestName: guestName.trim() || 'Walk-in',
        },
      ),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({
        queryKey: ['service-reservations', restaurantId],
      });
      const tables = res.reservation.tables
        .map((t) => t.table.name)
        .join(' + ');
      toast.success(
        tables ? `Seated at ${tables}` : 'Party seated',
        { duration: 3500 },
      );
      reset();
      onClose();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        setError(
          'No table is free for this party right now. Free a table or adjust the party size.',
        );
        return;
      }
      setError(
        err instanceof ApiError ? err.message : 'Could not seat the party. Try again.',
      );
    },
  });

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Seat a walk-in"
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
      >
        <div>
          <p className="mb-2 text-sm font-medium text-charcoal">Party size</p>
          <PartyStepper value={partySize} onChange={setPartySize} />
        </div>

        <Input
          label="Name (optional)"
          value={guestName}
          maxLength={120}
          placeholder="e.g. Sara — red coat"
          onChange={(e) => setGuestName(e.target.value)}
        />

        {error && (
          <p role="alert" className="rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" loading={mutation.isPending} className="flex-1">
            Seat now — best table is picked automatically
          </Button>
        </div>
      </form>
    </Modal>
  );
}
