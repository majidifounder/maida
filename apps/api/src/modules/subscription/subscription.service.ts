import { prisma, Plan, SubscriptionStatus } from '@restaurant/db';
import type {
  BillingTier,
  Plan as TypesPlan,
  PlanComparisonRow,
  PlanLimits,
  Subscription as TypesSubscription,
} from '@restaurant/types';
import {
  billingTierLabel,
  computeTrialEndsAt,
  getPlanLimits,
  isTrialPeriodExpired,
  PLAN_COMPARISON,
  PLAN_LIMITS,
  trialDaysRemaining,
  TRIAL_DAYS,
  TRIAL_LIMITS,
} from '../../lib/plan.js';
import {
  lsStatusToInternal,
  variantIdToPlan,
  lsRequest,
} from '../../lib/lemon-squeezy.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../errors/index.js';

export {
  PLAN_LIMITS,
  TRIAL_LIMITS,
  TRIAL_DAYS,
  PLAN_COMPARISON,
  getPlanLimits,
};

const TRIAL_ENDED_MESSAGE =
  'Your 14-day trial has ended. Subscribe to a plan to continue accepting reservations and updating your restaurant.';

export interface OwnerBillingState {
  billingTier: BillingTier;
  limits: PlanLimits;
  canOperate: boolean;
  isTrialActive: boolean;
  isTrialExpired: boolean;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  trialDaysRemaining: number | null;
  paidPlan: Plan;
  status: SubscriptionStatus;
}

function resolveTrialStart(sub: {
  trialStartedAt: Date | null;
  createdAt: Date;
}): Date {
  return sub.trialStartedAt ?? sub.createdAt;
}

function isPaidSubscriptionActive(status: SubscriptionStatus): boolean {
  return (
    status === SubscriptionStatus.ACTIVE ||
    status === SubscriptionStatus.PAST_DUE ||
    status === SubscriptionStatus.PAUSED ||
    status === SubscriptionStatus.CANCELLED
  );
}

export async function ensureOwnerSubscription(userId: string) {
  const existing = await prisma.subscription.findUnique({ where: { userId } });
  if (existing) return existing;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  });
  if (!user) {
    throw new NotFoundError('User not found');
  }

  return prisma.subscription.create({
    data: {
      userId,
      status: SubscriptionStatus.TRIALING,
      plan: Plan.STARTER,
      trialStartedAt: user.createdAt,
    },
  });
}

export async function resolveOwnerBillingState(
  userId: string,
): Promise<OwnerBillingState> {
  const sub = await ensureOwnerSubscription(userId);
  const trialStart = resolveTrialStart(sub);

  if (sub.status === SubscriptionStatus.TRIALING) {
    const expired = isTrialPeriodExpired(trialStart);
    const endsAt = computeTrialEndsAt(trialStart);
    return {
      billingTier: 'TRIAL',
      limits: TRIAL_LIMITS,
      canOperate: !expired,
      isTrialActive: !expired,
      isTrialExpired: expired,
      trialStartedAt: trialStart,
      trialEndsAt: endsAt,
      trialDaysRemaining: expired ? 0 : trialDaysRemaining(trialStart),
      paidPlan: sub.plan,
      status: sub.status,
    };
  }

  if (isPaidSubscriptionActive(sub.status)) {
    return {
      billingTier: sub.plan as BillingTier,
      limits: getPlanLimits(sub.plan as TypesPlan),
      canOperate: true,
      isTrialActive: false,
      isTrialExpired: false,
      trialStartedAt: sub.trialStartedAt,
      trialEndsAt: sub.trialStartedAt
        ? computeTrialEndsAt(sub.trialStartedAt)
        : null,
      trialDaysRemaining: null,
      paidPlan: sub.plan,
      status: sub.status,
    };
  }

  // EXPIRED paid subscription — downgraded limits, still operational on STARTER.
  return {
    billingTier: 'STARTER',
    limits: getPlanLimits('STARTER'),
    canOperate: true,
    isTrialActive: false,
    isTrialExpired: false,
    trialStartedAt: sub.trialStartedAt,
    trialEndsAt: sub.trialStartedAt
      ? computeTrialEndsAt(sub.trialStartedAt)
      : null,
    trialDaysRemaining: null,
    paidPlan: Plan.STARTER,
    status: sub.status,
  };
}

export async function getEffectiveLimitsForOwner(
  userId: string,
): Promise<PlanLimits> {
  const state = await resolveOwnerBillingState(userId);
  return state.limits;
}

export async function assertOwnerCanOperate(userId: string): Promise<void> {
  const state = await resolveOwnerBillingState(userId);
  if (!state.canOperate) {
    throw new ForbiddenError(TRIAL_ENDED_MESSAGE);
  }
}

