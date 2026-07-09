import { z } from 'zod';

export const SubmitFeedbackSchema = z.object({
  message: z
    .string()
    .trim()
    .min(10, 'Please write at least 10 characters.')
    .max(2000, 'Feedback must be 2000 characters or fewer.'),
});

export type SubmitFeedbackInput = z.infer<typeof SubmitFeedbackSchema>;
