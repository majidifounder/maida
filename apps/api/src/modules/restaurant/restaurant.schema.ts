import { z } from 'zod';
import { CuisineType } from '@restaurant/db';

export const CreateRestaurantSchema = z.object({
  name: z.string().min(2).max(120).trim(),
  description: z.string().min(10).max(1000).trim(),
  cuisine: z.nativeEnum(CuisineType),
  address: z.string().min(5).max(300).trim(),
  city: z.string().min(2).max(100).trim(),
  imageUrl: z.string().url().optional(),
});

export const UpdateRestaurantSchema = z.object({
  name: z.string().min(2).max(120).trim().optional(),
  description: z.string().min(10).max(1000).trim().optional(),
  cuisine: z.nativeEnum(CuisineType).optional(),
  address: z.string().min(5).max(300).trim().optional(),
  city: z.string().min(2).max(100).trim().optional(),
  imageUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().optional(),
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

export const GetSlotsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
});

export const SlotInputSchema = z.object({
  startsAt: z.string().datetime({ message: 'Must be ISO 8601 datetime' }),
  capacity: z.number().int().min(1).max(500),
});

export const CreateSlotsSchema = z.object({
  slots: z.array(SlotInputSchema).min(1).max(50),
});

export const UpdateSlotSchema = z.object({
  startsAt: z.string().datetime().optional(),
  capacity: z.number().int().min(1).max(500).optional(),
  isActive: z.boolean().optional(),
});

export type CreateRestaurantInput = z.infer<typeof CreateRestaurantSchema>;
export type UpdateRestaurantInput = z.infer<typeof UpdateRestaurantSchema>;
export type SearchRestaurantsInput = z.infer<typeof SearchRestaurantsSchema>;
export type CreateSlotsInput = z.infer<typeof CreateSlotsSchema>;
export type UpdateSlotInput = z.infer<typeof UpdateSlotSchema>;
