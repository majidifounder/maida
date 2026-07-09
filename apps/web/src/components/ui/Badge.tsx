const styles: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800',
  seated: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-gray-100 text-gray-500 line-through',
  no_show: 'bg-red-100 text-red-800',
};

const labels: Record<string, string> = {
  scheduled: 'Scheduled',
  seated: 'Seated',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

export function Badge({ status }: { status: string }) {
  const key = status.toLowerCase();
  const label = labels[key] ?? status.replace(/_/g, ' ');

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
        styles[key] ?? 'bg-gray-100 text-gray-700'
      }`}
    >
      {label}
    </span>
  );
}
