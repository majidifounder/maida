import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

/**
 * Maida button hierarchy (brand §7, monochrome):
 * primary = Ink fill · secondary = white + Mist hairline · danger = white with
 * Danger border/text (red is semantic — a destructive action — never a fill).
 * ghost = borderless quiet action for dense rows.
 */
const variantClasses: Record<Variant, string> = {
  primary:
    'bg-ink text-paper hover:bg-charcoal active:bg-ink disabled:bg-stone2 disabled:text-white',
  secondary:
    'bg-white text-ink border border-mist hover:bg-fog active:bg-fog disabled:text-stone2',
  danger:
    'bg-white text-danger-text border border-danger hover:bg-danger-bg active:bg-danger-bg disabled:opacity-50',
  ghost:
    'bg-transparent text-charcoal hover:bg-fog active:bg-fog disabled:text-stone2',
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
};

/**
 * Loading keeps the label visible and the width stable — the button quietly
 * shows work is happening without the layout jumping or the intent vanishing.
 */
function LoadingDot(): ReactNode {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps): ReactNode {
  return (
    <button
      type="button"
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={`inline-flex select-none items-center justify-center rounded-btn font-medium transition-colors duration-150 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {loading && <LoadingDot />}
      {children}
    </button>
  );
}
