-- Phase 15 · Task 2 — internal product feedback (admin-only)
CREATE TABLE "product_feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_feedback_createdAt_idx" ON "product_feedback"("createdAt");
CREATE INDEX "product_feedback_userId_idx" ON "product_feedback"("userId");

ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
