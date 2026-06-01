-- Phase 17: Sport Entity & Roster Library — additive entity schema migration
-- Implements D-10 (library in Supabase), D-04 (espn_id canonical key), D-03 (ESPN team identity)
-- Every DDL statement uses IF NOT EXISTS — idempotent.

-- ============================================================
-- Part 1: Extend public.teams (additive only)
-- DO NOT modify existing columns or the unique (league, abbreviation) constraint
-- ============================================================

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS source_sport_id   text,       -- league-official team ID (e.g. MLB 143 for PHI)
  ADD COLUMN IF NOT EXISTS source_sport_name text,       -- 'mlb_statsapi' | 'nhl_web' | 'nba_stats' | 'espn'
  ADD COLUMN IF NOT EXISTS alias_source      text DEFAULT 'espn';  -- tracks provenance of existing aliases[] column

-- ESPN team IDs are SPORT-SCOPED, not globally unique (e.g. espn_id '14' = mlb:TOR / nba:MIA /
-- nhl:OTT / nfl:LAR / wnba:SEA). So the canonical team key (D-04) is the composite (sport, espn_id),
-- not espn_id alone. Add that UNIQUE constraint so players.team_espn_id can FK to it (see Part 3).
-- Additive: does NOT touch existing columns or the proven unique (league, abbreviation) upsert key.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_sport_espn_id_key') THEN
    ALTER TABLE public.teams ADD CONSTRAINT teams_sport_espn_id_key UNIQUE (sport, espn_id);
  END IF;
END $$;

-- ============================================================
-- Part 2: team_aliases — per-alias provenance join table
-- Augments (never replaces) the ESPN-seeded aliases[] array on teams
-- ============================================================

CREATE TABLE IF NOT EXISTS public.team_aliases (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid        NOT NULL references public.teams(id) ON DELETE CASCADE,
  alias      text        NOT NULL,
  source     text        NOT NULL DEFAULT 'seed'
               CHECK (source IN ('seed', 'agent_derived', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, alias)
);

CREATE INDEX IF NOT EXISTS team_aliases_alias_idx ON public.team_aliases (lower(alias));

ALTER TABLE public.team_aliases ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY team_aliases_read_all ON public.team_aliases FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================
-- Part 3: players — ESPN-aligned player roster table (D-04, D-05)
-- espn_id is the canonical key; source_id stores league-official ID for Phase 18 grading
-- ============================================================

CREATE TABLE IF NOT EXISTS public.players (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  espn_id       text        UNIQUE NOT NULL,    -- ESPN athlete ID (canonical key, D-04)
  sport         text        NOT NULL,           -- 'MLB' | 'NBA' | 'NHL' | 'NFL' | 'Tennis' | 'Golf' | 'MMA'
  full_name     text        NOT NULL,
  short_name    text,                           -- "J. Tatum"
  team_espn_id  text,                           -- null for individual sports; composite FK below references public.teams(espn_id) scoped by sport
  position      text,
  jersey        text,
  active        boolean     NOT NULL DEFAULT true,
  source        text        NOT NULL DEFAULT 'espn',  -- 'mlb_statsapi' | 'nhl_web' | 'nba_stats' | 'espn'
  source_id     text,                           -- league-official player ID (cross-ref for Phase 18 grading)
  agent_derived boolean     NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS players_sport_idx ON public.players (sport);
CREATE INDEX IF NOT EXISTS players_team_idx  ON public.players (team_espn_id);
CREATE INDEX IF NOT EXISTS players_name_idx  ON public.players (full_name text_pattern_ops);

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY players_read_all ON public.players FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Composite FK: a player's (sport, team_espn_id) must reference an existing teams (sport, espn_id).
-- espn_id alone is ambiguous across sports (see Part 1). MATCH SIMPLE means rows with a NULL
-- team_espn_id (individual sports: Tennis/Golf/MMA) skip the FK check, exactly as intended.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'players_team_sport_fk') THEN
    ALTER TABLE public.players
      ADD CONSTRAINT players_team_sport_fk
      FOREIGN KEY (sport, team_espn_id) REFERENCES public.teams (sport, espn_id);
  END IF;
END $$;

-- ============================================================
-- Part 4: entity_resolution_queue — async agent resolution queue (D-11, D-12)
-- No public SELECT policy — internal queue, service-role only (T-17-02)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.entity_resolution_queue (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id            uuid        NOT NULL references public.bets(id) ON DELETE CASCADE,
  description       text        NOT NULL,
  sport             text        NOT NULL,
  status            text        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'claimed', 'resolved', 'failed')),
  attempts          int         NOT NULL DEFAULT 0,
  claimed_at        timestamptz,
  resolved_at       timestamptz,
  result_espn_id    text,        -- populated when resolved
  result_entity_type text,       -- 'team' | 'player'
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS erq_status_idx ON public.entity_resolution_queue (status, created_at);

ALTER TABLE public.entity_resolution_queue ENABLE ROW LEVEL SECURITY;
-- No public SELECT policy — entity_resolution_queue is service-role access only (T-17-02)

-- ============================================================
-- Part 5: Extend public.bets — entity resolution lifecycle columns (D-12)
-- All nullable; bets inserted before resolution use DEFAULT 'unresolved'
-- ============================================================

ALTER TABLE public.bets
  ADD COLUMN IF NOT EXISTS entity_resolution_status text DEFAULT 'unresolved'
    CHECK (entity_resolution_status IN (
      'unresolved', 'resolved', 'pending', 'low_confidence', 'agent_derived', 'failed'
    )),
  ADD COLUMN IF NOT EXISTS entity_espn_id   text,      -- resolved ESPN team or player ID
  ADD COLUMN IF NOT EXISTS entity_type      text
    CHECK (entity_type IN ('team', 'player') OR entity_type IS NULL),
  ADD COLUMN IF NOT EXISTS entity_confidence float;    -- Fuse.js inverted score (0.0–1.0)

-- ============================================================
-- Part 6: resolution_health view — D-17 surface backing
-- Exposes bets with unresolved or low-confidence entity assignment
-- ============================================================

CREATE OR REPLACE VIEW public.resolution_health AS
SELECT
  id,
  description,
  sport,
  placed_at,
  entity_resolution_status,
  entity_espn_id,
  entity_confidence
FROM public.bets
WHERE entity_resolution_status IN ('pending', 'low_confidence', 'failed')
  AND status = 'pending'
ORDER BY placed_at DESC;
