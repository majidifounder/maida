import { useMemo, useState } from 'react';
import {
  buildTimezoneOptions,
  formatTimezoneLabel,
  findTimezoneOption,
  isValidIanaTimezone,
  type TimezoneOption,
} from '../../lib/restaurant-time.js';

interface TimezonePickerProps {
  value: string;
  onChange: (timeZone: string) => void;
  label?: string;
}

function matchesQuery(option: TimezoneOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    option.city.toLowerCase().includes(q) ||
    option.region.toLowerCase().includes(q) ||
    option.value.toLowerCase().includes(q)
  );
}

export function TimezonePicker({ value, onChange, label = 'Timezone' }: TimezonePickerProps) {
  const [query, setQuery] = useState('');
  const options = useMemo(() => buildTimezoneOptions(value), [value]);

  const filtered = useMemo(
    () => options.filter((opt) => matchesQuery(opt, query)),
    [options, query],
  );

  const selected = findTimezoneOption(value) ?? {
    value,
    city: value.replace(/_/g, ' '),
    region: 'Other',
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <p className="text-xs text-gray-500">
        Search by city or region. Offsets shown for orientation only — the stored
        value is a real timezone that adjusts for daylight saving.
      </p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search city or region…"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-sm text-gray-500">No matching timezones.</p>
        ) : (
          filtered.map((opt) => {
            const selectedRow = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(opt.value)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${
                  selectedRow
                    ? 'bg-brand/10 font-medium text-brand'
                    : 'hover:bg-gray-50 text-gray-800'
                }`}
              >
                <span>{formatTimezoneLabel(opt)}</span>
                <span className="text-xs text-gray-400">{opt.region}</span>
              </button>
            );
          })
        )}
      </div>
      <p className="text-xs text-gray-600">
        Selected: <strong>{formatTimezoneLabel(selected)}</strong>
        {!isValidIanaTimezone(value) && (
          <span className="text-red-600"> — invalid timezone, will default to UTC on save</span>
        )}
      </p>
    </div>
  );
}
