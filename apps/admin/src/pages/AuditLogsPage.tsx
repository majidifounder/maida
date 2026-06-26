import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { DataTable } from '../components/DataTable.js';
import { Badge } from '../components/ui/Badge.js';
import type { AdminAuditLog, PaginatedAuditLogs } from '../types/api.js';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function truncateId(id: string | null): string {
  if (!id) return '—';
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export function AuditLogsPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit-logs', page],
    queryFn: () =>
      api.get<PaginatedAuditLogs>(
        `/admin/audit-logs?page=${page}&limit=50`,
      ),
  });

  const columns = [
    {
      header: 'Time',
      render: (log: AdminAuditLog) => (
        <span title={new Date(log.createdAt).toLocaleString()}>
          {relativeTime(log.createdAt)}
        </span>
      ),
    },
    {
      header: 'Actor',
      render: (log: AdminAuditLog) => (
        <span className="font-mono text-xs text-slate-600">
          {truncateId(log.actorId)}
        </span>
      ),
    },
    { header: 'Action', accessor: 'action' as const },
    {
      header: 'Entity',
      render: (log: AdminAuditLog) => (
        <Badge label={log.entityType} variant="neutral" />
      ),
    },
    {
      header: 'Entity ID',
      render: (log: AdminAuditLog) => (
        <span className="font-mono text-xs">{truncateId(log.entityId)}</span>
      ),
    },
    {
      header: 'IP',
      render: (log: AdminAuditLog) => log.ipAddress ?? '—',
    },
  ];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Audit Logs</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {data?.total ?? 0} total · append-only
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={data?.logs ?? []}
        rowKey={(log) => log.id}
        isLoading={isLoading}
        total={data?.total}
        page={page}
        limit={50}
        onPageChange={setPage}
        emptyText="No audit logs yet."
      />
    </div>
  );
}
