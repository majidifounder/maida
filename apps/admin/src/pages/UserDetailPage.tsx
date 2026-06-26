import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '../lib/api.js';
import { Button } from '../components/ui/Button.js';
import { ConfirmModal } from '../components/ConfirmModal.js';
import {
  PlanBadge,
  UserStatusBadge,
  Badge,
} from '../components/ui/Badge.js';
import { Spinner } from '../components/ui/Spinner.js';
import type { AdminUserDetail, Plan } from '../types/api.js';

const PLANS: Plan[] = ['STARTER', 'PRO', 'PREMIUM'];

function formatRole(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [confirmBan, setConfirmBan] = useState(false);

  const { data: user, isLoading } = useQuery({
    queryKey: ['admin', 'users', id],
    queryFn: () => api.get<AdminUserDetail>(`/admin/users/${id}`),
    enabled: Boolean(id),
  });

  const banMutation = useMutation({
    mutationFn: () =>
      api.patch(`/admin/users/${id}/${user?.deletedAt ? 'unban' : 'ban'}`),
    onSuccess: () => {
      toast.success(user?.deletedAt ? 'User unbanned' : 'User banned');
      void qc.invalidateQueries({ queryKey: ['admin', 'users', id] });
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setConfirmBan(false);
    },
    onError: (err: unknown) =>
      toast.error(err instanceof ApiError ? err.message : 'Action failed'),
  });

  const planMutation = useMutation({
    mutationFn: (plan: Plan) => api.patch(`/admin/users/${id}/plan`, { plan }),
    onSuccess: () => {
      toast.success('Plan updated');
      void qc.invalidateQueries({ queryKey: ['admin', 'users', id] });
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err: unknown) =>
      toast.error(
        err instanceof ApiError ? err.message : 'Plan update failed',
      ),
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <div className="p-8 text-slate-500">User not found.</div>;
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link to="/users" className="text-sm text-blue-600 hover:underline">
          ← Users
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{user.email}</h1>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge label={formatRole(user.role)} variant="info" />
                <UserStatusBadge deletedAt={user.deletedAt} />
                {user.role === 'OWNER' && (
                  <PlanBadge plan={user.subscription?.plan ?? 'STARTER'} />
                )}
              </div>
            </div>
            {user.role !== 'ADMIN' && (
              <Button
                variant={user.deletedAt ? 'secondary' : 'danger'}
                size="sm"
                onClick={() => setConfirmBan(true)}
              >
                {user.deletedAt ? 'Unban user' : 'Ban user'}
              </Button>
            )}
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-slate-500">Joined</dt>
              <dd className="font-medium">
                {new Date(user.createdAt).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Restaurants</dt>
              <dd className="font-medium">{user._count?.restaurants ?? 0}</dd>
            </div>
            {user.deletedAt && (
              <div>
                <dt className="text-slate-500">Banned at</dt>
                <dd className="font-medium text-red-600">
                  {new Date(user.deletedAt).toLocaleString()}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {user.role === 'OWNER' && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">
              Subscription
            </h2>
            <PlanBadge plan={user.subscription?.plan ?? 'STARTER'} />
            <p className="mt-2 text-xs text-slate-500">
              Status: {user.subscription?.status ?? 'none'}
            </p>

            <div className="mt-4 flex flex-col gap-2">
              <p className="text-xs font-medium text-slate-500">
                Override plan:
              </p>
              {PLANS.map((plan) => (
                <Button
                  key={plan}
                  variant={
                    user.subscription?.plan === plan ? 'primary' : 'secondary'
                  }
                  size="sm"
                  className="w-full"
                  disabled={
                    planMutation.isPending || user.subscription?.plan === plan
                  }
                  onClick={() => planMutation.mutate(plan)}
                >
                  {plan}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      {user.role === 'OWNER' && user.restaurants.length > 0 && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">
            Restaurants ({user.restaurants.length})
          </h2>
          <ul className="divide-y divide-slate-100">
            {user.restaurants.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between py-3"
              >
                <div>
                  <span className="text-sm font-medium text-slate-900">
                    {r.name}
                  </span>
                  <span className="ml-2 text-xs text-slate-500">{r.city}</span>
                </div>
                <Badge
                  label={r.isActive ? 'Active' : 'Inactive'}
                  variant={r.isActive ? 'success' : 'neutral'}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirmBan && (
        <ConfirmModal
          title={user.deletedAt ? 'Unban this user?' : 'Ban this user?'}
          message={
            user.deletedAt
              ? `${user.email} will be able to log in again.`
              : `${user.email} will be signed out immediately and blocked from logging in.`
          }
          variant={user.deletedAt ? 'primary' : 'danger'}
          confirmLabel={user.deletedAt ? 'Unban' : 'Ban'}
          isLoading={banMutation.isPending}
          onConfirm={() => banMutation.mutate()}
          onCancel={() => setConfirmBan(false)}
        />
      )}
    </div>
  );
}
