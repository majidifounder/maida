-- Enable UUID generation (used as primary keys)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enable pg_trgm for fast ILIKE / full-text search on restaurant names
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Enable citext for case-insensitive email storage
CREATE EXTENSION IF NOT EXISTS "citext";
