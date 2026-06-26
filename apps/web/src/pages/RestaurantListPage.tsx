import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { RestaurantsListResponse } from '../types/api.js';
import { RestaurantCard, RestaurantCardSkeleton } from '../components/RestaurantCard.js';
import { Input } from '../components/ui/Input.js';

export function RestaurantListPage() {
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['restaurants'],
    queryFn: () => api.get<RestaurantsListResponse>('/restaurants'),
  });

  const filtered = useMemo(() => {
    const list = data?.restaurants ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.cuisine.toLowerCase().includes(q) ||
        r.city.toLowerCase().includes(q),
    );
  }, [data?.restaurants, search]);

  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Restaurants</h1>
          <p className="mt-1 text-gray-600">Browse and book your next dining experience</p>
        </div>
        <div className="w-full sm:max-w-xs">
          <Input
            label="Search"
            placeholder="Name or cuisine…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">
          Failed to load restaurants. Please try again.
        </p>
      )}

      {isLoading && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <RestaurantCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <p className="text-center text-gray-500">No restaurants found.</p>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((restaurant) => (
            <RestaurantCard key={restaurant.id} restaurant={restaurant} />
          ))}
        </div>
      )}
    </div>
  );
}
