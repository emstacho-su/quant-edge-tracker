-- 20260523_book_prices_account_line.sql
-- Phase 11: 7stacks Credentialed Adapter — Schema + Safety Foundation
-- Additive changes:
--   1. book_prices gains an is_account_line column (BOOLEAN NOT NULL DEFAULT FALSE)
--      to distinguish the user's actual DGS account line (scraped login) from any
--      aggregator row for the same book (BOOK-05, D-03, Pitfall 4).
--   2. Creates the scrape_health status table: per-book health status
--      (book + status + checked_at ONLY — never tokens or credentials) (D-08).
-- Both changes are idempotent (IF NOT EXISTS / IF NOT EXISTS equivalents).
-- No existing table is altered beyond the additive book_prices column.
-- odds_snapshots is NOT referenced or modified.
-- Applied to prod (yuxjidjpiqeybrdsprgt) via Supabase MCP apply_migration.


-- ============================================================
-- 1. Additive column: book_prices.is_account_line
-- ============================================================
-- Distinguishes the user's actual logged-in DGS account line (is_account_line=true,
-- source_confidence='scraped') from any aggregator or API-sourced line for the same
-- book (is_account_line=false). The DGS-PPH adapter (11-02) uses upsert conflict key
-- (market_id, book, side, is_account_line) so scraped account rows never overwrite
-- any aggregator row. (D-03, A5, Pitfall 4)
alter table public.book_prices
  add column if not exists is_account_line boolean not null default false;

comment on column public.book_prices.is_account_line is
  'true = user''s actual logged-in DGS account line (scraped via Playwright); '
  'false = aggregator or API source. The DGS-PPH adapter upserts on '
  '(market_id, book, side, is_account_line) so account rows never overwrite '
  'any aggregator row for the same book (BOOK-05, D-03, Pitfall 4).';


-- ============================================================
-- 2. Additive table: scrape_health
-- ============================================================
-- Lightweight per-book scraper status table. The DGS-PPH adapter (11-02) upserts
-- { book, status, checked_at } on stale-session/DOM-drift — one row per book.
-- Stores book name + status ONLY — never tokens, credentials, or storageState.
-- The daemon writes via service-role; anon clients may read status for monitoring.
-- (D-08, BOOK-05, Pitfall 1, Threat Model row T-11-22/T-11-23)
create table if not exists public.scrape_health (
  book        text        primary key,
  status      text        not null,
  checked_at  timestamptz not null default now()
);

comment on table public.scrape_health is
  'Per-book scraper health status. One row per book keyed on book name. '
  'Columns: book (PK), status, checked_at. '
  'Book name + status ONLY — never tokens or credentials (D-08, T-11-22).';

comment on column public.scrape_health.book is
  'Book name (matches BookName union); primary key — one health row per book.';

comment on column public.scrape_health.status is
  'Scraper status string — e.g. "ok", "stale_session", "dom_drift", "unreachable". '
  'Human-readable; NOT a credential or session token.';

comment on column public.scrape_health.checked_at is
  'Timestamp of the last health update for this book.';

-- RLS: anon read-only (mirrors Phase 7 pattern from 07-03).
-- The daemon writes via the service-role key (bypasses RLS).
-- NO insert/update/delete policy for anon — anon may only SELECT.
-- (D-08, T-11-23)
alter table public.scrape_health enable row level security;

drop policy if exists "anon read scrape_health" on public.scrape_health;
create policy "anon read scrape_health"
  on public.scrape_health
  for select
  to anon
  using (true);
