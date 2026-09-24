create table if not exists public.mlb_pitchmix_feature_snapshots (
  id bigint generated always as identity primary key,
  observed_at timestamptz not null default now(),
  game_pk bigint not null,
  starts_at timestamptz,
  away_team text,
  home_team text,
  source_version text,
  lineups_confirmed boolean,
  away_available boolean,
  away_starter_id bigint,
  away_starter_name text,
  away_arsenal_coverage numeric,
  away_usable_usage numeric,
  away_weighted_xwoba_delta numeric,
  away_probability_adjustment numeric,
  home_available boolean,
  home_starter_id bigint,
  home_starter_name text,
  home_arsenal_coverage numeric,
  home_usable_usage numeric,
  home_weighted_xwoba_delta numeric,
  home_probability_adjustment numeric,
  raw jsonb not null default '{}'::jsonb
);

create index if not exists mlb_pitchmix_feature_snapshots_game_time_idx
  on public.mlb_pitchmix_feature_snapshots (game_pk, observed_at desc);

alter table public.mlb_pitchmix_feature_snapshots enable row level security;
revoke all on public.mlb_pitchmix_feature_snapshots from anon, authenticated;
grant select, insert, delete on public.mlb_pitchmix_feature_snapshots to service_role;

create or replace view public.player_prop_feature_store
with (security_invoker = true)
as
with enriched as (
  select
    o.id as observation_id,
    o.captured_at as observation_captured_at,
    o.starts_at,
    o.sport,
    o.model_version,
    o.event_id,
    o.game_pk,
    o.away_team,
    o.home_team,
    o.player_id,
    o.mlb_player_id,
    o.player_name,
    o.stat_id,
    o.market_name,
    o.line,
    o.side,
    o.label,
    o.model_mean,
    o.raw_independent_probability,
    o.model_probability,
    o.push_probability,
    coalesce(c.current_market_fair_probability, o.market_fair_probability)
      as market_fair_probability,
    o.edge_pct_points,
    o.best_book,
    coalesce(c.current_best_odds_at_decision_line, o.best_odds) as best_odds,
    o.exact_line_book_count,
    o.paired_books,
    o.ev_pct,
    o.data_quality,
    o.status,
    v.evaluated_at as verification_at,
    v.player_role,
    v.player_team_side,
    v.in_starting_lineup,
    v.batting_order_spot,
    v.is_confirmed_starter,
    v.catcher_change_after_model,
    v.opposing_starter_change_after_model,
    v.opposing_handedness_change_after_model,
    v.data_quality as verification_data_quality,
    w.evaluated_at as prop_weather_at,
    w.prop_family,
    w.impact_direction as weather_impact_direction,
    w.impact_multiplier as weather_impact_multiplier,
    w.raw_environment_multiplier as weather_environment_multiplier,
    w.delay_risk as prop_delay_risk,
    w.data_quality as prop_weather_data_quality,
    w.weather_change_after_model,
    c.refreshed_at as market_refresh_at,
    c.opening_consensus_line as market_open_line,
    c.current_consensus_line as market_current_line,
    c.line_move_open_to_current,
    c.opening_market_fair_probability as market_open_fair_probability,
    c.current_market_fair_probability as market_current_fair_probability,
    case
      when c.current_market_fair_probability is not null
       and c.opening_market_fair_probability is not null
      then (c.current_market_fair_probability - c.opening_market_fair_probability) * 100
      else null
    end as market_probability_move_pp,
    greatest(
      o.captured_at,
      coalesce(v.evaluated_at, o.captured_at),
      coalesce(w.evaluated_at, o.captured_at),
      coalesce(c.refreshed_at, o.captured_at)
    ) as preliminary_feature_at
  from public.player_prop_observations o
  left join lateral (
    select v1.*
    from public.player_prop_verification_shadow v1
    where v1.observation_id = o.id
      and v1.evaluated_at < o.starts_at
    order by v1.evaluated_at desc
    limit 1
  ) v on true
  left join lateral (
    select w1.*
    from public.player_prop_weather_shadow w1
    where w1.observation_id = o.id
      and w1.evaluated_at < o.starts_at
    order by w1.evaluated_at desc
    limit 1
  ) w on true
  left join lateral (
    select c1.*
    from public.player_prop_clv c1
    where c1.observation_id = o.id
      and c1.refreshed_at < o.starts_at
      and coalesce(c1.finalized, false) = false
    order by c1.refreshed_at desc
    limit 1
  ) c on true
),
sources as (
  select
    e.*,
    gv.checked_at as game_verification_at,
    gv.away_starter_hand,
    gv.home_starter_hand,
    gv.away_lineup,
    gv.home_lineup,
    gv.away_bullpen,
    gv.home_bullpen,
    gv.starter_changed,
    gv.lineup_changed,
    gv.catcher_changed,
    gv.handedness_changed,
    gw.checked_at as game_weather_at,
    gw.roof_status,
    gw.temp_f,
    gw.humidity_pct,
    gw.precip_probability_pct,
    gw.wind_mph,
    gw.wind_direction_deg,
    gw.wind_class,
    gw.park_factor,
    gw.run_multiplier,
    gw.hr_multiplier,
    gw.hits_tb_multiplier,
    gw.starter_durability_multiplier,
    gw.strikeout_opportunity_multiplier,
    gw.delay_risk as game_delay_risk,
    gw.data_quality as game_weather_data_quality,
    pm.observed_at as pitchmix_at,
    pm.away_available as pitchmix_away_available,
    pm.away_arsenal_coverage,
    pm.away_usable_usage,
    pm.away_weighted_xwoba_delta,
    pm.away_probability_adjustment,
    pm.home_available as pitchmix_home_available,
    pm.home_arsenal_coverage,
    pm.home_usable_usage,
    pm.home_weighted_xwoba_delta,
    pm.home_probability_adjustment,
    greatest(
      e.preliminary_feature_at,
      coalesce(gv.checked_at, e.preliminary_feature_at),
      coalesce(gw.checked_at, e.preliminary_feature_at),
      coalesce(pm.observed_at, e.preliminary_feature_at)
    ) as feature_available_at
  from enriched e
  left join lateral (
    select g1.*
    from public.mlb_verification_snapshots g1
    where (
        (e.game_pk is not null and g1.game_pk = e.game_pk)
        or (e.game_pk is null and g1.event_id = e.event_id)
      )
      and g1.checked_at < e.starts_at
    order by g1.checked_at desc
    limit 1
  ) gv on true
  left join lateral (
    select g2.*
    from public.mlb_weather_park_snapshots g2
    where (
        (e.game_pk is not null and g2.game_pk = e.game_pk)
        or (e.game_pk is null and g2.event_id = e.event_id)
      )
      and g2.checked_at < e.starts_at
    order by g2.checked_at desc
    limit 1
  ) gw on true
  left join lateral (
    select p1.*
    from public.mlb_pitchmix_feature_snapshots p1
    where e.game_pk is not null
      and p1.game_pk = e.game_pk
      and p1.observed_at < e.starts_at
    order by p1.observed_at desc
    limit 1
  ) pm on true
)
select
  s.observation_id,
  s.observation_captured_at,
  s.feature_available_at,
  s.starts_at,
  extract(epoch from (s.starts_at - s.feature_available_at)) / 60.0 as minutes_to_start,
  s.sport,
  s.model_version,
  s.event_id,
  s.game_pk,
  s.away_team,
  s.home_team,
  s.player_id,
  s.mlb_player_id,
  s.player_name,
  s.stat_id,
  s.market_name,
  s.line,
  s.side,
  s.label,
  s.model_mean,
  s.raw_independent_probability,
  s.model_probability,
  s.push_probability,
  s.market_fair_probability,
  s.edge_pct_points,
  s.best_book,
  s.best_odds,
  s.exact_line_book_count,
  s.paired_books,
  s.ev_pct,
  s.data_quality,
  s.status,
  s.market_open_line,
  s.market_current_line,
  s.line_move_open_to_current,
  s.market_open_fair_probability,
  s.market_current_fair_probability,
  s.market_probability_move_pp,
  case when s.market_refresh_at is not null
    then extract(epoch from (s.feature_available_at - s.market_refresh_at)) / 60.0
  end as market_quote_age_minutes,
  s.player_role,
  s.player_team_side,
  case when s.in_starting_lineup is true then 1 when s.in_starting_lineup is false then 0 end as in_starting_lineup,
  s.batting_order_spot,
  case when s.is_confirmed_starter is true then 1 when s.is_confirmed_starter is false then 0 end as is_confirmed_starter,
  case when s.catcher_change_after_model is true then 1 when s.catcher_change_after_model is false then 0 end as catcher_change_after_model,
  case when s.opposing_starter_change_after_model is true then 1 when s.opposing_starter_change_after_model is false then 0 end as opposing_starter_change_after_model,
  case when s.opposing_handedness_change_after_model is true then 1 when s.opposing_handedness_change_after_model is false then 0 end as opposing_handedness_change_after_model,
  s.verification_data_quality,
  case when s.player_team_side='away' then s.home_starter_hand when s.player_team_side='home' then s.away_starter_hand end as opposing_starter_hand,
  case when s.player_team_side='away' then s.away_starter_hand when s.player_team_side='home' then s.home_starter_hand end as own_starter_hand,
  case when s.player_team_side='away' then
      (select avg(nullif(x->>'ops','')::numeric) from jsonb_array_elements(coalesce(s.away_lineup,'[]'::jsonb)) x)
    when s.player_team_side='home' then
      (select avg(nullif(x->>'ops','')::numeric) from jsonb_array_elements(coalesce(s.home_lineup,'[]'::jsonb)) x)
  end as own_lineup_avg_ops,
  case when s.player_team_side='away' then
      (select avg(nullif(x->>'ops','')::numeric) from jsonb_array_elements(coalesce(s.home_lineup,'[]'::jsonb)) x)
    when s.player_team_side='home' then
      (select avg(nullif(x->>'ops','')::numeric) from jsonb_array_elements(coalesce(s.away_lineup,'[]'::jsonb)) x)
  end as opponent_lineup_avg_ops,
  case when s.player_team_side='away' then nullif(s.away_bullpen->>'score','')::numeric
       when s.player_team_side='home' then nullif(s.home_bullpen->>'score','')::numeric end as own_bullpen_score,
  case when s.player_team_side='away' then nullif(s.home_bullpen->>'score','')::numeric
       when s.player_team_side='home' then nullif(s.away_bullpen->>'score','')::numeric end as opponent_bullpen_score,
  case when s.player_team_side='away' then s.away_bullpen->>'level'
       when s.player_team_side='home' then s.home_bullpen->>'level' end as own_bullpen_level,
  case when s.player_team_side='away' then s.home_bullpen->>'level'
       when s.player_team_side='home' then s.away_bullpen->>'level' end as opponent_bullpen_level,
  case when s.starter_changed is true then 1 when s.starter_changed is false then 0 end as game_starter_changed,
  case when s.lineup_changed is true then 1 when s.lineup_changed is false then 0 end as game_lineup_changed,
  case when s.catcher_changed is true then 1 when s.catcher_changed is false then 0 end as game_catcher_changed,
  case when s.handedness_changed is true then 1 when s.handedness_changed is false then 0 end as game_handedness_changed,
  s.weather_impact_direction,
  s.weather_impact_multiplier,
  s.weather_environment_multiplier,
  s.prop_delay_risk,
  s.prop_weather_data_quality,
  case when s.weather_change_after_model is true then 1 when s.weather_change_after_model is false then 0 end as weather_change_after_model,
  s.roof_status,
  s.temp_f,
  s.humidity_pct,
  s.precip_probability_pct,
  s.wind_mph,
  s.wind_direction_deg,
  s.wind_class,
  s.park_factor,
  s.run_multiplier,
  s.hr_multiplier,
  s.hits_tb_multiplier,
  s.starter_durability_multiplier,
  s.strikeout_opportunity_multiplier,
  s.game_delay_risk,
  s.game_weather_data_quality,
  case
    when s.player_role='HITTER' and s.player_team_side='away' then s.pitchmix_away_available
    when s.player_role='HITTER' and s.player_team_side='home' then s.pitchmix_home_available
    when s.player_role='PITCHER' and s.player_team_side='away' then s.pitchmix_home_available
    when s.player_role='PITCHER' and s.player_team_side='home' then s.pitchmix_away_available
  end as pitchmix_available,
  case
    when s.player_role='HITTER' and s.player_team_side='away' then s.away_weighted_xwoba_delta
    when s.player_role='HITTER' and s.player_team_side='home' then s.home_weighted_xwoba_delta
    when s.player_role='PITCHER' and s.player_team_side='away' then s.home_weighted_xwoba_delta
    when s.player_role='PITCHER' and s.player_team_side='home' then s.away_weighted_xwoba_delta
  end as pitchmix_weighted_xwoba_delta,
  case
    when s.player_role='HITTER' and s.player_team_side='away' then s.away_probability_adjustment
    when s.player_role='HITTER' and s.player_team_side='home' then s.home_probability_adjustment
    when s.player_role='PITCHER' and s.player_team_side='away' then s.home_probability_adjustment
    when s.player_role='PITCHER' and s.player_team_side='home' then s.away_probability_adjustment
  end as pitchmix_probability_adjustment,
  case
    when s.player_role='HITTER' and s.player_team_side='away' then s.away_arsenal_coverage
    when s.player_role='HITTER' and s.player_team_side='home' then s.home_arsenal_coverage
    when s.player_role='PITCHER' and s.player_team_side='away' then s.home_arsenal_coverage
    when s.player_role='PITCHER' and s.player_team_side='home' then s.away_arsenal_coverage
  end as pitchmix_arsenal_coverage,
  case
    when s.player_role='HITTER' and s.player_team_side='away' then s.away_usable_usage
    when s.player_role='HITTER' and s.player_team_side='home' then s.home_usable_usage
    when s.player_role='PITCHER' and s.player_team_side='away' then s.home_usable_usage
    when s.player_role='PITCHER' and s.player_team_side='home' then s.away_usable_usage
  end as pitchmix_usable_usage,
  ((case when s.market_refresh_at is not null then 1 else 0 end)
   +(case when s.verification_at is not null then 1 else 0 end)
   +(case when s.prop_weather_at is not null then 1 else 0 end)
   +(case when s.game_verification_at is not null then 1 else 0 end)
   +(case when s.game_weather_at is not null then 1 else 0 end)
   +(case when s.pitchmix_at is not null then 1 else 0 end)) as feature_source_count
from sources s
where s.feature_available_at < s.starts_at;

revoke all on public.player_prop_feature_store from anon, authenticated;
grant select on public.player_prop_feature_store to service_role;

drop function if exists public.export_player_prop_training_rows();

create function public.export_player_prop_training_rows()
returns setof public.player_prop_feature_store
language sql
stable
security invoker
set search_path = public
as $$
  select f.*
  from public.player_prop_feature_store f
  join public.player_prop_results r on r.observation_id=f.observation_id
  where r.won is not null
  order by f.starts_at, f.feature_available_at, f.observation_id;
$$;

revoke all on function public.export_player_prop_training_rows()
  from public, anon, authenticated;
grant execute on function public.export_player_prop_training_rows() to service_role;
