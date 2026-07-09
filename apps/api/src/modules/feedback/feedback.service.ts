import { prisma } from '@restaurant/db';
import type { SubmitFeedbackInput } from './feedback.schema.js';

export async function submitProductFeedback(
  userId: string,
  role: 'DINER' | 'OWNER',
  input: SubmitFeedbackInput,
): Promise<{ id: string }> {
  const row = await prisma.productFeedback.create({
    data: {
      userId,
      role,
      message: input.message,
    },
    select: { id: true },
  });
  return row;
}
