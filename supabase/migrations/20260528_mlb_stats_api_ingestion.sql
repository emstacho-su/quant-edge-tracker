-- Phase 24: mlb-stats-api-lineups-bullpen-batter-logs
-- Stands up the ingestion schema for four MLB Stats API data categories, all
-- sourced from ONE /boxscore call per game_pk and written via one atomic RPC:
--   R-01 game_lineups          — 1-9 batting order + position per (game_pk, team)
--   R-02 historical_games.*     — HP umpire id/name (additive columns)
--   R-03 bullpen_appearances    — per-reliever appearance log
--   R-04 batter_game_logs       — per-batter per-game line
--
-- SCHEMA-COLLISION WARNING (research finding #1): historical_games already has a
-- legacy `home_plate_ump TEXT` column from the Pass-1 backfill. This migration adds
-- hp_umpire_id + hp_umpire_name ADDITIVELY alongside it. It does NOT drop or modify
-- home_plate_ump — cleanup of the legacy column is deferred to a later phase.
--
-- leverage_index (research finding #2): NOT present anywhere in /boxscore. The column
-- exists for forward-compat but is always NULL at v1. The validator must not gate on it.
--
-- Implements D-10: single Supabase RPC per game wraps all 4 table writes in one
-- transaction (ingest_mlb_boxscore). No FK constraints anywhere (SPEC §Constraints:
-- players/historical_games have incomplete historical coverage — soft refs only).
-- Idempotent: re-running produces no errors and no schema drift.

-- ============================================================================
-- Section 1 — game_lineups (R-01)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.game_lineups (
  game_pk          int NOT NULL,
  team             text NOT NULL,
  batting_order    int NOT NULL CHECK (batting_order BETWEEN 1 AND 9),
  player_id        int NOT NULL,
  position         text NULL,
  lineup_posted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_pk, team, batting_order)
);

COMMENT ON TABLE public.game_lineups IS
  'Phase 24 (R-01): starting lineup 1-9 batting order + position per (game_pk, team). Soft refs only — no FK to historical_games/players.';

-- ============================================================================
-- Section 2 — bullpen_appearances (R-03)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.bullpen_appearances (
  game_pk             int NOT NULL,
  team                text NOT NULL,
  pitcher_id          int NOT NULL,
  appearance_sequence int NOT NULL,
  ip                  numeric NOT NULL,
  pitches             int NULL,
  batters_faced       int NULL,
  leverage_index      numeric NULL,
  PRIMARY KEY (game_pk, team, pitcher_id)
);

COMMENT ON TABLE public.bullpen_appearances IS
  'Phase 24 (R-03): per-reliever appearance log. appearance_sequence=1 is the starter (derive is_starter at query time). Soft refs only.';
COMMENT ON COLUMN public.bullpen_appearances.leverage_index IS
  'Always NULL at v1 — leverage index is not present in the MLB Stats API /boxscore endpoint (research finding #2). Column reserved for a future source.';

-- ============================================================================
-- Section 3 — batter_game_logs (R-04)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.batter_game_logs (
  player_id     int NOT NULL,
  game_pk       int NOT NULL,
  team          text NOT NULL,
  pa            int NOT NULL,
  ab            int NOT NULL,
  h             int NOT NULL,
  hr            int NOT NULL,
  bb            int NOT NULL,
  k             int NOT NULL,
  sb            int NOT NULL,
  batting_order int NULL,
  position      text NULL,
  PRIMARY KEY (player_id, game_pk)
);

COMMENT ON TABLE public.batter_game_logs IS
  'Phase 24 (R-04): per-batter per-game line for any player with PA > 0. batting_order/position populated only for lineup-card players (NULL for PH/PR). Soft refs only.';

-- ============================================================================
-- Section 4 — historical_games HP-umpire columns (R-02) — ADDITIVE, non-destructive
-- ============================================================================
ALTER TABLE public.historical_games ADD COLUMN IF NOT EXISTS hp_umpire_id   int NULL;
ALTER TABLE public.historical_games ADD COLUMN IF NOT EXISTS hp_umpire_name text NULL;

COMMENT ON COLUMN public.historical_games.home_plate_ump IS
  'Legacy column from Pass-1 backfill; superseded by hp_umpire_id + hp_umpire_name in Phase 24. Cleanup deferred to a later phase — do NOT drop here.';

-- ============================================================================
-- Section 5 — Indexes for validator + downstream query patterns
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_game_lineups_player        ON public.game_lineups (player_id);
CREATE INDEX IF NOT EXISTS idx_bullpen_appearances_pitcher ON public.bullpen_appearances (pitcher_id);
CREATE INDEX IF NOT EXISTS idx_batter_game_logs_game       ON public.batter_game_logs (game_pk);
CREATE INDEX IF NOT EXISTS idx_historical_games_hp_umpire  ON public.historical_games (hp_umpire_id) WHERE hp_umpire_id IS NOT NULL;

-- ============================================================================
-- Section 6 — ingest_mlb_boxscore RPC (D-10) — one atomic transaction per game
-- ============================================================================
-- Payload shape (built Node-side per game, see 24-RESEARCH.md):
--   { game_pk, hp_umpire_id, hp_umpire_name,
--     teams: [ { team, lineup:[{batting_order,player_id,position}],
--               bullpen:[{appearance_sequence,pitcher_id,ip,pitches,batters_faced,leverage_index}],
--               batters:[{player_id,pa,ab,h,hr,bb,k,sb,batting_order,position}] } ] }
-- All field reads use typed casts (no string interpolation) so malformed input
-- raises in Postgres and is caught Node-side as a D-11 parse-failure.
CREATE OR REPLACE FUNCTION public.ingest_mlb_boxscore(p_payload jsonb)
RETURNS void AS $$
DECLARE
  v_team_obj jsonb;
  v_team_abbr text;
BEGIN
  -- (1) UPDATE historical_games for HP umpire (R-02)
  UPDATE public.historical_games
     SET hp_umpire_id   = NULLIF((p_payload->>'hp_umpire_id'), '')::int,
         hp_umpire_name = NULLIF((p_payload->>'hp_umpire_name'), '')
   WHERE game_pk = (p_payload->>'game_pk')::int;

  -- (2..4) Iterate each team object in p_payload->'teams' and write its 3 tables
  FOR v_team_obj IN SELECT * FROM jsonb_array_elements(p_payload->'teams') LOOP
    v_team_abbr := v_team_obj->>'team';

    -- (2) game_lineups (R-01) — PK (game_pk, team, batting_order)
    INSERT INTO public.game_lineups (game_pk, team, batting_order, player_id, position, lineup_posted_at)
    SELECT (p_payload->>'game_pk')::int,
           v_team_abbr,
           (slot->>'batting_order')::int,
           (slot->>'player_id')::int,
           slot->>'position',
           now()
      FROM jsonb_array_elements(v_team_obj->'lineup') AS slot
    ON CONFLICT (game_pk, team, batting_order) DO UPDATE
      SET player_id        = EXCLUDED.player_id,
          position         = EXCLUDED.position,
          lineup_posted_at = EXCLUDED.lineup_posted_at;

    -- (3) bullpen_appearances (R-03) — PK (game_pk, team, pitcher_id)
    INSERT INTO public.bullpen_appearances
      (game_pk, team, pitcher_id, appearance_sequence, ip, pitches, batters_faced, leverage_index)
    SELECT (p_payload->>'game_pk')::int,
           v_team_abbr,
           (app->>'pitcher_id')::int,
           (app->>'appearance_sequence')::int,
           (app->>'ip')::numeric,
           (app->>'pitches')::int,
           (app->>'batters_faced')::int,
           NULLIF((app->>'leverage_index'), '')::numeric
      FROM jsonb_array_elements(v_team_obj->'bullpen') AS app
    ON CONFLICT (game_pk, team, pitcher_id) DO UPDATE
      SET appearance_sequence = EXCLUDED.appearance_sequence,
          ip                  = EXCLUDED.ip,
          pitches             = EXCLUDED.pitches,
          batters_faced       = EXCLUDED.batters_faced,
          leverage_index      = EXCLUDED.leverage_index;

    -- (4) batter_game_logs (R-04) — PK (player_id, game_pk)
    INSERT INTO public.batter_game_logs
      (player_id, game_pk, team, pa, ab, h, hr, bb, k, sb, batting_order, position)
    SELECT (b->>'player_id')::int,
           (p_payload->>'game_pk')::int,
           v_team_abbr,
           (b->>'pa')::int,
           (b->>'ab')::int,
           (b->>'h')::int,
           (b->>'hr')::int,
           (b->>'bb')::int,
           (b->>'k')::int,
           (b->>'sb')::int,
           NULLIF((b->>'batting_order'), '')::int,
           b->>'position'
      FROM jsonb_array_elements(v_team_obj->'batters') AS b
    ON CONFLICT (player_id, game_pk) DO UPDATE
      SET team           = EXCLUDED.team,
          pa             = EXCLUDED.pa,
          ab             = EXCLUDED.ab,
          h              = EXCLUDED.h,
          hr             = EXCLUDED.hr,
          bb             = EXCLUDED.bb,
          k              = EXCLUDED.k,
          sb             = EXCLUDED.sb,
          batting_order  = EXCLUDED.batting_order,
          position       = EXCLUDED.position;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Section 7 — RLS: public-read on all 3 new tables (matches historical_* convention)
-- ============================================================================
ALTER TABLE public.game_lineups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullpen_appearances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batter_game_logs    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access to game_lineups" ON public.game_lineups;
CREATE POLICY "Public read access to game_lineups"
  ON public.game_lineups FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Public read access to bullpen_appearances" ON public.bullpen_appearances;
CREATE POLICY "Public read access to bullpen_appearances"
  ON public.bullpen_appearances FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Public read access to batter_game_logs" ON public.batter_game_logs;
CREATE POLICY "Public read access to batter_game_logs"
  ON public.batter_game_logs FOR SELECT USING (TRUE);

-- ============================================================================
-- Section 8 — Least-privilege grants on the RPC (only service_role may invoke)
-- ============================================================================
-- Supabase default privileges grant EXECUTE on new functions to anon + authenticated;
-- revoke both (plus PUBLIC) so only service_role (the ingest script) can invoke (threat T-24-01).
REVOKE EXECUTE ON FUNCTION public.ingest_mlb_boxscore(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_mlb_boxscore(jsonb) TO service_role;
