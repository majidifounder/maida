import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import type {
  PublicRestaurant,
  SlotWithAvailability,
} from '../types/api.js';
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

function isSlotInPast(startsAt: string): boolean {
  return new Date(startsAt).getTime() <= Date.now();
}

export function RestaurantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [partySize, setPartySize] = useState(2);
  const [toast, setToast] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const restaurantQuery = useQuery({
    queryKey: ['restaurant', id],
    queryFn: () => api.get<PublicRestaurant>(`/restaurants/${id!}`),
    enabled: Boolean(id),
  });

  const slotsQuery = useQuery({
    queryKey: ['slots', id, selectedDate],
    queryFn: () =>
      api.get<{ slots: SlotWithAvailability[] }>(
        `/restaurants/${id!}/slots?date=${selectedDate}`,
      ),
    enabled: Boolean(id),
  });

  const bookingMutation = useMutation({
    mutationFn: (payload: {
      restaurantId: string;
      slotId: string;
      partySize: number;
    }) => api.post('/bookings', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['slots', id] });
      setActiveSlotId(null);
      setBookingError(null);
      setToast('Booking request sent!');
      setTimeout(() => setToast(null), 4000);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        setBookingError('Session expired. Please log in again.');
        navigate('/login');
      } else {
        setBookingError(
          err instanceof ApiError ? err.message : 'Booking failed. Please try again.',
        );
      }
    },
  });

  const restaurant = restaurantQuery.data;
  const slots = slotsQuery.data?.slots ?? [];

  if (restaurantQuery.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (restaurantQuery.error || !restaurant) {
    return (
      <p className="text-center text-red-600">Restaurant not found.</p>
    );
  }

  const handleBook = (slotId: string) => {
    if (!user || !token) {
      navigate('/login');
      return;
    }
    setActiveSlotId(slotId);
    setBookingError(null);
  };

  const confirmBooking = (slotId: string) => {
    if (!id || !token) {
      navigate('/login');
      return;
    }
    bookingMutation.mutate({
      restaurantId: id,
      slotId,
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
          <p className="mt-1 text-gray-600">{restaurant.address}, {restaurant.city}</p>
          <p className="mt-4 text-gray-700">{restaurant.description}</p>
        </div>
      </div>

      <Card className="mt-10">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-xl font-semibold">Available times</h2>
          <div className="w-full sm:max-w-xs">
            <Input
              label="Date"
              type="date"
              value={selectedDate}
              min={todayIso()}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setActiveSlotId(null);
              }}
            />
          </div>
        </div>

        {slotsQuery.isLoading && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}

        {!slotsQuery.isLoading && slots.length === 0 && (
          <p className="text-gray-500">No slots available for this date.</p>
        )}

        <ul className="divide-y divide-gray-100">
          {slots.map((slot) => (
            <li key={slot.id} className="py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-gray-900">
                    {format(parseISO(slot.startsAt), 'EEEE, MMM d · h:mm a')}
                  </p>
                  <p className="text-sm text-gray-500">
                    {slot.available} of {slot.capacity} seats available
                  </p>
                </div>
                {!user || !token ? (
                  <Button
                    variant="secondary"
                    disabled
                    title="Log in to book"
                  >
                    Book
                  </Button>
                ) : activeSlotId !== slot.id ? (
                  <Button
                    variant="secondary"
                    disabled={slot.available < 1 || isSlotInPast(slot.startsAt)}
                    onClick={() => handleBook(slot.id)}
                  >
                    Book
                  </Button>
                ) : null}
              </div>

              {activeSlotId === slot.id && user && token && (
                <div className="mt-4 rounded-lg border border-brand-100 bg-brand-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="w-full sm:max-w-[120px]">
                      <Input
                        label="Party size"
                        type="number"
                        min={1}
                        max={20}
                        value={partySize}
                        onChange={(e) => setPartySize(Number(e.target.value))}
                      />
                    </div>
                    <Button
                      loading={bookingMutation.isPending}
                      onClick={() => confirmBooking(slot.id)}
                    >
                      Confirm booking
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setActiveSlotId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
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
