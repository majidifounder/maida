import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { api } from '../lib/api.js';
import type { ReservationsListResponse } from '../types/api.js';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';
import { Spinner } from '../components/ui/Spinner.js';

function canCancel(status: string): boolean {
  const s = status.toUpperCase();
  return s === 'SCHEDULED' || s === 'SEATED';
}

export function MyBookingsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['reservations'],
    queryFn: () => api.get<ReservationsListResponse>('/reservations'),
  });

  const cancelMutation = useMutation({
    mutationFn: (reservationId: string) =>
      api.patch(`/reservations/${reservationId}/cancel`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    },
  });

  const reservations = [...(data?.reservations ?? [])].sort(
    (a, b) =>
      new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-center text-red-600">Failed to load your reservations.</p>
    );
  }

  return (
    <div>
      <h1 className="mb-8 text-3xl font-bold text-gray-900">My reservations</h1>

      {reservations.length === 0 && (
        <Card className="text-center">
          <p className="text-gray-600">You have no reservations yet.</p>
          <Link
            to="/restaurants"
            className="mt-4 inline-block font-medium text-brand-600 hover:text-brand-700"
          >
            Browse restaurants →
          </Link>
        </Card>
      )}

      <ul className="space-y-4">
        {reservations.map((reservation) => (
          <li key={reservation.id}>
            <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {reservation.restaurant.name}
                </h2>
                <p className="text-sm text-gray-500">
                  {reservation.restaurant.city} · {reservation.restaurant.cuisine}
                </p>
                <p className="mt-2 text-sm text-gray-700">
                  {format(parseISO(reservation.startsAt), 'EEEE, MMM d · h:mm a')}
                </p>
                <p className="text-sm text-gray-600">Party of {reservation.partySize}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge status={reservation.status} />
                {canCancel(reservation.status) && (
                  <Button
                    variant="danger"
                    size="sm"
                    loading={cancelMutation.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Are you sure you want to cancel this reservation?',
                        )
                      ) {
                        cancelMutation.mutate(reservation.id);
                      }
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
