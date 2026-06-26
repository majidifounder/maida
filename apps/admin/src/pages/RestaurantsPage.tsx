import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { DataTable } from '../components/DataTable.js';
import { Badge } from '../components/ui/Badge.js';
import type { AdminRestaurant, PaginatedRestaurants } from '../types/api.js';

export function RestaurantsPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'restaurants', page],
    queryFn: () =>
      api.get<PaginatedRestaurants>(
        `/admin/restaurants?page=${page}&limit=20`,
      ),
  });

  const columns = [
    { header: 'Name', accessor: 'name' as const },
    { header: 'City', accessor: 'city' as const },
    {
      header: 'Cuisine',
      render: (r: AdminRestaurant) => (
        <span className="capitalize text-slate-600">
          {r.cuisine.toLowerCase()}
        </span>
      ),
    },
    {
      header: 'Owner',
      render: (r: AdminRestaurant) => r.owner.email,
    },
    {
      header: 'Bookings',
      render: (r: AdminRestaurant) => r._count.bookings,
    },
    {
      header: 'Status',
      render: (r: AdminRestaurant) => (
        <Badge
          label={r.isActive && !r.deletedAt ? 'Active' : 'Inactive'}
          variant={r.isActive && !r.deletedAt ? 'success' : 'neutral'}
        />
      ),
    },
    {
      header: 'Created',
      render: (r: AdminRestaurant) =>
        new Date(r.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Restaurants</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {data?.total ?? 0} total
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={data?.restaurants ?? []}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        total={data?.total}
        page={page}
        limit={20}
        onPageChange={setPage}
        emptyText="No restaurants found."
      />
    </div>
  );
}
