import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import type { PublicRestaurant, AvailabilityResponse } from '../types/api.js';
import {
  formatFee,
  formatServiceHoursLabel,
  formatServiceWindowLabel,
  restaurantOffersCustomReservations,
} from '../lib/restaurant-display.js';
import { formatTimezoneLabel } from '../lib/restaurant-time.js';
import { ReservationBookingFlow } from '../components/ReservationBookingFlow.js';
import { Spinner } from '../components/ui/Spinner.js';

function formatCuisine(cuisine: string): string {
  return cuisine.charAt(0) + cuisine.slice(1).toLowerCase();
}

export function RestaurantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [toast, setToast] = useState<string | null>(null);

  const restaurantQuery = useQuery({
    queryKey: ['restaurant', id],
    queryFn: () => api.get<PublicRestaurant>(`/restaurants/${id!}`),
    enabled: Boolean(id),
  });

  const restaurant = restaurantQuery.data;

  const previewAvailabilityQuery = useQuery({
    queryKey: ['availability-preview', id, restaurant?.timezone],
    queryFn: () => {
      const today = new Date().toISOString().slice(0, 10);
      return api.get<AvailabilityResponse>(
        `/restaurants/${id!}/availability?date=${today}&partySize=2`,
      );
    },
    enabled: Boolean(id && restaurant),
    staleTime: 60_000,
  });

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

  const serviceWindow = previewAvailabilityQuery.data?.serviceWindow;
  const standardDurationMins =
    previewAvailabilityQuery.data?.standardDurationMins ?? restaurant.defaultDurationMins;
  const serviceHoursLabel = serviceWindow
    ? formatServiceWindowLabel(serviceWindow, restaurant.timezone)
    : formatServiceHoursLabel(restaurant.openMinutes, restaurant.closeMinutes);

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
              {serviceHoursLabel}{' '}
              <span className="text-gray-500">
                ({formatTimezoneLabel(restaurant.timezone)})
              </span>
            </p>
            <p>
              <span className="font-medium text-gray-900">Typical table time: </span>
              ~{standardDurationMins} minutes for a party of 2
              {standardDurationMins !== restaurant.defaultDurationMins && (
                <span className="text-gray-500">
                  {' '}
                  (varies by party size based on turn-time rules)
                </span>
              )}
            </p>
            {restaurantOffersCustomReservations(restaurant) && (
              <p className="border-t border-gray-200 pt-2 text-gray-600">
                <span className="font-medium text-gray-900">
                  Custom-length reservations (paid at restaurant):{' '}
                </span>
                {formatFee(restaurant.customFee, restaurant.feeCurrency) && (
                  <>from {formatFee(restaurant.customFee, restaurant.feeCurrency)} flat</>
                )}
                {formatFee(restaurant.customFee, restaurant.feeCurrency) &&
                  formatFee(restaurant.extraHourFee, restaurant.feeCurrency) &&
                  ' · '}
                {formatFee(restaurant.extraHourFee, restaurant.feeCurrency) && (
                  <>
                    {formatFee(restaurant.extraHourFee, restaurant.feeCurrency)}/hr beyond
                    standard turn
                  </>
                )}
                . You can request a custom length when booking. Maida does not collect
                these fees.
              </p>
            )}
          </div>
        </div>
      </div>

      <ReservationBookingFlow
        restaurantId={id!}
        restaurant={restaurant}
        isLoggedIn={Boolean(user)}
        onSuccess={(result) => {
          let msg = 'Reservation confirmed!';
          if (result?.wasCapped) {
            msg =
              'Reservation confirmed — your table may end slightly earlier than requested.';
          }
          setToast(msg);
          setTimeout(() => setToast(null), 5000);
        }}
      />
    </div>
  );
}
