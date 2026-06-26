import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { DataTable } from '../components/DataTable.js';
import { BookingStatusBadge } from '../components/ui/Badge.js';
import type { AdminBooking, PaginatedBookings } from '../types/api.js';

export function BookingsPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'bookings', page],
    queryFn: () =>
      api.get<PaginatedBookings>(`/admin/bookings?page=${page}&limit=20`),
  });

  const columns = [
    {
      header: 'Diner',
      render: (b: AdminBooking) => b.diner.email,
    },
    {
      header: 'Restaurant',
      render: (b: AdminBooking) => b.restaurant.name,
    },
    {
      header: 'Slot',
      render: (b: AdminBooking) =>
        new Date(b.slot.startsAt).toLocaleString(),
    },
    { header: 'Party', accessor: 'partySize' as const },
    {
      header: 'Status',
      render: (b: AdminBooking) => <BookingStatusBadge status={b.status} />,
    },
    {
      header: 'Created',
      render: (b: AdminBooking) =>
        new Date(b.createdAt).toLocaleString(),
    },
  ];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Bookings</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {data?.total ?? 0} total
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={data?.bookings ?? []}
        rowKey={(b) => b.id}
        isLoading={isLoading}
        total={data?.total}
        page={page}
        limit={20}
        onPageChange={setPage}
        emptyText="No bookings found."
      />
    </div>
  );
}
