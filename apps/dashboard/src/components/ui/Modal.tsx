import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { IconX } from './icons.js';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Slightly wider surface for two-column forms. */
  wide?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal per brand §7 — 16px radius, modal shadow, Ink scrim. Focus is trapped,
 * Escape closes, focus returns to the opener. No entry animation beyond a
 * 150ms fade: the modal should feel like it was already there.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: ModalProps): ReactNode {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    document.addEventListener('keydown', handleKeyDown);

    // Initial focus: the first meaningful field, not the close button.
    const t = setTimeout(() => {
      const panel = panelRef.current;
      const target = panel?.querySelector<HTMLElement>(
        'input, select, textarea, button:not([data-modal-close])',
      );
      target?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(t);
      openerRef.current?.focus();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        className={`relative max-h-[92vh] w-full overflow-y-auto rounded-t-modal bg-white p-6 shadow-modal sm:rounded-modal ${
          wide ? 'sm:max-w-xl' : 'sm:max-w-md'
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-serif text-xl text-ink">{title}</h2>
          <button
            type="button"
            data-modal-close
            onClick={onClose}
            aria-label="Close"
            className="-m-1 rounded-md p-1 text-slate2 transition-colors hover:bg-fog hover:text-ink"
          >
            <IconX size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
