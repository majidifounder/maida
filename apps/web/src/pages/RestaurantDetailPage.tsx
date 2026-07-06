import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import type { PublicRestaurant, AvailabilityTime } from '../types/api.js';
import { formatFee, minutesToTimeLabel } from '../lib/restaurant-display.js';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';
import { Spinner } from '../components/ui/Spinner.js';

function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function formatCuisine(cuisine: string): string {
  return cuisine.charAt(0) + cuisine.slice(1).toLowerCase();
}

export function RestaurantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [activeTime, setActiveTime] = useState<string | null>(null);
  const [partySize, setPartySize] = useState(2);
  const [toast, setToast] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const restaurantQuery = useQuery({
    queryKey: ['restaurant', id],
    queryFn: () => api.get<PublicRestaurant>(`/restaurants/${id!}`),
    enabled: Boolean(id),
  });

  const availabilityQuery = useQuery({
    queryKey: ['availability', id, selectedDate, partySize],
    queryFn: () =>
      api.get<{ times: AvailabilityTime[] }>(
        `/restaurants/${id!}/availability?date=${selectedDate}&partySize=${partySize}`,
      ),
    enabled: Boolean(id),
  });

  const reservationMutation = useMutation({
    mutationFn: (payload: {
      restaurantId: string;
      startsAt: string;
      partySize: number;
    }) =>
      api.post('/reservations', {
        ...payload,
        reservationType: 'STANDARD',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['availability', id] });
      setActiveTime(null);
      setBookingError(null);
      setToast('Reservation confirmed!');
      setTimeout(() => setToast(null), 4000);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        setBookingError('Session expired. Please log in again.');
        navigate('/login');
      } else if (err instanceof ApiError && err.status === 409) {
        setBookingError(err.message);
      } else {
        setBookingError(
          err instanceof ApiError ? err.message : 'Reservation failed. Please try again.',
        );
      }
    },
  });

  const restaurant = restaurantQuery.data;
  const times = availabilityQuery.data?.times ?? [];

  if (restaurantQuery.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (restaurantQuery.error || !restaurant) {
    return <p className="text-center text-red-600">Restaurant not found.</p>;
  }

  const confirmReservation = (startsAt: string) => {
    if (!id || !token) {
      navigate('/login');
      return;
    }
    reservationMutation.mutate({
      restaurantId: id,
      startsAt,
      partySize,
    });
  };

  return (
    <div>
      {toast && (
        <div className="fixed right-4 top-20 z-50 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}

      <Link
        to="/restaurants"
        className="mb-6 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        ← Back to restaurants
      </Link>

      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          {restaurant.imageUrl ? (
            <img
              src={restaurant.imageUrl}
              alt={restaurant.name}
              className="aspect-[16/10] w-full rounded-xl object-cover"
            />
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center rounded-xl bg-gray-100 text-6xl">
              🍽
            </div>
          )}
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{restaurant.name}</h1>
          <p className="mt-2 text-brand-600">{formatCuisine(restaurant.cuisine)}</p>
          <p className="mt-1 text-gray-600">
            {restaurant.address}, {restaurant.city}
          </p>
          <p className="mt-4 text-gray-700">{restaurant.description}</p>

          <div className="mt-6 space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
            <p>
              <span className="font-medium text-gray-900">Seating: </span>
              {restaurant.seatingMode === 'FLEXIBLE'
                ? 'Flexible — tables may be combined for larger parties'
                : 'Fixed tables — each table is booked individually'}
            </p>
            <p>
              <span className="font-medium text-gray-900">Service hours: </span>
              {minutesToTimeLabel(restaurant.openMinutes)} –{' '}
              {minutesToTimeLabel(restaurant.closeMinutes)} ({restaurant.timezone})
            </p>
            <p>
              <span className="font-medium text-gray-900">Typical visit: </span>
              ~{restaurant.defaultDurationMins} minutes
            </p>
            {(formatFee(restaurant.customFee, restaurant.feeCurrency) ||
              formatFee(restaurant.extraHourFee, restaurant.feeCurrency)) && (
              <p className="border-t border-gray-200 pt-2 text-gray-600">
                <span className="font-medium text-gray-900">
                  Custom reservations (paid at restaurant):{' '}
                </span>
                {formatFee(restaurant.customFee, restaurant.feeCurrency) && (
                  <>
                    from{' '}
                    {formatFee(restaurant.customFee, restaurant.feeCurrency)} flat
                  </>
                )}
                {formatFee(restaurant.customFee, restaurant.feeCurrency) &&
                  formatFee(restaurant.extraHourFee, restaurant.feeCurrency) &&
                  ' · '}
                {formatFee(restaurant.extraHourFee, restaurant.feeCurrency) && (
                  <>
                    {formatFee(restaurant.extraHourFee, restaurant.feeCurrency)}/hr
                    beyond standard turn
                  </>
                )}
                . Maida does not collect these fees.
              </p>
            )}
          </div>
        </div>
      </div>

      <Card className="mt-10">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-xl font-semibold">Available times</h2>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="w-full sm:max-w-[120px]">
              <Input
                label="Party size"
                type="number"
                min={1}
                max={20}
                value={partySize}
                onChange={(e) => {
                  setPartySize(Number(e.target.value));
                  setActiveTime(null);
                }}
              />
            </div>
            <div className="w-full sm:max-w-xs">
              <Input
                label="Date"
                type="date"
                value={selectedDate}
                min={todayIso()}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setActiveTime(null);
                }}
              />
            </div>
          </div>
        </div>

        {availabilityQuery.isLoading && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}

        {!availabilityQuery.isLoading && times.length === 0 && (
          <p className="text-gray-500">No availability for this date and party size.</p>
        )}

        <ul className="divide-y divide-gray-100">
          {times.map((slot) => (
            <li key={slot.startsAt} className="py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-gray-900">
                    {format(parseISO(slot.startsAt), 'EEEE, MMM d · h:mm a')}
                  </p>
                  <p className="text-sm text-gray-500">
                    ~{slot.durationMins} min · until{' '}
                    {format(parseISO(slot.endsAt), 'h:mm a')}
                  </p>
                </div>
                {!user || !token ? (
                  <Button variant="secondary" disabled title="Log in to book">
                    Reserve
                  </Button>
                ) : activeTime !== slot.startsAt ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setActiveTime(slot.startsAt);
                      setBookingError(null);
                    }}
                  >
                    Reserve
                  </Button>
                ) : null}
              </div>

              {activeTime === slot.startsAt && user && token && (
                <div className="mt-4 rounded-lg border border-brand-100 bg-brand-50 p-4">
                  <Button
                    loading={reservationMutation.isPending}
                    onClick={() => confirmReservation(slot.startsAt)}
                  >
                    Confirm reservation
                  </Button>
                  <Button
                    variant="secondary"
                    className="ml-2"
                    onClick={() => setActiveTime(null)}
                  >
                    Cancel
                  </Button>
                  {bookingError && (
                    <p className="mt-2 text-sm text-red-600">{bookingError}</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
