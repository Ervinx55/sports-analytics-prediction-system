-- Reconstructed from production catalog on 2026-09-23.
-- Catch-up source for fresh environments; do not replay blindly on current production.

create table if not exists public.market_decision_fusion_shadow (
  observation_id bigint not null,
  evaluated_at timestamp with time zone default now() not null,
  source_captured_at timestamp with time zone not null,
  sport text not null,
  event_id text not null,
  game_pk bigint,
  starts_at timestamp with time zone,
  away_team text,
  home_team text,
  market_type text not null,
  market_side text not null,
  market_label text,
  line numeric,
  production_non_sharp_status text,
  production_sharp_status text,
  sharp_gate_id bigint,
  fusion_state text not null,
  priority integer not null,
  conflict_code text not null,
  headline text not null,
  explanation text not null,
  alignment_score numeric not null,
  uncertainty_class text,
  robust_market_edge_pp numeric,
  price_state text,
  robust_ev_pct numeric,
  price_cushion_cents numeric,
  max_playable_odds integer,
  verification_state text,
  verification_reason text,
  weather_state text,
  weather_impact_direction text,
  delay_risk text,
  sharp_classification text,
  sharp_confidence numeric,
  model_vs_sharp_pp numeric,
  blockers jsonb default '[]'::jsonb not null,
  warnings jsonb default '[]'::jsonb not null,
  supports jsonb default '[]'::jsonb not null,
  raw jsonb default '{}'::jsonb not null,
  shadow_only boolean default true not null,
  affects_decision boolean default false not null,
  constraint market_decision_fusion_shadow_alignment_score_check CHECK (alignment_score >= 0::numeric AND alignment_score <= 100::numeric),
  constraint market_decision_fusion_shadow_fusion_state_check CHECK (fusion_state = ANY (ARRAY['PLAY_CANDIDATE'::text, 'WATCH'::text, 'WAIT'::text, 'HOLD_PRICE'::text, 'REMODEL'::text, 'PASS'::text])),
  constraint market_decision_fusion_shadow_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES market_grade_observations(id) ON DELETE CASCADE,
  constraint market_decision_fusion_shadow_sharp_gate_id_fkey FOREIGN KEY (sharp_gate_id) REFERENCES sharp_gate_history(id) ON DELETE SET NULL,
  constraint market_decision_fusion_shadow_pkey PRIMARY KEY (observation_id)
);
alter table public.market_decision_fusion_shadow enable row level security;
revoke all on table public.market_decision_fusion_shadow from public, anon, authenticated;
grant select, insert, update, delete on table public.market_decision_fusion_shadow to service_role;

