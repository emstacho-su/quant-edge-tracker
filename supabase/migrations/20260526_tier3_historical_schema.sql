-- Tier 3 historical situational systems — data layer
--
-- Backs Oskeim-style "team in situation X at odds Y has historically gone Z%"
-- lookups, plus pitcher-vs-team matchup history. Lives in Supabase so both the
-- runner-side situational-lookup CLI tool AND the Vercel-side dashboards can
-- read it.
--
-- Backfill plan (per user decision 2026-05-26):
--   * 2021-2026 — full detail (all dims, all markets)        → data_quality = 'full'
--   * 2014-2020 — lighter (Tier-3a dims, ML/TOTAL/RL odds)  → data_quality = 'lighter'
--   * 2025+ ongoing capture — from odds_snapshots             → source = 'odds_snapshots'
--
-- Free-odds sources (researched 2026-05-26):
--   * sportsbookreviewsonline.com XLSX dumps 2010-2021 — opening + closing ML, RL, TOTAL
--   * GitHub: marcoblume/pinnacle.data — Pinnacle 2016 only (validation reference)
--   * GitHub: ArnavSaraogi/mlb-odds-scraper — SBR live scrape 2019-current (multi-book)
--   * The Odds API historical — paid; we skip per $30/mo budget unless gap-fill needed
--   * For TT / F5 markets — no free historical source available; populated from
--     odds_snapshots going forward only.

-- ── historical_games ─────────────────────────────────────────────────────────
-- One row per MLB game. Source of truth = MLB Stats API.

