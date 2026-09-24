create or replace function public.export_player_prop_training_rows()
returns table (
  observation_id bigint,
  captured_at timestamptz,
  starts_at timestamptz,
  event_id text,
  game_pk bigint,
  player_id text,
  stat_id text,
  line numeric,
  side text,
  model_mean numeric,
  raw_independent_probability numeric,
  model_probability numeric,
  push_probability numeric,
  market_fair_probability numeric,
  edge_pct_points numeric,
  best_odds integer,
  exact_line_book_count integer,
  paired_books integer,
  ev_pct numeric,
  data_quality numeric,
  status text,
  won boolean,
  pushed boolean,
  outcome text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    o.id as observation_id,
    o.captured_at,
    o.starts_at,
    o.event_id,
    o.game_pk,
    o.player_id,
    o.stat_id,
    o.line,
    o.side,
    o.model_mean,
    o.raw_independent_probability,
    o.model_probability,
    o.push_probability,
    o.market_fair_probability,
    o.edge_pct_points,
    o.best_odds,
    o.exact_line_book_count,
    o.paired_books,
    o.ev_pct,
    o.data_quality,
    o.status,
    r.won,
    r.pushed,
    r.outcome
  from public.player_prop_observations o
  join public.player_prop_results r
    on r.observation_id = o.id
  where r.won is not null
  order by o.starts_at, o.captured_at, o.id;
$$;

revoke all on function public.export_player_prop_training_rows()
  from public, anon, authenticated;
grant execute on function public.export_player_prop_training_rows()
  to service_role;
