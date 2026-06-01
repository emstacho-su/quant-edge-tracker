-- 20260521_line_shop.sql
-- Phase 7: Analysis Math + Schema Foundation
-- New tables: markets, book_prices, arb_opportunities, event_book_mappings
-- Additive bets columns: market_id, line_shop_used, entry_book, no_vig_at_entry
-- RLS: anon SELECT on all new tables; writes via service-role only.
-- Applied to prod (yuxjidjpiqeybrdsprgt) via Supabase MCP apply_migration.


-- ============================================================
-- 1. Canonical market registry
-- ============================================================
create table if not exists public.markets (
  id                uuid primary key default gen_random_uuid(),
  sport             text not null,
  event_id          text not null,                    -- e.g. 'MLB_20260520_MIL_CHC' or 'MLB_20260520_CHC_MIL_G2'
  event_name        text not null,
  event_start       timestamptz not null,
  market_type       text not null,                    -- 'moneyline','spread','total','team_total','outright'
  market_param      text,                             -- '-1.5','8.5', null for moneyline
  odds_api_event_id text,                             -- soft ref to odds_snapshots.odds_event_id (no hard FK)
  created_at        timestamptz not null default now()
);

comment on table public.markets is
  'Canonical event/market registry for line-shop. One row per (event, market_type, market_param). '
  'Linked to odds_snapshots via odds_api_event_id (soft ref). Source of truth for market identity across all books.';

-- Expression-based unique index handles NULL market_param (moneylines) correctly.
-- Standard UNIQUE(...) cannot include a function call in Postgres inline DDL.
-- COALESCE(market_param, '') coerces NULL to '' so duplicate moneylines are rejected (D-07, PITFALLS P4).
create unique index if not exists idx_markets_unique_market
  on public.markets(event_id, market_type, coalesce(market_param, ''));

create index if not exists idx_markets_event_id
  on public.markets(event_id);

create index if not exists idx_markets_sport_start
  on public.markets(sport, event_start);

alter table public.markets enable row level security;
drop policy if exists "anon read markets" on public.markets;
create policy "anon read markets" on public.markets for select to anon using (true);


-- ============================================================
-- 2. Book price snapshots (all sources)
-- ============================================================
create table if not exists public.book_prices (
  id                uuid primary key default gen_random_uuid(),
  market_id         uuid not null references public.markets(id) on delete cascade,
  book              text not null,
  side              text not null,                    -- 'home','away','over','under','yes','no'
  price_american    integer not null,
  price_decimal     numeric(8,5) not null,
  implied_prob      numeric(8,6) not null,            -- RAW implied probability (with vig)
  point             numeric,                          -- spread/total point value (mirrors odds_snapshots.point)
  fetched_at        timestamptz not null default now(),
  source_confidence text not null
    check (source_confidence in ('api','aggregator','scraped')),
  is_closing        boolean not null default false    -- true = closing-line snapshot (flagged post event_start)
);

comment on table public.book_prices is
  'Per-book price snapshots for line-shop. All sources land here (Odds API via adapter, Kalshi, scrapers). '
  'odds_snapshots remains the single-source CLV reference and is NOT written by line-shop adapters.';

comment on column public.book_prices.implied_prob is
  'RAW implied probability (with vig) = impliedFromAmerican(price_american). '
  'Do NOT store no-vig / devigged probability here — arb detection requires the raw value.';

create index if not exists idx_book_prices_market_book_time
  on public.book_prices(market_id, book, fetched_at desc);

create index if not exists idx_book_prices_recent
  on public.book_prices(fetched_at desc)
  where is_closing = false;

alter table public.book_prices enable row level security;
drop policy if exists "anon read book_prices" on public.book_prices;
create policy "anon read book_prices" on public.book_prices for select to anon using (true);


-- ============================================================
-- 3. Detected arb opportunities
-- ============================================================
create table if not exists public.arb_opportunities (
  id                uuid primary key default gen_random_uuid(),
  market_id         uuid not null references public.markets(id) on delete cascade,
  side_a            text not null,
  side_a_book       text not null,
  side_a_price      integer not null,
  side_a_stake_pct  numeric(6,4) not null,
  side_b            text not null,
  side_b_book       text not null,
  side_b_price      integer not null,
  side_b_stake_pct  numeric(6,4) not null,
  total_return_pct  numeric(6,4) not null,
  detected_at       timestamptz not null default now(),
  expires_at        timestamptz,
  status            text not null default 'detected'
    check (status in ('detected','expired','taken','rejected'))
);

comment on table public.arb_opportunities is
  'Persisted arb opportunities detected by the arbitrage scanner (Phase 8 cron). '
  'Created by Phase 7 schema only; populated in Phase 8.';

create index if not exists idx_arb_opportunities_status_time
  on public.arb_opportunities(status, detected_at desc);

alter table public.arb_opportunities enable row level security;
drop policy if exists "anon read arb_opportunities" on public.arb_opportunities;
create policy "anon read arb_opportunities" on public.arb_opportunities for select to anon using (true);


-- ============================================================
-- 4. Cross-book event mapping cache
-- ============================================================
create table if not exists public.event_book_mappings (
  id                  uuid primary key default gen_random_uuid(),
  canonical_event_id  text not null,                  -- matches markets.event_id
  book                text not null,
  book_event_id       text not null,                  -- Odds API event id, Kalshi ticker, etc.
  match_confidence    numeric(4,3) not null,           -- 0.0-1.0; >=1.0 = auto; <1.0 = needs review
  matched_at          timestamptz not null default now(),
  matched_by          text not null default 'auto',   -- 'auto' | 'manual' | 'needs_review'
  unique (canonical_event_id, book)
);

comment on table public.event_book_mappings is
  'Cache of book-specific event IDs mapped to canonical event_id. '
  'Populated lazily in Phase 8 during adapter.fetchEvents(). '
  'Reused on subsequent fetches to avoid re-matching.';

create index if not exists idx_event_book_mappings_lookup
  on public.event_book_mappings(canonical_event_id, book);

alter table public.event_book_mappings enable row level security;
drop policy if exists "anon read event_book_mappings" on public.event_book_mappings;
create policy "anon read event_book_mappings" on public.event_book_mappings for select to anon using (true);


-- ============================================================
-- 5. Extend bets table (additive nullable columns only)
-- ============================================================
alter table public.bets
  add column if not exists market_id        uuid references public.markets(id),
  add column if not exists line_shop_used   boolean not null default false,
  add column if not exists entry_book       text,
  add column if not exists no_vig_at_entry  numeric;

comment on column public.bets.market_id is
  'FK to markets.id set when bet was added from line-shop. Nullable — existing bets unaffected.';
comment on column public.bets.no_vig_at_entry is
  'No-vig consensus probability at time of bet entry (for pre-bet CLV display). Nullable.';
