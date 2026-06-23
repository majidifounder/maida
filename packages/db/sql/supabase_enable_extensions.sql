-- Run once in Supabase SQL Editor (Database → Extensions) BEFORE `pnpm db:migrate`
-- Dashboard: enable pgcrypto, pg_trgm, citext under Database → Extensions

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "citext";
