import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import { useBookingWebSocket, type BookingWsEvent } from '../hooks/useBookingWebSocket.js';
import type { BookingsResponse, PublicRestaurant, SlotRow } from '../types/api.js';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';
import { Badge } from '../components/ui/Badge.js';
import { Spinner } from '../components/ui/Spinner.js';

function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function formatCuisine(cuisine: string): string {
  return cuisine.charAt(0) + cuisine.slice(1).toLowerCase();
}

export function RestaurantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token } = useAuth();

  const [slotDate, setSlotDate] = useState(todayIso);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [showAddSlots, setShowAddSlots] = useState(false);
  const [newSlotTime, setNewSlotTime] = useState('19:00');
  const [newSlotCapacity, setNewSlotCapacity] = useState(10);
  const [statusFilter, setStatusFilter] = useState('');

  const restaurantQuery = useQuery({
    queryKey: ['restaurant', id],
    queryFn: () => api.get<PublicRestaurant>(`/restaurants/${id!}`),
    enabled: Boolean(id),
  });

  const slotsQuery = useQuery({
    queryKey: ['slots', id, slotDate],
    queryFn: () =>
      api.get<{ slots: SlotRow[] }>(
        `/restaurants/${id!}/slots?date=${slotDate}`,
      ),
    enabled: Boolean(id),
  });

  const bookingsQuery = useQuery({
    queryKey: ['bookings', id, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter.toUpperCase());
      const qs = params.toString();
      return api.get<BookingsResponse>(
        `/restaurants/${id!}/bookings${qs ? `?${qs}` : ''}`,
      );
    },
    enabled: Boolean(id),
  });

  const onWsEvent = useCallback(
    (event: BookingWsEvent) => {
      void queryClient.invalidateQueries({ queryKey: ['bookings', id] });
      void queryClient.invalidateQueries({ queryKey: ['slots', id] });

      if (event.eventType === 'booking.created') {
        toast.success(`New booking — party of ${event.partySize ?? '?'}`);
      } else if (event.eventType === 'booking.confirmed') {
        toast.success('Booking confirmed');
      } else if (event.eventType === 'booking.cancelled') {
        toast(
          event.cancelledBy === 'owner'
            ? 'Booking cancelled (by you)'
            : 'Booking cancelled by guest',
        );
      }
    },
    [queryClient, id],
  );

  const { isConnected } = useBookingWebSocket({
    restaurantId: id!,
    token,
    onEvent: onWsEvent,
    enabled: Boolean(id && token),
  });

  const updateMutation = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      api.patch(`/restaurants/${id!}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['restaurant', id] });
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

  const addSlotsMutation = useMutation({
    mutationFn: () => {
      const startsAt = `${slotDate}T${newSlotTime}:00.000Z`;
      return api.post(`/restaurants/${id!}/slots`, {
        slots: [{ startsAt, capacity: newSlotCapacity }],
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['slots', id] });
      setShowAddSlots(false);
      toast.success('Slots added');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add slots');
    },
  });

  const deleteSlotMutation = useMutation({
    mutationFn: (slotId: string) =>
      api.delete(`/restaurants/${id!}/slots/${slotId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['slots', id] });
      toast.success('Slot removed');
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (bookingId: string) =>
      api.patch(`/restaurants/${id!}/bookings/${bookingId}/confirm`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bookings', id] });
      toast.success('Booking confirmed');
    },
  });

  const cancelBookingMutation = useMutation({
    mutationFn: (bookingId: string) =>
      api.patch(`/restaurants/${id!}/bookings/${bookingId}/cancel`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bookings', id] });
      toast.success('Booking cancelled');
    },
  });

  const restaurant = restaurantQuery.data;
  const slots = slotsQuery.data?.slots ?? [];
  const bookings = bookingsQuery.data?.bookings ?? [];

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
            {!editing && (
              <p className="mt-3 text-gray-700">{restaurant.description}</p>
            )}
          </div>
          <div className="flex gap-2">
            {!editing && (
              <Button variant="secondary" size="sm" onClick={startEdit}>
                Edit
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

      <Card>
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-xl font-semibold">Slots</h2>
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label="Date"
              type="date"
              value={slotDate}
              onChange={(e) => setSlotDate(e.target.value)}
            />
            <Button size="sm" onClick={() => setShowAddSlots((v) => !v)}>
              Add slots
            </Button>
          </div>
        </div>

        {showAddSlots && (
          <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <Input
                label="Time (UTC)"
                type="time"
                value={newSlotTime}
                onChange={(e) => setNewSlotTime(e.target.value)}
              />
              <Input
                label="Capacity"
                type="number"
                min={1}
                value={newSlotCapacity}
                onChange={(e) => setNewSlotCapacity(Number(e.target.value))}
              />
              <Button
                size="sm"
                loading={addSlotsMutation.isPending}
                onClick={() => addSlotsMutation.mutate()}
              >
                Create slot
              </Button>
            </div>
          </div>
        )}

        {slotsQuery.isLoading && <Spinner />}
        {!slotsQuery.isLoading && slots.length === 0 && (
          <p className="text-gray-500">No slots for this date.</p>
        )}
        <ul className="divide-y">
          {slots.map((slot) => (
            <li
              key={slot.id}
              className="flex items-center justify-between py-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {format(parseISO(slot.startsAt), 'h:mm a')}
                </p>
                <p className="text-gray-500">
                  {slot.available} / {slot.capacity} available
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  if (window.confirm('Remove this slot?')) {
                    deleteSlotMutation.mutate(slot.id);
                  }
                }}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold">Bookings</h2>
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
            <option value="PENDING">Pending</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        {bookingsQuery.isLoading && <Spinner />}
        {!bookingsQuery.isLoading && bookings.length === 0 && (
          <p className="text-gray-500">No bookings yet.</p>
        )}

        <ul className="divide-y">
          {bookings.map((b) => (
            <li
              key={b.id}
              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium">
                  {format(parseISO(b.slot.startsAt), 'EEE MMM d · h:mm a')}
                </p>
                <p className="text-sm text-gray-600">
                  Party of {b.partySize} · {b.diner.email}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge status={b.status} />
                {b.status === 'PENDING' && (
                  <>
                    <Button
                      size="sm"
                      loading={confirmMutation.isPending}
                      onClick={() => confirmMutation.mutate(b.id)}
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        if (window.confirm('Cancel this booking?')) {
                          cancelBookingMutation.mutate(b.id);
                        }
                      }}
                    >
                      Cancel
                    </Button>
                  </>
                )}
                {b.status === 'CONFIRMED' && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      if (window.confirm('Cancel this booking?')) {
                        cancelBookingMutation.mutate(b.id);
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
