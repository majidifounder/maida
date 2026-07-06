-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 12 · Reservation Engine Core Rebuild (timeline-based capacity model)
--
-- Retires the slot-counter booking model (time_slots + bookings) and replaces
-- it with discrete physical resources (dining_tables, table_combinations)
-- occupied for explicit time ranges (reservations + reservation_tables).
--
-- Double-booking is made impossible BY CONSTRUCTION via a GiST exclusion
-- constraint on reservation_tables: no two unreleased holds on the same
-- physical table may have overlapping [startsAt, endsAt) ranges. This holds
-- for every code path, retried request, or future bug — the database rejects
-- the conflicting write with SQLSTATE 23P01.
--
-- Pre-launch software with seed/test data only — clean breaking change.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extensions ────────────────────────────────────────────────────────────────
-- btree_gist enables equality operators (uuid =) inside GiST exclusion constraints.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Drop the retired booking model ────────────────────────────────────────────
DROP TABLE IF EXISTS "bookings";
DROP TABLE IF EXISTS "time_slots";
DROP TYPE IF EXISTS "BookingStatus";

-- ── New enums ─────────────────────────────────────────────────────────────────
CREATE TYPE "SeatingMode" AS ENUM ('LOCKED', 'FLEXIBLE');
CREATE TYPE "ReservationStatus" AS ENUM ('SCHEDULED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
CREATE TYPE "ReservationType" AS ENUM ('STANDARD', 'CUSTOM');
CREATE TYPE "ReservationSource" AS ENUM ('ONLINE', 'WALK_IN', 'STAFF');

-- ── Restaurant reservation-engine configuration ───────────────────────────────
ALTER TABLE "restaurants"
  DROP COLUMN "maxCapacity",
  ADD COLUMN "seatingMode" "SeatingMode" NOT NULL DEFAULT 'LOCKED',
  ADD COLUMN "defaultDurationMins" INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN "openMinutes" INTEGER NOT NULL DEFAULT 660,
  ADD COLUMN "closeMinutes" INTEGER NOT NULL DEFAULT 1380,
  ADD COLUMN "customFee" DECIMAL(10,2),
  ADD COLUMN "extraHourFee" DECIMAL(10,2),
  ADD COLUMN "feeCurrency" VARCHAR(3) NOT NULL DEFAULT 'USD';

ALTER TABLE "restaurants"
  ADD CONSTRAINT "restaurants_service_window_check"
    CHECK ("openMinutes" >= 0 AND "closeMinutes" <= 1440 AND "closeMinutes" > "openMinutes"),
  ADD CONSTRAINT "restaurants_default_duration_check"
    CHECK ("defaultDurationMins" >= 15 AND "defaultDurationMins" <= 720);

-- ── Dining tables (atomic physical units) ─────────────────────────────────────
CREATE TABLE "dining_tables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurantId" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "minPartySize" INTEGER NOT NULL DEFAULT 1,
    "maxPartySize" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dining_tables_restaurantId_name_key" ON "dining_tables"("restaurantId", "name");
CREATE INDEX "dining_tables_restaurantId_isActive_idx" ON "dining_tables"("restaurantId", "isActive");

ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "dining_tables_party_size_check"
    CHECK ("minPartySize" >= 1 AND "maxPartySize" >= "minPartySize");

-- ── Table combinations (owner-predefined merges, FLEXIBLE mode) ───────────────
CREATE TABLE "table_combinations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurantId" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "minPartySize" INTEGER NOT NULL DEFAULT 1,
    "maxPartySize" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_combinations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "table_combinations_restaurantId_name_key" ON "table_combinations"("restaurantId", "name");
CREATE INDEX "table_combinations_restaurantId_isActive_idx" ON "table_combinations"("restaurantId", "isActive");

ALTER TABLE "table_combinations"
  ADD CONSTRAINT "table_combinations_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "table_combinations_party_size_check"
    CHECK ("minPartySize" >= 1 AND "maxPartySize" >= "minPartySize");

CREATE TABLE "table_combination_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "combinationId" UUID NOT NULL,
    "tableId" UUID NOT NULL,

    CONSTRAINT "table_combination_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "table_combination_members_combinationId_tableId_key" ON "table_combination_members"("combinationId", "tableId");
CREATE INDEX "table_combination_members_tableId_idx" ON "table_combination_members"("tableId");

ALTER TABLE "table_combination_members"
  ADD CONSTRAINT "table_combination_members_combinationId_fkey"
    FOREIGN KEY ("combinationId") REFERENCES "table_combinations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "table_combination_members_tableId_fkey"
    FOREIGN KEY ("tableId") REFERENCES "dining_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Turn-time rules (default duration by party-size band) ─────────────────────
CREATE TABLE "turn_time_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurantId" UUID NOT NULL,
    "minPartySize" INTEGER NOT NULL,
    "maxPartySize" INTEGER NOT NULL,
    "durationMins" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turn_time_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "turn_time_rules_restaurantId_idx" ON "turn_time_rules"("restaurantId");

ALTER TABLE "turn_time_rules"
  ADD CONSTRAINT "turn_time_rules_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "turn_time_rules_party_size_check"
    CHECK ("minPartySize" >= 1 AND "maxPartySize" >= "minPartySize"),
  ADD CONSTRAINT "turn_time_rules_duration_check"
    CHECK ("durationMins" >= 15 AND "durationMins" <= 720);

-- ── Reservations (time-range occupations) ─────────────────────────────────────
CREATE TABLE "reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurantId" UUID NOT NULL,
    "dinerId" UUID,
    "partySize" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'SCHEDULED',
    "reservationType" "ReservationType" NOT NULL DEFAULT 'STANDARD',
    "source" "ReservationSource" NOT NULL DEFAULT 'ONLINE',
    "guestName" VARCHAR(120),
    "notes" VARCHAR(500),
    "customFeeSnapshot" DECIMAL(10,2),
    "extraHourFeeSnapshot" DECIMAL(10,2),
    "feeCurrency" VARCHAR(3),
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "seatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" VARCHAR(300),
    "noShowAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reservations_dinerId_status_idx" ON "reservations"("dinerId", "status");
CREATE INDEX "reservations_restaurantId_startsAt_idx" ON "reservations"("restaurantId", "startsAt");
CREATE INDEX "reservations_restaurantId_status_idx" ON "reservations"("restaurantId", "status");
CREATE INDEX "reservations_restaurantId_createdAt_idx" ON "reservations"("restaurantId", "createdAt" DESC);

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "reservations_dinerId_fkey"
    FOREIGN KEY ("dinerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "reservations_valid_range_check"
    CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "reservations_party_size_check"
    CHECK ("partySize" >= 1);

-- ── Reservation table holds — THE structural double-booking guarantee ─────────
CREATE TABLE "reservation_tables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservationId" UUID NOT NULL,
    "tableId" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "reservation_tables_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reservation_tables_reservationId_tableId_key" ON "reservation_tables"("reservationId", "tableId");
CREATE INDEX "reservation_tables_tableId_startsAt_idx" ON "reservation_tables"("tableId", "startsAt");

ALTER TABLE "reservation_tables"
  ADD CONSTRAINT "reservation_tables_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "reservation_tables_tableId_fkey"
    FOREIGN KEY ("tableId") REFERENCES "dining_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "reservation_tables_valid_range_check"
    CHECK ("endsAt" > "startsAt");

-- No two unreleased holds on the same physical table may overlap in time.
-- '[)' bounds: back-to-back reservations (A ends exactly when B starts) are legal.
-- Enforced at the database — application code catches SQLSTATE 23P01 and
-- responds with 409 + a suggested next available time.
ALTER TABLE "reservation_tables"
  ADD CONSTRAINT "reservation_tables_no_overlap"
  EXCLUDE USING gist (
    "tableId" WITH =,
    tsrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE ("releasedAt" IS NULL);
