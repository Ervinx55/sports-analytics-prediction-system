
alter table public.sharp_gate_history
  add column if not exists sharp_consensus_probability numeric,
  add column if not exists valid_sharp_source_count integer not null default 0,
  add column if not exists fresh_sharp_source_count integer not null default 0,
  add column if not exists sharp_data_quality numeric,
  add column if not exists sharp_consensus_spread_pp numeric,
  add column if not exists model_vs_sharp_pp numeric,
  add column if not exists gate_mode text,
  add column if not exists source_summary jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sharp_gate_source_count_range') then
    alter table public.sharp_gate_history
      add constraint sharp_gate_source_count_range
      check (valid_sharp_source_count between 0 and 3 and fresh_sharp_source_count between 0 and 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sharp_gate_quality_range') then
    alter table public.sharp_gate_history
      add constraint sharp_gate_quality_range
      check (sharp_data_quality is null or (sharp_data_quality >= 0 and sharp_data_quality <= 1));
  end if;
end $$;

update public.sharp_gate_history
set
  sharp_consensus_probability = coalesce(
    sharp_consensus_probability,
    bookmaker_candidate_fair_probability,
    pinnacle_candidate_fair_probability,
    circa_candidate_fair_probability
  ),
  valid_sharp_source_count = case
    when valid_sharp_source_count > 0 then valid_sharp_source_count
    else
      (case when bookmaker_candidate_fair_probability is not null then 1 else 0 end) +
      (case when pinnacle_candidate_fair_probability is not null then 1 else 0 end) +
      (case when circa_candidate_fair_probability is not null then 1 else 0 end)
  end,
  fresh_sharp_source_count = case
    when fresh_sharp_source_count > 0 then fresh_sharp_source_count
    else
      (case when bookmaker_candidate_fair_probability is not null and bookmaker_freshness is not null then 1 else 0 end) +
      (case when pinnacle_candidate_fair_probability is not null and pinnacle_freshness is not null then 1 else 0 end) +
      (case when circa_candidate_fair_probability is not null and circa_freshness is not null then 1 else 0 end)
  end,
  sharp_data_quality = coalesce(sharp_data_quality,
    case
      when second_source_ok then 0.75
      when bookmaker_candidate_fair_probability is not null
        or pinnacle_candidate_fair_probability is not null
        or circa_candidate_fair_probability is not null then 0.45
      else 0.10
    end
  ),
  sharp_consensus_spread_pp = coalesce(sharp_consensus_spread_pp, sharp_disagreement_pp),
  model_vs_sharp_pp = coalesce(
    model_vs_sharp_pp,
    case
      when model_probability is not null and coalesce(
        bookmaker_candidate_fair_probability,
        pinnacle_candidate_fair_probability,
        circa_candidate_fair_probability
      ) is not null
      then (
        model_probability - coalesce(
          bookmaker_candidate_fair_probability,
          pinnacle_candidate_fair_probability,
          circa_candidate_fair_probability
        )
      ) * 100
      else null
    end
  ),
  gate_mode = coalesce(
    gate_mode,
    case
      when second_source_ok then 'LEGACY_MULTI_SOURCE'
      when bookmaker_candidate_fair_probability is not null
        or pinnacle_candidate_fair_probability is not null
        or circa_candidate_fair_probability is not null then 'LEGACY_SINGLE_SOURCE'
      else 'LEGACY_NO_SOURCE'
    end
  ),
  source_summary = case
    when source_summary = '{}'::jsonb then jsonb_build_object(
      'bookmaker', jsonb_build_object('status',
        case when bookmaker_candidate_fair_probability is not null then 'valid' else 'unavailable' end),
      'pinnacle', jsonb_build_object('status', coalesce(pinnacle_status, 'unavailable')),
      'circa', jsonb_build_object('status', coalesce(circa_status, 'unavailable'))
    )
    else source_summary
  end;

create or replace view public.sharp_gate_latest as
with ranked as (
  select
    s.*,
    row_number() over (
      partition by
        coalesce(s.event_id, ''),
        coalesce(s.market_type, 'moneyline'),
        coalesce(s.market_side, s.side_key, ''),
        coalesce(s.market_line::text, '')
      order by s.checked_at desc, s.id desc
    ) as rn
  from public.sharp_gate_history s
)
select
  id, checked_at, sport, event_id, game_pk, starts_at, away_team, home_team,
  side_key, side_name, verification_status, mainstream_book, mainstream_odds,
  playable_threshold, model_probability, bookmaker_away_odds, bookmaker_home_odds,
  bookmaker_candidate_fair_probability, bookmaker_freshness, pinnacle_away_odds,
  pinnacle_home_odds, pinnacle_candidate_fair_probability, pinnacle_status,
  pinnacle_freshness, circa_away_odds, circa_home_odds,
  circa_candidate_fair_probability, circa_status, circa_freshness,
  model_vs_bookmaker_pp, sharp_disagreement_pp, price_ok, second_source_ok,
  final_status, reason, raw, market_type, market_side, market_line, rn,
  sharp_consensus_probability, valid_sharp_source_count, fresh_sharp_source_count,
  sharp_data_quality, sharp_consensus_spread_pp, model_vs_sharp_pp, gate_mode,
  source_summary
from ranked
where rn = 1;
