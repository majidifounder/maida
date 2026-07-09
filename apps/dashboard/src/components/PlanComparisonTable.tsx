import type { PlanComparisonRow } from '@restaurant/types';
import {
  billingTierLabel,
  formatLimit,
  yesNo,
} from '../lib/plan-limits.js';

interface PlanComparisonTableProps {
  rows: PlanComparisonRow[];
  highlightTier?: string;
}

export function PlanComparisonTable({
  rows,
  highlightTier,
}: PlanComparisonTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-gray-600">
          <tr>
            <th className="px-4 py-3 font-medium">Feature</th>
            {rows.map((row) => (
              <th
                key={row.tier}
                className={`px-4 py-3 font-semibold ${
                  highlightTier === row.tier ? 'text-brand' : 'text-gray-900'
                }`}
              >
                {row.label}
                {row.price && (
                  <span className="mt-1 block text-xs font-normal text-gray-500">
                    {row.price}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-gray-700">
          <ComparisonRow
            label="Restaurants"
            rows={rows}
            highlightTier={highlightTier}
            value={(limits) => formatLimit(limits.restaurants)}
          />
          <ComparisonRow
            label="Reservations / month"
            rows={rows}
            highlightTier={highlightTier}
            value={(limits) => formatLimit(limits.reservationsPerMonth)}
          />
          <ComparisonRow
            label="Tables / restaurant"
            rows={rows}
            highlightTier={highlightTier}
            value={(limits) => formatLimit(limits.tablesPerRestaurant)}
          />
          <ComparisonRow
            label="Flexible seating"
            rows={rows}
            highlightTier={highlightTier}
            value={(limits) => yesNo(limits.flexibleSeating)}
          />
          <ComparisonRow
            label="Table combinations"
            rows={rows}
            highlightTier={highlightTier}
            value={(limits) => formatLimit(limits.combinationsPerRestaurant)}
          />
          <ComparisonRow
            label="Turn-time rules"
            rows={rows}
            highlightTier={highlightTier}
            value={(limits) => formatLimit(limits.turnTimeRulesPerRestaurant)}
          />
          <ComparisonRow
            label="Custom reservations & fees"
            rows={rows}
            highlightTier={highlightTier}
            value={(limits) => yesNo(limits.customReservations)}
          />
        </tbody>
      </table>
    </div>
  );
}

function ComparisonRow({
  label,
  rows,
  highlightTier,
  value,
}: {
  label: string;
  rows: PlanComparisonRow[];
  highlightTier?: string | undefined;
  value: (limits: PlanComparisonRow['limits']) => string;
}) {
  return (
    <tr>
      <td className="px-4 py-3 font-medium text-gray-900">{label}</td>
      {rows.map((row) => (
        <td
          key={row.tier}
          className={`px-4 py-3 ${
            highlightTier === row.tier ? 'bg-brand/5 font-semibold text-brand' : ''
          }`}
        >
          {value(row.limits)}
        </td>
      ))}
    </tr>
  );
}

export { billingTierLabel };
