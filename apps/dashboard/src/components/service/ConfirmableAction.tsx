import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Two-step inline confirmation for destructive actions.
 *
 * Why not a modal: during service, a modal steals the whole screen for a
 * one-row decision and breaks the host's scanning position.
 * Why not undo: cancelling/no-showing emails the guest immediately and the
 * API has no reverse transition — undo would be a lie. (When reinstatement
 * lands server-side, this component is where undo replaces confirmation.)
 *
 * First press arms the button (it restates the consequence in Danger styling);
 * a second press within 4s executes; anything else disarms.
 */
export function ConfirmableAction({
  label,
  confirmLabel,
  onConfirm,
  disabled = false,
  icon,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  icon?: ReactNode;
}): ReactNode {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleClick = (): void => {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 4_000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    onConfirm();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handleClick}
      onBlur={() => {
        if (timer.current) clearTimeout(timer.current);
        setArmed(false);
      }}
      className={`inline-flex h-8 items-center gap-1.5 rounded-btn px-2.5 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
        armed
          ? 'border border-danger bg-danger-bg text-danger-text'
          : 'text-slate2 hover:bg-fog hover:text-ink'
      }`}
    >
      {icon}
      {armed ? confirmLabel : label}
    </button>
  );
}
