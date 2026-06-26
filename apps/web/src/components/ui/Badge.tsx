const styles: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
};

function normalizeStatus(status: string): string {
  return status.toLowerCase();
}

export function Badge({ status }: { status: string }) {
  const key = normalizeStatus(status);
  const label = key.charAt(0).toUpperCase() + key.slice(1);

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
