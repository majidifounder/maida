import { useQuery } from '@tanstack/react-query';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { api } from '../lib/api.js';
import { StatCard } from '../components/ui/StatCard.js';
import { Spinner } from '../components/ui/Spinner.js';
import type { AdminStats } from '../types/api.js';

const PLAN_COLORS: Record<string, string> = {
  STARTER: '#94a3b8',
  PRO: '#3b82f6',
  PREMIUM: '#8b5cf6',
};

export function DashboardPage() {
  const { data, isLoading } = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.get('/admin/stats'),
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const subs = data?.subscriptions;
  const planData = subs
    ? [
        { name: 'STARTER', value: subs.starter },
        { name: 'PRO', value: subs.pro },
        { name: 'PREMIUM', value: subs.premium },
      ].filter((d) => d.value > 0)
    : [];

  const paidCount = (subs?.pro ?? 0) + (subs?.premium ?? 0);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">Platform overview</p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Users"
          value={data?.users.total ?? 0}
          color="blue"
          sub={`${data?.users.owners ?? 0} owners · ${data?.users.diners ?? 0} diners`}
        />
        <StatCard
          label="Restaurants"
          value={data?.restaurants.total ?? 0}
          color="green"
        />
        <StatCard
          label="Total Reservations"
          value={data?.reservations.total ?? 0}
          color="amber"
          sub={`${data?.reservations.thisMonth ?? 0} this month`}
        />
        <StatCard
          label="Paid Plans"
          value={paidCount}
          color="purple"
          sub="PRO + PREMIUM"
        />
      </div>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-900">
          Plan distribution
        </h2>
        {planData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={planData}
                cx="50%"
                cy="50%"
                outerRadius={90}
                dataKey="value"
                label={({ name, value }) => `${name}: ${value}`}
              >
                {planData.map(({ name }) => (
                  <Cell
                    key={name}
                    fill={PLAN_COLORS[name] ?? '#94a3b8'}
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-slate-400">No subscription data yet.</p>
        )}
      </div>
    </div>
  );
}
