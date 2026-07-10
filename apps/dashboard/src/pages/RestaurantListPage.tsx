import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { OwnerRestaurant } from '../types/api.js';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { IconArmchair, IconSettings } from '../components/ui/icons.js';

function formatCuisine(cuisine: string): string {
  return cuisine.charAt(0) + cuisine.slice(1).toLowerCase();
}

export function RestaurantListPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['my-restaurants'],
    queryFn: () =>
      api.get<{ restaurants: OwnerRestaurant[] }>('/restaurants/mine'),
  });

  const restaurants = data?.restaurants ?? [];

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl text-ink">My restaurants</h1>
          <p className="mt-1 text-slate2">
            Tonight&apos;s service, tables, and settings
          </p>
        </div>
        <Link to="/restaurants/new">
          <Button>New restaurant</Button>
        </Link>
      </div>

      {isLoading && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-card" />
          ))}
        </div>
      )}

      {Boolean(error) && (
        <p className="text-danger-text">
          Couldn&apos;t load your restaurants. Refresh to try again.
        </p>
      )}

      {!isLoading && !error && restaurants.length === 0 && (
        <EmptyState
          title="No restaurants yet."
          hint="Add your restaurant, set your hours and tables, and you're taking bookings — takes about 3 minutes."
          action={
            <Link to="/restaurants/new">
              <Button>Create your first restaurant</Button>
            </Link>
          }
        />
      )}

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {restaurants.map((r) => (
          <Card key={r.id} className="flex flex-col">
            <h2 className="font-sans text-lg font-medium text-ink">{r.name}</h2>
            <p className="mt-1 text-sm text-slate2">
              {formatCuisine(r.cuisine)} · {r.city}
            </p>
            {/* Service is the daily door; settings is the weekly one. */}
            <div className="mt-4 flex gap-2">
              <Link to={`/restaurants/${r.id}/service`} className="flex-1">
                <Button className="w-full">
                  <IconArmchair size={15} />
                  Service
                </Button>
              </Link>
              <Link to={`/restaurants/${r.id}`}>
                <Button variant="secondary" aria-label={`${r.name} settings`}>
                  <IconSettings size={15} />
                </Button>
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
