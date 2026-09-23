-- Reconstructed from production catalog on 2026-09-23.
-- Catch-up source for fresh environments; do not replay blindly on current production.

create table if not exists public.market_uncertainty_shadow (
  observation_id bigint not null,
  calculated_at timestamp with time zone default now() not null,
  evaluator_version text default 'uncertainty-v1'::text not null,
  sport text not null,
  event_id text not null,
  starts_at timestamp with time zone,
  away_team text,
  home_team text,
  market_type text not null,
  market_side text not null,
  market_label text,
  line numeric,
  non_sharp_status text,
  model_probability numeric,
  market_fair_probability numeric,
  sharp_consensus_probability numeric,
  sharp_data_quality numeric,
  calibration_sample_size integer default 0 not null,
  uncertainty_pp numeric,
  conservative_probability numeric,
  headline_market_edge_pp numeric,
  robust_market_edge_pp numeric,
  headline_sharp_edge_pp numeric,
  robust_sharp_edge_pp numeric,
  market_classification text,
  classification text not null,
  reference_type text not null,
  components jsonb default '{}'::jsonb not null,
  raw jsonb default '{}'::jsonb not null,
  source_captured_at timestamp with time zone,
  constraint market_uncertainty_shadow_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES market_grade_observations(id) ON DELETE CASCADE,
  constraint market_uncertainty_shadow_pkey PRIMARY KEY (observation_id)
);
alter table public.market_uncertainty_shadow enable row level security;
revoke all on table public.market_uncertainty_shadow from public, anon, authenticated;
grant select, insert, update, delete on table public.market_uncertainty_shadow to service_role;

CREATE INDEX IF NOT EXISTS market_uncertainty_shadow_classification_idx ON public.market_uncertainty_shadow USING btree (sport, classification, calculated_at DESC);

CREATE INDEX IF NOT EXISTS market_uncertainty_shadow_event_idx ON public.market_uncertainty_shadow USING btree (sport, event_id, market_type, market_side, line);

CREATE INDEX IF NOT EXISTS market_uncertainty_shadow_source_capture_idx ON public.market_uncertainty_shadow USING btree (sport, source_captured_at DESC);

create table if not exists public.market_policy_registry (
  policy_id text not null,
  policy_version text default 'market-policy-v1'::text not null,
  market_type text not null,
  policy_family text not null,
  display_name text not null,
  active boolean default true not null,
  shadow_only boolean default true not null,
  affects_decision boolean default false not null,
  config jsonb not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  constraint market_policy_registry_market_type_check CHECK (market_type = ANY (ARRAY['moneyline'::text, 'spread'::text, 'total'::text])),
  constraint market_policy_registry_pkey PRIMARY KEY (policy_id)
);
alter table public.market_policy_registry enable row level security;
revoke all on table public.market_policy_registry from public, anon, authenticated;
grant select, insert, update, delete on table public.market_policy_registry to service_role;

create table if not exists public.market_policy_shadow_results (
  observation_id bigint not null,
  policy_id text not null,
  evaluated_at timestamp with time zone default now() not null,
  evaluator_version text default 'market-policy-v1'::text not null,
  sport text not null,
  event_id text not null,
  starts_at timestamp with time zone,
  market_type text not null,
  market_side text not null,
  market_label text,
  line numeric,
  decision text not null,
  reason_code text not null,
  reason text,
  robust_market_edge_pp numeric,
  robust_sharp_edge_pp numeric,
  ev_pct numeric,
  uncertainty_pp numeric,
  sharp_data_quality numeric,
  sharp_source_count integer default 0 not null,
  config_snapshot jsonb not null,
  inputs jsonb default '{}'::jsonb not null,
  source_captured_at timestamp with time zone,
  constraint market_policy_shadow_results_decision_check CHECK (decision = ANY (ARRAY['PLAY'::text, 'PASS'::text, 'PENDING'::text])),
  constraint market_policy_shadow_results_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES market_grade_observations(id) ON DELETE CASCADE,
  constraint market_policy_shadow_results_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES market_policy_registry(policy_id) ON DELETE CASCADE,
  constraint market_policy_shadow_results_pkey PRIMARY KEY (observation_id, policy_id)
);
alter table public.market_policy_shadow_results enable row level security;
revoke all on table public.market_policy_shadow_results from public, anon, authenticated;
grant select, insert, update, delete on table public.market_policy_shadow_results to service_role;

CREATE INDEX IF NOT EXISTS market_policy_shadow_results_event_idx ON public.market_policy_shadow_results USING btree (sport, event_id, market_type, market_side, line);

