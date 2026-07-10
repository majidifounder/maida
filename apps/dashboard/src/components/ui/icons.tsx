import type { SVGProps } from 'react';

/**
 * Inline icon set — Tabler-style: outline, 1.5px stroke, 24px grid,
 * currentColor. Kept as code (no icon-font, no runtime dependency) so every
 * icon renders crisply and inherits the monochrome ramp automatically.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...props }: IconProps) {
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  };
}

export function IconClock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export function IconUserX(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="7" r="4" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M17 9l4 4m0-4l-4 4" />
    </svg>
  );
}

/** Armchair — the brand's "Seated" glyph. */
export function IconArmchair(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 11a2 2 0 0 1 2 2v2h10v-2a2 2 0 1 1 4 0v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z" />
      <path d="M5 11V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5" />
      <path d="M6 19v2m12-2v2" />
    </svg>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="7" r="4" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M21 21v-2a4 4 0 0 0-3-3.85" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M4 11h16" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="7" />
      <path d="M21 21l-6-6" />
    </svg>
  );
}

export function IconNote(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13 20l7-7V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7z" />
      <path d="M13 20v-5a2 2 0 0 1 2-2h5" />
    </svg>
  );
}

/** Door-enter — walk-in. */
export function IconWalkIn(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" />
      <path d="M4 12h9" />
      <path d="M10 9l3 3-3 3" />
    </svg>
  );
}

/** Timer-plus — extend a stay. */
export function IconExtend(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 10v6M9 13h6" />
      <path d="M9 3h6" />
    </svg>
  );
}

/** Door-exit — table freed early. */
export function IconFreeTable(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M11 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5" />
      <path d="M9 12h11" />
      <path d="M17 9l3 3-3 3" />
    </svg>
  );
}

export function IconPhoneBook(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="3" width="14" height="18" rx="2" />
      <path d="M8 7h6M8 11h6M8 15h4" />
      <path d="M21 7v2m0 4v2" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 9v4m0 4h.01" />
      <path d="M10.3 4.1L2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}
