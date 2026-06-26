import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { api } from '../lib/api.js';
import type { BookingsListResponse } from '../types/api.js';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';
import { Spinner } from '../components/ui/Spinner.js';

function canCancel(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'pending' || s === 'confirmed';
}

export function MyBookingsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['bookings'],
    queryFn: () => api.get<BookingsListResponse>('/bookings'),
  });

  const cancelMutation = useMutation({
    mutationFn: (bookingId: string) =>
      api.patch(`/bookings/${bookingId}/cancel`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
  });

  const bookings = [...(data?.bookings ?? [])].sort(
    (a, b) =>
      new Date(b.slot.startsAt).getTime() - new Date(a.slot.startsAt).getTime(),
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
      <p className="text-center text-red-600">Failed to load your bookings.</p>
    );
  }

  return (
    <div>
      <h1 className="mb-8 text-3xl font-bold text-gray-900">My bookings</h1>

      {bookings.length === 0 && (
        <Card className="text-center">
          <p className="text-gray-600">You have no bookings yet.</p>
          <Link
            to="/restaurants"
            className="mt-4 inline-block font-medium text-brand-600 hover:text-brand-700"
          >
            Browse restaurants →
          </Link>
        </Card>
      )}

      <ul className="space-y-4">
        {bookings.map((booking) => (
          <li key={booking.id}>
            <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {booking.restaurant.name}
                </h2>
                <p className="text-sm text-gray-500">
                  {booking.restaurant.city} · {booking.restaurant.cuisine}
                </p>
                <p className="mt-2 text-sm text-gray-700">
                  {format(parseISO(booking.slot.startsAt), 'EEEE, MMM d · h:mm a')}
                </p>
                <p className="text-sm text-gray-600">Party of {booking.partySize}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge status={booking.status} />
                {canCancel(booking.status) && (
                  <Button
                    variant="danger"
                    size="sm"
                    loading={cancelMutation.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Are you sure you want to cancel this booking?',
                        )
                      ) {
                        cancelMutation.mutate(booking.id);
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
