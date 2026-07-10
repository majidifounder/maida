import type { ReactNode } from 'react';

/** Fog placeholder block. Compose into layout-shaped loading states. */
export function Skeleton({ className = '' }: { className?: string }): ReactNode {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

/**
 * Skeleton for the service list — mirrors the real row geometry so the page
 * doesn't reflow when data lands. Shown ONLY on the first load of a day;
 * navigating between days keeps the previous list visible instead.
 */
export function ReservationListSkeleton(): ReactNode {
  return (
    <div role="status" aria-label="Loading reservations" className="space-y-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-card border border-mist bg-white px-4 py-3"
        >
          <Skeleton className="h-5 w-14" />
          <Skeleton className="h-5 w-40 flex-1" />
          <Skeleton className="h-5 w-10" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}
