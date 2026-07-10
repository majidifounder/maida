import type { ReactNode } from 'react';

/** Keyboard hint chip — teaches shortcuts passively, in DM Mono. */
export function Kbd({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-mist bg-fog px-1 font-mono text-[11px] text-slate2">
      {children}
    </kbd>
  );
}
