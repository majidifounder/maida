import { useState, type ReactNode } from 'react';
import type { OwnerReservation } from '../../types/api.js';
import { formatTimeInTz } from '../../lib/restaurant-time.js';
import { StatusBadge } from './StatusBadge.js';
import { ConfirmableAction } from './ConfirmableAction.js';
import {
  IconArmchair,
  IconExtend,
  IconFreeTable,
  IconNote,
  IconUsers,
  IconUserX,
  IconWalkIn,
  IconX,
} from '../ui/icons.js';

export interface RowActions {
  seat: (id: string) => void;
  cancel: (id: string) => void;
  noShow: (id: string) => void;
  extend: (id: string, mins: number) => void;
  freeEarly: (id: string) => void;
}

const EXTEND_CHOICES = [15, 30, 60] as const;

function guestLabel(r: OwnerReservation): string {
  if (r.guestName) return r.guestName;
  if (r.diner?.email) return r.diner.email;
  return r.source === 'WALK_IN' ? 'Walk-in' : 'Guest';
}

/**
 * One reservation, one line. Time and covers are fixed-width (DM Mono) so a
 * column of rows scans like a service sheet. Actions live at the end and are
 * CONTEXTUAL — only what is legal for the row's real (raw) status is shown,
 * so the host never wonders why a button didn't work.
 */
/** "25 min left" / "5 min over" for a seated party — the host's most common
 * mental math, done for them. Rounded to 5 so it never looks falsely precise. */
function timeLeftLabel(endsAtIso: string, nowMs: number): string {
  const mins = Math.round((new Date(endsAtIso).getTime() - nowMs) / 60_000 / 5) * 5;
  if (mins > 0) return `${mins} min left`;
  if (mins === 0) return 'ending now';
  return `${-mins} min over`;
}

export function ReservationRow({
  r,
  timezone,
  isToday,
  justArrived,
  actions,
  pendingAction,
  nowMs,
}: {
  r: OwnerReservation;
  timezone: string;
  isToday: boolean;
  justArrived: boolean;
  actions: RowActions;
  /** Row id currently mid-mutation — its actions dim without blocking others. */
  pendingAction: boolean;
  /** Shared clock tick from the page — keeps every row's math consistent. */
  nowMs: number;
}): ReactNode {
  const [extendOpen, setExtendOpen] = useState(false);

  const raw = r.rawStatus;
  const now = nowMs;
  const started = new Date(r.startsAt).getTime() <= now;
  const finished = ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(r.status);

  const tables = r.tables.map((t) => t.table.name).join(' · ');
  const seatedNow = raw === 'SEATED' && !finished;
  const overtime =
    seatedNow && new Date(r.endsAt).getTime() < now;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-mist bg-white px-4 py-3 shadow-card transition-opacity ${
        finished ? 'opacity-60' : ''
      } ${justArrived ? 'row-arrive' : ''} ${pendingAction ? 'opacity-70' : ''}`}
    >
      <span className="w-[72px] shrink-0 font-mono text-sm text-ink">
        {formatTimeInTz(r.startsAt, timezone)}
      </span>

      <span
        className="flex w-12 shrink-0 items-center gap-1 font-mono text-sm text-charcoal"
        title={`Party of ${r.partySize}`}
      >
        <IconUsers size={14} className="text-stone2" />
        {r.partySize}
      </span>

      <span className="min-w-0 flex-1 basis-40">
        <span className="flex items-center gap-1.5">
          {r.source === 'WALK_IN' && (
            <IconWalkIn size={14} className="shrink-0 text-stone2" />
          )}
          <span className="truncate text-sm font-medium text-ink">
            {guestLabel(r)}
          </span>
          {r.notes && (
            <span title={r.notes} className="shrink-0 text-notice-text">
              <IconNote size={14} />
            </span>
          )}
        </span>
        {(tables || seatedNow) && (
          <span className="block truncate text-xs text-slate2">
            {tables}
            {seatedNow && (
              <span className={overtime ? 'text-notice-text' : ''}>
                {tables ? ' · ' : ''}
                {timeLeftLabel(r.endsAt, now)}
              </span>
            )}
          </span>
        )}
      </span>

      <StatusBadge status={r.status} />

      <span className="flex shrink-0 items-center gap-1">
        {raw === 'SCHEDULED' && !finished && isToday && (
          <button
            type="button"
            disabled={pendingAction}
            onClick={() => actions.seat(r.id)}
            className="inline-flex h-8 items-center gap-1.5 rounded-btn bg-ink px-3 text-sm font-medium text-paper transition-colors hover:bg-charcoal disabled:opacity-50"
          >
            <IconArmchair size={14} />
            Seat
          </button>
        )}

        {raw === 'SCHEDULED' && started && (
          <ConfirmableAction
            label="No-show"
            confirmLabel="Confirm no-show"
            icon={<IconUserX size={14} />}
            disabled={pendingAction}
            onConfirm={() => actions.noShow(r.id)}
          />
        )}

        {raw === 'SCHEDULED' && !finished && (
          <ConfirmableAction
            label="Cancel"
            confirmLabel="Cancel booking?"
            icon={<IconX size={14} />}
            disabled={pendingAction}
            onConfirm={() => actions.cancel(r.id)}
          />
        )}

        {raw === 'SEATED' && !finished && (
          <span className="relative">
            <button
              type="button"
              disabled={pendingAction}
              onClick={() => setExtendOpen((v) => !v)}
              className="inline-flex h-8 items-center gap-1.5 rounded-btn px-2.5 text-sm font-medium text-slate2 transition-colors hover:bg-fog hover:text-ink disabled:opacity-50"
            >
              <IconExtend size={14} />
              Extend
            </button>
            {extendOpen && (
              <span className="absolute right-0 top-9 z-[100] flex overflow-hidden rounded-btn border border-mist bg-white shadow-raised">
                {EXTEND_CHOICES.map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => {
                      setExtendOpen(false);
                      actions.extend(r.id, mins);
                    }}
                    className="px-3 py-2 font-mono text-sm text-ink transition-colors hover:bg-fog"
                  >
                    +{mins}
                  </button>
                ))}
              </span>
            )}
          </span>
        )}

        {raw === 'SEATED' && !finished && (
          <button
            type="button"
            disabled={pendingAction}
            onClick={() => actions.freeEarly(r.id)}
            className="inline-flex h-8 items-center gap-1.5 rounded-btn px-2.5 text-sm font-medium text-slate2 transition-colors hover:bg-fog hover:text-ink disabled:opacity-50"
            title="Guests left — finish the reservation and free the table"
          >
            <IconFreeTable size={14} />
            Free table
          </button>
        )}

        {/* The display layer retires past rows as COMPLETED, but the truth may
            still be SCHEDULED (guest never came). Keep no-show reachable. */}
        {finished && raw === 'SCHEDULED' && r.status === 'COMPLETED' && (
          <ConfirmableAction
            label="Mark no-show"
            confirmLabel="Confirm no-show"
            icon={<IconUserX size={14} />}
            disabled={pendingAction}
            onConfirm={() => actions.noShow(r.id)}
          />
        )}
      </span>
    </div>
  );
}
