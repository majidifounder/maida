import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '../lib/api.js';
import type {
  DiningTableRow,
  OwnerRestaurant,
  OwnerReservation,
  ReservationsResponse,
} from '../types/api.js';
import {
  addDaysIso,
  formatDayLabel,
  restaurantTodayIso,
} from '../lib/restaurant-time.js';
import {
  useBookingWebSocket,
  type BookingWsEvent,
} from '../hooks/useBookingWebSocket.js';
import { ReservationRow, type RowActions } from '../components/service/ReservationRow.js';
import { WalkInDialog } from '../components/service/WalkInDialog.js';
import { NewBookingDialog } from '../components/service/NewBookingDialog.js';
import { ReservationListSkeleton } from '../components/ui/Skeleton.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Kbd } from '../components/ui/Kbd.js';
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconPhoneBook,
  IconSearch,
  IconSettings,
  IconUsers,
  IconWalkIn,
} from '../components/ui/icons.js';

const DAY_QUERY_LIMIT = 100;

function dayQueryKey(restaurantId: string, date: string) {
  return ['service-reservations', restaurantId, date] as const;
}

function fetchDay(restaurantId: string, date: string) {
  return api.get<ReservationsResponse>(
    `/restaurants/${restaurantId}/reservations?date=${date}&limit=${DAY_QUERY_LIMIT}`,
  );
}

/** True for rows that still count toward service (not cancelled/no-show). */
function isLive(r: OwnerReservation): boolean {
  return r.status !== 'CANCELLED' && r.status !== 'NO_SHOW';
}

