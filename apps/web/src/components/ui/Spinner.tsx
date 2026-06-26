export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div
      className={`h-8 w-8 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600 ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}
