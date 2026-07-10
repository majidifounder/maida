/**
 * Monochrome spinner. Use sparingly — skeletons cover initial loads, buttons
 * carry their own inline indicator, and background refreshes show nothing.
 * This exists for the rare truly-indeterminate wait.
 */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div
      className={`h-6 w-6 animate-spin rounded-full border-2 border-mist border-t-ink ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}