export function ServicePage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const restaurantId = id!;
  const queryClient = useQueryClient();

  const restaurantQuery = useQuery({
    queryKey: ['restaurant-config', restaurantId],
    queryFn: () =>
      api
        .get<{ config: OwnerRestaurant }>(`/restaurants/${restaurantId}/config`)
        .then((r) => r.config),
  });
  const timezone = restaurantQuery.data?.timezone ?? 'UTC';

  const todayIso = restaurantTodayIso(timezone);
  const [date, setDate] = useState<string | null>(null);
  const selectedDate = date ?? todayIso;
  const isToday = selectedDate === todayIso;

  const [search, setSearch] = useState('');
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [showFinished, setShowFinished] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // A quiet 30s heartbeat so "time left" on seated rows and the free-tables
  // strip stay honest without any user interaction.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ── Data ────────────────────────────────────────────────────────────────────
  const dayQuery = useQuery({
    queryKey: dayQueryKey(restaurantId, selectedDate),
    queryFn: () => fetchDay(restaurantId, selectedDate),
    staleTime: 15_000,
    // Safety net beneath the WebSocket: worst case, the book is 60s stale.
    refetchInterval: 60_000,
  });

  // Tables power the "free right now" strip — the question a host answers
  // dozens of times a night without wanting to think about it.
  const tablesQuery = useQuery({
    queryKey: ['tables', restaurantId],
    queryFn: () =>
      api
        .get<{ tables: DiningTableRow[] }>(`/restaurants/${restaurantId}/tables`)
        .then((r) => r.tables),
    staleTime: 60_000,
  });

  // Adjacent days are prefetched in the background so the arrows feel like
  // flipping pages in a paper book — no visible loading at all.
  useEffect(() => {
    for (const d of [addDaysIso(selectedDate, 1), addDaysIso(selectedDate, -1)]) {
      void queryClient.prefetchQuery({
        queryKey: dayQueryKey(restaurantId, d),
        queryFn: () => fetchDay(restaurantId, d),
        staleTime: 15_000,
      });
    }
  }, [queryClient, restaurantId, selectedDate]);

  // ── Live updates ────────────────────────────────────────────────────────────
  const onWsEvent = useCallback(
    (event: BookingWsEvent) => {
      void queryClient.invalidateQueries({
        queryKey: ['service-reservations', restaurantId],
      });
      // Only ONLINE arrivals deserve a toast — the host caused everything else
      // and already saw the row change under their finger.
      if (event.eventType === 'reservation.created') {
        toast(`New booking — party of ${event.partySize ?? '?'}`, {
          icon: <IconUsers size={16} />,
          duration: 4000,
        });
      }
    },
    [queryClient, restaurantId],
  );
  const { isConnected } = useBookingWebSocket({
    restaurantId,
    onEvent: onWsEvent,
    enabled: true,
  });

  // New-row flash: anything not seen in the previous payload pulses once.
  const knownIds = useRef<Set<string> | null>(null);
  const [arrivedIds, setArrivedIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const rows = dayQuery.data?.reservations ?? [];
    const ids = new Set(rows.map((r) => r.id));
    if (knownIds.current) {
      const fresh = rows.filter((r) => !knownIds.current!.has(r.id));
      if (fresh.length > 0 && fresh.length < 5) {
        setArrivedIds(new Set(fresh.map((r) => r.id)));
        const t = setTimeout(() => setArrivedIds(new Set()), 1_500);
        return () => clearTimeout(t);
      }
    }
    knownIds.current = ids;
    return undefined;
  }, [dayQuery.data]);
  useEffect(() => {
    knownIds.current = null; // switching days: nothing is "new"
  }, [selectedDate]);

  // ── Lifecycle mutations (optimistic) ────────────────────────────────────────
  const [pendingId, setPendingId] = useState<string | null>(null);

  function useLifecycle(
    path: (rid: string) => string,
    patch: Partial<OwnerReservation>,
    body?: unknown,
  ) {
    return useMutation({
      mutationFn: (reservationId: string) =>
        api.patch(`/restaurants/${restaurantId}${path(reservationId)}`, body),
      onMutate: async (reservationId: string) => {
        setPendingId(reservationId);
        const key = dayQueryKey(restaurantId, selectedDate);
        await queryClient.cancelQueries({ queryKey: key });
        const previous = queryClient.getQueryData<ReservationsResponse>(key);
        queryClient.setQueryData<ReservationsResponse>(key, (old) =>
          old
            ? {
                ...old,
                reservations: old.reservations.map((r) =>
                  r.id === reservationId ? { ...r, ...patch } : r,
                ),
              }
            : old,
        );
        return { previous, key };
      },
      onError: (err: unknown, _id, ctx) => {
        if (ctx?.previous) queryClient.setQueryData(ctx.key, ctx.previous);
        toast.error(
          err instanceof ApiError ? err.message : 'That didn’t go through — the book is unchanged.',
        );
      },
      onSettled: () => {
        setPendingId(null);
        void queryClient.invalidateQueries({
          queryKey: ['service-reservations', restaurantId],
        });
      },
    });
  }

  const seatMutation = useLifecycle(
    (rid) => `/reservations/${rid}/seat`,
    { status: 'SEATED', rawStatus: 'SEATED' },
  );
  const cancelMutation = useLifecycle(
    (rid) => `/reservations/${rid}/cancel`,
    { status: 'CANCELLED', rawStatus: 'CANCELLED' },
    {},
  );
  const noShowMutation = useLifecycle(
    (rid) => `/reservations/${rid}/no-show`,
    { status: 'NO_SHOW', rawStatus: 'NO_SHOW' },
  );
  const freeEarlyMutation = useLifecycle(
    (rid) => `/reservations/${rid}/free-early`,
    { status: 'COMPLETED', rawStatus: 'COMPLETED' },
  );
  const extendMutation = useMutation({
    mutationFn: ({ rid, mins }: { rid: string; mins: number }) =>
      api.patch(
        `/restaurants/${restaurantId}/reservations/${rid}/extend`,
        { additionalMins: mins },
      ),
    onMutate: ({ rid }) => setPendingId(rid),
    onSuccess: (_res, { mins }) => {
      toast.success(`Extended by ${mins} minutes`);
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof ApiError && err.status === 409
          ? 'The next booking on that table is too close to extend.'
          : err instanceof ApiError
            ? err.message
            : 'Could not extend the stay.',
      );
    },
    onSettled: () => {
      setPendingId(null);
      void queryClient.invalidateQueries({
        queryKey: ['service-reservations', restaurantId],
      });
    },
  });

  const rowActions: RowActions = useMemo(
    () => ({
      seat: (rid) => seatMutation.mutate(rid),
      cancel: (rid) => cancelMutation.mutate(rid),
      noShow: (rid) => noShowMutation.mutate(rid),
      freeEarly: (rid) => freeEarlyMutation.mutate(rid),
      extend: (rid, mins) => extendMutation.mutate({ rid, mins }),
    }),
    [seatMutation, cancelMutation, noShowMutation, freeEarlyMutation, extendMutation],
  );

  // ── Keyboard: hands stay on the keys during service ────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;
      if (typing || walkInOpen || bookingOpen) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'w':
          e.preventDefault();
          setWalkInOpen(true);
          break;
        case 'n':
          e.preventDefault();
          setBookingOpen(true);
          break;
        case 't':
          e.preventDefault();
          setDate(null);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setDate(addDaysIso(selectedDate, -1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setDate(addDaysIso(selectedDate, 1));
          break;
        case '/':
          e.preventDefault();
          searchRef.current?.focus();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedDate, walkInOpen, bookingOpen]);

  // ── Derived view ────────────────────────────────────────────────────────────
  const allRows = useMemo(
    () => dayQuery.data?.reservations ?? [],
    [dayQuery.data],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) => {
      const hay = [
        r.guestName ?? '',
        r.diner?.email ?? '',
        ...r.tables.map((t) => t.table.name),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [allRows, search]);

  const seated = filtered.filter((r) => r.rawStatus === 'SEATED' && isLive(r) && r.status === 'SEATED');
  const upcoming = filtered.filter((r) => r.status === 'SCHEDULED');
  const finished = filtered.filter(
    (r) => !seated.includes(r) && !upcoming.includes(r),
  );

  const covers = allRows
    .filter(isLive)
    .reduce((sum, r) => sum + r.partySize, 0);
  const liveCount = allRows.filter(isLive).length;

  // Tables free at this instant: active tables minus any with a live hold
  // covering now (seated parties, or scheduled bookings inside their window).
  const freeTables = useMemo(() => {
    const tables = tablesQuery.data;
    if (!isToday || !tables) return null;
    const busy = new Set<string>();
    for (const r of allRows) {
      if (!isLive(r)) continue;
      const started = new Date(r.startsAt).getTime() <= nowTick;
      const ended = new Date(r.endsAt).getTime() <= nowTick;
      const occupying =
        (r.rawStatus === 'SEATED' && !ended) ||
        (r.rawStatus === 'SCHEDULED' && started && !ended);
      if (!occupying) continue;
      for (const t of r.tables) busy.add(t.tableId);
    }
    return tables.filter((t) => t.isActive && !busy.has(t.id));
  }, [tablesQuery.data, allRows, isToday, nowTick]);

  const showSkeleton = dayQuery.isLoading && !dayQuery.data;

  const renderRows = (rows: OwnerReservation[]): ReactNode =>
    rows.map((r) => (
      <ReservationRow
        key={r.id}
        r={r}
        timezone={timezone}
        isToday={isToday}
        justArrived={arrivedIds.has(r.id)}
        actions={rowActions}
        pendingAction={pendingId === r.id}
        nowMs={nowTick}
      />
    ));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="truncate font-serif text-2xl text-ink">
          {restaurantQuery.data?.name ?? ' '}
        </h1>
        <Link
          to={`/restaurants/${restaurantId}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate2 transition-colors hover:text-ink"
        >
          <IconSettings size={16} />
          Settings
        </Link>
      </div>

      <div className="mb-5 flex items-center gap-2 text-sm text-slate2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            isConnected
              ? 'bg-success-bg text-success-text'
              : 'bg-notice-bg text-notice-text'
          }`}
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${
              isConnected ? 'bg-success' : 'bg-notice'
            }`}
          />
          {isConnected ? 'Live' : 'Reconnecting…'}
        </span>
        <span aria-hidden>·</span>
        <span>
          {liveCount} {liveCount === 1 ? 'booking' : 'bookings'} · {covers} covers
        </span>
        <span aria-hidden>·</span>
        <span>times in {timezone.replace('_', ' ')}</span>
      </div>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center overflow-hidden rounded-btn border border-mist bg-white">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => setDate(addDaysIso(selectedDate, -1))}
            className="flex h-10 w-10 items-center justify-center text-slate2 transition-colors hover:bg-fog hover:text-ink"
          >
            <IconChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => setDate(null)}
            className={`h-10 border-x border-mist px-4 text-sm font-medium transition-colors ${
              isToday ? 'bg-ink text-paper' : 'bg-white text-ink hover:bg-fog'
            }`}
          >
            {formatDayLabel(selectedDate, todayIso)}
          </button>
          <button
            type="button"
            aria-label="Next day"
            onClick={() => setDate(addDaysIso(selectedDate, 1))}
            className="flex h-10 w-10 items-center justify-center text-slate2 transition-colors hover:bg-fog hover:text-ink"
          >
            <IconChevronRight size={18} />
          </button>
        </div>

        <label className="relative">
          <span className="sr-only">Jump to date</span>
          <IconCalendar
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone2"
          />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setDate(e.target.value || null)}
            className="h-10 rounded-btn border border-mist bg-white pl-9 pr-3 text-sm text-ink"
          />
        </label>

        <label className="relative min-w-[160px] flex-1">
          <span className="sr-only">Find a guest or table</span>
          <IconSearch
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone2"
          />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a guest or table…"
            className="h-10 w-full rounded-btn border border-mist bg-white pl-9 pr-3 text-sm text-ink placeholder:text-stone2"
          />
        </label>

        <button
          type="button"
          onClick={() => setBookingOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded-btn border border-mist bg-white px-4 text-sm font-medium text-ink transition-colors hover:bg-fog"
        >
          <IconPhoneBook size={16} />
          New booking
        </button>
        <button
          type="button"
          onClick={() => setWalkInOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded-btn bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-charcoal"
        >
          <IconWalkIn size={16} />
          Walk-in
        </button>
      </div>

      {/* ── Free right now — the question a host asks most ─────────────────── */}
      {freeTables && freeTables.length > 0 && (
        <p className="mb-4 rounded-btn border border-mist bg-white px-3 py-2 text-sm text-charcoal">
          <span className="font-medium text-ink">
            {freeTables.length} {freeTables.length === 1 ? 'table' : 'tables'} free now
          </span>
          <span className="text-slate2">
            {' — '}
            {freeTables.map((t) => t.name).join(' · ')}
          </span>
        </p>
      )}
      {freeTables && freeTables.length === 0 && (tablesQuery.data?.length ?? 0) > 0 && (
        <p className="mb-4 rounded-btn border border-mist bg-fog px-3 py-2 text-sm text-charcoal">
          All tables are taken right now.
        </p>
      )}

      {/* ── The book ───────────────────────────────────────────────────────── */}
      {showSkeleton ? (
        <ReservationListSkeleton />
      ) : allRows.length === 0 ? (
        <EmptyState
          icon={<IconCalendar size={28} />}
          title={
            isToday
              ? 'No reservations yet today.'
              : `No reservations for ${formatDayLabel(selectedDate, todayIso)}.`
          }
          hint={
            isToday
              ? 'Online bookings appear here the moment a guest confirms. Walk-ins land here the moment you seat them.'
              : 'Bookings for this day will appear here as guests confirm.'
          }
          action={
            isToday ? (
              <button
                type="button"
                onClick={() => setWalkInOpen(true)}
                className="inline-flex h-9 items-center gap-2 rounded-btn bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-charcoal"
              >
                <IconWalkIn size={15} />
                Seat a walk-in
              </button>
            ) : undefined
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<IconSearch size={28} />}
          title={`Nothing matches “${search.trim()}”.`}
          hint="Try part of the guest's name, their email, or a table name."
        />
      ) : (
        <div className="space-y-6">
          {seated.length > 0 && (
            <section aria-label="Seated now">
              <h2 className="mb-2 font-sans text-xs font-medium uppercase tracking-wider text-slate2">
                Seated now — {seated.length}
              </h2>
              <div className="space-y-2">{renderRows(seated)}</div>
            </section>
          )}

          {upcoming.length > 0 && (
            <section aria-label="Upcoming">
              <h2 className="mb-2 font-sans text-xs font-medium uppercase tracking-wider text-slate2">
                {isToday ? 'Up next' : 'Bookings'} — {upcoming.length}
              </h2>
              <div className="space-y-2">{renderRows(upcoming)}</div>
            </section>
          )}

          {finished.length > 0 && (
            <section aria-label="Finished">
              <button
                type="button"
                onClick={() => setShowFinished((v) => !v)}
                className="mb-2 inline-flex items-center gap-1.5 font-sans text-xs font-medium uppercase tracking-wider text-slate2 transition-colors hover:text-ink"
                aria-expanded={showFinished}
              >
                <IconChevronRight
                  size={14}
                  className={`transition-transform duration-150 ${showFinished ? 'rotate-90' : ''}`}
                />
                Finished — {finished.length}
              </button>
              {showFinished && <div className="space-y-2">{renderRows(finished)}</div>}
            </section>
          )}
        </div>
      )}

      {/* ── Keyboard hints — teach passively, never nag ───────────────────── */}
      <div className="mt-8 hidden flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone2 sm:flex">
        <span className="flex items-center gap-1.5">
          <Kbd>W</Kbd> Walk-in
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>N</Kbd> New booking
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>T</Kbd> Today
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd> Days
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>/</Kbd> Search
        </span>
      </div>

      <WalkInDialog
        restaurantId={restaurantId}
        open={walkInOpen}
        onClose={() => setWalkInOpen(false)}
      />
      <NewBookingDialog
        restaurantId={restaurantId}
        timezone={timezone}
        defaultDate={selectedDate}
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
      />
    </div>
  );
}
