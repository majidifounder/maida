import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { DataTable } from '../components/DataTable.js';
import { PlanBadge } from '../components/ui/Badge.js';
import type { AdminSubscription, PaginatedSubscriptions } from '../types/api.js';

export function SubscriptionsPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'subscriptions', page],
    queryFn: () =>
      api.get<PaginatedSubscriptions>(
        `/admin/subscriptions?page=${page}&limit=20`,
      ),
  });

  const paidCount =
    data?.subscriptions.filter(
      (s) => s.plan === 'PRO' || s.plan === 'PREMIUM',
    ).length ?? 0;

  const columns = [
    {
      header: 'User',
      render: (s: AdminSubscription) => s.user.email,
    },
    {
      header: 'Plan',
      render: (s: AdminSubscription) => <PlanBadge plan={s.plan} />,
    },
    { header: 'Status', accessor: 'status' as const },
    {
      header: 'Period end',
      render: (s: AdminSubscription) =>
        s.currentPeriodEnd
          ? new Date(s.currentPeriodEnd).toLocaleDateString()
          : '—',
    },
    {
      header: 'Lemon Squeezy',
      render: (s: AdminSubscription) => (
        <span className="font-mono text-xs text-slate-600">
          {s.lemonSqueezyId
            ? `${s.lemonSqueezyId.slice(0, 12)}…`
            : '—'}
        </span>
      ),
    },
    {
      header: 'Created',
      render: (s: AdminSubscription) =>
        new Date(s.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Subscriptions</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {data?.total ?? 0} total · {paidCount} paid on this page
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={data?.subscriptions ?? []}
        rowKey={(s) => s.id}
        isLoading={isLoading}
        total={data?.total}
        page={page}
        limit={20}
        onPageChange={setPage}
        emptyText="No subscriptions found."
      />
    </div>
  );
}