CREATE TABLE IF NOT EXISTS public.historical_games (
  game_pk        BIGINT PRIMARY KEY,                       -- MLB Stats API gamePk
  game_date      DATE NOT NULL,                            -- local game date (ET)
  game_type      TEXT,                                     -- 'R' (regular), 'P' (postseason), 'S' (spring), 'E' (exhibition)
  season         INT NOT NULL,                             -- 2014, 2015, ..., 2026
  away_team      TEXT NOT NULL,                            -- 3-letter abbrev (LAD, NYY, SD, ATH, ...)
  home_team      TEXT NOT NULL,
  away_score     INT,                                       -- NULL until game_status = 'final'
  home_score     INT,
  innings        INT,                                       -- 9, 10, 11+; NULL for postponed/cancelled
  game_status    TEXT,                                     -- 'final' | 'postponed' | 'cancelled' | 'suspended'
  start_time_utc TIMESTAMPTZ,                              -- first-pitch UTC
  weather_temp_f INT,                                       -- when reported by MLB feed
  weather_wind_mph INT,
  weather_wind_dir TEXT,                                   -- 'In From CF', 'Out To LF', 'L To R', etc.
  weather_conditions TEXT,                                 -- 'Clear', 'Cloudy', 'Rain', 'Dome', etc.
  home_plate_ump TEXT,                                     -- umpire name
  attendance     INT,
  game_length_min INT,                                     -- total elapsed minutes (incl. rain delays)
  data_quality   TEXT NOT NULL DEFAULT 'full',             -- 'full' (modern era) | 'lighter' (long-tail era)
  raw_feed_json  JSONB,                                    -- defensive: keep MLB API response so re-tagging doesn't require re-pull
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historical_games_date
  ON public.historical_games (game_date);
CREATE INDEX IF NOT EXISTS idx_historical_games_season
  ON public.historical_games (season);
CREATE INDEX IF NOT EXISTS idx_historical_games_teams
  ON public.historical_games (away_team, home_team, game_date);

COMMENT ON TABLE public.historical_games IS
  'MLB game results 2014-2026, backfilled from MLB Stats API. raw_feed_json kept so situational tags can be recomputed without re-pulling. data_quality=lighter for 2014-2020 (Tier-3a dims only).';


-- ── historical_team_games ────────────────────────────────────────────────────
-- One row per (game, team). Encodes the team's experience of that game plus
-- the situational tags computed from prior games. This is the primary table the
-- situational lookup queries.

CREATE TABLE IF NOT EXISTS public.historical_team_games (
  game_pk           BIGINT NOT NULL REFERENCES public.historical_games(game_pk) ON DELETE CASCADE,
  team              TEXT NOT NULL,                          -- 'LAD', 'NYY', ...
  is_home           BOOLEAN NOT NULL,
  won               BOOLEAN,                                -- NULL until game finalised
  team_score        INT,
  opp_score         INT,
  starter_id        INT,                                    -- MLB person id for this team's starter
  starter_name      TEXT,

  -- Situational tags (Tier 3a — populated for ALL eras)
  streak            INT,                                    -- signed; team's W/L streak ENTERING this game (+3 = won last 3, -2 = lost last 2)
  rest_days         INT,                                    -- 0 = back-to-back, 1 = standard, 2+ = post off-day
  is_day_game       BOOLEAN,                                -- first pitch before 17:00 ET
  day_after_night   BOOLEAN,                                -- today day game, prior game night
  getaway_day       BOOLEAN,                                -- last game of a road series for the team
  series_game_num   INT,                                    -- 1, 2, 3, 4 (DH-aware)
  doubleheader      TEXT,                                   -- 'none' | 'game_1' | 'game_2'
  prev_extras       BOOLEAN,                                -- previous game went to extra innings
  prev_blowout      BOOLEAN,                                -- previous game decided by 5+ runs (margin)

  -- Situational tags (Tier 3b — only populated for data_quality = 'full' games)
  starter_rest      INT,                                    -- days since this starter last pitched
  bullpen_ip_3d     NUMERIC,                                -- bullpen IP across the prior 3 calendar days
  coming_off_no_hit BOOLEAN,                                -- previous game was a no-hitter (either by or against)
  tz_change_we      BOOLEAN,                                -- west→east time-zone change in the last 24h
  tz_change_ew      BOOLEAN,                                -- east→west
  road_trip_game_num INT,                                   -- 1..N for road games on the current trip; NULL when home
  home_stand_game_num INT,                                  -- 1..N for home games on the current stand; NULL when away
  same_starter_in_series BOOLEAN,                           -- this team faced the OPP's same starter earlier in the series
  vs_team_above_500 BOOLEAN,                                -- opponent's W% > 0.500 entering today

  PRIMARY KEY (game_pk, team)
);

CREATE INDEX IF NOT EXISTS idx_htg_team_date
  ON public.historical_team_games (team, game_pk);
CREATE INDEX IF NOT EXISTS idx_htg_situational_core
  ON public.historical_team_games (team, is_home, streak, rest_days);
CREATE INDEX IF NOT EXISTS idx_htg_starter
  ON public.historical_team_games (starter_id);

COMMENT ON TABLE public.historical_team_games IS
  'Per-team situational snapshot of each game. Tier-3a fields (streak, rest_days, is_day_game, day_after_night, getaway_day, series_game_num, doubleheader, prev_extras, prev_blowout) populated for all eras. Tier-3b fields populated only for data_quality=full games (2021-2026).';


-- ── historical_odds ──────────────────────────────────────────────────────────
-- Closing odds per (game, market, side). One row per book quote we care about
-- for the lookup; consensus / chosen-book per source.

-- historical_odds uses a surrogate PK + a unique index with COALESCE since
-- the natural-key columns (team, side, point) are nullable across markets and
-- Postgres rejects COALESCE() inside a real PRIMARY KEY constraint.
CREATE TABLE IF NOT EXISTS public.historical_odds (
  id             BIGSERIAL PRIMARY KEY,
  game_pk        BIGINT NOT NULL REFERENCES public.historical_games(game_pk) ON DELETE CASCADE,
  market         TEXT NOT NULL,                             -- 'ML', 'RL', 'TOTAL', 'TT', 'F5-ML', 'F5-RL', 'F5-TOTAL', 'F5-TT'
  team           TEXT,                                       -- for ML/RL: which team's side; NULL for TOTAL/TT-OVER/UNDER
  side           TEXT,                                       -- 'OVER' | 'UNDER' | NULL (use team for ML/RL)
  point          NUMERIC,                                    -- spread for RL (±1.5 / ±0.5), total for TOTAL/TT
  price_american INT NOT NULL,                              -- closing American odds
  source         TEXT NOT NULL,                              -- 'sbr_xlsx' | 'pinnacle_data_2016' | 'sbr_scraper' | 'odds_api_historical' | 'odds_snapshots' | 'pythagorean_estimate'
  source_book    TEXT,                                       -- 'pinnacle' | 'draftkings' | 'consensus' | NULL
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ho_natural
  ON public.historical_odds (
    game_pk,
    market,
    COALESCE(team, ''),
    COALESCE(side, ''),
    COALESCE(point, 0),
    source
  );
CREATE INDEX IF NOT EXISTS idx_ho_game_market
  ON public.historical_odds (game_pk, market);
CREATE INDEX IF NOT EXISTS idx_ho_source
  ON public.historical_odds (source);

COMMENT ON TABLE public.historical_odds IS
  'Closing odds for historical games. source column tags provenance — free-source backfill (sbr_xlsx, sbr_scraper) for 2014-2024 ML/RL/TOTAL; odds_snapshots for 2025+ ongoing capture; pythagorean_estimate as a synthetic fallback when no real odds source exists for that (game, market). TT/F5 markets typically NULL pre-2025 (no free historical source).';


-- ── pitcher_vs_team_games ────────────────────────────────────────────────────
-- One row per (game, pitcher). Tracks each start's stat line vs the opposing
-- team. Source: MLB Stats API game-feed boxscore.

CREATE TABLE IF NOT EXISTS public.pitcher_vs_team_games (
  game_pk        BIGINT NOT NULL REFERENCES public.historical_games(game_pk) ON DELETE CASCADE,
  game_date      DATE NOT NULL,
  pitcher_id     INT NOT NULL,
  pitcher_name   TEXT NOT NULL,
  opp_team       TEXT NOT NULL,                              -- the team this pitcher faced
  ip             NUMERIC,                                    -- innings pitched, decimal (e.g. 6.2 = 6 IP + 2/3)
  bf             INT,
  k              INT,
  bb             INT,
  hr_allowed     INT,
  earned_runs    INT,
  outcome        TEXT,                                       -- 'W' | 'L' | 'ND' | 'BS' | NULL
  game_score     INT,                                        -- Bill James game score (or NULL if not derivable)
  PRIMARY KEY (game_pk, pitcher_id)
);

CREATE INDEX IF NOT EXISTS idx_pvtg_pitcher_opp
  ON public.pitcher_vs_team_games (pitcher_id, opp_team, game_date DESC);
CREATE INDEX IF NOT EXISTS idx_pvtg_opp_team
  ON public.pitcher_vs_team_games (opp_team, game_date DESC);

COMMENT ON TABLE public.pitcher_vs_team_games IS
  'Per-start pitcher line vs the opposing team. Used to derive pitcher_vs_team_career aggregates and for recent-form / decay analysis.';


-- ── pitcher_vs_team_career ───────────────────────────────────────────────────
-- Pre-aggregated career line per (pitcher, opp_team). Refreshed by the daily
-- cron after new games are appended to pitcher_vs_team_games. Plain table (not
-- a materialized view) so we can cheaply update single rows on append.

CREATE TABLE IF NOT EXISTS public.pitcher_vs_team_career (
  pitcher_id     INT NOT NULL,
  opp_team       TEXT NOT NULL,
  pitcher_name   TEXT NOT NULL,                              -- denormalised for query speed
  starts         INT NOT NULL,
  total_bf       INT NOT NULL,
  total_ip       NUMERIC NOT NULL,
  total_k        INT NOT NULL,
  total_bb       INT NOT NULL,
  total_hr       INT NOT NULL,
  total_er       INT NOT NULL,
  k_bb_pct       NUMERIC,                                    -- (k - bb) / bf
  era            NUMERIC,                                    -- 9 * er / ip
  fip            NUMERIC,                                    -- (13*hr + 3*bb - 2*k) / ip + 3.10
  last_faced     DATE NOT NULL,                              -- most recent start vs this team
  refreshed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pitcher_id, opp_team)
);

CREATE INDEX IF NOT EXISTS idx_pvtc_pitcher
  ON public.pitcher_vs_team_career (pitcher_id);

COMMENT ON TABLE public.pitcher_vs_team_career IS
  'Pre-aggregated pitcher career line vs each opposing team. Refreshed by the daily situational-append cron from pitcher_vs_team_games.';


-- ── RLS: read-public, write-service-role-only (single-user app pattern) ──────
-- The lookup CLI tool uses the service-role key; the dashboard uses anon key
-- for read-only. Matches the existing convention in this project.

ALTER TABLE public.historical_games        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_team_games   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_odds         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pitcher_vs_team_games   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pitcher_vs_team_career  ENABLE ROW LEVEL SECURITY;

-- Read: public
CREATE POLICY hg_read_public  ON public.historical_games        FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY htg_read_public ON public.historical_team_games   FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY ho_read_public  ON public.historical_odds         FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY pvtg_read_public ON public.pitcher_vs_team_games  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY pvtc_read_public ON public.pitcher_vs_team_career FOR SELECT TO anon, authenticated USING (true);

-- Writes: service-role only (no explicit policy needed — service-role bypasses RLS by default;
-- absence of INSERT/UPDATE/DELETE policies blocks anon/authenticated writes).
