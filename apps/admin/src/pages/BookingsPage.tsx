import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { DataTable } from '../components/DataTable.js';
import { BookingStatusBadge } from '../components/ui/Badge.js';
import type { AdminReservation, PaginatedReservations } from '../types/api.js';

export function BookingsPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'reservations', page],
    queryFn: () =>
      api.get<PaginatedReservations>(
        `/admin/reservations?page=${page}&limit=20`,
      ),
  });

  const columns = [
    {
      header: 'Guest',
      render: (r: AdminReservation) => r.diner?.email ?? '—',
    },
    {
      header: 'Restaurant',
      render: (r: AdminReservation) => r.restaurant.name,
    },
    {
      header: 'Time',
      render: (r: AdminReservation) =>
        new Date(r.startsAt).toLocaleString(),
    },
    { header: 'Party', accessor: 'partySize' as const },
    {
      header: 'Status',
      render: (r: AdminReservation) => <BookingStatusBadge status={r.status} />,
    },
    {
      header: 'Created',
      render: (r: AdminReservation) =>
        new Date(r.createdAt).toLocaleString(),
    },
  ];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Reservations</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {data?.total ?? 0} total
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={data?.reservations ?? []}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        total={data?.total}
        page={page}
        limit={20}
        onPageChange={setPage}
        emptyText="No reservations found."
      />
    </div>
  );
}
