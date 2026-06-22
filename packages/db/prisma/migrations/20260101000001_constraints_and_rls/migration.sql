-- ── CHECK CONSTRAINTS ────────────────────────────────────────────────────────

-- Party size: 1–20 people
ALTER TABLE bookings
  ADD CONSTRAINT chk_party_size CHECK (party_size >= 1 AND party_size <= 20);

-- Slot capacity must be positive
ALTER TABLE time_slots
  ADD CONSTRAINT chk_slot_capacity CHECK (capacity > 0);

-- Booked seats cannot exceed capacity (defence in depth — app layer also checks)
ALTER TABLE time_slots
  ADD CONSTRAINT chk_booked_lte_capacity CHECK (booked >= 0 AND booked <= capacity);

-- Restaurant max capacity must be positive
ALTER TABLE restaurants
  ADD CONSTRAINT chk_max_capacity CHECK (max_capacity > 0);

-- Slot duration must be sensible (15 min to 4 hours)
ALTER TABLE time_slots
  ADD CONSTRAINT chk_duration_mins CHECK (duration_mins >= 15 AND duration_mins <= 240);

-- ── TRIGRAM INDEXES (for restaurant name search) ──────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restaurants_name_trgm
  ON restaurants USING GIN (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restaurants_city_trgm
  ON restaurants USING GIN (city gin_trgm_ops);

-- ── PARTIAL INDEXES (only index rows that will actually be queried) ────────────

-- Only active, non-deleted restaurants
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restaurants_active
  ON restaurants (city, cuisine)
  WHERE is_active = true AND deleted_at IS NULL;

-- Only future slots that still have capacity
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_slots_available
  ON time_slots (restaurant_id, starts_at)
  WHERE is_active = true AND booked < capacity;

-- Only active non-revoked refresh tokens
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_active
  ON refresh_tokens (user_id, expires_at)
  WHERE revoked_at IS NULL;

-- ── ROW LEVEL SECURITY ───────────────────────────────────────────────────────

-- Enable RLS on all tables containing user data
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants    ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_slots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs     ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used only for Prisma and internal jobs)
-- Application role (app_user) is subject to all policies below.

-- Create application DB role (restricted — no superuser, no schema rights)
CREATE ROLE app_user LOGIN PASSWORD 'REPLACE_IN_MIGRATION_RUNNER';
GRANT CONNECT ON DATABASE restaurant_dev TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Audit log: append-only — app_user can INSERT but never UPDATE or DELETE
REVOKE UPDATE, DELETE ON audit_logs FROM app_user;

-- Users: diners see only themselves; owners see only themselves
CREATE POLICY users_self ON users
  FOR ALL USING (id::text = current_setting('app.user_id', true))
  WITH CHECK (id::text = current_setting('app.user_id', true));

-- Bookings: diners see their own; owners see all bookings for their restaurants
CREATE POLICY bookings_diner ON bookings
  FOR ALL USING (
    diner_id::text = current_setting('app.user_id', true)
  );

CREATE POLICY bookings_owner ON bookings
  FOR SELECT USING (
    restaurant_id IN (
      SELECT id FROM restaurants
      WHERE owner_id::text = current_setting('app.user_id', true)
        AND deleted_at IS NULL
    )
  );

-- Restaurants: public can read active ones; owners manage only their own
CREATE POLICY restaurants_public_read ON restaurants
  FOR SELECT USING (is_active = true AND deleted_at IS NULL);

CREATE POLICY restaurants_owner_manage ON restaurants
  FOR ALL USING (
    owner_id::text = current_setting('app.user_id', true)
  )
  WITH CHECK (
    owner_id::text = current_setting('app.user_id', true)
  );

-- Time slots: public read for active slots; owners manage only their restaurant's slots
CREATE POLICY slots_public_read ON time_slots
  FOR SELECT USING (is_active = true);

CREATE POLICY slots_owner_manage ON time_slots
  FOR ALL USING (
    restaurant_id IN (
      SELECT id FROM restaurants
      WHERE owner_id::text = current_setting('app.user_id', true)
    )
  );

-- Refresh tokens: users manage only their own tokens
CREATE POLICY refresh_tokens_self ON refresh_tokens
  FOR ALL USING (user_id::text = current_setting('app.user_id', true));

-- Audit logs: no user can read or modify audit logs through RLS
-- (accessed only by service role for admin/compliance tooling)
CREATE POLICY audit_deny_all ON audit_logs
  FOR ALL USING (false);
