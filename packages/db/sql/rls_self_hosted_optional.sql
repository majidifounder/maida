-- Optional: self-hosted PostgreSQL only (NOT compatible with Supabase managed roles).
-- On Supabase, authorization is enforced in the API layer (JWT + RBAC).
-- Prisma connects with the direct DATABASE_URL / service credentials.

-- Enable RLS on all tables containing user data
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants    ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_slots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs     ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'REPLACE_IN_MIGRATION_RUNNER';
  END IF;
END
$$;
GRANT CONNECT ON DATABASE restaurant_dev TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user;

REVOKE UPDATE, DELETE ON audit_logs FROM app_user;

CREATE POLICY users_self ON users
  FOR ALL USING (id::text = current_setting('app.user_id', true))
  WITH CHECK (id::text = current_setting('app.user_id', true));

CREATE POLICY bookings_diner ON bookings
  FOR ALL USING ("dinerId"::text = current_setting('app.user_id', true));

CREATE POLICY bookings_owner ON bookings
  FOR SELECT USING (
    "restaurantId" IN (
      SELECT id FROM restaurants
      WHERE "ownerId"::text = current_setting('app.user_id', true)
        AND "deletedAt" IS NULL
    )
  );

CREATE POLICY restaurants_public_read ON restaurants
  FOR SELECT USING ("isActive" = true AND "deletedAt" IS NULL);

CREATE POLICY restaurants_owner_manage ON restaurants
  FOR ALL USING ("ownerId"::text = current_setting('app.user_id', true))
  WITH CHECK ("ownerId"::text = current_setting('app.user_id', true));

CREATE POLICY slots_public_read ON time_slots
  FOR SELECT USING ("isActive" = true);

CREATE POLICY slots_owner_manage ON time_slots
  FOR ALL USING (
    "restaurantId" IN (
      SELECT id FROM restaurants
      WHERE "ownerId"::text = current_setting('app.user_id', true)
    )
  );

CREATE POLICY refresh_tokens_self ON refresh_tokens
  FOR ALL USING ("userId"::text = current_setting('app.user_id', true));

CREATE POLICY audit_deny_all ON audit_logs
  FOR ALL USING (false);
