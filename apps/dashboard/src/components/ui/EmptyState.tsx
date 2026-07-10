import type { ReactNode } from 'react';

/**
 * Empty states are calm, specific, and end with the next action — never a
 * dead end, never an apology. (Brand voice: clear, warm, direct.)
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-mist bg-white px-6 py-12 text-center">
      {icon && <div className="mb-3 text-stone2">{icon}</div>}
      <p className="text-sm font-medium text-charcoal">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-slate2">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
