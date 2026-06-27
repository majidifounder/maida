-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAUSED', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "renewsAt" TIMESTAMP(3);

-- Migrate legacy string status values to enum
ALTER TABLE "subscriptions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "subscriptions" ALTER COLUMN "status" TYPE "SubscriptionStatus" USING (
  CASE LOWER("status")
    WHEN 'on_trial' THEN 'TRIALING'::"SubscriptionStatus"
    WHEN 'trialing' THEN 'TRIALING'::"SubscriptionStatus"
    WHEN 'active' THEN 'ACTIVE'::"SubscriptionStatus"
    WHEN 'paused' THEN 'PAUSED'::"SubscriptionStatus"
    WHEN 'past_due' THEN 'PAST_DUE'::"SubscriptionStatus"
    WHEN 'cancelled' THEN 'CANCELLED'::"SubscriptionStatus"
    WHEN 'expired' THEN 'EXPIRED'::"SubscriptionStatus"
    ELSE 'ACTIVE'::"SubscriptionStatus"
  END
);
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"SubscriptionStatus";
