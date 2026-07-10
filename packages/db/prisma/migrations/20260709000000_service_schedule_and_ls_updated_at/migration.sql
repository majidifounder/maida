-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 17 · Weekly service schedule, blackout dates, and webhook ordering
--
-- Replaces the single per-restaurant open/close window with a proper weekly
-- schedule (service_periods, one or more windows per weekday, overnight-aware)
-- plus explicit blackout dates (restaurant_closures). The reservation engine now
-- reads these; the legacy openMinutes/closeMinutes columns are retained as the
-- coarse day span and as the backfill source.
--
-- Also adds subscriptions."lsUpdatedAt" so Lemon Squeezy webhook events that
-- arrive out of order can be ignored instead of regressing billing state.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Service periods (weekly opening schedule) ─────────────────────────────────
CREATE TABLE "service_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurantId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openMinute" INTEGER NOT NULL,
    "closeMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_periods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_periods_restaurantId_dayOfWeek_idx"
  ON "service_periods"("restaurantId", "dayOfWeek");

ALTER TABLE "service_periods"
  ADD CONSTRAINT "service_periods_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "service_periods_day_check"
    CHECK ("dayOfWeek" >= 0 AND "dayOfWeek" <= 6),
  ADD CONSTRAINT "service_periods_open_check"
    CHECK ("openMinute" >= 0 AND "openMinute" <= 1439),
  ADD CONSTRAINT "service_periods_close_check"
    CHECK ("closeMinute" >= 1 AND "closeMinute" <= 1440);

-- ── Restaurant closures (blackout dates) ──────────────────────────────────────
CREATE TABLE "restaurant_closures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurantId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "reason" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_closures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "restaurant_closures_restaurantId_date_key"
  ON "restaurant_closures"("restaurantId", "date");
CREATE INDEX "restaurant_closures_restaurantId_date_idx"
  ON "restaurant_closures"("restaurantId", "date");

ALTER TABLE "restaurant_closures"
  ADD CONSTRAINT "restaurant_closures_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill: one window per weekday mirroring each restaurant's legacy hours ──
-- The legacy "open 24 hours" sentinel (0..1440) becomes a single 0..1440 window,
-- which the engine treats as continuous local-day service.
INSERT INTO "service_periods" ("restaurantId", "dayOfWeek", "openMinute", "closeMinute")
SELECT r."id", dow.d, r."openMinutes", r."closeMinutes"
FROM "restaurants" r
CROSS JOIN (VALUES (0), (1), (2), (3), (4), (5), (6)) AS dow(d);

-- ── Webhook ordering guard ────────────────────────────────────────────────────
ALTER TABLE "subscriptions" ADD COLUMN "lsUpdatedAt" TIMESTAMPTZ;
