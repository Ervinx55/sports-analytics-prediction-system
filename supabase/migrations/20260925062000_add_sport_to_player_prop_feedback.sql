alter table public.player_prop_results
  add column if not exists sport text not null default 'MLB';

alter table public.player_prop_clv
  add column if not exists sport text not null default 'MLB';

create index if not exists player_prop_results_sport_graded_idx
  on public.player_prop_results(sport, graded_at desc);

create index if not exists player_prop_clv_sport_final_idx
  on public.player_prop_clv(sport, finalized, starts_at desc);

create or replace view public.player_prop_clv_latest
with (security_invoker = true) as
select
  c.observation_id,
  c.sport,
  c.refreshed_at,
  c.finalized_at,
  c.finalized,
  c.event_id,
  c.game_pk,
  c.starts_at,
  c.player_id,
  c.player_name,
  c.stat_id,
  c.label,
  c.side,
  c.decision_line,
  c.decision_book,
  c.decision_odds,
  c.decision_implied_probability,
  c.decision_market_fair_probability,
  c.opening_consensus_line,
  c.opening_best_odds_at_decision_line,
  c.opening_market_fair_probability,
  c.current_consensus_line,
  c.current_best_odds_at_decision_line,
  c.current_same_book_odds,
  c.current_market_fair_probability,
  c.current_quote_at,
  c.closing_consensus_line,
  c.closing_best_odds_at_decision_line,
  c.closing_same_book_odds,
  c.closing_market_fair_probability,
  c.close_quote_at,
  c.close_quote_age_minutes,
  c.close_book_count,
  c.close_paired_books,
  c.line_move_open_to_current,
  c.line_move_open_to_close,
  c.line_clv_units,
  c.fair_probability_clv_pp,
  c.same_book_price_clv_pp,
  c.best_market_price_clv_pp,
  c.clv_classification,
  c.raw
from public.player_prop_clv c
join public.player_prop_latest p
  on p.id = c.observation_id;

revoke all on table public.player_prop_clv_latest
  from public, anon, authenticated;
grant select on table public.player_prop_clv_latest
  to service_role;
