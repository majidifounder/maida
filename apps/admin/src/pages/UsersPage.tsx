import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, ApiError } from '../lib/api.js';
import { DataTable } from '../components/DataTable.js';
import { ConfirmModal } from '../components/ConfirmModal.js';
import { Button } from '../components/ui/Button.js';
import { PlanBadge, UserStatusBadge } from '../components/ui/Badge.js';
import type {
  AdminUserListItem,
  PaginatedUsers,
  Plan,
} from '../types/api.js';

type BanAction = { type: 'ban' | 'unban'; user: AdminUserListItem };
type PlanAction = { user: AdminUserListItem; newPlan: Plan };

const PLANS: Plan[] = ['STARTER', 'PRO', 'PREMIUM'];

function formatRole(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export function UsersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [banAction, setBanAction] = useState<BanAction | null>(null);
  const [planAction, setPlanAction] = useState<PlanAction | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', page, search],
    queryFn: () =>
      api.get<PaginatedUsers>(
        `/admin/users?page=${page}&limit=20${search ? `&q=${encodeURIComponent(search)}` : ''}`,
      ),
  });

  const banMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'ban' | 'unban' }) =>
      api.patch(`/admin/users/${id}/${action}`),
    onSuccess: () => {
      toast.success(
        banAction?.type === 'ban' ? 'User banned' : 'User unbanned',
      );
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setBanAction(null);
    },
    onError: (err: unknown) =>
      toast.error(err instanceof ApiError ? err.message : 'Action failed'),
  });

  const planMutation = useMutation({
    mutationFn: ({ id, plan }: { id: string; plan: Plan }) =>
      api.patch(`/admin/users/${id}/plan`, { plan }),
    onSuccess: () => {
      toast.success(`Plan updated to ${planAction?.newPlan}`);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setPlanAction(null);
    },
    onError: (err: unknown) =>
      toast.error(
        err instanceof ApiError ? err.message : 'Plan update failed',
      ),
  });

  const columns = [
    {
      header: 'Email',
      render: (u: AdminUserListItem) => (
        <Link
          to={`/users/${u.id}`}
          className="font-medium text-blue-600 hover:underline"
        >
          {u.email}
        </Link>
      ),
    },
    {
      header: 'Role',
      render: (u: AdminUserListItem) => (
        <span className="text-slate-600">{formatRole(u.role)}</span>
      ),
    },
    {
      header: 'Plan',
      render: (u: AdminUserListItem) => (
        <PlanBadge plan={u.subscription?.plan ?? 'STARTER'} />
      ),
    },
    {
      header: 'Status',
      render: (u: AdminUserListItem) => (
        <UserStatusBadge deletedAt={u.deletedAt} />
      ),
    },
    {
      header: 'Joined',
      render: (u: AdminUserListItem) =>
        new Date(u.createdAt).toLocaleDateString(),
    },
    {
      header: 'Actions',
      render: (u: AdminUserListItem) => (
        <div className="flex items-center gap-2">
          {u.role === 'OWNER' && (
            <select
              className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
              value={u.subscription?.plan ?? 'STARTER'}
              onChange={(e) =>
                setPlanAction({
                  user: u,
                  newPlan: e.target.value as Plan,
                })
              }
            >
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
          {u.role !== 'ADMIN' &&
            (u.deletedAt ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setBanAction({ type: 'unban', user: u })}
              >
                Unban
              </Button>
            ) : (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setBanAction({ type: 'ban', user: u })}
              >
                Ban
              </Button>
            ))}
        </div>
      ),
    },
  ];

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Users</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {data?.total ?? 0} total
          </p>
        </div>
        <input
          type="search"
          placeholder="Search by email…"
          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <DataTable
        columns={columns}
        rows={data?.users ?? []}
        rowKey={(u) => u.id}
        isLoading={isLoading}
        total={data?.total}
        page={page}
        limit={20}
        onPageChange={setPage}
        emptyText="No users found."
      />

      {banAction && (
        <ConfirmModal
          title={banAction.type === 'ban' ? 'Ban user?' : 'Unban user?'}
          message={`${
            banAction.type === 'ban'
              ? 'This user will be immediately signed out and blocked from logging in.'
              : 'This user will be able to log in again.'
          }\n\n${banAction.user.email}`}
          confirmLabel={banAction.type === 'ban' ? 'Ban user' : 'Unban user'}
          variant={banAction.type === 'ban' ? 'danger' : 'primary'}
          isLoading={banMutation.isPending}
          onConfirm={() =>
            banMutation.mutate({
              id: banAction.user.id,
              action: banAction.type,
            })
          }
          onCancel={() => setBanAction(null)}
        />
      )}

      {planAction && (
        <ConfirmModal
          title="Change subscription plan?"
          message={`Change ${planAction.user.email} from ${planAction.user.subscription?.plan ?? 'STARTER'} to ${planAction.newPlan}?`}
          confirmLabel={`Set to ${planAction.newPlan}`}
          variant="primary"
          isLoading={planMutation.isPending}
          onConfirm={() =>
            planMutation.mutate({
              id: planAction.user.id,
              plan: planAction.newPlan,
            })
          }
          onCancel={() => setPlanAction(null)}
        />
      )}
    </div>
  );
}
