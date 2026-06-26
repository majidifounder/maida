import { z } from 'zod';

export const AdminLoginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
  totpToken: z.string().length(6).optional(),
  pendingToken: z.string().uuid().optional(),
});

export const AdminUpdatePlanSchema = z.object({
  plan: z.enum(['STARTER', 'PRO', 'PREMIUM']),
});

export const AdminPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().max(100).optional(),
});

export type AdminLoginInput = z.infer<typeof AdminLoginSchema>;
export type AdminUpdatePlanInput = z.infer<typeof AdminUpdatePlanSchema>;
export type AdminPaginationInput = z.infer<typeof AdminPaginationSchema>;
