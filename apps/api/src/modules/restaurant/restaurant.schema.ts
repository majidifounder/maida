import { z } from 'zod';
import { CuisineType, SeatingMode } from '@restaurant/db';
import { isValidIanaTimezone } from '../../lib/timezone.js';
import { validateServiceHours } from '../../lib/service-hours.js';

const IanaTimezoneSchema = z
  .string()
  .max(64)
  .refine(isValidIanaTimezone, { message: 'Must be a valid IANA timezone' });

export const CreateRestaurantSchema = z
  .object({
    name: z.string().min(2).max(120).trim(),
    description: z.string().min(10).max(1000).trim(),
    cuisine: z.nativeEnum(CuisineType),
    address: z.string().min(5).max(300).trim(),
    city: z.string().min(2).max(100).trim(),
    imageUrl: z.string().url().optional(),
    timezone: IanaTimezoneSchema.optional(),
    seatingMode: z.nativeEnum(SeatingMode).optional(),
    defaultDurationMins: z.number().int().min(15).max(720).optional(),
    openMinutes: z.number().int().min(0).max(1439).optional(),
    closeMinutes: z.number().int().min(1).max(1440).optional(),
  })
  .superRefine((data, ctx) => {
    const err = validateServiceHours(data.openMinutes, data.closeMinutes);
    if (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err,
        path: ['closeMinutes'],
      });
    }
  });

export const UpdateRestaurantSchema = z.object({
  name: z.string().min(2).max(120).trim().optional(),
  description: z.string().min(10).max(1000).trim().optional(),
  cuisine: z.nativeEnum(CuisineType).optional(),
  address: z.string().min(5).max(300).trim().optional(),
  city: z.string().min(2).max(100).trim().optional(),
  imageUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().optional(),
  timezone: IanaTimezoneSchema.optional(),
});

export const UpdateReservationConfigSchema = z
  .object({
    seatingMode: z.nativeEnum(SeatingMode).optional(),
    defaultDurationMins: z.number().int().min(15).max(720).optional(),
    openMinutes: z.number().int().min(0).max(1439).optional(),
    closeMinutes: z.number().int().min(1).max(1440).optional(),
    timezone: IanaTimezoneSchema.optional(),
    customFee: z.number().min(0).nullable().optional(),
    extraHourFee: z.number().min(0).nullable().optional(),
    feeCurrency: z.string().length(3).optional(),
    maxExtraHours: z.number().int().min(0).max(6).optional(),
  })
  .superRefine((data, ctx) => {
    const err = validateServiceHours(data.openMinutes, data.closeMinutes);
    if (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err,
        path: ['closeMinutes'],
      });
    }
  });

export const SearchRestaurantsSchema = z.object({
  q: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  cuisine: z.nativeEnum(CuisineType).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .optional(),
  partySize: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const GetAvailabilityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  partySize: z.coerce.number().int().min(1).default(2),
});

export const CreateTableSchema = z.object({
  name: z.string().min(1).max(60).trim(),
  minPartySize: z.number().int().min(1).default(1),
  maxPartySize: z.number().int().min(1),
});

export const UpdateTableSchema = z.object({
  name: z.string().min(1).max(60).trim().optional(),
  minPartySize: z.number().int().min(1).optional(),
  maxPartySize: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
});

export const CreateCombinationSchema = z.object({
  name: z.string().min(1).max(60).trim(),
  minPartySize: z.number().int().min(1).default(1),
  maxPartySize: z.number().int().min(1),
  tableIds: z.array(z.string().uuid()).min(2),
});

export const UpdateCombinationSchema = z.object({
  name: z.string().min(1).max(60).trim().optional(),
  minPartySize: z.number().int().min(1).optional(),
  maxPartySize: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
  tableIds: z.array(z.string().uuid()).min(2).optional(),
});

export const CreateTurnTimeRuleSchema = z.object({
  minPartySize: z.number().int().min(1),
  maxPartySize: z.number().int().min(1),
  durationMins: z.number().int().min(15).max(720),
});

// A single service window on one weekday. `closeMinute <= openMinute` means the
// window runs past local midnight into the next day (overnight service).
const ServicePeriodSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openMinute: z.number().int().min(0).max(1439),
  closeMinute: z.number().int().min(1).max(1440),
});

export const ReplaceScheduleSchema = z.object({
  // At most a handful of windows per day across the week; cap defensively.
  periods: z.array(ServicePeriodSchema).max(70),
});

export const CreateClosureSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  reason: z.string().max(200).trim().optional(),
});

export type CreateRestaurantInput = z.infer<typeof CreateRestaurantSchema>;
export type UpdateRestaurantInput = z.infer<typeof UpdateRestaurantSchema>;
export type UpdateReservationConfigInput = z.infer<
  typeof UpdateReservationConfigSchema
>;
export type SearchRestaurantsInput = z.infer<typeof SearchRestaurantsSchema>;
export type CreateTableInput = z.infer<typeof CreateTableSchema>;
export type UpdateTableInput = z.infer<typeof UpdateTableSchema>;
export type CreateCombinationInput = z.infer<typeof CreateCombinationSchema>;
export type UpdateCombinationInput = z.infer<typeof UpdateCombinationSchema>;
export type CreateTurnTimeRuleInput = z.infer<typeof CreateTurnTimeRuleSchema>;
export type ReplaceScheduleInput = z.infer<typeof ReplaceScheduleSchema>;
export type CreateClosureInput = z.infer<typeof CreateClosureSchema>;
