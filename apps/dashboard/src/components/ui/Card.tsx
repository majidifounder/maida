import type { ReactNode } from 'react';

/** White surface on Paper canvas — 12px radius, Mist hairline, minimal shadow. */
export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div
      className={`rounded-card border border-mist bg-white p-5 shadow-card ${className}`}
    >
      {children}
    </div>
  );
}
