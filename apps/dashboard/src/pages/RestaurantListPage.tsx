import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { OwnerRestaurant } from '../types/api.js';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Spinner } from '../components/ui/Spinner.js';

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
          <h1 className="text-3xl font-bold text-gray-900">My restaurants</h1>
          <p className="mt-1 text-gray-600">
            Manage reservations, tables, and engine settings
          </p>
        </div>
        <Link to="/restaurants/new">
          <Button>New restaurant</Button>
        </Link>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {error && (
        <p className="text-red-600">Failed to load restaurants.</p>
      )}

      {!isLoading && restaurants.length === 0 && (
        <Card className="text-center">
          <p className="text-gray-600">You have no restaurants yet.</p>
          <Link to="/restaurants/new" className="mt-4 inline-block">
            <Button>Create your first restaurant</Button>
          </Link>
        </Card>
      )}

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {restaurants.map((r) => (
          <Card key={r.id} className="flex flex-col">
            <h2 className="text-lg font-semibold">{r.name}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {formatCuisine(r.cuisine)} · {r.city}
            </p>
            <Link to={`/restaurants/${r.id}`} className="mt-4">
              <Button variant="secondary" className="w-full">
                Manage
              </Button>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
