import { prisma, Plan, SubscriptionStatus } from '@restaurant/db';
import type { Plan as TypesPlan } from '@restaurant/types';
import { getPlanLimits, PLAN_LIMITS } from '../../lib/plan.js';
import { lsStatusToInternal, variantIdToPlan } from '../../lib/lemon-squeezy.js';

export { PLAN_LIMITS, getPlanLimits };

export async function getSubscription(userId: string) {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (sub) return sub;

  return {
    id: null,
    userId,
    plan: Plan.STARTER,
    status: SubscriptionStatus.ACTIVE,
    lemonSqueezyId: null,
    lemonSqueezyOrderId: null,
    lemonSqueezyProductId: null,
    lemonSqueezyVariantId: null,
    currentPeriodEnd: null,
    renewsAt: null,
    cancelAtPeriodEnd: false,
    createdAt: null,
    updatedAt: null,
  };
}

export async function getCurrentPlan(userId: string): Promise<Plan> {
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    select: { plan: true, status: true },
  });

  if (!sub) return Plan.STARTER;
  if (sub.status === SubscriptionStatus.EXPIRED) return Plan.STARTER;

  return sub.plan;
}

export interface UpsertFromWebhookInput {
  userId: string;
  lemonSqueezyId: string;
  lsStatus: string;
  variantId: number;
  renewsAt: string | null;
  endsAt: string | null;
  cancelled: boolean;
}

export async function upsertSubscriptionFromWebhook(
  input: UpsertFromWebhookInput,
): Promise<void> {
  const internalStatus = lsStatusToInternal(input.lsStatus);
  const mappedPlan = variantIdToPlan(input.variantId);

  const effectivePlan =
    internalStatus === SubscriptionStatus.EXPIRED
      ? Plan.STARTER
      : (mappedPlan ?? undefined);

  const variantIdStr = String(input.variantId);

  await prisma.subscription.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      lemonSqueezyId: input.lemonSqueezyId,
      lemonSqueezyVariantId: variantIdStr,
      plan: effectivePlan ?? Plan.STARTER,
      status: internalStatus,
      renewsAt: input.renewsAt ? new Date(input.renewsAt) : null,
      currentPeriodEnd: input.endsAt ? new Date(input.endsAt) : null,
      cancelAtPeriodEnd: input.cancelled,
    },
    update: {
      lemonSqueezyId: input.lemonSqueezyId,
      lemonSqueezyVariantId: variantIdStr,
      status: internalStatus,
      renewsAt: input.renewsAt ? new Date(input.renewsAt) : null,
      currentPeriodEnd: input.endsAt ? new Date(input.endsAt) : null,
      cancelAtPeriodEnd: input.cancelled,
      ...(effectivePlan !== undefined && { plan: effectivePlan }),
    },
  });
}

export async function assertOwnerRestaurantPlanLimit(
  ownerId: string,
): Promise<{ plan: TypesPlan; atLimit: boolean; limit: number }> {
  const plan = await getCurrentPlan(ownerId);
  const limits = getPlanLimits(plan as TypesPlan);

  if (limits.restaurants === Infinity) {
    return { plan: plan as TypesPlan, atLimit: false, limit: Infinity };
  }

  const count = await prisma.restaurant.count({
    where: { ownerId, deletedAt: null },
  });

  return {
    plan: plan as TypesPlan,
    atLimit: count >= limits.restaurants,
    limit: limits.restaurants,
  };
}
