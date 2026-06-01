-- Phase 23 R-A1 — additive ALTER TABLE: add nullable mlbam_id column +
-- composite (season, mlbam_id) index to fangraphs_pitchers.
-- Idempotent; safe to re-run. Live-DB stays the source of truth for the
-- rest of the schema (CONTEXT.md Area 1 locked decision).

ALTER TABLE public.fangraphs_pitchers ADD COLUMN IF NOT EXISTS mlbam_id INTEGER NULL;

CREATE INDEX IF NOT EXISTS idx_fangraphs_pitchers_season_mlbam
  ON public.fangraphs_pitchers (season, mlbam_id);

COMMENT ON COLUMN public.fangraphs_pitchers.mlbam_id IS
  'MLBAM person id from FanGraphs xMLBAMID column; populated by R-A2 scraper; used by R-A4 probable-starter filter (Phase 23).';
