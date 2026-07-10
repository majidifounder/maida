import type { ReactNode } from 'react';

/**
 * Party-size input built for a host's thumb: big −/+ targets (44px), the
 * number editable directly, common sizes one tap away. No dropdown — a
 * dropdown is three interactions where one will do.
 */
export function PartyStepper({
  value,
  onChange,
  max = 50,
}: {
  value: number;
  onChange: (v: number) => void;
  max?: number;
}): ReactNode {
  const clamp = (v: number): number => Math.max(1, Math.min(max, v));

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Fewer guests"
          onClick={() => onChange(clamp(value - 1))}
          className="h-11 w-11 rounded-btn border border-mist bg-white text-xl text-ink transition-colors hover:bg-fog"
        >
          −
        </button>
        <input
          type="number"
          min={1}
          max={max}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value) || 1))}
          aria-label="Party size"
          className="h-11 w-16 rounded-btn border border-mist text-center font-mono text-lg text-ink focus:border-ink"
        />
        <button
          type="button"
          aria-label="More guests"
          onClick={() => onChange(clamp(value + 1))}
          className="h-11 w-11 rounded-btn border border-mist bg-white text-xl text-ink transition-colors hover:bg-fog"
        >
          +
        </button>
      </div>
      <div className="mt-2 flex gap-1.5">
        {[2, 4, 6, 8].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`h-8 w-10 rounded-btn border text-sm font-medium transition-colors ${
              value === n
                ? 'border-ink bg-ink text-paper'
                : 'border-mist bg-white text-charcoal hover:bg-fog'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
