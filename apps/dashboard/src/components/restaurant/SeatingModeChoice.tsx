import type { SeatingMode } from '../../types/api.js';
import { useOwnerPlan } from '../../hooks/useOwnerPlan.js';
import { PlanGateNotice } from '../PlanGateNotice.js';

interface SeatingModeChoiceProps {
  value: SeatingMode;
  onChange: (mode: SeatingMode) => void;
  disabled?: boolean;
}

const OPTIONS: Array<{
  mode: SeatingMode;
  title: string;
  description: string;
  requiresFlexible?: boolean;
}> = [
  {
    mode: 'LOCKED',
    title: 'Fixed tables',
    description:
      'Each table is booked individually. Simplest setup — best for most restaurants.',
  },
  {
    mode: 'FLEXIBLE',
    title: 'Flexible seating',
    description:
      'Combine tables for larger parties using predefined table merges. Requires active table combinations.',
    requiresFlexible: true,
  },
];

export function SeatingModeChoice({ value, onChange, disabled }: SeatingModeChoiceProps) {
  const { limits, billingTier } = useOwnerPlan();
  const tierLabel = billingTier === 'TRIAL' ? 'trial' : billingTier.toLowerCase();

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        How should reservations use your floor plan?
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((opt) => {
          const locked = opt.requiresFlexible && !limits.flexibleSeating;
          const selected = value === opt.mode;
          return (
            <button
              key={opt.mode}
              type="button"
              disabled={disabled || locked}
              onClick={() => onChange(opt.mode)}
              className={`rounded-xl border p-4 text-left transition ${
                selected
                  ? 'border-brand bg-brand/5 ring-2 ring-brand'
                  : 'border-gray-200 hover:border-gray-300'
              } ${locked ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <p className="font-semibold text-gray-900">{opt.title}</p>
              <p className="mt-1 text-sm text-gray-600">{opt.description}</p>
              {locked && (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  Unavailable on {tierLabel} — upgrade to Pro
                </p>
              )}
            </button>
          );
        })}
      </div>
      {!limits.flexibleSeating && (
        <PlanGateNotice
          message={
            billingTier === 'TRIAL'
              ? 'Flexible seating is not included in the free trial. Upgrade to Pro or Premium after subscribing.'
              : 'Flexible seating and table combinations require a Pro or Premium plan.'
          }
          ctaLabel="Compare plans on Billing →"
        />
      )}
    </div>
  );
}
