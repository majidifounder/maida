-- Email verification (R7b): identities must be reachable before they can act.
-- Diners must verify before booking; owners before creating a restaurant.
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ;

-- Grandfather every existing account: the rule applies to registrations made
-- after it exists. Locking out current users retroactively would be hostile.
UPDATE "users" SET "emailVerifiedAt" = now();
