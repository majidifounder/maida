import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import {
  useBookingWebSocket,
  type BookingWsEvent,
} from '../hooks/useBookingWebSocket.js';
import type { OwnerRestaurant, ReservationsResponse } from '../types/api.js';
import { CombinationsPanel } from '../components/restaurant/CombinationsPanel.js';
import { ReservationConfigPanel } from '../components/restaurant/ReservationConfigPanel.js';
import { TablesPanel } from '../components/restaurant/TablesPanel.js';
import { TurnTimeRulesPanel } from '../components/restaurant/TurnTimeRulesPanel.js';
import { LogoUploadPanel } from '../components/restaurant/LogoUploadPanel.js';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';
import { Badge } from '../components/ui/Badge.js';
import { Spinner } from '../components/ui/Spinner.js';

function formatCuisine(cuisine: string): string {
  return cuisine.charAt(0) + cuisine.slice(1).toLowerCase();
}

export function RestaurantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const restaurantQuery = useQuery({
    queryKey: ['restaurant-config', id],
    queryFn: () =>
      api
        .get<{ config: OwnerRestaurant }>(`/restaurants/${id!}/config`)
        .then((r) => r.config),
    enabled: Boolean(id),
  });

  const reservationsQuery = useQuery({
    queryKey: ['reservations', id, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter.toUpperCase());
      const qs = params.toString();
      return api.get<ReservationsResponse>(
        `/restaurants/${id!}/reservations${qs ? `?${qs}` : ''}`,
      );
    },
    enabled: Boolean(id),
  });

  const onWsEvent = useCallback(
    (event: BookingWsEvent) => {
      void queryClient.invalidateQueries({ queryKey: ['reservations', id] });
      void queryClient.invalidateQueries({ queryKey: ['tables', id] });

      if (event.eventType === 'reservation.created') {
        toast.success(`New reservation — party of ${event.partySize ?? '?'}`);
      } else if (event.eventType === 'reservation.seated') {
        toast.success('Guest seated');
      } else if (event.eventType === 'reservation.cancelled') {
        toast('Reservation cancelled');
      }
    },
    [queryClient, id],
  );

  const { isConnected } = useBookingWebSocket({
    restaurantId: id!,
    onEvent: onWsEvent,
    enabled: Boolean(id && user),
  });

  const updateMutation = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      api.patch(`/restaurants/${id!}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['restaurant-config', id] });
      setEditing(false);
      toast.success('Restaurant updated');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/restaurants/${id!}`),
    onSuccess: () => {
      toast.success('Restaurant deleted');
      navigate('/restaurants');
    },
  });

  const seatMutation = useMutation({
    mutationFn: (reservationId: string) =>
      api.patch(`/restaurants/${id!}/reservations/${reservationId}/seat`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations', id] });
      toast.success('Guest seated');
    },
  });

  const cancelReservationMutation = useMutation({
    mutationFn: (reservationId: string) =>
      api.patch(`/restaurants/${id!}/reservations/${reservationId}/cancel`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations', id] });
      toast.success('Reservation cancelled');
    },
  });

  const noShowMutation = useMutation({
    mutationFn: (reservationId: string) =>
      api.patch(`/restaurants/${id!}/reservations/${reservationId}/no-show`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations', id] });
      toast.success('Marked no-show');
    },
  });

  const restaurant = restaurantQuery.data;
  const reservations = reservationsQuery.data?.reservations ?? [];

  if (restaurantQuery.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (!restaurant) {
    return <p className="text-red-600">Restaurant not found.</p>;
  }

  const startEdit = () => {
    setEditName(restaurant.name);
    setEditDesc(restaurant.description);
    setEditing(true);
  };

  return (
    <div className="space-y-8">
      <Link to="/restaurants" className="text-sm font-medium text-brand">
        ← Back to restaurants
      </Link>

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">{restaurant.name}</h1>
            <p className="mt-1 text-brand">{formatCuisine(restaurant.cuisine)}</p>
            <p className="text-gray-600">
              {restaurant.address}, {restaurant.city}
            </p>
            <p className="mt-2 text-xs text-gray-500">
              {restaurant.seatingMode === 'FLEXIBLE' ? 'Flexible seating' : 'Fixed tables'}{' '}
              · {restaurant.timezone}
            </p>
            {!editing && (
              <p className="mt-3 text-gray-700">{restaurant.description}</p>
            )}
          </div>
          <div className="flex gap-2">
            {!editing && (
              <Button variant="secondary" size="sm" onClick={startEdit}>
                Edit profile
              </Button>
            )}
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (window.confirm('Delete this restaurant?')) {
                  deleteMutation.mutate();
                }
              }}
              loading={deleteMutation.isPending}
            >
              Delete
            </Button>
          </div>
        </div>

        <div className="mt-6 border-t pt-6">
          <LogoUploadPanel
            restaurantId={restaurant.id}
            imageUrl={restaurant.imageUrl}
            restaurantName={restaurant.name}
          />
        </div>

        {editing && (
          <form
            className="mt-4 space-y-3 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              updateMutation.mutate({ name: editName, description: editDesc });
            }}
          >
            <Input label="Name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            <Input
              label="Description"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
            />
            <div className="flex gap-2">
              <Button type="submit" loading={updateMutation.isPending}>
                Save
              </Button>
              <Button variant="secondary" type="button" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Card>

      <ReservationConfigPanel restaurantId={id!} config={restaurant} />
      <TablesPanel restaurantId={id!} />
      <CombinationsPanel restaurantId={id!} seatingMode={restaurant.seatingMode} />
      <TurnTimeRulesPanel restaurantId={id!} />

      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold">Reservations</h2>
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <span
                className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-300'}`}
              />
              Live
            </span>
          </div>
          <select
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="SEATED">Seated</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="NO_SHOW">No-show</option>
          </select>
        </div>

        {reservationsQuery.isLoading && <Spinner />}
        {!reservationsQuery.isLoading && reservations.length === 0 && (
          <p className="text-gray-500">No reservations yet.</p>
        )}

        <ul className="divide-y">
          {reservations.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium">
                  {format(parseISO(r.startsAt), 'EEE MMM d · h:mm a')}
                </p>
                <p className="text-sm text-gray-600">
                  Party of {r.partySize} ·{' '}
                  {r.diner?.email ?? r.guestName ?? 'Walk-in'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge status={r.status} />
                {r.status === 'SCHEDULED' && (
                  <>
                    <Button
                      size="sm"
                      loading={seatMutation.isPending}
                      onClick={() => seatMutation.mutate(r.id)}
                    >
                      Seat
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => noShowMutation.mutate(r.id)}
                    >
                      No-show
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        if (window.confirm('Cancel this reservation?')) {
                          cancelReservationMutation.mutate(r.id);
                        }
                      }}
                    >
                      Cancel
                    </Button>
                  </>
                )}
                {r.status === 'SEATED' && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      if (window.confirm('Cancel this reservation?')) {
                        cancelReservationMutation.mutate(r.id);
                      }
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