CREATE INDEX IF NOT EXISTS market_decision_fusion_event_idx ON public.market_decision_fusion_shadow USING btree (sport, event_id, market_type, market_side, line, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS market_decision_fusion_sharp_gate_idx ON public.market_decision_fusion_shadow USING btree (sharp_gate_id);

CREATE INDEX IF NOT EXISTS market_decision_fusion_state_idx ON public.market_decision_fusion_shadow USING btree (fusion_state, evaluated_at DESC);

create table if not exists public.player_prop_decision_fusion_shadow (
  observation_id bigint not null,
  evaluated_at timestamp with time zone default now() not null,
  source_captured_at timestamp with time zone not null,
  sport text not null,
  event_id text not null,
  game_pk bigint,
  starts_at timestamp with time zone,
  away_team text,
  home_team text,
  player_id text,
  mlb_player_id bigint,
  player_name text not null,
  player_role text not null,
  stat_id text not null,
  label text,
  line numeric,
  side text,
  upstream_status text,
  fusion_state text not null,
  priority integer not null,
  conflict_code text not null,
  headline text not null,
  explanation text not null,
  alignment_score numeric not null,
  model_probability numeric,
  market_fair_probability numeric,
  edge_pct_points numeric,
  ev_pct numeric,
  data_quality numeric,
  exact_line_book_count integer,
  paired_books integer,
  best_book text,
  best_odds integer,
  verification_state text,
  verification_reason text,
  in_starting_lineup boolean,
  batting_order_spot integer,
  is_confirmed_starter boolean,
  catcher_name text,
  catcher_change_after_model boolean default false not null,
  opposing_starter_change_after_model boolean default false not null,
  opposing_handedness_change_after_model boolean default false not null,
  weather_state text,
  weather_impact_direction text,
  weather_impact_multiplier numeric,
  delay_risk text,
  blockers jsonb default '[]'::jsonb not null,
  warnings jsonb default '[]'::jsonb not null,
  supports jsonb default '[]'::jsonb not null,
  raw jsonb default '{}'::jsonb not null,
  shadow_only boolean default true not null,
  affects_decision boolean default false not null,
  constraint player_prop_decision_fusion_shadow_alignment_score_check CHECK (alignment_score >= 0::numeric AND alignment_score <= 100::numeric),
  constraint player_prop_decision_fusion_shadow_fusion_state_check CHECK (fusion_state = ANY (ARRAY['PLAY_CANDIDATE'::text, 'WATCH'::text, 'WAIT'::text, 'REMODEL'::text, 'PASS'::text])),
  constraint player_prop_decision_fusion_shadow_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES player_prop_observations(id) ON DELETE CASCADE,
  constraint player_prop_decision_fusion_shadow_pkey PRIMARY KEY (observation_id)
);
alter table public.player_prop_decision_fusion_shadow enable row level security;
revoke all on table public.player_prop_decision_fusion_shadow from public, anon, authenticated;
grant select, insert, update, delete on table public.player_prop_decision_fusion_shadow to service_role;

CREATE INDEX IF NOT EXISTS player_prop_fusion_event_idx ON public.player_prop_decision_fusion_shadow USING btree (sport, event_id, player_name, stat_id, side, line, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS player_prop_fusion_state_idx ON public.player_prop_decision_fusion_shadow USING btree (fusion_state, evaluated_at DESC);

CREATE OR REPLACE FUNCTION public.compute_decision_fusion_v1(p_non_sharp_status text, p_uncertainty_class text, p_robust_market_edge_pp numeric, p_price_state text, p_robust_ev_pct numeric, p_price_cushion_cents numeric, p_verification_state text, p_verification_reason text, p_weather_state text, p_weather_impact_direction text, p_delay_risk text, p_sharp_gate_status text, p_sharp_classification text, p_sharp_confidence numeric, p_model_vs_sharp_pp numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_non text := upper(coalesce(p_non_sharp_status,''));
  v_unc text := upper(coalesce(p_uncertainty_class,'INCOMPLETE'));
  v_price text := upper(coalesce(p_price_state,'PENDING'));
  v_verify text := upper(coalesce(p_verification_state,'PENDING'));
  v_weather text := upper(coalesce(p_weather_state,'PENDING'));
  v_wdir text := upper(coalesce(p_weather_impact_direction,'UNKNOWN'));
  v_delay text := upper(coalesce(p_delay_risk,'UNKNOWN'));
  v_sgate text := upper(coalesce(p_sharp_gate_status,''));
  v_sharp text := upper(coalesce(p_sharp_classification,'INSUFFICIENT_SOURCES'));
  v_state text;
  v_code text;
  v_headline text;
  v_explanation text;
  v_priority integer;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_supports jsonb := '[]'::jsonb;
  v_score numeric := 50;
begin
  if v_unc='ROBUST' then
    v_supports := v_supports || jsonb_build_array('Model edge survives the uncertainty haircut.');
    v_score := v_score + 15;
  elsif v_unc='MARGINAL' then
    v_warnings := v_warnings || jsonb_build_array('Model edge is marginal after uncertainty adjustment.');
    v_score := v_score - 5;
  elsif v_unc='FRAGILE' then
    v_blockers := v_blockers || jsonb_build_array('Model edge does not survive the uncertainty haircut.');
    v_score := v_score - 25;
  else
    v_warnings := v_warnings || jsonb_build_array('Uncertainty analysis is incomplete.');
    v_score := v_score - 10;
  end if;

  if p_robust_market_edge_pp is not null then
    if p_robust_market_edge_pp >= 2 then
      v_supports := v_supports || jsonb_build_array('Robust market edge is at least +2.0 percentage points.');
      v_score := v_score + 10;
    elsif p_robust_market_edge_pp <= 0 then
      v_blockers := v_blockers || jsonb_build_array('Robust market edge is non-positive.');
      v_score := v_score - 15;
    end if;
  end if;

  if v_price='BUY' then
    v_supports := v_supports || jsonb_build_array('Current sportsbook price is at or better than the shadow buy point.');
    v_score := v_score + 15;
  elsif v_price='HOLD' then
    v_warnings := v_warnings || jsonb_build_array('Current price still has positive robust EV but is below the configured buy target.');
    v_score := v_score - 5;
  elsif v_price='PASS' then
    v_blockers := v_blockers || jsonb_build_array('Current price has crossed beyond the robust buy point.');
    v_score := v_score - 25;
  else
    v_warnings := v_warnings || jsonb_build_array('Price sensitivity is unresolved.');
    v_score := v_score - 8;
  end if;

  if p_robust_ev_pct is not null then
    if p_robust_ev_pct >= 3 then
      v_supports := v_supports || jsonb_build_array('Current robust EV is at least +3%.');
      v_score := v_score + 8;
    elsif p_robust_ev_pct < 0 then
      v_blockers := v_blockers || jsonb_build_array('Current robust EV is negative.');
      v_score := v_score - 15;
    end if;
  end if;

  if p_price_cushion_cents is not null then
    if p_price_cushion_cents >= 10 then
      v_supports := v_supports || jsonb_build_array('Price has at least 10 cents of cushion to the buy point.');
      v_score := v_score + 5;
    elsif p_price_cushion_cents < 0 then
      v_warnings := v_warnings || jsonb_build_array('Price is already worse than the target buy point.');
    end if;
  end if;

  if v_verify='READY' then
    v_supports := v_supports || jsonb_build_array('Starter/lineup verification is ready.');
    v_score := v_score + 10;
  elsif v_verify='REMODEL' then
    v_blockers := v_blockers || jsonb_build_array('A starter, handedness, lineup, or catcher change requires a fresh model run.');
    v_score := v_score - 40;
  elsif v_verify='PASS' then
    v_blockers := v_blockers || jsonb_build_array('Verification gate is blocking the market.');
    v_score := v_score - 40;
  else
    v_warnings := v_warnings || jsonb_build_array('Pregame verification is still pending.');
    v_score := v_score - 10;
  end if;

  if v_weather='REMODEL' then
    v_blockers := v_blockers || jsonb_build_array('Material weather/park conditions changed after the model observation.');
    v_score := v_score - 30;
  elsif v_weather='WEATHER_RISK' or v_delay='HIGH' then
    v_warnings := v_warnings || jsonb_build_array('Weather interruption risk is high.');
    v_score := v_score - 15;
  elsif v_weather='PENDING' then
    v_warnings := v_warnings || jsonb_build_array('Weather/roof context is unresolved.');
    v_score := v_score - 8;
  elsif v_wdir='FAVORABLE' then
    v_supports := v_supports || jsonb_build_array('Weather/park environment favors this side.');
    v_score := v_score + 4;
  elsif v_wdir='ADVERSE' then
    v_warnings := v_warnings || jsonb_build_array('Weather/park environment works against this side.');
    v_score := v_score - 4;
  end if;

  if v_sharp='CONSENSUS_OK' then
    v_supports := v_supports || jsonb_build_array('Sharp sources are aligned.');
    v_score := v_score + 10;
  elsif v_sharp='MARKET_MOVING' then
    v_warnings := v_warnings || jsonb_build_array('Sharp books are moving together; price discovery is still active.');
    v_score := v_score - 4;
  elsif v_sharp='REAL_SHARP_DISAGREEMENT' then
    v_blockers := v_blockers || jsonb_build_array('Fresh sharp books materially disagree.');
    v_score := v_score - 18;
  elsif v_sharp='STALE_PRICE' then
    v_warnings := v_warnings || jsonb_build_array('Apparent sharp disagreement is likely being driven by a stale price.');
    v_score := v_score - 5;
  elsif v_sharp='SOURCE_QUALITY_PROBLEM' then
    v_warnings := v_warnings || jsonb_build_array('Sharp confirmation is degraded by a source-quality problem.');
    v_score := v_score - 8;
  elsif v_sharp in ('INSUFFICIENT_SOURCES','DISAGREEMENT_WATCH') then
    v_warnings := v_warnings || jsonb_build_array('Sharp confirmation is incomplete or unresolved.');
    v_score := v_score - 8;
  end if;

  if p_model_vs_sharp_pp is not null then
    if p_model_vs_sharp_pp >= 3 then
      v_supports := v_supports || jsonb_build_array('Model retains at least +3.0 pp versus sharp consensus.');
      v_score := v_score + 8;
    elsif p_model_vs_sharp_pp < 1 then
      v_warnings := v_warnings || jsonb_build_array('Model edge versus sharp consensus is below +1.0 pp.');
      v_score := v_score - 10;
    end if;
  end if;

  if v_verify='REMODEL' or v_weather='REMODEL' then
    v_state := 'REMODEL';
    v_priority := 100;
    v_code := case when v_verify='REMODEL' then 'CONTEXT_CHANGED_REMODEL' else 'WEATHER_CHANGED_REMODEL' end;
    v_headline := 'REMODEL REQUIRED';
    v_explanation := 'The previous projection is no longer valid because material pregame context changed after the model observation.';
  elsif v_verify='PASS' then
    v_state := 'PASS';
    v_priority := 95;
    v_code := coalesce(nullif(p_verification_reason,''),'VERIFICATION_BLOCK');
    v_headline := 'CONTEXT BLOCK';
    v_explanation := 'Model/price signals cannot override a blocked game-status or verification condition.';
  elsif v_unc='FRAGILE' and v_price='PASS' then
    v_state := 'PASS';
    v_priority := 90;
    v_code := 'NO_ROBUST_EDGE_AND_PRICE_GONE';
    v_headline := 'EDGE FAILED + PRICE GONE';
    v_explanation := 'The original model edge does not survive uncertainty and the current price is no longer robustly profitable.';
  elsif v_price='PASS' and coalesce(p_robust_market_edge_pp,0)>0 then
    v_state := 'PASS';
    v_priority := 88;
    v_code := 'MODEL_LIKES_IT_PRICE_GONE';
    v_headline := 'MODEL LIKES IT — PRICE GONE';
    v_explanation := 'The model still shows some robust directional edge, but the available sportsbook price has crossed beyond the buy point.';
  elsif v_price='PASS' then
    v_state := 'PASS';
    v_priority := 87;
    v_code := 'NEGATIVE_ROBUST_PRICE_VALUE';
    v_headline := 'PRICE / EV FAIL';
    v_explanation := 'At the current sportsbook number, robust expected value is negative or below the required threshold.';
  elsif v_unc='FRAGILE' then
    v_state := 'PASS';
    v_priority := 85;
    v_code := 'FRAGILE_EDGE';
    v_headline := 'FRAGILE EDGE';
    v_explanation := 'Headline model edge is not strong enough after uncertainty is applied.';
  elsif v_non='PASS' then
    v_state := 'PASS';
    v_priority := 82;
    v_code := 'UPSTREAM_NON_SHARP_PASS';
    v_headline := 'BASE MODEL PASS';
    v_explanation := 'The upstream non-sharp model/context layer already rejected this market.';
  elsif v_non <> 'READY_FOR_SHARP_CHECK' then
    v_state := 'WAIT';
    v_priority := 80;
    v_code := 'UPSTREAM_NON_SHARP_PENDING';
    v_headline := 'BASE MODEL STILL PENDING';
    v_explanation := 'The upstream model/context layer has not reached READY_FOR_SHARP_CHECK, so downstream shadow signals cannot promote the market.';
  elsif v_sgate='PASS' then
    v_state := 'PASS';
    v_priority := 78;
    v_code := 'PRODUCTION_SHARP_GATE_PASS';
    v_headline := 'SHARP GATE PASS';
    v_explanation := 'The production Sharp Gate explicitly rejected the market; the fusion layer records the supporting context but does not override that decision.';
  elsif v_unc='INCOMPLETE' or v_price='PENDING' or v_verify='PENDING' or v_weather='PENDING' then
    v_state := 'WAIT';
    v_priority := 75;
    v_code := 'INPUTS_INCOMPLETE';
    v_headline := 'WAIT FOR INPUTS';
    v_explanation := 'At least one required pregame component is incomplete, so the market should not be treated as decision-ready.';
  elsif v_sharp='REAL_SHARP_DISAGREEMENT' then
    v_state := 'WAIT';
    v_priority := 72;
    v_code := 'REAL_SHARP_CONFLICT';
    v_headline := 'REAL SHARP CONFLICT';
    v_explanation := 'Fresh valid sharp books materially disagree; wait rather than forcing a directional conclusion.';
  elsif v_sharp='MARKET_MOVING' then
    v_state := 'WATCH';
    v_priority := 68;
    v_code := 'SHARP_PRICE_DISCOVERY';
    v_headline := 'MARKET MOVING';
    v_explanation := 'Sharp books are moving in the same direction. The edge may still be valid, but price discovery is active and the buy point can change quickly.';
  elsif v_price='HOLD' then
    v_state := 'HOLD_PRICE';
    v_priority := 65;
    v_code := 'POSITIVE_EV_BELOW_BUY_TARGET';
    v_headline := 'WAIT FOR A BETTER PRICE';
    v_explanation := 'The market remains positive-EV in the shadow model, but it does not meet the configured buy threshold at the current price.';
  elsif v_sharp in ('SOURCE_QUALITY_PROBLEM','INSUFFICIENT_SOURCES','DISAGREEMENT_WATCH','STALE_PRICE')
        and v_sgate <> 'FINAL_PLAY' then
    v_state := 'WAIT';
    v_priority := 62;
    v_code := 'SHARP_CONFIRMATION_INCOMPLETE';
    v_headline := 'WAIT FOR CLEAN SHARP CONFIRMATION';
    v_explanation := 'The model and price may be acceptable, but sharp confirmation is not clean enough to treat the setup as fully resolved.';
  elsif v_unc='ROBUST' and v_price='BUY' and v_verify='READY'
        and v_weather not in ('PENDING','REMODEL','WEATHER_RISK')
        and v_sgate='FINAL_PLAY' then
    v_state := 'PLAY_CANDIDATE';
    v_priority := 50;
    v_code := 'ALL_MAJOR_SHADOW_SIGNALS_ALIGNED';
    v_headline := 'SHADOW PLAY CANDIDATE';
    v_explanation := 'Robust model edge, playable price, verified context, acceptable weather, and sharp confirmation are aligned.';
  elsif v_unc='ROBUST' and v_price='BUY' and v_verify='READY' then
    v_state := 'WATCH';
    v_priority := 45;
    v_code := 'CORE_EDGE_READY_SHARP_UNRESOLVED';
    v_headline := 'CORE EDGE READY — SHARP UNRESOLVED';
    v_explanation := 'Model, price, and game context are ready, but sharp confirmation is not yet strong enough for the shadow fusion layer to call it fully aligned.';
  else
    v_state := 'WATCH';
    v_priority := 40;
    v_code := 'MIXED_SIGNALS';
    v_headline := 'MIXED SIGNALS';
    v_explanation := 'No single hard blocker is present, but the component signals are not sufficiently aligned.';
  end if;

  v_score := greatest(0,least(100,v_score));
  v_score := case
    when v_state='PLAY_CANDIDATE' then v_score
    when v_state='WATCH' then least(v_score,84)
    when v_state='WAIT' then least(v_score,69)
    when v_state='HOLD_PRICE' then least(v_score,64)
    when v_state='REMODEL' then least(v_score,49)
    when v_state='PASS' then least(v_score,39)
    else v_score
  end;

  return jsonb_build_object(
    'evaluatorVersion','decision-fusion-v1',
    'state',v_state,
    'priority',v_priority,
    'conflictCode',v_code,
    'headline',v_headline,
    'explanation',v_explanation,
    'alignmentScore',round(v_score,1),
    'blockers',v_blockers,
    'warnings',v_warnings,
    'supports',v_supports,
    'inputs',jsonb_build_object(
      'nonSharpStatus',p_non_sharp_status,
      'uncertaintyClass',p_uncertainty_class,
      'robustMarketEdgePp',p_robust_market_edge_pp,
      'priceState',p_price_state,
      'robustEvPct',p_robust_ev_pct,
      'priceCushionCents',p_price_cushion_cents,
      'verificationState',p_verification_state,
      'weatherState',p_weather_state,
      'weatherImpactDirection',p_weather_impact_direction,
      'delayRisk',p_delay_risk,
      'sharpGateStatus',p_sharp_gate_status,
      'sharpClassification',p_sharp_classification,
      'sharpConfidence',p_sharp_confidence,
      'modelVsSharpPp',p_model_vs_sharp_pp
    )
  );
end;
$function$;
revoke execute on function public.compute_decision_fusion_v1(p_non_sharp_status text, p_uncertainty_class text, p_robust_market_edge_pp numeric, p_price_state text, p_robust_ev_pct numeric, p_price_cushion_cents numeric, p_verification_state text, p_verification_reason text, p_weather_state text, p_weather_impact_direction text, p_delay_risk text, p_sharp_gate_status text, p_sharp_classification text, p_sharp_confidence numeric, p_model_vs_sharp_pp numeric) from public, anon, authenticated;
grant execute on function public.compute_decision_fusion_v1(p_non_sharp_status text, p_uncertainty_class text, p_robust_market_edge_pp numeric, p_price_state text, p_robust_ev_pct numeric, p_price_cushion_cents numeric, p_verification_state text, p_verification_reason text, p_weather_state text, p_weather_impact_direction text, p_delay_risk text, p_sharp_gate_status text, p_sharp_classification text, p_sharp_confidence numeric, p_model_vs_sharp_pp numeric) to service_role;

CREATE OR REPLACE FUNCTION public.refresh_market_decision_fusion_shadow()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  r record;
  v_eval jsonb;
  v_count integer := 0;
begin
  for r in
    select
      g.*,
      u.classification as uncertainty_class,
      u.robust_market_edge_pp,
      p.state as price_state,
      p.current_robust_ev_pct,
      p.price_cushion_cents,
      p.max_playable_odds,
      v.state as verification_state,
      v.reason_code as verification_reason,
      w.state as weather_state,
      w.impact_direction as weather_impact_direction,
      w.delay_risk,
      sg.id as sharp_gate_id,
      sg.final_status as sharp_gate_status,
      sg.model_vs_sharp_pp,
      sd.classification as sharp_classification,
      sd.confidence as sharp_confidence
    from public.market_grade_latest g
    left join public.market_uncertainty_latest u
      on u.observation_id=g.id
    left join public.market_price_sensitivity_latest p
      on p.observation_id=g.id
     and p.policy_id=case g.market_type
       when 'moneyline' then 'ML_BALANCED'
       when 'spread' then 'RL_BALANCED'
       when 'total' then 'TOT_BALANCED'
       else null
     end
    left join public.team_market_verification_latest v
      on v.observation_id=g.id
    left join public.team_market_weather_latest w
      on w.observation_id=g.id
    left join lateral (
      select s.*
      from public.sharp_gate_latest s
      where s.event_id=g.event_id
        and s.market_type=g.market_type
        and s.market_side=g.market_side
        and (
          (s.market_line is null and g.line is null)
          or (
            s.market_line is not null
            and g.line is not null
            and abs(s.market_line-g.line)<0.001
          )
        )
      order by s.checked_at desc,s.id desc
      limit 1
    ) sg on true
    left join public.sharp_disagreement_latest sd
      on sd.sharp_gate_id=sg.id
    where g.starts_at is not null
      and g.starts_at > now()
      and g.starts_at <= now()+interval '36 hours'
      and g.captured_at >= now()-interval '72 hours'
    order by g.starts_at,g.id
  loop
    v_eval := public.compute_decision_fusion_v1(
      r.non_sharp_status,
      r.uncertainty_class,
      r.robust_market_edge_pp,
      r.price_state,
      r.current_robust_ev_pct,
      r.price_cushion_cents,
      r.verification_state,
      r.verification_reason,
      r.weather_state,
      r.weather_impact_direction,
      r.delay_risk,
      r.sharp_gate_status,
      r.sharp_classification,
      r.sharp_confidence,
      r.model_vs_sharp_pp
    );

    insert into public.market_decision_fusion_shadow (
      observation_id,evaluated_at,source_captured_at,sport,event_id,game_pk,starts_at,
      away_team,home_team,market_type,market_side,market_label,line,
      production_non_sharp_status,production_sharp_status,sharp_gate_id,
      fusion_state,priority,conflict_code,headline,explanation,alignment_score,
      uncertainty_class,robust_market_edge_pp,
      price_state,robust_ev_pct,price_cushion_cents,max_playable_odds,
      verification_state,verification_reason,
      weather_state,weather_impact_direction,delay_risk,
      sharp_classification,sharp_confidence,model_vs_sharp_pp,
      blockers,warnings,supports,raw,shadow_only,affects_decision
    ) values (
      r.id,now(),r.captured_at,r.sport,r.event_id,r.game_pk,r.starts_at,
      r.away_team,r.home_team,r.market_type,r.market_side,r.market_label,r.line,
      r.non_sharp_status,r.sharp_gate_status,r.sharp_gate_id,
      v_eval->>'state',
      coalesce(nullif(v_eval->>'priority','')::integer,0),
      coalesce(v_eval->>'conflictCode','UNKNOWN'),
      coalesce(v_eval->>'headline','MIXED SIGNALS'),
      coalesce(v_eval->>'explanation',''),
      coalesce(nullif(v_eval->>'alignmentScore','')::numeric,0),
      r.uncertainty_class,r.robust_market_edge_pp,
      r.price_state,r.current_robust_ev_pct,r.price_cushion_cents,r.max_playable_odds,
      r.verification_state,r.verification_reason,
      r.weather_state,r.weather_impact_direction,r.delay_risk,
      r.sharp_classification,r.sharp_confidence,r.model_vs_sharp_pp,
      coalesce(v_eval->'blockers','[]'::jsonb),
      coalesce(v_eval->'warnings','[]'::jsonb),
      coalesce(v_eval->'supports','[]'::jsonb),
      jsonb_build_object(
        'evaluatorVersion','decision-fusion-v1',
        'evaluation',v_eval,
        'componentAvailability',jsonb_build_object(
          'uncertainty',r.uncertainty_class is not null,
          'priceSensitivity',r.price_state is not null,
          'verification',r.verification_state is not null,
          'weatherPark',r.weather_state is not null,
          'sharpGate',r.sharp_gate_id is not null,
          'sharpDiagnosis',r.sharp_classification is not null
        )
      ),
      true,false
    )
    on conflict (observation_id) do update
    set
      evaluated_at=excluded.evaluated_at,
      source_captured_at=excluded.source_captured_at,
      production_non_sharp_status=excluded.production_non_sharp_status,
      production_sharp_status=excluded.production_sharp_status,
      sharp_gate_id=excluded.sharp_gate_id,
      fusion_state=excluded.fusion_state,
      priority=excluded.priority,
      conflict_code=excluded.conflict_code,
      headline=excluded.headline,
      explanation=excluded.explanation,
      alignment_score=excluded.alignment_score,
      uncertainty_class=excluded.uncertainty_class,
      robust_market_edge_pp=excluded.robust_market_edge_pp,
      price_state=excluded.price_state,
      robust_ev_pct=excluded.robust_ev_pct,
      price_cushion_cents=excluded.price_cushion_cents,
      max_playable_odds=excluded.max_playable_odds,
      verification_state=excluded.verification_state,
      verification_reason=excluded.verification_reason,
      weather_state=excluded.weather_state,
      weather_impact_direction=excluded.weather_impact_direction,
      delay_risk=excluded.delay_risk,
      sharp_classification=excluded.sharp_classification,
      sharp_confidence=excluded.sharp_confidence,
      model_vs_sharp_pp=excluded.model_vs_sharp_pp,
      blockers=excluded.blockers,
      warnings=excluded.warnings,
      supports=excluded.supports,
      raw=excluded.raw,
      shadow_only=true,
      affects_decision=false;

    v_count := v_count+1;
  end loop;

  return v_count;
end;
$function$;
revoke execute on function public.refresh_market_decision_fusion_shadow() from public, anon, authenticated;
grant execute on function public.refresh_market_decision_fusion_shadow() to service_role;

CREATE OR REPLACE FUNCTION public.trigger_market_decision_fusion()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select public.refresh_market_decision_fusion_shadow();
$function$;
revoke execute on function public.trigger_market_decision_fusion() from public, anon, authenticated;
grant execute on function public.trigger_market_decision_fusion() to service_role;

CREATE OR REPLACE FUNCTION public.compute_player_prop_fusion_v1(p_upstream_status text, p_player_role text, p_stat_id text, p_edge_pp numeric, p_ev_pct numeric, p_data_quality numeric, p_exact_line_book_count integer, p_paired_books integer, p_verification_state text, p_verification_reason text, p_in_starting_lineup boolean, p_is_confirmed_starter boolean, p_batting_order_spot integer, p_catcher_change_after_model boolean, p_opposing_starter_change_after_model boolean, p_opposing_handedness_change_after_model boolean, p_weather_state text, p_weather_impact_direction text, p_weather_impact_multiplier numeric, p_delay_risk text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_up text := upper(coalesce(p_upstream_status,'PENDING'));
  v_role text := upper(coalesce(p_player_role,
    case when coalesce(p_stat_id,'') like 'pitching_%' then 'PITCHER' else 'HITTER' end));
  v_verify text := upper(coalesce(p_verification_state,'PENDING'));
  v_weather text := upper(coalesce(p_weather_state,'PENDING'));
  v_wdir text := upper(coalesce(p_weather_impact_direction,'UNKNOWN'));
  v_delay text := upper(coalesce(p_delay_risk,'UNKNOWN'));

  v_state text;
  v_code text;
  v_headline text;
  v_explanation text;
  v_priority integer;
  v_score numeric := 50;

  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_supports jsonb := '[]'::jsonb;
begin
  if p_data_quality is null then
    v_warnings := v_warnings || jsonb_build_array('Prop data quality is unavailable.');
    v_score := v_score - 10;
  elsif p_data_quality >= 0.90 then
    v_supports := v_supports || jsonb_build_array('Prop data quality is at least 0.90.');
    v_score := v_score + 10;
  elsif p_data_quality >= 0.75 then
    v_supports := v_supports || jsonb_build_array('Prop data quality clears the 0.75 minimum.');
    v_score := v_score + 5;
  else
    v_blockers := v_blockers || jsonb_build_array('Prop data quality is below the 0.75 minimum.');
    v_score := v_score - 25;
  end if;

  if coalesce(p_exact_line_book_count,0) >= 2 then
    v_supports := v_supports || jsonb_build_array('At least two books offer the exact prop line.');
    v_score := v_score + 7;
  else
    v_blockers := v_blockers || jsonb_build_array('Fewer than two books offer the exact prop line.');
    v_score := v_score - 20;
  end if;

  if coalesce(p_paired_books,0) >= 1 then
    v_supports := v_supports || jsonb_build_array('At least one exact-line two-sided pair supports no-vig market probability.');
    v_score := v_score + 7;
  else
    v_blockers := v_blockers || jsonb_build_array('No exact-line two-sided book pair is available.');
    v_score := v_score - 20;
  end if;

  if p_edge_pp is not null then
    if p_edge_pp >= 10 then
      v_supports := v_supports || jsonb_build_array('Model edge is at least +10 pp.');
      v_score := v_score + 15;
    elsif p_edge_pp >= 6 then
      v_supports := v_supports || jsonb_build_array('Model edge clears the +6 pp prop threshold.');
      v_score := v_score + 10;
    else
      v_blockers := v_blockers || jsonb_build_array('Model edge is below the +6 pp prop threshold.');
      v_score := v_score - 25;
    end if;
  else
    v_warnings := v_warnings || jsonb_build_array('Model edge is unavailable.');
    v_score := v_score - 10;
  end if;

  if p_ev_pct is not null then
    if p_ev_pct >= 12 then
      v_supports := v_supports || jsonb_build_array('Modeled EV is at least +12%.');
      v_score := v_score + 15;
    elsif p_ev_pct >= 6 then
      v_supports := v_supports || jsonb_build_array('Modeled EV clears the +6% prop threshold.');
      v_score := v_score + 10;
    else
      v_blockers := v_blockers || jsonb_build_array('Modeled EV is below the +6% prop threshold.');
      v_score := v_score - 25;
    end if;
  else
    v_warnings := v_warnings || jsonb_build_array('Modeled EV is unavailable.');
    v_score := v_score - 10;
  end if;

  if v_role='HITTER' then
    if p_in_starting_lineup is true then
      v_supports := v_supports || jsonb_build_array('Hitter is in the confirmed starting lineup.');
      v_score := v_score + 10;
      if p_batting_order_spot is not null and p_batting_order_spot <= 5 then
        v_supports := v_supports || jsonb_build_array('Hitter has a top-five batting-order slot.');
        v_score := v_score + 5;
      elsif p_batting_order_spot is not null and p_batting_order_spot >= 8 then
        v_warnings := v_warnings || jsonb_build_array('Bottom-of-order slot can reduce plate-appearance opportunity.');
        v_score := v_score - 4;
      end if;
    elsif p_in_starting_lineup is false then
      v_blockers := v_blockers || jsonb_build_array('Hitter is not in the confirmed starting lineup.');
      v_score := v_score - 40;
    else
      v_warnings := v_warnings || jsonb_build_array('Hitter starting-lineup status is unresolved.');
      v_score := v_score - 10;
    end if;

    if coalesce(p_opposing_starter_change_after_model,false) then
      v_blockers := v_blockers || jsonb_build_array('Opposing starter changed after this prop projection.');
      v_score := v_score - 35;
    end if;

    if coalesce(p_opposing_handedness_change_after_model,false) then
      v_blockers := v_blockers || jsonb_build_array('Opposing starter handedness changed after this prop projection.');
      v_score := v_score - 35;
    end if;
  else
    if p_is_confirmed_starter is true then
      v_supports := v_supports || jsonb_build_array('Pitcher remains the confirmed starter.');
      v_score := v_score + 10;
    elsif p_is_confirmed_starter is false then
      v_blockers := v_blockers || jsonb_build_array('Pitcher is not the current confirmed starter.');
      v_score := v_score - 40;
    else
      v_warnings := v_warnings || jsonb_build_array('Pitcher starter status is unresolved.');
      v_score := v_score - 10;
    end if;

    if coalesce(p_catcher_change_after_model,false) then
      v_blockers := v_blockers || jsonb_build_array('Starting catcher changed after this pitcher-prop projection.');
      v_score := v_score - 35;
    end if;
  end if;

  if v_verify='READY' then
    v_supports := v_supports || jsonb_build_array('Role/lineup verification is ready.');
    v_score := v_score + 8;
  elsif v_verify='WATCH' then
    v_warnings := v_warnings || jsonb_build_array('Verification gate has a role/workload WATCH condition.');
    v_score := v_score - 8;
  elsif v_verify='REMODEL' then
    v_blockers := v_blockers || jsonb_build_array('Material player/game context changed after the projection.');
    v_score := v_score - 35;
  elsif v_verify='PASS' then
    v_blockers := v_blockers || jsonb_build_array('Role/lineup verification is blocking the prop.');
    v_score := v_score - 40;
  else
    v_warnings := v_warnings || jsonb_build_array('Role/lineup verification is still pending.');
    v_score := v_score - 10;
  end if;

  if v_weather='REMODEL' then
    v_blockers := v_blockers || jsonb_build_array('Material weather/park conditions changed after the prop projection.');
    v_score := v_score - 30;
  elsif v_weather='WEATHER_RISK' or v_delay='HIGH' then
    v_warnings := v_warnings || jsonb_build_array('High interruption risk can change player opportunity.');
    v_score := v_score - 15;
  elsif v_weather='PENDING' then
    v_warnings := v_warnings || jsonb_build_array('Weather/roof context is unresolved.');
    v_score := v_score - 8;
  elsif v_wdir='FAVORABLE' then
    v_supports := v_supports || jsonb_build_array('Weather/park environment favors the selected prop side.');
    v_score := v_score + 5;
  elsif v_wdir='ADVERSE' then
    v_warnings := v_warnings || jsonb_build_array('Weather/park environment works against the selected prop side.');
    v_score := v_score - 5;
  end if;

  if p_weather_impact_multiplier is not null then
    if v_wdir='FAVORABLE' and abs(p_weather_impact_multiplier-1) >= 0.02 then
      v_supports := v_supports || jsonb_build_array('Environment changes expected opportunity by at least 2% in the favorable direction.');
      v_score := v_score + 3;
    elsif v_wdir='ADVERSE' and abs(p_weather_impact_multiplier-1) >= 0.02 then
      v_warnings := v_warnings || jsonb_build_array('Environment changes expected opportunity by at least 2% against the selected side.');
      v_score := v_score - 5;
    end if;
  end if;

  if v_up <> 'PASS' and (v_verify='REMODEL' or v_weather='REMODEL'
      or coalesce(p_catcher_change_after_model,false)
      or coalesce(p_opposing_starter_change_after_model,false)
      or coalesce(p_opposing_handedness_change_after_model,false)) then
    v_state := 'REMODEL';
    v_priority := 100;
    v_code := case
      when coalesce(p_opposing_handedness_change_after_model,false) then 'OPPOSING_HAND_CHANGED_REMODEL'
      when coalesce(p_opposing_starter_change_after_model,false) then 'OPPOSING_STARTER_CHANGED_REMODEL'
      when coalesce(p_catcher_change_after_model,false) then 'CATCHER_CHANGED_REMODEL'
      when v_weather='REMODEL' then 'WEATHER_CHANGED_REMODEL'
      else 'ROLE_CONTEXT_CHANGED_REMODEL'
    end;
    v_headline := 'REMODEL PROP';
    v_explanation := 'The original prop projection is no longer valid because material role, opponent, catcher, or weather context changed.';
  elsif v_verify='PASS'
        or (v_role='HITTER' and p_in_starting_lineup is false)
        or (v_role='PITCHER' and p_is_confirmed_starter is false) then
    v_state := 'PASS';
    v_priority := 95;
    v_code := coalesce(nullif(p_verification_reason,''),'ROLE_VERIFICATION_BLOCK');
    v_headline := 'ROLE / LINEUP BLOCK';
    v_explanation := 'The player does not satisfy the required confirmed role or lineup condition.';
  elsif v_up='PASS' then
    v_state := 'PASS';
    v_priority := 90;
    if coalesce(p_data_quality,0) < 0.75 then
      v_code := 'DATA_QUALITY_FAIL';
      v_headline := 'DATA QUALITY FAIL';
      v_explanation := 'The prop model does not have sufficient data quality for a playable decision.';
    elsif coalesce(p_exact_line_book_count,0) < 2 or coalesce(p_paired_books,0) < 1 then
      v_code := 'MARKET_COVERAGE_FAIL';
      v_headline := 'MARKET COVERAGE FAIL';
      v_explanation := 'The exact prop line does not have enough reliable two-sided market coverage.';
    elsif coalesce(p_edge_pp,-999) < 6 or coalesce(p_ev_pct,-999) < 6 then
      v_code := 'EDGE_EV_FAIL';
      v_headline := 'EDGE / EV FAIL';
      v_explanation := 'The prop does not clear the +6 pp edge and +6% modeled-EV thresholds.';
    else
      v_code := 'UPSTREAM_PROP_PASS';
      v_headline := 'PROP MODEL PASS';
      v_explanation := 'The upstream prop model rejected the wager for its stored model, sample, role, market, or quality reason.';
    end if;
  elsif v_up='PENDING' then
    v_state := 'WAIT';
    v_priority := 82;
    v_code := 'UPSTREAM_PROP_PENDING';
    v_headline := 'WAIT FOR PROP INPUTS';
    v_explanation := 'The upstream prop model has not reached a final PLAY/PASS decision.';
  elsif coalesce(p_data_quality,0) < 0.75 then
    v_state := 'PASS';
    v_priority := 88;
    v_code := 'DATA_QUALITY_FAIL';
    v_headline := 'DATA QUALITY FAIL';
    v_explanation := 'Data quality is below the minimum required for a reliable prop decision.';
  elsif coalesce(p_exact_line_book_count,0) < 2 or coalesce(p_paired_books,0) < 1 then
    v_state := 'PASS';
    v_priority := 87;
    v_code := 'MARKET_COVERAGE_FAIL';
    v_headline := 'MARKET COVERAGE FAIL';
    v_explanation := 'Exact-line/two-sided market coverage is not strong enough to trust the market probability.';
  elsif coalesce(p_edge_pp,-999) < 6 or coalesce(p_ev_pct,-999) < 6 then
    v_state := 'PASS';
    v_priority := 86;
    v_code := 'EDGE_EV_FAIL';
    v_headline := 'EDGE / EV FAIL';
    v_explanation := 'The prop does not clear both the +6 pp model edge and +6% modeled-EV thresholds.';
  elsif v_verify='PENDING' or v_weather='PENDING' then
    v_state := 'WAIT';
    v_priority := 78;
    v_code := 'CONTEXT_PENDING';
    v_headline := 'WAIT FOR CONTEXT';
    v_explanation := 'The prop model qualifies, but final role/lineup or weather context is not complete.';
  elsif v_role='PITCHER' and v_verify='WATCH' then
    v_state := 'WATCH';
    v_priority := 72;
    v_code := 'STARTER_LEASH_WATCH';
    v_headline := 'STARTER LEASH WATCH';
    v_explanation := 'The pitcher qualifies on model/market inputs, but bullpen workload or related context may change expected starter usage.';
  elsif v_weather='WEATHER_RISK' or v_delay='HIGH' then
    v_state := 'WATCH';
    v_priority := 70;
    v_code := 'WEATHER_OPPORTUNITY_RISK';
    v_headline := 'WEATHER OPPORTUNITY WATCH';
    v_explanation := 'The prop qualifies on model/market inputs, but interruption risk can materially change player opportunity.';
  elsif v_wdir='ADVERSE' and p_weather_impact_multiplier is not null
        and abs(p_weather_impact_multiplier-1) >= 0.02 then
    v_state := 'WATCH';
    v_priority := 68;
    v_code := 'MATERIAL_ENVIRONMENT_ADVERSE';
    v_headline := 'ENVIRONMENT WORKS AGAINST PROP';
    v_explanation := 'The prop clears the model thresholds, but the current park/weather environment moves expected opportunity at least 2% against the selected side.';
  elsif v_up='PLAY' and v_verify='READY' and v_weather not in ('PENDING','REMODEL','WEATHER_RISK') then
    v_state := 'PLAY_CANDIDATE';
    v_priority := 50;
    v_code := case when v_role='PITCHER' then 'PITCHER_PROP_ALL_SIGNALS_ALIGNED' else 'HITTER_PROP_ALL_SIGNALS_ALIGNED' end;
    v_headline := case when v_role='PITCHER' then 'SHADOW PITCHER PROP CANDIDATE' else 'SHADOW HITTER PROP CANDIDATE' end;
    v_explanation := 'Model edge, modeled EV, exact-line market coverage, data quality, confirmed role, and environment are aligned.';
  else
    v_state := 'WATCH';
    v_priority := 45;
    v_code := 'PROP_MIXED_SIGNALS';
    v_headline := 'PROP MIXED SIGNALS';
    v_explanation := 'No hard blocker is present, but all role, market, and environment signals are not fully aligned.';
  end if;

  v_score := greatest(0,least(100,v_score));
  v_score := case
    when v_state='PLAY_CANDIDATE' then v_score
    when v_state='WATCH' then least(v_score,84)
    when v_state='WAIT' then least(v_score,69)
    when v_state='REMODEL' then least(v_score,49)
    when v_state='PASS' then least(v_score,39)
    else v_score
  end;

  return jsonb_build_object(
    'evaluatorVersion','player-prop-fusion-v1',
    'state',v_state,
    'priority',v_priority,
    'conflictCode',v_code,
    'headline',v_headline,
    'explanation',v_explanation,
    'alignmentScore',round(v_score,1),
    'blockers',v_blockers,
    'warnings',v_warnings,
    'supports',v_supports,
    'inputs',jsonb_build_object(
      'upstreamStatus',p_upstream_status,
      'playerRole',v_role,
      'statId',p_stat_id,
      'edgePp',p_edge_pp,
      'evPct',p_ev_pct,
      'dataQuality',p_data_quality,
      'exactLineBookCount',p_exact_line_book_count,
      'pairedBooks',p_paired_books,
      'verificationState',p_verification_state,
      'verificationReason',p_verification_reason,
      'inStartingLineup',p_in_starting_lineup,
      'isConfirmedStarter',p_is_confirmed_starter,
      'battingOrderSpot',p_batting_order_spot,
      'weatherState',p_weather_state,
      'weatherImpactDirection',p_weather_impact_direction,
      'weatherImpactMultiplier',p_weather_impact_multiplier,
      'delayRisk',p_delay_risk
    )
  );
end;
$function$;
revoke execute on function public.compute_player_prop_fusion_v1(p_upstream_status text, p_player_role text, p_stat_id text, p_edge_pp numeric, p_ev_pct numeric, p_data_quality numeric, p_exact_line_book_count integer, p_paired_books integer, p_verification_state text, p_verification_reason text, p_in_starting_lineup boolean, p_is_confirmed_starter boolean, p_batting_order_spot integer, p_catcher_change_after_model boolean, p_opposing_starter_change_after_model boolean, p_opposing_handedness_change_after_model boolean, p_weather_state text, p_weather_impact_direction text, p_weather_impact_multiplier numeric, p_delay_risk text) from public, anon, authenticated;
grant execute on function public.compute_player_prop_fusion_v1(p_upstream_status text, p_player_role text, p_stat_id text, p_edge_pp numeric, p_ev_pct numeric, p_data_quality numeric, p_exact_line_book_count integer, p_paired_books integer, p_verification_state text, p_verification_reason text, p_in_starting_lineup boolean, p_is_confirmed_starter boolean, p_batting_order_spot integer, p_catcher_change_after_model boolean, p_opposing_starter_change_after_model boolean, p_opposing_handedness_change_after_model boolean, p_weather_state text, p_weather_impact_direction text, p_weather_impact_multiplier numeric, p_delay_risk text) to service_role;

CREATE OR REPLACE FUNCTION public.refresh_player_prop_decision_fusion_shadow()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  r record;
  v_eval jsonb;
  v_count integer := 0;
begin
  for r in
    select
      p.*,
      coalesce(v.player_role,
        case when p.stat_id like 'pitching_%' then 'PITCHER' else 'HITTER' end
      ) as player_role,
      v.state as verification_state,
      v.reason_code as verification_reason,
      v.in_starting_lineup,
      v.batting_order_spot,
      v.is_confirmed_starter,
      v.catcher_name,
      coalesce(v.catcher_change_after_model,false) as catcher_change_after_model,
      coalesce(v.opposing_starter_change_after_model,false) as opposing_starter_change_after_model,
      coalesce(v.opposing_handedness_change_after_model,false) as opposing_handedness_change_after_model,
      w.state as weather_state,
      w.impact_direction as weather_impact_direction,
      w.impact_multiplier as weather_impact_multiplier,
      w.delay_risk
    from public.player_prop_latest p
    left join public.player_prop_verification_latest v
      on v.observation_id=p.id
    left join public.player_prop_weather_latest w
      on w.observation_id=p.id
    where p.sport='MLB'
      and p.starts_at is not null
      and p.starts_at > now()
      and p.starts_at <= now()+interval '36 hours'
      and p.captured_at >= now()-interval '72 hours'
    order by p.starts_at,p.id
  loop
    v_eval := public.compute_player_prop_fusion_v1(
      r.status,
      r.player_role,
      r.stat_id,
      r.edge_pct_points,
      r.ev_pct,
      r.data_quality,
      r.exact_line_book_count,
      r.paired_books,
      r.verification_state,
      r.verification_reason,
      r.in_starting_lineup,
      r.is_confirmed_starter,
      r.batting_order_spot,
      r.catcher_change_after_model,
      r.opposing_starter_change_after_model,
      r.opposing_handedness_change_after_model,
      r.weather_state,
      r.weather_impact_direction,
      r.weather_impact_multiplier,
      r.delay_risk
    );

    insert into public.player_prop_decision_fusion_shadow (
      observation_id,evaluated_at,source_captured_at,sport,event_id,game_pk,starts_at,
      away_team,home_team,player_id,mlb_player_id,player_name,player_role,
      stat_id,label,line,side,upstream_status,
      fusion_state,priority,conflict_code,headline,explanation,alignment_score,
      model_probability,market_fair_probability,edge_pct_points,ev_pct,data_quality,
      exact_line_book_count,paired_books,best_book,best_odds,
      verification_state,verification_reason,in_starting_lineup,batting_order_spot,
      is_confirmed_starter,catcher_name,catcher_change_after_model,
      opposing_starter_change_after_model,opposing_handedness_change_after_model,
      weather_state,weather_impact_direction,weather_impact_multiplier,delay_risk,
      blockers,warnings,supports,raw,shadow_only,affects_decision
    ) values (
      r.id,now(),r.captured_at,r.sport,r.event_id,r.game_pk,r.starts_at,
      r.away_team,r.home_team,r.player_id,r.mlb_player_id,r.player_name,r.player_role,
      r.stat_id,r.label,r.line,r.side,r.status,
      v_eval->>'state',
      coalesce(nullif(v_eval->>'priority','')::integer,0),
      coalesce(v_eval->>'conflictCode','UNKNOWN'),
      coalesce(v_eval->>'headline','PROP MIXED SIGNALS'),
      coalesce(v_eval->>'explanation',''),
      coalesce(nullif(v_eval->>'alignmentScore','')::numeric,0),
      r.model_probability,r.market_fair_probability,r.edge_pct_points,r.ev_pct,r.data_quality,
      r.exact_line_book_count,r.paired_books,r.best_book,r.best_odds,
      r.verification_state,r.verification_reason,r.in_starting_lineup,r.batting_order_spot,
      r.is_confirmed_starter,r.catcher_name,r.catcher_change_after_model,
      r.opposing_starter_change_after_model,r.opposing_handedness_change_after_model,
      r.weather_state,r.weather_impact_direction,r.weather_impact_multiplier,r.delay_risk,
      coalesce(v_eval->'blockers','[]'::jsonb),
      coalesce(v_eval->'warnings','[]'::jsonb),
      coalesce(v_eval->'supports','[]'::jsonb),
      jsonb_build_object(
        'evaluatorVersion','player-prop-fusion-v1',
        'evaluation',v_eval,
        'upstreamReason',r.reason,
        'componentAvailability',jsonb_build_object(
          'modelProbability',r.model_probability is not null,
          'marketProbability',r.market_fair_probability is not null,
          'verification',r.verification_state is not null,
          'weatherPark',r.weather_state is not null
        )
      ),
      true,false
    )
    on conflict (observation_id) do update
    set
      evaluated_at=excluded.evaluated_at,
      source_captured_at=excluded.source_captured_at,
      upstream_status=excluded.upstream_status,
      fusion_state=excluded.fusion_state,
      priority=excluded.priority,
      conflict_code=excluded.conflict_code,
      headline=excluded.headline,
      explanation=excluded.explanation,
      alignment_score=excluded.alignment_score,
      model_probability=excluded.model_probability,
      market_fair_probability=excluded.market_fair_probability,
      edge_pct_points=excluded.edge_pct_points,
      ev_pct=excluded.ev_pct,
      data_quality=excluded.data_quality,
      exact_line_book_count=excluded.exact_line_book_count,
      paired_books=excluded.paired_books,
      best_book=excluded.best_book,
      best_odds=excluded.best_odds,
      verification_state=excluded.verification_state,
      verification_reason=excluded.verification_reason,
      in_starting_lineup=excluded.in_starting_lineup,
      batting_order_spot=excluded.batting_order_spot,
      is_confirmed_starter=excluded.is_confirmed_starter,
      catcher_name=excluded.catcher_name,
      catcher_change_after_model=excluded.catcher_change_after_model,
      opposing_starter_change_after_model=excluded.opposing_starter_change_after_model,
      opposing_handedness_change_after_model=excluded.opposing_handedness_change_after_model,
      weather_state=excluded.weather_state,
      weather_impact_direction=excluded.weather_impact_direction,
      weather_impact_multiplier=excluded.weather_impact_multiplier,
      delay_risk=excluded.delay_risk,
      blockers=excluded.blockers,
      warnings=excluded.warnings,
      supports=excluded.supports,
      raw=excluded.raw,
      shadow_only=true,
      affects_decision=false;

    v_count := v_count+1;
  end loop;

  return v_count;
end;
$function$;
revoke execute on function public.refresh_player_prop_decision_fusion_shadow() from public, anon, authenticated;
grant execute on function public.refresh_player_prop_decision_fusion_shadow() to service_role;

CREATE OR REPLACE FUNCTION public.trigger_player_prop_decision_fusion()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select public.refresh_player_prop_decision_fusion_shadow();
$function$;
revoke execute on function public.trigger_player_prop_decision_fusion() from public, anon, authenticated;
grant execute on function public.trigger_player_prop_decision_fusion() to service_role;

create or replace view public.market_decision_fusion_latest with (security_invoker = true) as
SELECT f.observation_id,
    f.evaluated_at,
    f.source_captured_at,
    f.sport,
    f.event_id,
    f.game_pk,
    f.starts_at,
    f.away_team,
    f.home_team,
    f.market_type,
    f.market_side,
    f.market_label,
    f.line,
    f.production_non_sharp_status,
    f.production_sharp_status,
    f.sharp_gate_id,
    f.fusion_state,
    f.priority,
    f.conflict_code,
    f.headline,
    f.explanation,
    f.alignment_score,
    f.uncertainty_class,
    f.robust_market_edge_pp,
    f.price_state,
    f.robust_ev_pct,
    f.price_cushion_cents,
    f.max_playable_odds,
    f.verification_state,
    f.verification_reason,
    f.weather_state,
    f.weather_impact_direction,
    f.delay_risk,
    f.sharp_classification,
    f.sharp_confidence,
    f.model_vs_sharp_pp,
    f.blockers,
    f.warnings,
    f.supports,
    f.raw,
    f.shadow_only,
    f.affects_decision
   FROM market_decision_fusion_shadow f
     JOIN market_grade_latest g ON g.id = f.observation_id;
;
revoke all on table public.market_decision_fusion_latest from public, anon, authenticated;
grant select on table public.market_decision_fusion_latest to service_role;

create or replace view public.player_prop_decision_fusion_latest with (security_invoker = true) as
SELECT f.observation_id,
    f.evaluated_at,
    f.source_captured_at,
    f.sport,
    f.event_id,
    f.game_pk,
    f.starts_at,
    f.away_team,
    f.home_team,
    f.player_id,
    f.mlb_player_id,
    f.player_name,
    f.player_role,
    f.stat_id,
    f.label,
    f.line,
    f.side,
    f.upstream_status,
    f.fusion_state,
    f.priority,
    f.conflict_code,
    f.headline,
    f.explanation,
    f.alignment_score,
    f.model_probability,
    f.market_fair_probability,
    f.edge_pct_points,
    f.ev_pct,
    f.data_quality,
    f.exact_line_book_count,
    f.paired_books,
    f.best_book,
    f.best_odds,
    f.verification_state,
    f.verification_reason,
    f.in_starting_lineup,
    f.batting_order_spot,
    f.is_confirmed_starter,
    f.catcher_name,
    f.catcher_change_after_model,
    f.opposing_starter_change_after_model,
    f.opposing_handedness_change_after_model,
    f.weather_state,
    f.weather_impact_direction,
    f.weather_impact_multiplier,
    f.delay_risk,
    f.blockers,
    f.warnings,
    f.supports,
    f.raw,
    f.shadow_only,
    f.affects_decision
   FROM player_prop_decision_fusion_shadow f
     JOIN player_prop_latest p ON p.id = f.observation_id;
;
revoke all on table public.player_prop_decision_fusion_latest from public, anon, authenticated;
grant select on table public.player_prop_decision_fusion_latest to service_role;
