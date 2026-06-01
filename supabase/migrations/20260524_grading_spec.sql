-- Phase 18: grading spec + state for accurate auto-settlement.
-- Additive only — no existing rows affected.
-- Implements D-09 (per-bet grading-spec), D-06 (needs-agent queue state),
-- D-07 prerequisite (per-leg game link + spec), D-05 prerequisite (agent rule write-back).
-- Every DDL statement uses IF NOT EXISTS — idempotent on re-run.

-- ============================================================
-- Part 1: Extend public.bets — grading spec + agent-handoff state (D-09, D-06)
-- grading_spec: structured "what this bet needs to win" (market type, subject espn_id,
--               stat key(s), line, side) — computed at import / Phase-17 resolution time.
-- grading_state: null = deterministic path (no tag); 'needs-agent' = cron could not grade
--               deterministically, handed off to daemon; 'agent-derived' = daemon resolved it.
-- ============================================================

ALTER TABLE public.bets
  ADD COLUMN IF NOT EXISTS grading_spec  jsonb,
  ADD COLUMN IF NOT EXISTS grading_state text
    CHECK (grading_state IN ('needs-agent', 'agent-derived'));

-- ============================================================
-- Part 2: Extend public.parlay_legs — per-leg game link + spec (D-07 prerequisite)
-- live_game_id: the ESPN event ID for the specific game this leg refers to (prop legs
--               need their own game link distinct from the parlay header).
-- grading_spec: per-leg grading spec mirroring the bet-level spec structure.
-- ============================================================

ALTER TABLE public.parlay_legs
  ADD COLUMN IF NOT EXISTS live_game_id  text,
  ADD COLUMN IF NOT EXISTS grading_spec  jsonb;

-- ============================================================
-- Part 3: grading_rules — agent self-improving rule write-back (D-05)
-- Agent writes reusable rules (phrase → taxonomy_key) so the deterministic grader
-- handles that shape on subsequent runs and agent calls shrink over time.
-- Mirrors Phase 17's entity library write-back pattern.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.grading_rules (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sport         text        NOT NULL,          -- 'MLB' | 'NBA' | 'NHL' | 'NFL' | 'WNBA'
  phrase        text        NOT NULL,          -- stat phrasing as it appears in bet description
  taxonomy_key  text        NOT NULL,          -- maps to evaluate-prop.ts TAXONOMY keys
  source        text        NOT NULL DEFAULT 'agent-derived',  -- 'agent-derived' | 'manual'
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS grading_rules_sport_idx ON public.grading_rules (sport);
CREATE INDEX IF NOT EXISTS grading_rules_phrase_idx ON public.grading_rules (lower(phrase));

ALTER TABLE public.grading_rules ENABLE ROW LEVEL SECURITY;

-- Read-all policy (public SELECT via anon key).
-- Writes are service-role only (daemon grading agent) — no anon INSERT path (T-18-01).
DO $$ BEGIN
  CREATE POLICY grading_rules_read_all ON public.grading_rules FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================
-- Part 4: One-time backlog reset — re-open retryable skipped bets (D-06)
-- Resets bets stuck at auto_settle_state='skipped' for parse/taxonomy reasons so the
-- Phase 18 cron can re-attempt them with the new grading logic.
-- Safety constraints (Pitfall 1):
--   • WHERE auto_settle_state = 'skipped'  → never touches 'manual' overrides
--   • settle_skip_reason NOT IN ('cash_floor_guard') → leaves genuinely un-settleable
--     (insufficient cash) bets untouched
--   • placed_at >= now() - interval '90 days' → limits scope to recent backlog only
-- This is a one-time DML; subsequent migration re-runs are no-ops (rows already null).
-- DOES NOT touch bankroll_events — ledger is source of truth (CLAUDE.md invariant).
-- ============================================================

UPDATE public.bets
SET    auto_settle_state = null,
       settle_skip_reason = null
WHERE  status = 'pending'
  AND  auto_settle_state = 'skipped'
  AND  settle_skip_reason NOT IN ('cash_floor_guard')
  AND  placed_at >= now() - interval '90 days';
