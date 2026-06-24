import { z } from 'zod';

export const CreateBookingSchema = z.object({
  restaurantId: z.string().uuid(),
  slotId: z.string().uuid(),
  partySize: z.number().int().min(1).max(20),
});

export const ListBookingsQuerySchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'NO_SHOW']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const ListRestaurantBookingsQuerySchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'NO_SHOW']).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;
export type ListBookingsQuery = z.infer<typeof ListBookingsQuerySchema>;
export type ListRestaurantBookingsQuery = z.infer<
  typeof ListRestaurantBookingsQuerySchema
>;
