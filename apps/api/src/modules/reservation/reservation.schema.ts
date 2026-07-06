import { z } from 'zod';

export const CreateReservationSchema = z.object({
  restaurantId: z.string().uuid(),
  partySize: z.number().int().min(1).max(50),
  startsAt: z.string().datetime(),
  reservationType: z.enum(['STANDARD', 'CUSTOM']).default('STANDARD'),
  durationMins: z.number().int().min(15).max(720).optional(),
  notes: z.string().max(500).optional(),
});

export const ListReservationsQuerySchema = z.object({
  status: z
    .enum(['SCHEDULED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const ListRestaurantReservationsQuerySchema =
  ListReservationsQuerySchema.extend({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
      .optional(),
  });

export const StaffCreateReservationSchema = z.object({
  partySize: z.number().int().min(1).max(50),
  startsAt: z.string().datetime(),
  guestName: z.string().min(1).max(120),
  reservationType: z.enum(['STANDARD', 'CUSTOM']).default('STANDARD'),
  durationMins: z.number().int().min(15).max(720).optional(),
  notes: z.string().max(500).optional(),
  dinerId: z.string().uuid().optional(),
});

export const WalkInSchema = z.object({
  partySize: z.number().int().min(1).max(50),
  guestName: z.string().min(1).max(120),
  durationMins: z.number().int().min(15).max(720).optional(),
  notes: z.string().max(500).optional(),
  tableIds: z.array(z.string().uuid()).min(1).optional(),
});

export const OverrideReservationSchema = z.object({
  partySize: z.number().int().min(1).max(50),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  tableIds: z.array(z.string().uuid()).min(1),
  guestName: z.string().min(1).max(120).optional(),
  notes: z.string().max(500).optional(),
  reason: z.string().min(5).max(300),
});

export const ExtendReservationSchema = z.object({
  additionalMins: z.number().int().min(15).max(240),
});

export const CancelReservationSchema = z.object({
  reason: z.string().max(300).optional(),
});

export type CreateReservationInput = z.infer<typeof CreateReservationSchema>;
export type ListReservationsQuery = z.infer<typeof ListReservationsQuerySchema>;
export type ListRestaurantReservationsQuery = z.infer<
  typeof ListRestaurantReservationsQuerySchema
>;
export type StaffCreateReservationInput = z.infer<
  typeof StaffCreateReservationSchema
>;
export type WalkInInput = z.infer<typeof WalkInSchema>;
export type OverrideReservationInput = z.infer<
  typeof OverrideReservationSchema
>;
export type ExtendReservationInput = z.infer<typeof ExtendReservationSchema>;
