-- Positive Line Movement (PLM): your locked price vs the best actual price across
-- the sharp/major book subset. Sits alongside the existing no-vig CLV fields; rides
-- the same clv_status lifecycle (tracking → locked) and freezes on lock.
alter table public.bets add column if not exists plm_best_american numeric;
alter table public.bets add column if not exists plm_best_book     text;
alter table public.bets add column if not exists plm_pct           numeric;
alter table public.bets add column if not exists plm_prob_points   numeric;
alter table public.bets add column if not exists plm_positive      boolean;
