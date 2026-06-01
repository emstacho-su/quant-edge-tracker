-- 20260527_statcast_and_park_factors.sql
-- Phase 25: Statcast batter-quality metrics + MLB park factors ingestion.
-- Tables: park_factors          (3-year rolling MLB park factors by venue × season × hand)
--         batter_statcast_daily (per-batter per-day advanced metrics, 2018–2026)
-- RLS: read-public, write-service-role-only.
-- Applied to prod (yuxjidjpiqeybrdsprgt) via Supabase MCP apply_migration.
--
-- Schema authority: 25-SPEC.md §"Final park_factors schema" + SPEC Amendments A-01..A-05.
--   A-01: park factors are 3-year-rolling only → years_rolling + year_range columns.
--   A-02/A-04: Savant integer-100 indexes are /100.0-converted at ingest, stored NUMERIC(5,3).
--   A-03: BABIP column renamed to bacon_idx (Savant exposes index_bacon, not BABIP).
-- No FK constraints — soft refs only (historical_games has no venue_id column); Phase 24 doctrine.

-- ── park_factors ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.park_factors (
  venue_id      INT       NOT NULL,
  venue_name    TEXT      NOT NULL,
  season        INT       NOT NULL,
  hand          TEXT      NOT NULL CHECK (hand IN ('L', 'R', 'ALL')),
  years_rolling INT       NOT NULL DEFAULT 3,
  year_range    TEXT      NOT NULL,
  runs_idx      NUMERIC(5, 3),
  hr_idx        NUMERIC(5, 3),
  bacon_idx     NUMERIC(5, 3),
  woba_idx      NUMERIC(5, 3),
  hits_idx      NUMERIC(5, 3),
  doubles_idx   NUMERIC(5, 3),
  triples_idx   NUMERIC(5, 3),
  PRIMARY KEY (venue_id, season, hand)
);

COMMENT ON TABLE public.park_factors IS
  '3-year rolling MLB park factors by venue × season × handedness. '
  'Source: Savant public endpoint. Indexes on 1.000 scale (100% = neutral). '
  'Backfilled 2018–2026.';

COMMENT ON COLUMN public.park_factors.season IS
  'Most-recent season the rolling window ends in (matches Savant request year=YYYY).';
COMMENT ON COLUMN public.park_factors.hand IS
  'Batter handedness split: L, R, or ALL (combined).';
COMMENT ON COLUMN public.park_factors.years_rolling IS
  'A-01: Savant publishes 3-year rolling only; no single-season variant on the public endpoint.';
COMMENT ON COLUMN public.park_factors.year_range IS
  'Rolling window covered, e.g. 2022-2024.';
COMMENT ON COLUMN public.park_factors.runs_idx IS
  'A-02: Divided by 100.0 at ingest; 1.000 = neutral.';
COMMENT ON COLUMN public.park_factors.hr_idx IS
  'A-02: Divided by 100.0 at ingest; 1.000 = neutral.';
COMMENT ON COLUMN public.park_factors.bacon_idx IS
  'A-03: Batting Average on Contact, not BABIP (Savant index_bacon). A-02: divided by 100.0 at ingest; 1.000 = neutral.';
COMMENT ON COLUMN public.park_factors.woba_idx IS
  'A-02: Divided by 100.0 at ingest; 1.000 = neutral.';
COMMENT ON COLUMN public.park_factors.hits_idx IS
  'A-02: Divided by 100.0 at ingest; 1.000 = neutral.';
COMMENT ON COLUMN public.park_factors.doubles_idx IS
  'A-02: Divided by 100.0 at ingest; 1.000 = neutral.';
COMMENT ON COLUMN public.park_factors.triples_idx IS
  'A-02: Divided by 100.0 at ingest; 1.000 = neutral.';

CREATE INDEX IF NOT EXISTS idx_pf_season_hand
  ON public.park_factors (season, hand)
  WHERE hand = 'ALL';

-- RLS: read-public + service-role writes (matches historical_* / situational_systems_catalog convention).
ALTER TABLE public.park_factors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access to park_factors" ON public.park_factors;
CREATE POLICY "Public read access to park_factors"
  ON public.park_factors FOR SELECT
  TO anon, authenticated
  USING (true);

-- ── batter_statcast_daily ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.batter_statcast_daily (
  player_id      INT       NOT NULL,
  game_date      DATE      NOT NULL,
  game_pk        INT       NULL,
  pa             INT,
  ab             INT,
  woba           NUMERIC,
  xwoba          NUMERIC,
  barrel_pct     NUMERIC,
  hard_hit_pct   NUMERIC,
  sweet_spot_pct NUMERIC,
  avg_ev         NUMERIC,
  avg_la         NUMERIC,
  PRIMARY KEY (player_id, game_date)
);

COMMENT ON TABLE public.batter_statcast_daily IS
  'Per-batter per-day Statcast advanced metrics (2018–2026). '
  'Source: Baseball Savant via pybaseball.statcast(), aggregated per batter per game_date. '
  'Soft-references historical_games on game_date (no FK, Phase 24 doctrine).';

COMMENT ON COLUMN public.batter_statcast_daily.game_pk IS
  'Nullable because Statcast aggregates per-day per-batter — a batter in a doubleheader gets ONE row covering both games (R-02).';

CREATE INDEX IF NOT EXISTS idx_bsd_game_date_desc
  ON public.batter_statcast_daily (game_date DESC);

-- RLS: read-public + service-role writes.
ALTER TABLE public.batter_statcast_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access to batter_statcast_daily" ON public.batter_statcast_daily;
CREATE POLICY "Public read access to batter_statcast_daily"
  ON public.batter_statcast_daily FOR SELECT
  TO anon, authenticated
  USING (true);
