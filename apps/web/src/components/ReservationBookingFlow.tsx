import { useEffect, useMemo, useState } from 'react';

import { Link, useNavigate } from 'react-router-dom';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, ApiError } from '../lib/api.js';

import type {

  AvailabilityResponse,

  PublicRestaurant,

} from '../types/api.js';

import {

  computeQuickPicks,

  flattenScannedSlots,

  hasAnyQuickPick,

  type DayAvailability,

  type ScannedSlot,

} from '../lib/booking-availability.js';

import {

  estimateCustomReservationFee,

  restaurantOffersCustomReservations,

} from '../lib/restaurant-display.js';

import {

  formatRestaurantDateTime,

  formatTimezoneLabel,

} from '../lib/restaurant-time.js';

import {

  DurationPicker,

  durationModeLabel,

  type DurationMode,

} from './DurationPicker.js';

import { TimeQuickPicks } from './TimeQuickPicks.js';

import { Card } from './ui/Card.js';

import { Button } from './ui/Button.js';

import { Input } from './ui/Input.js';



type BookingStep = 'party' | 'datetime' | 'duration' | 'confirm';



const SCAN_DAYS = 7;



function todayIso(): string {

  return new Date().toISOString().slice(0, 10);

}



function scanDatesFromToday(): string[] {

  const dates: string[] = [];

  const base = new Date();

  for (let i = 0; i < SCAN_DAYS; i++) {

    const d = new Date(base);

    d.setUTCDate(d.getUTCDate() + i);

    dates.push(d.toISOString().slice(0, 10));

  }

  return dates;

}



interface CreateReservationResponse {

  reservation: {

    id: string;

    endsAt: string;

    wasCapped?: boolean;

    estimatedFee?: string | null;

    untilClose?: boolean;

  };

}



interface ReservationBookingFlowProps {

  restaurantId: string;

  restaurant: PublicRestaurant;

  isLoggedIn: boolean;

  onSuccess: (result?: { wasCapped: boolean; endsAt: string }) => void;

}



