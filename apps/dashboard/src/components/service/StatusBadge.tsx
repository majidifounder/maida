import type { ReactNode } from 'react';
import {
  IconArmchair,
  IconCheck,
  IconClock,
  IconUserX,
  IconX,
} from '../ui/icons.js';

/**
 * Brand §4: a status is never color alone — always color + icon + label, so
 * the system stays legible in grayscale, for color-blind staff, and at a
 * dinner-rush glance. Scheduled/Seated are neutral (they are normal states of
 * a healthy service, not alerts); green marks positive completion, red marks
 * cancellation/no-show.
 */
const STATUS: Record<
  string,
  { label: string; icon: (cls: string) => ReactNode; className: string }
> = {
  SCHEDULED: {
    label: 'Scheduled',
    icon: (c) => <IconClock size={13} className={c} />,
    className: 'bg-fog text-charcoal',
  },
  SEATED: {
    label: 'Seated',
    icon: (c) => <IconArmchair size={13} className={c} />,
    className: 'bg-ink text-paper',
  },
  COMPLETED: {
    label: 'Completed',
    icon: (c) => <IconCheck size={13} className={c} />,
    className: 'bg-success-bg text-success-text',
  },
  CANCELLED: {
    label: 'Cancelled',
    icon: (c) => <IconX size={13} className={c} />,
    className: 'bg-danger-bg text-danger-text',
  },
  NO_SHOW: {
    label: 'No-show',
    icon: (c) => <IconUserX size={13} className={c} />,
    className: 'bg-danger-bg text-danger-text',
  },
};

export function StatusBadge({ status }: { status: string }): ReactNode {
  const s = STATUS[status] ?? {
    label: status,
    icon: () => null,
    className: 'bg-fog text-charcoal',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}
    >
      {s.icon('shrink-0')}
      {s.label}
    </span>
  );
}
