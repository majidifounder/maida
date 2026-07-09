import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { DataTable } from '../components/DataTable.js';
import { Badge } from '../components/ui/Badge.js';

interface AdminFeedbackItem {
  id: string;
  userEmail: string;
  role: string;
  message: string;
  createdAt: string;
}

interface PaginatedFeedback {
  feedback: AdminFeedbackItem[];
  total: number;
  page: number;
  limit: number;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function FeedbackPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'feedback', page],
    queryFn: () =>
      api.get<PaginatedFeedback>(`/admin/feedback?page=${page}&limit=50`),
  });

  const columns = [
    {
      header: 'Time',
      render: (row: AdminFeedbackItem) => (
        <span title={new Date(row.createdAt).toLocaleString()}>
          {relativeTime(row.createdAt)}
        </span>
      ),
    },
    {
      header: 'From',
      render: (row: AdminFeedbackItem) => (
        <span className="text-slate-700">{row.userEmail}</span>
      ),
    },
    {
      header: 'Role',
      render: (row: AdminFeedbackItem) => (
        <Badge label={row.role} variant="neutral" />
      ),
    },
    {
      header: 'Message',
      render: (row: AdminFeedbackItem) => (
        <p className="max-w-xl whitespace-pre-wrap text-slate-700">{row.message}</p>
      ),
    },
  ];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Product feedback</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Internal Maida platform feedback from diners and owners — not public reviews.
        </p>
        <p className="mt-1 text-sm text-slate-500">{data?.total ?? 0} total</p>
      </div>

      <DataTable
        columns={columns}
        rows={data?.feedback ?? []}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        total={data?.total}
        page={page}
        limit={50}
        onPageChange={setPage}
        emptyText="No feedback submitted yet."
      />
    </div>
  );
}
