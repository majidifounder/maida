import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import type { OwnerRestaurant } from '../types/api.js';
import { CombinationsPanel } from '../components/restaurant/CombinationsPanel.js';
import { ReservationConfigPanel } from '../components/restaurant/ReservationConfigPanel.js';
import { WeeklySchedulePanel } from '../components/restaurant/WeeklySchedulePanel.js';
import { TablesPanel } from '../components/restaurant/TablesPanel.js';
import { TurnTimeRulesPanel } from '../components/restaurant/TurnTimeRulesPanel.js';
import { LogoUploadPanel } from '../components/restaurant/LogoUploadPanel.js';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { IconArmchair } from '../components/ui/icons.js';

function formatCuisine(cuisine: string): string {
  return cuisine.charAt(0) + cuisine.slice(1).toLowerCase();
}

/**
 * Restaurant SETTINGS. Day-to-day operations live in the service view
 * (/restaurants/:id/service) — this page is where the owner shapes the
 * restaurant: profile, hours, tables, rules. Visited weekly, not nightly.
 */
export function RestaurantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const restaurantQuery = useQuery({
    queryKey: ['restaurant-config', id],
    queryFn: () =>
      api
        .get<{ config: OwnerRestaurant }>(`/restaurants/${id!}/config`)
        .then((r) => r.config),
    enabled: Boolean(id),
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

  const restaurant = restaurantQuery.data;

  if (restaurantQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full rounded-card" />
        <Skeleton className="h-64 w-full rounded-card" />
      </div>
    );
  }

  if (!restaurant) {
    return <p className="text-danger-text">Restaurant not found.</p>;
  }

  const startEdit = () => {
    setEditName(restaurant.name);
    setEditDesc(restaurant.description);
    setEditing(true);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <Link
          to="/restaurants"
          className="text-sm font-medium text-slate2 transition-colors hover:text-ink"
        >
          ← All restaurants
        </Link>
        <Link
          to={`/restaurants/${id!}/service`}
          className="inline-flex h-10 items-center gap-2 rounded-btn bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-charcoal"
        >
          <IconArmchair size={16} />
          Open service view
        </Link>
      </div>

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-serif text-3xl text-ink">{restaurant.name}</h1>
            <p className="mt-1 text-charcoal">{formatCuisine(restaurant.cuisine)}</p>
            <p className="text-slate2">
              {restaurant.address}, {restaurant.city}
            </p>
            <p className="mt-2 text-xs text-stone2">
              {restaurant.seatingMode === 'FLEXIBLE' ? 'Flexible seating' : 'Fixed tables'}{' '}
              · {restaurant.timezone}
            </p>
            {!editing && (
              <p className="mt-3 text-charcoal">{restaurant.description}</p>
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
                if (window.confirm('Delete this restaurant? This removes it from search and stops new bookings.')) {
                  deleteMutation.mutate();
                }
              }}
              loading={deleteMutation.isPending}
            >
              Delete
            </Button>
          </div>
        </div>

        <div className="mt-6 border-t border-mist pt-6">
          <LogoUploadPanel
            restaurantId={restaurant.id}
            imageUrl={restaurant.imageUrl}
            restaurantName={restaurant.name}
          />
        </div>

        {editing && (
          <form
            className="mt-4 space-y-3 border-t border-mist pt-4"
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
      <WeeklySchedulePanel restaurantId={id!} timezone={restaurant.timezone} />
      <TablesPanel restaurantId={id!} />
      <CombinationsPanel restaurantId={id!} seatingMode={restaurant.seatingMode} />
      <TurnTimeRulesPanel restaurantId={id!} />
    </div>
  );
}
