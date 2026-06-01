-- markets: add team columns, make market_param non-null (empty = h2h), unique key for upsert
alter table public.markets add column if not exists home_team text;
alter table public.markets add column if not exists away_team text;
update public.markets set market_param = '' where market_param is null;
alter table public.markets alter column market_param set default '';
alter table public.markets alter column market_param set not null;
create unique index if not exists uq_markets_event_type_param
  on public.markets (event_id, market_type, market_param);

-- event_book_mappings: unique key matching resolveEventMapping's cache lookup + upsert onConflict
create unique index if not exists uq_ebm_book_event_book
  on public.event_book_mappings (book_event_id, book);
