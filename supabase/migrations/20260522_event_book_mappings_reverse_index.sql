-- 20260522_event_book_mappings_reverse_index.sql
-- Phase 8: Odds API Arb Cron — Reverse-Direction Lookup Index
-- Purpose: Add reverse-direction index on event_book_mappings(book_event_id, book) so the
--   Phase 8 arb cron / resolveEventMapping can resolve book_event_id -> canonical_event_id
--   efficiently (index lookup instead of full table scan on every cron tick).
-- Phase 7 (20260521_line_shop.sql) created only the (canonical_event_id, book) direction;
--   this index covers the opposite resolution path (DATA-03, D-04, RESEARCH Open Q #2).
-- Additive and idempotent: create index if not exists; no table/column/constraint change.
-- Applied to prod (yuxjidjpiqeybrdsprgt) via Supabase MCP apply_migration.

create index if not exists idx_event_book_mappings_reverse
  on public.event_book_mappings (book_event_id, book);
