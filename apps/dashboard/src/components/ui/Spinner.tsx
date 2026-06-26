export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div
      className={`h-8 w-8 animate-spin rounded-full border-4 border-blue-100 border-t-brand ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}
