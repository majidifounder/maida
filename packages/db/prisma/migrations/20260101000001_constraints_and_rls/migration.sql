-- ── CHECK CONSTRAINTS ────────────────────────────────────────────────────────

-- Party size: 1–20 people
ALTER TABLE bookings
  ADD CONSTRAINT chk_party_size CHECK ("partySize" >= 1 AND "partySize" <= 20);

-- Slot capacity must be positive
ALTER TABLE time_slots
  ADD CONSTRAINT chk_slot_capacity CHECK (capacity > 0);

-- Booked seats cannot exceed capacity (defence in depth — app layer also checks)
ALTER TABLE time_slots
  ADD CONSTRAINT chk_booked_lte_capacity CHECK (booked >= 0 AND booked <= capacity);

-- Restaurant max capacity must be positive
ALTER TABLE restaurants
  ADD CONSTRAINT chk_max_capacity CHECK ("maxCapacity" > 0);

-- Slot duration must be sensible (15 min to 4 hours)
ALTER TABLE time_slots
  ADD CONSTRAINT chk_duration_mins CHECK ("durationMins" >= 15 AND "durationMins" <= 240);

-- ── TRIGRAM INDEXES (for restaurant name search) ──────────────────────────────
-- Note: CONCURRENTLY omitted — Prisma migrations run inside a transaction.

CREATE INDEX IF NOT EXISTS idx_restaurants_name_trgm
  ON restaurants USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_restaurants_city_trgm
  ON restaurants USING GIN (city gin_trgm_ops);

-- ── PARTIAL INDEXES (only index rows that will actually be queried) ────────────

CREATE INDEX IF NOT EXISTS idx_restaurants_active
  ON restaurants (city, cuisine)
  WHERE "isActive" = true AND "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_slots_available
  ON time_slots ("restaurantId", "startsAt")
  WHERE "isActive" = true AND booked < capacity;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active
  ON refresh_tokens ("userId", "expiresAt")
  WHERE "revokedAt" IS NULL;

-- RLS policies moved to packages/db/sql/rls_self_hosted_optional.sql (not used on Supabase).
