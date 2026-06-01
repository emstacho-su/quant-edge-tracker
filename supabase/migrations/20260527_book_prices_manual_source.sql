-- 20260527_book_prices_manual_source.sql
-- Phase 21: Arb Scanner — Book Filter + Offshore Slate Upload (Plan 21-01)
-- Additive changes:
--   1. Extends book_prices.source_confidence CHECK constraint to accept 'manual'
--      (D-07: offshore slate upload writes rows with source_confidence='manual').
--      Shape is DROP CONSTRAINT / ADD CONSTRAINT (not an enum extension);
--      source_confidence is a text column + CHECK, never a Postgres ENUM (RESEARCH Pitfall 1).
--   2. Adds nullable superseded_at timestamptz column implementing D-08 lifecycle:
--      prior manual rows for the same book are soft-deleted (superseded_at = now())
--      on next upload rather than hard-deleted, preserving the audit trail (Option C
--      from RESEARCH Pattern 4).
--   3. Partial index idx_book_prices_live on live (non-superseded) rows for fast
--      lookups by market + book used by detectArbsForMarkets (plan 21-04).
-- All three changes are idempotent (IF NOT EXISTS / DROP IF EXISTS guards).
-- No existing table is altered beyond the additive column + index.
-- arb_opportunities and odds_snapshots are NOT referenced or modified.
-- Applied to prod (yuxjidjpiqeybrdsprgt) via Supabase MCP apply_migration on 2026-05-27.


-- ============================================================
-- 1. Extend source_confidence CHECK constraint to include 'manual'
-- ============================================================
-- Drop the current 3-value CHECK so we can re-add with the extended 4-value set.
-- (source_confidence is text + CHECK, not an ENUM — enum-extension syntax is wrong here.)
alter table public.book_prices
  drop constraint if exists book_prices_source_confidence_check;

alter table public.book_prices
  add constraint book_prices_source_confidence_check
  check (source_confidence in ('api', 'aggregator', 'scraped', 'manual'));


-- ============================================================
-- 2. Additive column: book_prices.superseded_at
-- ============================================================
-- Nullable; defaults to NULL on all existing rows and every new INSERT.
-- The offshore-slate upload route (plan 21-05) sets superseded_at = now() on prior
-- manual rows for the same book before inserting the replacement batch, implementing
-- D-08 lifecycle without hard-deleting the old rows (audit trail preserved).
alter table public.book_prices
  add column if not exists superseded_at timestamptz null;

comment on column public.book_prices.superseded_at is
  'NULL = live row. NON-NULL = soft-deleted by a later upload for the same book / source. '
  'Phase 21 D-08: lifecycle = until next manual upload for the same book. '
  'The upload-slate route (21-05) sets superseded_at = now() on prior manual rows '
  'before inserting the replacement batch; existing API/aggregator/scraped rows are never '
  'superseded by the manual-upload path.';


-- ============================================================
-- 3. Partial index on live rows for detectArbsForMarkets (plan 21-04)
-- ============================================================
-- Mirrors the existing idx_book_prices_market_book_time index but is narrowed to
-- live (non-superseded) rows so arb detection only considers current prices.
-- Footprint stays small: manual upload rows that have been superseded are excluded.
create index if not exists idx_book_prices_live
  on public.book_prices(market_id, book, fetched_at desc)
  where superseded_at is null;