export function ReservationBookingFlow({

  restaurantId,

  restaurant,

  isLoggedIn,

  onSuccess,

}: ReservationBookingFlowProps) {

  const navigate = useNavigate();

  const queryClient = useQueryClient();



  const [step, setStep] = useState<BookingStep>('party');

  const [partySize, setPartySize] = useState(2);

  const [pickerDate, setPickerDate] = useState(todayIso);

  const [selectedEntry, setSelectedEntry] = useState<ScannedSlot | null>(null);

  const [showSpecificPicker, setShowSpecificPicker] = useState(false);

  const [durationMode, setDurationMode] = useState<DurationMode>('standard');

  const [extraHours, setExtraHours] = useState(1);

  const [bookingError, setBookingError] = useState<string | null>(null);

  const [suggestedNext, setSuggestedNext] = useState<string | null>(null);

  const [confirmedEndsAt, setConfirmedEndsAt] = useState<string | null>(null);

  const [confirmedWasCapped, setConfirmedWasCapped] = useState(false);



  const scanDates = useMemo(() => scanDatesFromToday(), []);

  const supportsCustom = restaurantOffersCustomReservations(restaurant);



  const scanQuery = useQuery({

    queryKey: ['availability-scan', restaurantId, partySize, scanDates],

    queryFn: async () => {

      const results = await Promise.all(

        scanDates.map(async (date) => {

          const data = await api.get<AvailabilityResponse>(

            `/restaurants/${restaurantId}/availability?date=${date}&partySize=${partySize}`,

          );

          return { date, ...data } satisfies DayAvailability;

        }),

      );

      return results;

    },

    enabled: step !== 'party' && Boolean(restaurantId),

  });



  const pickerQuery = useQuery({

    queryKey: ['availability', restaurantId, pickerDate, partySize],

    queryFn: () =>

      api.get<AvailabilityResponse>(

        `/restaurants/${restaurantId}/availability?date=${pickerDate}&partySize=${partySize}`,

      ),

    enabled: step === 'datetime' && showSpecificPicker && Boolean(restaurantId),

  });



  const scannedSlots = useMemo(

    () => flattenScannedSlots(scanQuery.data ?? []),

    [scanQuery.data],

  );



  const quickPicks = useMemo(

    () =>

      computeQuickPicks(

        scannedSlots,

        restaurant.timezone,

        selectedEntry?.slot.startsAt ?? null,

      ),

    [scannedSlots, restaurant.timezone, selectedEntry?.slot.startsAt],

  );



  useEffect(() => {

    if (step !== 'datetime' || scanQuery.isLoading) return;

    if (!hasAnyQuickPick(quickPicks)) {

      setShowSpecificPicker(true);

    }

  }, [step, scanQuery.isLoading, quickPicks]);



  const standardDurationMins =

    selectedEntry?.standardDurationMins ??

    scanQuery.data?.[0]?.standardDurationMins ??

    restaurant.defaultDurationMins;



  const serviceWindow =

    selectedEntry?.serviceWindow ??

    scanQuery.data?.[0]?.serviceWindow ?? {

      open: new Date().toISOString(),

      close: new Date().toISOString(),

    };



  const selectedSlot = selectedEntry?.slot ?? null;



  const customFeeEstimate =

    durationMode === 'extended'

      ? estimateCustomReservationFee(

          restaurant,

          standardDurationMins + extraHours * 60,

          standardDurationMins,

        )

      : durationMode === 'untilClose'

        ? estimateCustomReservationFee(

            restaurant,

            standardDurationMins + restaurant.maxExtraHours * 60,

            standardDurationMins,

          )

        : null;



  const reservationMutation = useMutation({

    mutationFn: (payload: Record<string, unknown>) =>

      api.post<CreateReservationResponse>('/reservations', payload),

    onSuccess: (data) => {

      void queryClient.invalidateQueries({ queryKey: ['availability', restaurantId] });

      void queryClient.invalidateQueries({ queryKey: ['availability-scan', restaurantId] });

      setBookingError(null);

      setSuggestedNext(null);

      const wasCapped = Boolean(data.reservation.wasCapped);

      setConfirmedWasCapped(wasCapped);

      setConfirmedEndsAt(data.reservation.endsAt);

      onSuccess(

        wasCapped

          ? { wasCapped: true, endsAt: data.reservation.endsAt }

          : undefined,

      );

    },

    onError: (err: unknown) => {

      if (err instanceof ApiError && err.status === 401) {

        setBookingError('Session expired. Please log in again.');

        navigate('/login');

        return;

      }

      if (err instanceof ApiError && err.status === 409) {

        setBookingError(err.message);

        const next = err.details?.suggestedNextAvailableAt;

        setSuggestedNext(typeof next === 'string' ? next : null);

        return;

      }

      setSuggestedNext(null);

      setBookingError(

        err instanceof ApiError ? err.message : 'Reservation failed. Please try again.',

      );

    },

  });



  const resetFromPartyChange = () => {

    setSelectedEntry(null);

    setBookingError(null);

    setSuggestedNext(null);

    setConfirmedEndsAt(null);

    setConfirmedWasCapped(false);

    setDurationMode('standard');

    setExtraHours(1);

    setShowSpecificPicker(false);

  };



  const selectSlot = (entry: ScannedSlot) => {

    setSelectedEntry(entry);

    setBookingError(null);

    setSuggestedNext(null);

  };



  const goToDatetime = () => {

    resetFromPartyChange();

    setStep('datetime');

  };



  const goAfterTimeSelected = () => {

    if (!selectedEntry) return;

    setBookingError(null);

    setSuggestedNext(null);

    if (supportsCustom) {

      setStep('duration');

    } else {

      setDurationMode('standard');

      setStep('confirm');

    }

  };



  const buildReservationPayload = (startsAt: string) => {

    const base = {

      restaurantId,

      startsAt,

      partySize,

    };

    if (durationMode === 'standard' || !supportsCustom) {

      return { ...base, reservationType: 'STANDARD' as const };

    }

    if (durationMode === 'untilClose') {

      return {

        ...base,

        reservationType: 'CUSTOM' as const,

        untilClose: true,

      };

    }

    return {

      ...base,

      reservationType: 'CUSTOM' as const,

      durationMins: standardDurationMins + extraHours * 60,

    };

  };



  const submitReservation = () => {

    if (!selectedSlot) return;

    if (!isLoggedIn) {

      navigate('/login');

      return;

    }

    reservationMutation.mutate(buildReservationPayload(selectedSlot.startsAt));

  };



  const acceptSuggestedTime = () => {

    if (!suggestedNext) return;

    setSelectedEntry({

      slot: {

        startsAt: suggestedNext,

        endsAt: suggestedNext,

        durationMins: standardDurationMins,

      },

      date: suggestedNext.slice(0, 10),

      standardDurationMins,

      serviceWindow,

    });

    setBookingError(null);

    setSuggestedNext(null);

    reservationMutation.mutate(buildReservationPayload(suggestedNext));

  };



  const activeSteps: BookingStep[] = supportsCustom

    ? ['party', 'datetime', 'duration', 'confirm']

    : ['party', 'datetime', 'confirm'];



  const stepLabels: Record<BookingStep, string> = {

    party: 'Party size',

    datetime: 'When',

    duration: 'How long',

    confirm: 'Confirm',

  };



  if (confirmedEndsAt && !reservationMutation.isPending && !bookingError) {

    return (

      <Card className="mt-10">

        <h2 className="text-xl font-semibold text-gray-900">Reservation confirmed</h2>

        <p className="mt-2 text-sm text-gray-700">

          You&apos;re booked at {restaurant.name} for{' '}

          {selectedSlot &&

            formatRestaurantDateTime(selectedSlot.startsAt, restaurant.timezone)}

          .

        </p>

        {confirmedWasCapped && (

          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">

            Your table is reserved until{' '}

            {formatRestaurantDateTime(confirmedEndsAt, restaurant.timezone)} — slightly

            earlier than requested, because another reservation follows.

          </p>

        )}

        <div className="mt-6 flex flex-wrap gap-2">

          <Link to="/reservations">

            <Button>View my reservations</Button>

          </Link>

          <Button

            variant="secondary"

            onClick={() => {

              resetFromPartyChange();

              setStep('party');

              setConfirmedEndsAt(null);

            }}

          >

            Book another table

          </Button>

        </div>

      </Card>

    );

  }



  return (

    <Card className="mt-10">

      <div className="mb-6">

        <h2 className="text-xl font-semibold">Book a table</h2>

        <p className="mt-1 text-sm text-gray-500">

          All times shown in {formatTimezoneLabel(restaurant.timezone)} — local to the

          restaurant.

        </p>

        <ol className="mt-4 flex flex-wrap gap-2 text-sm">

          {activeSteps.map((s, i) => (

            <li

              key={s}

              className={`flex items-center gap-2 rounded-full px-3 py-1 ${

                step === s

                  ? 'bg-brand-100 font-medium text-brand-800'

                  : 'bg-gray-100 text-gray-500'

              }`}

            >

              <span className="text-xs">{i + 1}</span>

              {stepLabels[s]}

            </li>

          ))}

        </ol>

      </div>



      {step === 'party' && (

        <div className="space-y-4">

          <div className="w-full max-w-xs">

            <Input

              label="How many guests?"

              type="number"

              min={1}

              max={20}

              value={partySize}

              onChange={(e) => {

                setPartySize(Number(e.target.value));

                resetFromPartyChange();

              }}

            />

          </div>

          <Button onClick={goToDatetime}>Continue</Button>

        </div>

      )}



      {step === 'datetime' && (

        <TimeQuickPicks

          timeZone={restaurant.timezone}

          isLoading={scanQuery.isLoading}

          showSpecificPicker={showSpecificPicker}

          onToggleSpecificPicker={setShowSpecificPicker}

          nextAvailable={quickPicks.nextAvailable}

          in30Min={quickPicks.in30Min}

          tonight={quickPicks.tonight}

          tomorrowSameTime={quickPicks.tomorrowSameTime}

          selectedSlot={selectedSlot}

          onSelectSlot={selectSlot}

          onContinue={goAfterTimeSelected}

          onBack={() => setStep('party')}

          pickerDate={pickerDate}

          onPickerDateChange={(date) => {

            setPickerDate(date);

            setSelectedEntry(null);

            setBookingError(null);

            setSuggestedNext(null);

          }}

          minDate={todayIso()}

          pickerTimes={pickerQuery.data?.times ?? []}

          pickerServiceWindow={pickerQuery.data?.serviceWindow ?? null}

          pickerStandardDurationMins={

            pickerQuery.data?.standardDurationMins ?? restaurant.defaultDurationMins

          }

          pickerLoading={pickerQuery.isLoading}

        />

      )}



      {step === 'duration' && selectedSlot && supportsCustom && (

        <DurationPicker

          restaurant={restaurant}

          partySize={partySize}

          standardDurationMins={standardDurationMins}

          startsAt={selectedSlot.startsAt}

          serviceWindow={serviceWindow}

          mode={durationMode}

          extraHours={extraHours}

          onModeChange={setDurationMode}

          onExtraHoursChange={setExtraHours}

          onBack={() => setStep('datetime')}

          onContinue={() => {

            setBookingError(null);

            setSuggestedNext(null);

            setStep('confirm');

          }}

        />

      )}



      {step === 'confirm' && selectedSlot && (

        <div className="space-y-6">

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">

            <h3 className="font-semibold text-gray-900">Reservation summary</h3>

            <dl className="mt-3 space-y-2 text-gray-700">

              <div className="flex justify-between gap-4">

                <dt className="text-gray-500">Restaurant</dt>

                <dd className="text-right font-medium">{restaurant.name}</dd>

              </div>

              <div className="flex justify-between gap-4">

                <dt className="text-gray-500">When</dt>

                <dd className="text-right font-medium">

                  {formatRestaurantDateTime(selectedSlot.startsAt, restaurant.timezone)}

                </dd>

              </div>

              <div className="flex justify-between gap-4">

                <dt className="text-gray-500">Party</dt>

                <dd className="font-medium">

                  {partySize} guest{partySize === 1 ? '' : 's'}

                </dd>

              </div>

              <div className="flex justify-between gap-4">

                <dt className="text-gray-500">Duration</dt>

                <dd className="text-right font-medium">

                  {durationModeLabel(durationMode, extraHours)}

                </dd>

              </div>

              {supportsCustom && durationMode !== 'standard' && (

                <div className="flex justify-between gap-4">

                  <dt className="text-gray-500">Estimated fee</dt>

                  <dd className="text-right font-medium">

                    {customFeeEstimate ?? 'See restaurant'}

                    <span className="mt-0.5 block text-xs font-normal text-gray-500">

                      Added to your bill at the restaurant — Maida does not collect this

                      fee.

                    </span>

                  </dd>

                </div>

              )}

            </dl>

            <p className="mt-3 text-xs text-gray-500">

              Times are in {formatTimezoneLabel(restaurant.timezone)}. Your table is

              assigned automatically — you don&apos;t pick a specific table.

            </p>

          </div>



          {bookingError && (

            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">

              <p>{bookingError}</p>

              {suggestedNext && (

                <div className="mt-3">

                  <p className="font-medium">

                    Next available:{' '}

                    {formatRestaurantDateTime(suggestedNext, restaurant.timezone)}

                  </p>

                  <Button

                    size="sm"

                    className="mt-2"

                    variant="secondary"

                    loading={reservationMutation.isPending}

                    onClick={acceptSuggestedTime}

                  >

                    Use this time instead

                  </Button>

                </div>

              )}

            </div>

          )}



          <div className="flex flex-wrap gap-2">

            {isLoggedIn ? (

              <Button

                loading={reservationMutation.isPending}

                onClick={submitReservation}

              >

                Confirm reservation

              </Button>

            ) : (

              <Link to="/login">

                <Button>Log in to confirm</Button>

              </Link>

            )}

            <Button

              variant="secondary"

              onClick={() => {

                setStep('datetime');

                setBookingError(null);

                setSuggestedNext(null);

              }}

            >

              Change time

            </Button>

            <Button variant="secondary" onClick={() => setStep('party')}>

              Start over

            </Button>

          </div>

        </div>

      )}

    </Card>

  );

}


