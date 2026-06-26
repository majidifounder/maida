interface Props {
  label: string;
  value: number | string;
  sub?: string;
  color?: 'blue' | 'green' | 'amber' | 'red' | 'purple';
}

const colors = {
  blue: 'bg-blue-50 border-blue-200 text-blue-700',
  green: 'bg-green-50 border-green-200 text-green-700',
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  red: 'bg-red-50 border-red-200 text-red-700',
  purple: 'bg-purple-50 border-purple-200 text-purple-700',
};

export function StatCard({
  label,
  value,
  sub,
  color = 'blue',
}: Props) {
  return (
    <div className={`rounded-xl border p-5 ${colors[color]}`}>
      <p className="text-sm font-medium opacity-80">{label}</p>
      <p className="mt-1 text-4xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs opacity-70">{sub}</p>}
    </div>
  );
}
