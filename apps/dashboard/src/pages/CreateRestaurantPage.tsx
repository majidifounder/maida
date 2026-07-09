import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { api, ApiError } from '../lib/api.js';
import { CUISINE_TYPES, type SeatingMode } from '../types/api.js';
import { resolveTimezone } from '../lib/restaurant-time.js';
import { useOwnerPlan } from '../hooks/useOwnerPlan.js';
import { Card } from '../components/ui/Card.js';
import { Input, Select, TextArea } from '../components/ui/Input.js';
import { Button } from '../components/ui/Button.js';
import { SeatingModeChoice } from '../components/restaurant/SeatingModeChoice.js';
import { TimezonePicker } from '../components/restaurant/TimezonePicker.js';
import {
  resolveServiceHoursPayload,
  ServiceHoursFields,
  validateServiceHoursInput,
} from '../components/restaurant/ServiceHoursFields.js';
import { formatServiceWindow } from '../lib/restaurant-time.js';

const basicsSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(10),
  cuisine: z.enum(CUISINE_TYPES),
  address: z.string().min(5),
  city: z.string().min(2),
});

type BasicsForm = z.infer<typeof basicsSchema>;

const STEPS = ['Basics', 'Operations', 'Service hours', 'Review'] as const;

export function CreateRestaurantPage() {
  const navigate = useNavigate();
  const { limits } = useOwnerPlan();
  const [step, setStep] = useState(0);
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const [seatingMode, setSeatingMode] = useState<SeatingMode>('LOCKED');
  const [openTime, setOpenTime] = useState('11:00');
  const [closeTime, setCloseTime] = useState('23:00');
  const [open24Hours, setOpen24Hours] = useState(false);
  const [defaultDurationMins, setDefaultDurationMins] = useState('90');

  const {
    register,
    handleSubmit,
    getValues,
    trigger,
    formState: { errors },
  } = useForm<BasicsForm>({
    resolver: zodResolver(basicsSchema),
    defaultValues: { cuisine: 'ITALIAN' },
  });

  const goNextFromBasics = handleSubmit(() => {
    setStep(1);
    setApiError(null);
  });

  const createRestaurant = async () => {
    setApiError(null);
    setSubmitting(true);
    const basics = getValues();
    const hours = resolveServiceHoursPayload(openTime, closeTime, open24Hours);
    const duration = Number(defaultDurationMins);
    const effectiveSeatingMode = limits.flexibleSeating ? seatingMode : 'LOCKED';

    const hoursError = validateServiceHoursInput(openTime, closeTime, open24Hours);
    if (hoursError || !hours) {
      setApiError(hoursError ?? 'Enter valid service hours.');
      setSubmitting(false);
      return;
    }
    if (!Number.isInteger(duration) || duration < 15 || duration > 720) {
      setApiError('Default table turn must be between 15 and 720 minutes.');
      setSubmitting(false);
      return;
    }

    try {
      const res = await api.post<{ restaurant: { id: string } }>('/restaurants', {
        ...basics,
        timezone: resolveTimezone(timezone),
        seatingMode: effectiveSeatingMode,
        openMinutes: hours.openMinutes,
        closeMinutes: hours.closeMinutes,
        defaultDurationMins: duration,
      });

      toast.success('Restaurant created');
      navigate(`/restaurants/${res.restaurant.id}`);
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Failed to create restaurant');
    } finally {
      setSubmitting(false);
    }
  };

  const basics = getValues();
  const reviewHours = resolveServiceHoursPayload(openTime, closeTime, open24Hours);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-3xl font-bold">New restaurant</h1>
      <p className="mb-6 text-gray-600">
        Set up how your restaurant accepts reservations — not just its name and address.
      </p>

      <div className="mb-6 flex gap-2">
        {STEPS.map((label, i) => (
          <div
            key={label}
            className={`flex-1 rounded-lg px-2 py-2 text-center text-xs font-medium sm:text-sm ${
              i === step
                ? 'bg-brand text-white'
                : i < step
                  ? 'bg-brand/10 text-brand'
                  : 'bg-gray-100 text-gray-500'
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      <Card>
        {step === 0 && (
          <form onSubmit={(e) => void goNextFromBasics(e)} className="space-y-4">
            <Input label="Name" error={errors.name?.message} {...register('name')} />
            <TextArea
              label="Description"
              error={errors.description?.message}
              {...register('description')}
            />
            <Select label="Cuisine" error={errors.cuisine?.message} {...register('cuisine')}>
              {CUISINE_TYPES.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0) + c.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
            <Input label="Address" error={errors.address?.message} {...register('address')} />
            <Input label="City" error={errors.city?.message} {...register('city')} />
            <Button type="submit">Continue</Button>
          </form>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <TimezonePicker value={timezone} onChange={setTimezone} />
            <SeatingModeChoice value={seatingMode} onChange={setSeatingMode} />
            <div className="flex gap-2">
              <Button variant="secondary" type="button" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button type="button" onClick={() => setStep(2)}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <p className="text-sm text-gray-600">
              Defaults work for most restaurants — you can change these anytime from the
              restaurant settings page.
            </p>
            <ServiceHoursFields
              openTime={openTime}
              closeTime={closeTime}
              defaultDurationMins={defaultDurationMins}
              open24Hours={open24Hours}
              onOpenTimeChange={setOpenTime}
              onCloseTimeChange={setCloseTime}
              onDefaultDurationChange={setDefaultDurationMins}
              onOpen24HoursChange={setOpen24Hours}
            />
            <div className="flex gap-2">
              <Button variant="secondary" type="button" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button type="button" onClick={() => setStep(3)}>
                Review
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="font-medium text-gray-500">Restaurant</dt>
                <dd>
                  {basics.name || '—'} · {basics.city || '—'}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500">Timezone</dt>
                <dd>{timezone}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500">Seating</dt>
                <dd>
                  {seatingMode === 'LOCKED'
                    ? 'Fixed tables'
                    : 'Flexible seating (combinations)'}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500">Service window</dt>
                <dd>
                  {reviewHours
                    ? `${formatServiceWindow(reviewHours.openMinutes, reviewHours.closeMinutes)} · ${defaultDurationMins} min default turn`
                    : '—'}
                </dd>
              </div>
            </dl>

            {apiError && <p className="text-sm text-red-600">{apiError}</p>}

            <div className="flex gap-2">
              <Button variant="secondary" type="button" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                type="button"
                loading={submitting}
                onClick={() => {
                  void trigger().then((ok) => {
                    if (ok) void createRestaurant();
                  });
                }}
              >
                Create restaurant
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
