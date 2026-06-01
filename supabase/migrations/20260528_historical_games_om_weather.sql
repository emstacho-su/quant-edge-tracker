-- Phase 23 / Plan 23-07 — Open-Meteo historical weather columns on historical_games
--
-- Workstream B's Tier-2 wind→run-delta lookup table is derived from raw historical
-- data per the Area-1 sourcing principle (CONTEXT.md). The existing
-- weather_temp_f / weather_wind_mph / weather_wind_dir / weather_conditions columns
-- on historical_games carry the MLB Stats API live-feed weather — that is a
-- different signal (gate-open conditions) than what the derivation script needs
-- (Open-Meteo ERA5 reanalysis at first-pitch UTC).
--
-- This migration is additive only. No new table; no NOT NULL; no defaults
-- (om_fetched_at intentionally stays NULL until the per-row backfill writes it).
-- Idempotent via `ADD COLUMN IF NOT EXISTS` so re-runs are safe.
--
-- Backfill is operational follow-up (see 23-07-SUMMARY.md): the backfill script
-- om-weather-backfill.ts lives in quant-edge-runner and is invoked manually
-- against bounded date ranges.

ALTER TABLE public.historical_games
  ADD COLUMN IF NOT EXISTS om_temp_f         NUMERIC(5,1);
ALTER TABLE public.historical_games
  ADD COLUMN IF NOT EXISTS om_wind_mph       NUMERIC(5,1);
ALTER TABLE public.historical_games
  ADD COLUMN IF NOT EXISTS om_wind_dir_deg   SMALLINT;
ALTER TABLE public.historical_games
  ADD COLUMN IF NOT EXISTS om_wind_dir_card  TEXT;
ALTER TABLE public.historical_games
  ADD COLUMN IF NOT EXISTS om_humidity_pct   SMALLINT;
ALTER TABLE public.historical_games
  ADD COLUMN IF NOT EXISTS om_conditions     TEXT;
ALTER TABLE public.historical_games
  ADD COLUMN IF NOT EXISTS om_precip_pct     SMALLINT;
ALTER TABLE public.historical_games
  ADD COLUMN IF NOT EXISTS om_fetched_at     TIMESTAMPTZ;

COMMENT ON COLUMN public.historical_games.om_fetched_at IS
  'When the Open-Meteo Historical Archive snapshot was retrieved for this game; used by Phase 23 weather backfill (23-07).';
