type Variant = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'purple';

const variants: Record<Variant, string> = {
  success: 'bg-green-100 text-green-800',
  danger: 'bg-red-100 text-red-800',
  warning: 'bg-amber-100 text-amber-800',
  info: 'bg-blue-100 text-blue-800',
  neutral: 'bg-slate-100 text-slate-700',
  purple: 'bg-purple-100 text-purple-800',
};

export function Badge({
  label,
  variant = 'neutral',
}: {
  label: string;
  variant?: Variant;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${variants[variant]}`}
    >
      {label}
    </span>
  );
}

export function PlanBadge({ plan }: { plan: string }) {
  const map: Record<string, Variant> = {
    STARTER: 'neutral',
    PRO: 'info',
    PREMIUM: 'purple',
  };
  return <Badge label={plan} variant={map[plan] ?? 'neutral'} />;
}

export function BookingStatusBadge({ status }: { status: string }) {
  const map: Record<string, Variant> = {
    PENDING: 'warning',
    CONFIRMED: 'success',
    CANCELLED: 'danger',
    NO_SHOW: 'neutral',
  };
  return <Badge label={status} variant={map[status] ?? 'neutral'} />;
}

export function UserStatusBadge({
  deletedAt,
}: {
  deletedAt: string | null;
}) {
  return deletedAt ? (
    <Badge label="Banned" variant="danger" />
  ) : (
    <Badge label="Active" variant="success" />
  );
}