function serializeSubscription(
  sub: Awaited<ReturnType<typeof ensureOwnerSubscription>>,
  state: OwnerBillingState,
): TypesSubscription {
  return {
    id: sub.id,
    userId: sub.userId,
    plan: sub.plan as TypesPlan,
    status: sub.status as TypesSubscription['status'],
    billingTier: state.billingTier,
    lemonSqueezyId: sub.lemonSqueezyId,
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    renewsAt: sub.renewsAt?.toISOString() ?? null,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    trialStartedAt: state.trialStartedAt?.toISOString() ?? null,
    trialEndsAt: state.trialEndsAt?.toISOString() ?? null,
    trialDaysRemaining: state.trialDaysRemaining,
    isTrialActive: state.isTrialActive,
    isTrialExpired: state.isTrialExpired,
    canOperate: state.canOperate,
    createdAt: sub.createdAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
  };
}

export async function getSubscription(userId: string) {
  const sub = await ensureOwnerSubscription(userId);
  const state = await resolveOwnerBillingState(userId);
  return serializeSubscription(sub, state);
}

export function getPlanComparison(): PlanComparisonRow[] {
  return PLAN_COMPARISON.map((row) => ({
    tier: row.tier,
    label: row.label,
    price: row.price,
    limits: row.limits,
  }));
}

export async function getCurrentPlan(userId: string): Promise<Plan> {
  const state = await resolveOwnerBillingState(userId);
  if (state.billingTier === 'TRIAL') {
    return Plan.STARTER;
  }
  return state.paidPlan;
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
): Promise<{ plan: BillingTier; atLimit: boolean; limit: number }> {
  await assertOwnerCanOperate(ownerId);
  const state = await resolveOwnerBillingState(ownerId);

  if (state.limits.restaurants === Infinity) {
    return { plan: state.billingTier, atLimit: false, limit: Infinity };
  }

  const count = await prisma.restaurant.count({
    where: { ownerId, deletedAt: null },
  });

  return {
    plan: state.billingTier,
    atLimit: count >= state.limits.restaurants,
    limit: state.limits.restaurants,
  };
}

export async function cancelSubscription(ownerId: string): Promise<void> {
  const sub = await prisma.subscription.findUnique({
    where: { userId: ownerId },
    select: {
      lemonSqueezyId: true,
      status: true,
      cancelAtPeriodEnd: true,
    },
  });

  if (!sub?.lemonSqueezyId) {
    throw new UnprocessableError('No active subscription found');
  }

  if (sub.cancelAtPeriodEnd) {
    throw new ConflictError(
      'Subscription is already scheduled for cancellation',
    );
  }

  if (sub.status === SubscriptionStatus.CANCELLED) {
    throw new ConflictError('Subscription is already cancelled');
  }

  await lsRequest('PATCH', `/subscriptions/${sub.lemonSqueezyId}`, {
    data: {
      type: 'subscriptions',
      id: sub.lemonSqueezyId,
      attributes: { cancelled: true },
    },
  });

  await prisma.subscription.update({
    where: { userId: ownerId },
    data: { cancelAtPeriodEnd: true },
  });

  await prisma.auditLog
    .create({
      data: {
        actorId: ownerId,
        action: 'SUBSCRIPTION_CANCELLED',
        entityType: 'Subscription',
        entityId: ownerId,
      },
    })
    .catch(() => {});
}

export async function resumeSubscription(ownerId: string): Promise<void> {
  const sub = await prisma.subscription.findUnique({
    where: { userId: ownerId },
    select: {
      lemonSqueezyId: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: true,
    },
  });

  if (!sub?.lemonSqueezyId) {
    throw new UnprocessableError('No subscription found');
  }

  if (!sub.cancelAtPeriodEnd) {
    throw new ConflictError(
      'Subscription is not scheduled for cancellation',
    );
  }

  if (sub.currentPeriodEnd && sub.currentPeriodEnd < new Date()) {
    throw new UnprocessableError(
      'Subscription has already expired — please subscribe again',
    );
  }

  await lsRequest('PATCH', `/subscriptions/${sub.lemonSqueezyId}`, {
    data: {
      type: 'subscriptions',
      id: sub.lemonSqueezyId,
      attributes: { cancelled: false },
    },
  });

  await prisma.subscription.update({
    where: { userId: ownerId },
    data: { cancelAtPeriodEnd: false },
  });

  await prisma.auditLog
    .create({
      data: {
        actorId: ownerId,
        action: 'SUBSCRIPTION_RESUMED',
        entityType: 'Subscription',
        entityId: ownerId,
      },
    })
    .catch(() => {});
}

export { billingTierLabel, TRIAL_ENDED_MESSAGE };