CREATE INDEX IF NOT EXISTS market_policy_shadow_results_policy_idx ON public.market_policy_shadow_results USING btree (policy_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS market_policy_shadow_results_source_idx ON public.market_policy_shadow_results USING btree (policy_id, source_captured_at DESC);

CREATE OR REPLACE FUNCTION public.compute_market_uncertainty_v1(p_market_type text, p_model_probability numeric, p_market_fair_probability numeric, p_non_sharp_status text, p_calibration_sample integer, p_raw jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_market_type text := lower(coalesce(p_market_type,''));
  v_status text := upper(coalesce(p_non_sharp_status,''));
  v_raw jsonb := coalesce(p_raw,'{}'::jsonb);
  v_base_sigma numeric;
  v_context_sigma numeric;
  v_adjustment_sigma numeric;
  v_market_sigma numeric;
  v_calibration_sigma numeric;
  v_uncertainty numeric;
  v_conservative numeric;
  v_headline_edge numeric;
  v_robust_edge numeric;
  v_classification text;
  v_warning_count integer := 0;
  v_adjustment_abs_sum numeric := 0;
  v_adjustment_count integer := 0;
  v_lineup numeric;
  v_bullpen numeric;
  v_pitchmix numeric;
  v_runenv numeric;
  v_market_split boolean := false;
begin
  if p_model_probability is null then
    return jsonb_build_object(
      'evaluatorVersion','uncertainty-v1',
      'classification','INCOMPLETE',
      'reason','model_probability_missing'
    );
  end if;

  v_base_sigma := case v_market_type
    when 'moneyline' then 1.75
    when 'spread' then 2.25
    when 'total' then 2.50
    else 2.50
  end;

  if jsonb_typeof(v_raw->'warnings')='array' then
    v_warning_count := jsonb_array_length(v_raw->'warnings');
  elsif jsonb_typeof(v_raw #> '{explanationStats,warnings}')='array' then
    v_warning_count := jsonb_array_length(v_raw #> '{explanationStats,warnings}');
  end if;

  v_context_sigma := case v_status
    when 'READY_FOR_SHARP_CHECK' then 0.50
    when 'PASS' then 0.75
    when 'PENDING' then 2.00
    else 1.25
  end + least(1.00, v_warning_count * 0.25);

  begin v_lineup := nullif(v_raw #>> '{explanationStats,lineup,netAdjustmentPctPoints}','')::numeric; exception when others then v_lineup := null; end;
  begin v_bullpen := nullif(v_raw #>> '{explanationStats,bullpen,netAdjustmentPctPoints}','')::numeric; exception when others then v_bullpen := null; end;
  begin v_pitchmix := nullif(v_raw #>> '{explanationStats,pitchMix,netAdjustmentPctPoints}','')::numeric; exception when others then v_pitchmix := null; end;
  begin v_runenv := nullif(v_raw #>> '{explanationStats,runEnvironment,adjustmentPctPoints}','')::numeric; exception when others then v_runenv := null; end;

  if v_lineup is not null then
    v_adjustment_abs_sum := v_adjustment_abs_sum + abs(v_lineup);
    v_adjustment_count := v_adjustment_count + 1;
  end if;
  if v_bullpen is not null then
    v_adjustment_abs_sum := v_adjustment_abs_sum + abs(v_bullpen);
    v_adjustment_count := v_adjustment_count + 1;
  end if;
  if v_pitchmix is not null then
    v_adjustment_abs_sum := v_adjustment_abs_sum + abs(v_pitchmix);
    v_adjustment_count := v_adjustment_count + 1;
  end if;
  if v_runenv is not null then
    v_adjustment_abs_sum := v_adjustment_abs_sum + abs(v_runenv);
    v_adjustment_count := v_adjustment_count + 1;
  end if;

  v_adjustment_sigma := case
    when v_adjustment_count = 0 then 1.25
    else least(2.50, 0.35 + 0.25 * v_adjustment_abs_sum)
  end;

  v_market_split := coalesce((v_raw->>'marketSplit')::boolean,false);

  v_market_sigma := case
    when p_market_fair_probability is null then 2.25
    when v_market_split then 1.75
    else 0.75
  end;

  v_calibration_sigma := case
    when coalesce(p_calibration_sample,0) >= 100 then 0.75
    when coalesce(p_calibration_sample,0) >= 50 then 1.00
    when coalesce(p_calibration_sample,0) >= 25 then 1.50
    when coalesce(p_calibration_sample,0) >= 10 then 2.00
    else 2.75
  end;

  v_uncertainty := least(
    8.00,
    greatest(
      1.50,
      sqrt(
        power(v_base_sigma,2) +
        power(v_context_sigma,2) +
        power(v_adjustment_sigma,2) +
        power(v_market_sigma,2) +
        power(v_calibration_sigma,2)
      )
    )
  );

  v_conservative := greatest(
    0.01,
    least(0.99, p_model_probability - v_uncertainty / 100.0)
  );

  if p_market_fair_probability is not null then
    v_headline_edge := (p_model_probability - p_market_fair_probability) * 100.0;
    v_robust_edge := (v_conservative - p_market_fair_probability) * 100.0;
  end if;

  v_classification := case
    when v_status='PENDING' or p_market_fair_probability is null then 'INCOMPLETE'
    when v_robust_edge >= 2.00 then 'ROBUST'
    when v_robust_edge >= 0.00 then 'MARGINAL'
    else 'FRAGILE'
  end;

  return jsonb_build_object(
    'evaluatorVersion','uncertainty-v1',
    'classification',v_classification,
    'modelProbability',round(p_model_probability,6),
    'marketFairProbability',case when p_market_fair_probability is null then null else round(p_market_fair_probability,6) end,
    'conservativeProbability',round(v_conservative,6),
    'uncertaintyPctPoints',round(v_uncertainty,3),
    'headlineMarketEdgePctPoints',case when v_headline_edge is null then null else round(v_headline_edge,3) end,
    'robustMarketEdgePctPoints',case when v_robust_edge is null then null else round(v_robust_edge,3) end,
    'calibrationSampleSize',coalesce(p_calibration_sample,0),
    'components',jsonb_build_object(
      'baseSigmaPctPoints',round(v_base_sigma,3),
      'contextSigmaPctPoints',round(v_context_sigma,3),
      'adjustmentSigmaPctPoints',round(v_adjustment_sigma,3),
      'marketSigmaPctPoints',round(v_market_sigma,3),
      'calibrationSigmaPctPoints',round(v_calibration_sigma,3),
      'warningCount',v_warning_count,
      'adjustmentAbsSumPctPoints',round(v_adjustment_abs_sum,3),
      'adjustmentInputCount',v_adjustment_count,
      'marketSplit',v_market_split
    )
  );
end;
$function$;
revoke execute on function public.compute_market_uncertainty_v1(p_market_type text, p_model_probability numeric, p_market_fair_probability numeric, p_non_sharp_status text, p_calibration_sample integer, p_raw jsonb) from public, anon, authenticated;
grant execute on function public.compute_market_uncertainty_v1(p_market_type text, p_model_probability numeric, p_market_fair_probability numeric, p_non_sharp_status text, p_calibration_sample integer, p_raw jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.refresh_market_uncertainty_shadow()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  r record;
  v_calc jsonb;
  v_sample integer;
  v_sharp record;
  v_conservative numeric;
  v_robust_sharp numeric;
  v_headline_sharp numeric;
  v_market_class text;
  v_class text;
  v_reference text;
  v_count integer := 0;
begin
  for r in
    select *
    from public.market_grade_observations
    where captured_at >= now() - interval '14 days'
    order by captured_at asc, id asc
  loop
    select count(*)::integer
    into v_sample
    from (
      select distinct
        o2.event_id,
        o2.market_type,
        o2.market_side,
        coalesce(o2.line::text,'')
      from public.team_market_results tr
      join public.market_grade_observations o2
        on o2.id = tr.observation_id
      where o2.market_type = r.market_type
        and tr.graded_at <= r.captured_at
        and tr.outcome in ('W','L','PUSH')
    ) graded_unique;

    v_calc := public.compute_market_uncertainty_v1(
      r.market_type,
      r.model_probability,
      r.market_fair_probability,
      r.non_sharp_status,
      v_sample,
      r.raw
    );

    v_conservative := nullif(v_calc->>'conservativeProbability','')::numeric;
    v_market_class := coalesce(v_calc->>'classification','INCOMPLETE');

    select
      s.sharp_consensus_probability,
      s.sharp_data_quality,
      s.valid_sharp_source_count,
      s.checked_at
    into v_sharp
    from public.sharp_gate_history s
    where s.sport = r.sport
      and s.event_id = r.event_id
      and coalesce(s.market_type,'moneyline') = r.market_type
      and coalesce(s.market_side,s.side_key,'') = r.market_side
      and (
        (s.market_line is null and r.line is null)
        or abs(s.market_line - r.line) < 0.001
      )
      and s.checked_at >= r.captured_at - interval '2 minutes'
      and s.checked_at <= r.captured_at + interval '10 minutes'
    order by abs(extract(epoch from (s.checked_at - r.captured_at))) asc
    limit 1;

    if v_sharp.sharp_consensus_probability is not null and v_conservative is not null then
      v_headline_sharp := (r.model_probability - v_sharp.sharp_consensus_probability) * 100.0;
      v_robust_sharp := (v_conservative - v_sharp.sharp_consensus_probability) * 100.0;
      v_reference := 'sharp';
      v_class := case
        when v_market_class = 'INCOMPLETE' then 'INCOMPLETE'
        when v_robust_sharp >= 2.00 then 'ROBUST'
        when v_robust_sharp >= 0.00 then 'MARGINAL'
        else 'FRAGILE'
      end;
    else
      v_headline_sharp := null;
      v_robust_sharp := null;
      v_reference := 'market';
      v_class := v_market_class;
    end if;

    insert into public.market_uncertainty_shadow (
      observation_id,
      source_captured_at,
      calculated_at,
      evaluator_version,
      sport,
      event_id,
      starts_at,
      away_team,
      home_team,
      market_type,
      market_side,
      market_label,
      line,
      non_sharp_status,
      model_probability,
      market_fair_probability,
      sharp_consensus_probability,
      sharp_data_quality,
      calibration_sample_size,
      uncertainty_pp,
      conservative_probability,
      headline_market_edge_pp,
      robust_market_edge_pp,
      headline_sharp_edge_pp,
      robust_sharp_edge_pp,
      market_classification,
      classification,
      reference_type,
      components,
      raw
    )
    values (
      r.id,
      r.captured_at,
      now(),
      'uncertainty-v1',
      r.sport,
      r.event_id,
      r.starts_at,
      r.away_team,
      r.home_team,
      r.market_type,
      r.market_side,
      r.market_label,
      r.line,
      r.non_sharp_status,
      r.model_probability,
      r.market_fair_probability,
      v_sharp.sharp_consensus_probability,
      v_sharp.sharp_data_quality,
      v_sample,
      nullif(v_calc->>'uncertaintyPctPoints','')::numeric,
      v_conservative,
      nullif(v_calc->>'headlineMarketEdgePctPoints','')::numeric,
      nullif(v_calc->>'robustMarketEdgePctPoints','')::numeric,
      v_headline_sharp,
      v_robust_sharp,
      v_market_class,
      v_class,
      v_reference,
      coalesce(v_calc->'components','{}'::jsonb) ||
        jsonb_build_object(
          'sharpSourceCount',coalesce(v_sharp.valid_sharp_source_count,0),
          'sharpDataQuality',v_sharp.sharp_data_quality,
          'sharpMatchedAt',v_sharp.checked_at
        ),
      jsonb_build_object(
        'sourceObservationCapturedAt',r.captured_at,
        'sourceNonSharpReason',r.reason
      )
    )
    on conflict (observation_id) do update
    set
      source_captured_at = excluded.source_captured_at,
      calculated_at = excluded.calculated_at,
      sharp_consensus_probability = excluded.sharp_consensus_probability,
      sharp_data_quality = excluded.sharp_data_quality,
      headline_sharp_edge_pp = excluded.headline_sharp_edge_pp,
      robust_sharp_edge_pp = excluded.robust_sharp_edge_pp,
      classification = excluded.classification,
      reference_type = excluded.reference_type,
      components = (
        public.market_uncertainty_shadow.components
          - 'sharpSourceCount' - 'sharpDataQuality' - 'sharpMatchedAt'
      ) || jsonb_build_object(
        'sharpSourceCount',coalesce(v_sharp.valid_sharp_source_count,0),
        'sharpDataQuality',v_sharp.sharp_data_quality,
        'sharpMatchedAt',v_sharp.checked_at
      );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;
revoke execute on function public.refresh_market_uncertainty_shadow() from public, anon, authenticated;
grant execute on function public.refresh_market_uncertainty_shadow() to service_role;

CREATE OR REPLACE FUNCTION public.compute_market_policy_v1(p_market_type text, p_robust_market_edge_pp numeric, p_robust_sharp_edge_pp numeric, p_ev_pct numeric, p_uncertainty_pp numeric, p_sharp_data_quality numeric, p_sharp_source_count integer, p_non_sharp_status text, p_raw jsonb, p_policy jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_type text := lower(coalesce(p_market_type,''));
  v_status text := upper(coalesce(p_non_sharp_status,''));
  v_raw jsonb := coalesce(p_raw,'{}'::jsonb);
  v_policy jsonb := coalesce(p_policy,'{}'::jsonb);
  v_min_robust_market numeric := coalesce(nullif(v_policy->>'minRobustMarketEdgePp','')::numeric,0);
  v_min_robust_sharp numeric := coalesce(nullif(v_policy->>'minRobustSharpEdgePp','')::numeric,0);
  v_min_ev numeric := coalesce(nullif(v_policy->>'minEvPct','')::numeric,0);
  v_max_uncertainty numeric := coalesce(nullif(v_policy->>'maxUncertaintyPp','')::numeric,99);
  v_min_dq numeric := coalesce(nullif(v_policy->>'minSharpDataQuality','')::numeric,0);
  v_min_sources integer := coalesce(nullif(v_policy->>'minSharpSources','')::integer,0);
  v_require_sharp boolean := coalesce((v_policy->>'requireSharp')::boolean,false);
  v_reject_market_split boolean := coalesce((v_policy->>'rejectMarketSplit')::boolean,false);
  v_require_runenv boolean := coalesce((v_policy->>'requireRunEnvironment')::boolean,false);
  v_max_push numeric := coalesce(nullif(v_policy->>'maxPushProbability','')::numeric,1);
  v_market_split boolean := coalesce((v_raw->>'marketSplit')::boolean,false);
  v_push numeric := coalesce(nullif(v_raw->>'pushProbability','')::numeric,0);
  v_runenv jsonb := v_raw #> '{explanationStats,runEnvironment}';
begin
  if p_robust_market_edge_pp is null then
    return jsonb_build_object(
      'evaluatorVersion','market-policy-v1','decision','PENDING',
      'reasonCode','MISSING_ROBUST_MARKET_EDGE',
      'reason','Robust market edge is unavailable.'
    );
  end if;

  if v_status = 'PENDING' then
    return jsonb_build_object(
      'evaluatorVersion','market-policy-v1','decision','PENDING',
      'reasonCode','UPSTREAM_CONTEXT_PENDING',
      'reason','Upstream model/context verification is still pending.'
    );
  end if;

  if v_reject_market_split and v_market_split then
    return jsonb_build_object(
      'evaluatorVersion','market-policy-v1','decision','PASS',
      'reasonCode','MARKET_SPLIT',
      'reason','Books are split on the exact market number.'
    );
  end if;

  if v_require_runenv and (v_runenv is null or v_runenv = '{}'::jsonb) then
    return jsonb_build_object(
      'evaluatorVersion','market-policy-v1','decision','PENDING',
      'reasonCode','RUN_ENVIRONMENT_MISSING',
      'reason','Run-environment context is required for this policy.'
    );
  end if;

  if v_type = 'spread' and v_push > v_max_push then
    return jsonb_build_object(
      'evaluatorVersion','market-policy-v1','decision','PASS',
      'reasonCode','PUSH_RISK_TOO_HIGH',
      'reason',format('Push probability %s exceeds policy maximum %s.',
        round(v_push,3),round(v_max_push,3))
    );
  end if;

  if p_uncertainty_pp is null or p_uncertainty_pp > v_max_uncertainty then
    return jsonb_build_object(
      'evaluatorVersion','market-policy-v1','decision','PASS',
      'reasonCode','UNCERTAINTY_TOO_HIGH',
      'reason',format('Uncertainty %s exceeds policy maximum %s pp.',
        coalesce(round(p_uncertainty_pp,2)::text,'—'),round(v_max_uncertainty,2))
    );
  end if;

  if p_robust_market_edge_pp < v_min_robust_market then
    return jsonb_build_object(
      'evaluatorVersion','market-policy-v1','decision','PASS',
      'reasonCode','ROBUST_MARKET_EDGE_TOO_LOW',
      'reason',format('Robust market edge %s pp is below %s pp.',
        round(p_robust_market_edge_pp,2),round(v_min_robust_market,2))
    );
  end if;

  if p_ev_pct is null or p_ev_pct < v_min_ev then
    return jsonb_build_object(
      'evaluatorVersion','market-policy-v1','decision','PASS',
      'reasonCode','EV_TOO_LOW',
      'reason',format('EV %s%% is below policy minimum %s%%.',
        coalesce(round(p_ev_pct,2)::text,'—'),round(v_min_ev,2))
    );
  end if;

  if v_require_sharp then
    if p_robust_sharp_edge_pp is null then
      return jsonb_build_object(
        'evaluatorVersion','market-policy-v1','decision','PENDING',
        'reasonCode','SHARP_CONFIRMATION_MISSING',
        'reason','Sharp confirmation is required but not yet available.'
      );
    end if;

    if coalesce(p_sharp_source_count,0) < v_min_sources then
      return jsonb_build_object(
        'evaluatorVersion','market-policy-v1','decision','PENDING',
        'reasonCode','SHARP_SOURCE_COUNT_LOW',
        'reason',format('Only %s sharp source(s); policy requires %s.',
          coalesce(p_sharp_source_count,0),v_min_sources)
      );
    end if;

    if p_sharp_data_quality is null or p_sharp_data_quality < v_min_dq then
      return jsonb_build_object(
        'evaluatorVersion','market-policy-v1','decision','PENDING',
        'reasonCode','SHARP_DATA_QUALITY_LOW',
        'reason',format('Sharp data quality %s is below %s.',
          coalesce(round(p_sharp_data_quality,2)::text,'—'),round(v_min_dq,2))
      );
    end if;

    if p_robust_sharp_edge_pp < v_min_robust_sharp then
      return jsonb_build_object(
        'evaluatorVersion','market-policy-v1','decision','PASS',
        'reasonCode','ROBUST_SHARP_EDGE_TOO_LOW',
        'reason',format('Robust sharp edge %s pp is below %s pp.',
          round(p_robust_sharp_edge_pp,2),round(v_min_robust_sharp,2))
      );
    end if;
  end if;

  return jsonb_build_object(
    'evaluatorVersion','market-policy-v1',
    'decision','PLAY',
    'reasonCode','POLICY_CLEARED',
    'reason',format(
      'Clears %s policy: robust market edge %s pp, EV %s%%, uncertainty %s pp%s.',
      v_type,
      round(p_robust_market_edge_pp,2),
      round(p_ev_pct,2),
      round(p_uncertainty_pp,2),
      case when p_robust_sharp_edge_pp is not null
        then format(', robust sharp edge %s pp',round(p_robust_sharp_edge_pp,2))
        else ''
      end
    ),
    'inputs',jsonb_build_object(
      'robustMarketEdgePp',p_robust_market_edge_pp,
      'robustSharpEdgePp',p_robust_sharp_edge_pp,
      'evPct',p_ev_pct,
      'uncertaintyPp',p_uncertainty_pp,
      'sharpDataQuality',p_sharp_data_quality,
      'sharpSourceCount',coalesce(p_sharp_source_count,0),
      'marketSplit',v_market_split,
      'pushProbability',v_push
    )
  );
end;
$function$;
revoke execute on function public.compute_market_policy_v1(p_market_type text, p_robust_market_edge_pp numeric, p_robust_sharp_edge_pp numeric, p_ev_pct numeric, p_uncertainty_pp numeric, p_sharp_data_quality numeric, p_sharp_source_count integer, p_non_sharp_status text, p_raw jsonb, p_policy jsonb) from public, anon, authenticated;
grant execute on function public.compute_market_policy_v1(p_market_type text, p_robust_market_edge_pp numeric, p_robust_sharp_edge_pp numeric, p_ev_pct numeric, p_uncertainty_pp numeric, p_sharp_data_quality numeric, p_sharp_source_count integer, p_non_sharp_status text, p_raw jsonb, p_policy jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.refresh_market_policy_shadow()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  r record;
  p record;
  v_eval jsonb;
  v_count integer := 0;
  v_sources integer;
begin
  for r in
    select
      u.*,
      o.ev_pct,
      o.raw as observation_raw
    from public.market_uncertainty_shadow u
    join public.market_grade_observations o
      on o.id = u.observation_id
    where u.source_captured_at >= now() - interval '14 days'
    order by u.source_captured_at asc, u.observation_id asc
  loop
    begin
      v_sources := coalesce(nullif(r.components->>'sharpSourceCount','')::integer,0);
    exception when others then
      v_sources := 0;
    end;

    for p in
      select *
      from public.market_policy_registry
      where active = true
        and market_type = r.market_type
      order by policy_id
    loop
      v_eval := public.compute_market_policy_v1(
        r.market_type,
        r.robust_market_edge_pp,
        r.robust_sharp_edge_pp,
        r.ev_pct,
        r.uncertainty_pp,
        r.sharp_data_quality,
        v_sources,
        r.non_sharp_status,
        coalesce(r.observation_raw,'{}'::jsonb),
        p.config
      );

      insert into public.market_policy_shadow_results (
        observation_id,
        policy_id,
        source_captured_at,
        evaluated_at,
        evaluator_version,
        sport,
        event_id,
        starts_at,
        market_type,
        market_side,
        market_label,
        line,
        decision,
        reason_code,
        reason,
        robust_market_edge_pp,
        robust_sharp_edge_pp,
        ev_pct,
        uncertainty_pp,
        sharp_data_quality,
        sharp_source_count,
        config_snapshot,
        inputs
      )
      values (
        r.observation_id,
        p.policy_id,
        r.source_captured_at,
        now(),
        'market-policy-v1',
        r.sport,
        r.event_id,
        r.starts_at,
        r.market_type,
        r.market_side,
        r.market_label,
        r.line,
        coalesce(v_eval->>'decision','PENDING'),
        coalesce(v_eval->>'reasonCode','UNKNOWN'),
        v_eval->>'reason',
        r.robust_market_edge_pp,
        r.robust_sharp_edge_pp,
        r.ev_pct,
        r.uncertainty_pp,
        r.sharp_data_quality,
        v_sources,
        p.config,
        coalesce(v_eval->'inputs','{}'::jsonb)
      )
      on conflict (observation_id,policy_id) do update
      set
        source_captured_at = excluded.source_captured_at,
        evaluated_at = excluded.evaluated_at,
        decision = excluded.decision,
        reason_code = excluded.reason_code,
        reason = excluded.reason,
        robust_market_edge_pp = excluded.robust_market_edge_pp,
        robust_sharp_edge_pp = excluded.robust_sharp_edge_pp,
        ev_pct = excluded.ev_pct,
        uncertainty_pp = excluded.uncertainty_pp,
        sharp_data_quality = excluded.sharp_data_quality,
        sharp_source_count = excluded.sharp_source_count,
        config_snapshot = excluded.config_snapshot,
        inputs = excluded.inputs;

      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end;
$function$;
revoke execute on function public.refresh_market_policy_shadow() from public, anon, authenticated;
grant execute on function public.refresh_market_policy_shadow() to service_role;

create or replace view public.market_uncertainty_latest with (security_invoker = true) as
SELECT u.observation_id,
    u.calculated_at,
    u.evaluator_version,
    u.sport,
    u.event_id,
    u.starts_at,
    u.away_team,
    u.home_team,
    u.market_type,
    u.market_side,
    u.market_label,
    u.line,
    u.non_sharp_status,
    u.model_probability,
    u.market_fair_probability,
    u.sharp_consensus_probability,
    u.sharp_data_quality,
    u.calibration_sample_size,
    u.uncertainty_pp,
    u.conservative_probability,
    u.headline_market_edge_pp,
    u.robust_market_edge_pp,
    u.headline_sharp_edge_pp,
    u.robust_sharp_edge_pp,
    u.market_classification,
    u.classification,
    u.reference_type,
    u.components,
    u.raw,
    u.source_captured_at
   FROM market_uncertainty_shadow u
     JOIN market_grade_latest g ON g.id = u.observation_id;
;
revoke all on table public.market_uncertainty_latest from public, anon, authenticated;
grant select on table public.market_uncertainty_latest to service_role;

create or replace view public.market_policy_grade_latest with (security_invoker = true) as
WITH result_ranked AS (
         SELECT tr.observation_id,
            tr.event_id,
            tr.game_pk,
            tr.market_type,
            tr.market_side,
            tr.market_label,
            tr.line,
            tr.decision_status,
            tr.actual_value,
            tr.away_score,
            tr.home_score,
            tr.outcome,
            tr.won,
            tr.pushed,
            tr.pass_evaluation,
            tr.graded_at,
            tr.raw,
            row_number() OVER (PARTITION BY tr.event_id, tr.market_type, tr.market_side, (COALESCE(tr.line::text, ''::text)) ORDER BY tr.graded_at DESC, tr.observation_id DESC) AS rn
           FROM team_market_results tr
        ), results AS (
         SELECT result_ranked.observation_id,
            result_ranked.event_id,
            result_ranked.game_pk,
            result_ranked.market_type,
            result_ranked.market_side,
            result_ranked.market_label,
            result_ranked.line,
            result_ranked.decision_status,
            result_ranked.actual_value,
            result_ranked.away_score,
            result_ranked.home_score,
            result_ranked.outcome,
            result_ranked.won,
            result_ranked.pushed,
            result_ranked.pass_evaluation,
            result_ranked.graded_at,
            result_ranked.raw,
            result_ranked.rn
           FROM result_ranked
          WHERE result_ranked.rn = 1
        )
 SELECT p.policy_id,
    reg.policy_family,
    reg.display_name,
    p.observation_id,
    p.source_captured_at,
    p.evaluated_at,
    p.sport,
    p.event_id,
    p.starts_at,
    p.market_type,
    p.market_side,
    p.market_label,
    p.line,
    p.decision AS raw_shadow_decision,
    p.final_shadow_decision,
    p.final_reason_code,
    p.reason,
    p.robust_market_edge_pp,
    p.robust_sharp_edge_pp,
    p.ev_pct,
    p.uncertainty_pp,
    p.sharp_data_quality,
    p.sharp_source_count,
    o.model_probability,
    o.market_fair_probability,
    o.best_book,
    o.best_odds,
    u.conservative_probability,
    u.classification AS uncertainty_classification,
    res.outcome,
    res.won,
    res.pushed,
    res.away_score,
    res.home_score,
    res.graded_at,
        CASE
            WHEN res.outcome IS NULL THEN NULL::text
            WHEN p.final_shadow_decision = 'PLAY'::text AND res.outcome = 'W'::text THEN 'SHADOW_WIN'::text
            WHEN p.final_shadow_decision = 'PLAY'::text AND res.outcome = 'L'::text THEN 'SHADOW_LOSS'::text
            WHEN p.final_shadow_decision = 'PLAY'::text AND res.outcome = 'PUSH'::text THEN 'SHADOW_PUSH'::text
            WHEN p.final_shadow_decision = 'PASS'::text AND res.outcome = 'W'::text THEN 'MISSED_WIN'::text
            WHEN p.final_shadow_decision = 'PASS'::text AND res.outcome = 'L'::text THEN 'GOOD_PASS'::text
            WHEN p.final_shadow_decision = 'PASS'::text AND res.outcome = 'PUSH'::text THEN 'PASS_PUSH'::text
            ELSE NULL::text
        END AS policy_evaluation,
        CASE
            WHEN p.final_shadow_decision <> 'PLAY'::text OR res.outcome IS NULL THEN NULL::numeric
            WHEN res.outcome = 'PUSH'::text THEN 0::numeric
            WHEN res.outcome = 'L'::text THEN - 1::numeric
            WHEN res.outcome = 'W'::text AND o.best_odds > 0 THEN o.best_odds::numeric / 100::numeric
            WHEN res.outcome = 'W'::text AND o.best_odds < 0 THEN 100::numeric / abs(o.best_odds)::numeric
            ELSE NULL::numeric
        END AS unit_profit,
    clv.first_tracked_sharp_probability,
    clv.closing_sharp_probability,
    clv.tracked_sharp_move_pp,
    clv.market_to_close_clv_pp,
    clv.model_vs_close_pp,
    clv.closing_source_count
   FROM market_policy_final_pregame p
     JOIN market_policy_registry reg ON reg.policy_id = p.policy_id
     JOIN market_grade_observations o ON o.id = p.observation_id
     LEFT JOIN market_uncertainty_shadow u ON u.observation_id = p.observation_id
     LEFT JOIN sharp_market_clv clv ON clv.observation_id = p.observation_id
     LEFT JOIN results res ON res.event_id = p.event_id AND res.market_type = p.market_type AND res.market_side = p.market_side AND (res.line IS NULL AND p.line IS NULL OR abs(res.line - p.line) < 0.001);
;
revoke all on table public.market_policy_grade_latest from public, anon, authenticated;
grant select on table public.market_policy_grade_latest to service_role;

create or replace view public.market_policy_final_pregame with (security_invoker = true) as
WITH ranked AS (
         SELECT r_1.observation_id,
            r_1.policy_id,
            r_1.evaluated_at,
            r_1.evaluator_version,
            r_1.sport,
            r_1.event_id,
            r_1.starts_at,
            r_1.market_type,
            r_1.market_side,
            r_1.market_label,
            r_1.line,
            r_1.decision,
            r_1.reason_code,
            r_1.reason,
            r_1.robust_market_edge_pp,
            r_1.robust_sharp_edge_pp,
            r_1.ev_pct,
            r_1.uncertainty_pp,
            r_1.sharp_data_quality,
            r_1.sharp_source_count,
            r_1.config_snapshot,
            r_1.inputs,
            r_1.source_captured_at,
            row_number() OVER (PARTITION BY r_1.policy_id, r_1.sport, r_1.event_id, r_1.market_type, r_1.market_side, (COALESCE(r_1.line::text, ''::text)) ORDER BY r_1.source_captured_at DESC NULLS LAST, r_1.observation_id DESC) AS rn
           FROM market_policy_shadow_results r_1
          WHERE r_1.source_captured_at IS NOT NULL AND (r_1.starts_at IS NULL OR r_1.source_captured_at <= r_1.starts_at)
        )
 SELECT observation_id,
    policy_id,
    evaluated_at,
    evaluator_version,
    sport,
    event_id,
    starts_at,
    market_type,
    market_side,
    market_label,
    line,
    decision,
    reason_code,
    reason,
    robust_market_edge_pp,
    robust_sharp_edge_pp,
    ev_pct,
    uncertainty_pp,
    sharp_data_quality,
    sharp_source_count,
    config_snapshot,
    inputs,
    source_captured_at,
    rn,
        CASE
            WHEN decision = 'PENDING'::text THEN 'PASS'::text
            ELSE decision
        END AS final_shadow_decision,
        CASE
            WHEN decision = 'PENDING'::text THEN 'PENDING_AT_DEADLINE'::text
            ELSE reason_code
        END AS final_reason_code
   FROM ranked r
  WHERE rn = 1;
;
revoke all on table public.market_policy_final_pregame from public, anon, authenticated;
grant select on table public.market_policy_final_pregame to service_role;

insert into public.market_policy_registry
select * from jsonb_populate_recordset(null::public.market_policy_registry, '[{"notes":"Primary moneyline challenger.","active":true,"config":{"minEvPct":2.5,"requireSharp":true,"minSharpSources":1,"maxUncertaintyPp":4.25,"minSharpDataQuality":0.6,"minRobustSharpEdgePp":1,"minRobustMarketEdgePp":2},"policy_id":"ML_BALANCED","created_at":"2026-09-23T06:56:16.737633+00:00","market_type":"moneyline","shadow_only":true,"display_name":"Moneyline Balanced","policy_family":"BALANCED","policy_version":"market-policy-v1","affects_decision":false},{"notes":"Looser shadow challenger.","active":true,"config":{"minEvPct":2,"requireSharp":true,"minSharpSources":1,"maxUncertaintyPp":4.75,"minSharpDataQuality":0.5,"minRobustSharpEdgePp":0.5,"minRobustMarketEdgePp":1.5},"policy_id":"ML_EXPLORE","created_at":"2026-09-23T06:56:16.737633+00:00","market_type":"moneyline","shadow_only":true,"display_name":"Moneyline Explore","policy_family":"EXPLORE","policy_version":"market-policy-v1","affects_decision":false},{"notes":"High-conviction moneyline challenger.","active":true,"config":{"minEvPct":3.5,"requireSharp":true,"minSharpSources":2,"maxUncertaintyPp":3.75,"minSharpDataQuality":0.7,"minRobustSharpEdgePp":1.5,"minRobustMarketEdgePp":3},"policy_id":"ML_STRICT","created_at":"2026-09-23T06:56:16.737633+00:00","market_type":"moneyline","shadow_only":true,"display_name":"Moneyline Strict","policy_family":"STRICT","policy_version":"market-policy-v1","affects_decision":false},{"notes":"Primary run-line challenger.","active":true,"config":{"minEvPct":3,"requireSharp":true,"minSharpSources":1,"maxUncertaintyPp":4,"rejectMarketSplit":true,"maxPushProbability":0.06,"minSharpDataQuality":0.65,"minRobustSharpEdgePp":1,"minRobustMarketEdgePp":2.75},"policy_id":"RL_BALANCED","created_at":"2026-09-23T06:56:16.737633+00:00","market_type":"spread","shadow_only":true,"display_name":"Run Line Balanced","policy_family":"BALANCED","policy_version":"market-policy-v1","affects_decision":false},{"notes":"Looser run-line challenger with push control.","active":true,"config":{"minEvPct":2.5,"requireSharp":true,"minSharpSources":1,"maxUncertaintyPp":4.5,"rejectMarketSplit":true,"maxPushProbability":0.08,"minSharpDataQuality":0.55,"minRobustSharpEdgePp":0.5,"minRobustMarketEdgePp":2},"policy_id":"RL_EXPLORE","created_at":"2026-09-23T06:56:16.737633+00:00","market_type":"spread","shadow_only":true,"display_name":"Run Line Explore","policy_family":"EXPLORE","policy_version":"market-policy-v1","affects_decision":false},{"notes":"High-conviction run-line challenger.","active":true,"config":{"minEvPct":4,"requireSharp":true,"minSharpSources":2,"maxUncertaintyPp":3.75,"rejectMarketSplit":true,"maxPushProbability":0.04,"minSharpDataQuality":0.7,"minRobustSharpEdgePp":1.5,"minRobustMarketEdgePp":3.5},"policy_id":"RL_STRICT","created_at":"2026-09-23T06:56:16.737633+00:00","market_type":"spread","shadow_only":true,"display_name":"Run Line Strict","policy_family":"STRICT","policy_version":"market-policy-v1","affects_decision":false},{"notes":"Primary totals challenger.","active":true,"config":{"minEvPct":3,"requireSharp":true,"minSharpSources":1,"maxUncertaintyPp":4.5,"rejectMarketSplit":true,"minSharpDataQuality":0.65,"minRobustSharpEdgePp":1,"minRobustMarketEdgePp":3,"requireRunEnvironment":true},"policy_id":"TOT_BALANCED","created_at":"2026-09-23T06:56:16.737633+00:00","market_type":"total","shadow_only":true,"display_name":"Total Balanced","policy_family":"BALANCED","policy_version":"market-policy-v1","affects_decision":false},{"notes":"Looser totals challenger; still requires exact-market integrity and run environment.","active":true,"config":{"minEvPct":2.5,"requireSharp":true,"minSharpSources":1,"maxUncertaintyPp":4.75,"rejectMarketSplit":true,"minSharpDataQuality":0.55,"minRobustSharpEdgePp":0.5,"minRobustMarketEdgePp":2.5,"requireRunEnvironment":true},"policy_id":"TOT_EXPLORE","created_at":"2026-09-23T06:56:16.737633+00:00","market_type":"total","shadow_only":true,"display_name":"Total Explore","policy_family":"EXPLORE","policy_version":"market-policy-v1","affects_decision":false},{"notes":"High-conviction totals challenger.","active":true,"config":{"minEvPct":4,"requireSharp":true,"minSharpSources":2,"maxUncertaintyPp":4,"rejectMarketSplit":true,"minSharpDataQuality":0.7,"minRobustSharpEdgePp":1.5,"minRobustMarketEdgePp":4,"requireRunEnvironment":true},"policy_id":"TOT_STRICT","created_at":"2026-09-23T06:56:16.737633+00:00","market_type":"total","shadow_only":true,"display_name":"Total Strict","policy_family":"STRICT","policy_version":"market-policy-v1","affects_decision":false}]'::jsonb)
on conflict do nothing;
