-- Phase 12 · Task 1b — TIMESTAMPTZ + restaurant timezone + tstzrange exclusion

ALTER TABLE "restaurants"
  ADD COLUMN "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC';

COMMENT ON COLUMN "restaurants"."timezone" IS 'IANA timezone for local service-day boundaries (e.g. America/New_York)';
COMMENT ON COLUMN "restaurants"."openMinutes" IS 'Service window start — minutes from local midnight in restaurant timezone';
COMMENT ON COLUMN "restaurants"."closeMinutes" IS 'Service window end — minutes from local midnight in restaurant timezone';

-- Drop GiST exclusion before column type changes
ALTER TABLE "reservation_tables"
  DROP CONSTRAINT IF EXISTS "reservation_tables_no_overlap";

-- Reservation lifecycle timestamps → TIMESTAMPTZ (existing values treated as UTC)
ALTER TABLE "reservations"
  ALTER COLUMN "startsAt" TYPE TIMESTAMPTZ(3) USING "startsAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "endsAt" TYPE TIMESTAMPTZ(3) USING "endsAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "seatedAt" TYPE TIMESTAMPTZ(3) USING "seatedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "completedAt" TYPE TIMESTAMPTZ(3) USING "completedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "cancelledAt" TYPE TIMESTAMPTZ(3) USING "cancelledAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "noShowAt" TYPE TIMESTAMPTZ(3) USING "noShowAt" AT TIME ZONE 'UTC';

ALTER TABLE "reservation_tables"
  ALTER COLUMN "startsAt" TYPE TIMESTAMPTZ(3) USING "startsAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "endsAt" TYPE TIMESTAMPTZ(3) USING "endsAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "releasedAt" TYPE TIMESTAMPTZ(3) USING "releasedAt" AT TIME ZONE 'UTC';

-- Recreate exclusion with timezone-aware ranges
ALTER TABLE "reservation_tables"
  ADD CONSTRAINT "reservation_tables_no_overlap"
  EXCLUDE USING gist (
    "tableId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE ("releasedAt" IS NULL);
