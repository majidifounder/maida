-- Phase 15 · Task 1 — owner trial start timestamp (lazy expiry derived at read time)
ALTER TABLE "subscriptions" ADD COLUMN "trialStartedAt" TIMESTAMPTZ;
