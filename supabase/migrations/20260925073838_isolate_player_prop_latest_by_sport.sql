create or replace view public.player_prop_latest
with (security_invoker = true) as
with ranked as (
  select
    p.id,
    p.captured_at,
    p.sport,
    p.model_version,
    p.event_id,
    p.game_pk,
    p.starts_at,
    p.away_team,
    p.home_team,
    p.player_id,
    p.mlb_player_id,
    p.player_name,
    p.stat_id,
    p.market_name,
    p.line,
    p.side,
    p.label,
    p.model_mean,
    p.raw_independent_probability,
    p.model_probability,
    p.push_probability,
    p.market_fair_probability,
    p.edge_pct_points,
    p.best_book,
    p.best_odds,
    p.exact_line_book_count,
    p.paired_books,
    p.ev_pct,
    p.data_quality,
    p.status,
    p.reason,
    p.raw,
    row_number() over (
      partition by
        p.sport,
        p.event_id,
        p.player_id,
        p.stat_id,
        p.line,
        p.side
      order by p.captured_at desc, p.id desc
    ) as rn,
    p.tf_shadow_model_version,
    p.tf_shadow_probability,
    p.tf_shadow_ensemble_probability,
    p.tf_shadow_production_weight,
    p.tf_shadow_selected_validation_weight,
    p.tf_shadow_eligible_for_production,
    p.tf_shadow_affects_decision
  from public.player_prop_observations p
)
select
  id,
  captured_at,
  sport,
  model_version,
  event_id,
  game_pk,
  starts_at,
  away_team,
  home_team,
  player_id,
  mlb_player_id,
  player_name,
  stat_id,
  market_name,
  line,
  side,
  label,
  model_mean,
  raw_independent_probability,
  model_probability,
  push_probability,
  market_fair_probability,
  edge_pct_points,
  best_book,
  best_odds,
  exact_line_book_count,
  paired_books,
  ev_pct,
  data_quality,
  status,
  reason,
  raw,
  rn,
  tf_shadow_model_version,
  tf_shadow_probability,
  tf_shadow_ensemble_probability,
  tf_shadow_production_weight,
  tf_shadow_selected_validation_weight,
  tf_shadow_eligible_for_production,
  tf_shadow_affects_decision
from ranked
where rn = 1;

revoke all on table public.player_prop_latest
  from public, anon, authenticated;
grant select on table public.player_prop_latest
  to service_role;

create index if not exists player_prop_lookup_sport_idx
  on public.player_prop_observations(
    sport,
    event_id,
    player_id,
    stat_id,
    line,
    side,
    captured_at desc,
    id desc
  );
