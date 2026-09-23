-- Reconstructed from production catalog on 2026-09-23.
-- Catch-up source for fresh environments; do not replay blindly on current production.

create table if not exists public.market_price_sensitivity_shadow (
  observation_id bigint not null,
  policy_id text not null,
  source_captured_at timestamp with time zone not null,
  evaluated_at timestamp with time zone default now() not null,
  evaluator_version text default 'price-sensitivity-v1'::text not null,
  sport text not null,
  event_id text not null,
  starts_at timestamp with time zone,
  market_type text not null,
  market_side text not null,
  market_label text,
  line numeric,
  current_book text,
  current_odds integer,
  model_probability numeric,
  conservative_probability numeric,
  sharp_consensus_probability numeric,
  push_probability numeric default 0,
  target_ev_pct numeric not null,
  strong_ev_pct numeric not null,
  state text not null,
  strength text,
  current_model_ev_pct numeric,
  current_robust_ev_pct numeric,
  current_sharp_ev_pct numeric,
  fair_model_odds integer,
  fair_conservative_odds integer,
  fair_sharp_odds integer,
  max_playable_odds integer,
  price_cushion_cents numeric,
  ev_price_ladder jsonb default '{}'::jsonb not null,
  reason_code text,
  raw jsonb default '{}'::jsonb not null,
  constraint market_price_sensitivity_shadow_state_check CHECK (state = ANY (ARRAY['BUY'::text, 'HOLD'::text, 'PASS'::text, 'PENDING'::text])),
  constraint market_price_sensitivity_shadow_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES market_grade_observations(id) ON DELETE CASCADE,
  constraint market_price_sensitivity_shadow_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES market_policy_registry(policy_id) ON DELETE CASCADE,
  constraint market_price_sensitivity_shadow_pkey PRIMARY KEY (observation_id, policy_id)
);
alter table public.market_price_sensitivity_shadow enable row level security;
revoke all on table public.market_price_sensitivity_shadow from public, anon, authenticated;
grant select, insert, update, delete on table public.market_price_sensitivity_shadow to service_role;

CREATE INDEX IF NOT EXISTS market_price_sensitivity_shadow_event_idx ON public.market_price_sensitivity_shadow USING btree (sport, event_id, market_type, market_side, line, source_captured_at DESC);

CREATE INDEX IF NOT EXISTS market_price_sensitivity_shadow_policy_idx ON public.market_price_sensitivity_shadow USING btree (policy_id, source_captured_at DESC);

CREATE OR REPLACE FUNCTION public.compute_price_sensitivity_v1(p_market_type text, p_current_odds integer, p_model_probability numeric, p_conservative_probability numeric, p_sharp_probability numeric, p_push_probability numeric, p_target_ev_pct numeric, p_strong_ev_pct numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_type text := lower(coalesce(p_market_type,''));
  v_push numeric := greatest(0,least(0.40,coalesce(p_push_probability,0)));
  v_target numeric := greatest(0,coalesce(p_target_ev_pct,0))/100.0;
  v_strong numeric := greatest(
    v_target,
    greatest(0,coalesce(p_strong_ev_pct,p_target_ev_pct,0))/100.0
  );
  v_profit numeric;
  v_loss_model numeric;
  v_loss_cons numeric;
  v_loss_sharp numeric;
  v_model_ev numeric;
  v_cons_ev numeric;
  v_sharp_ev numeric;
  v_fair_model numeric;
  v_fair_cons numeric;
  v_fair_sharp numeric;
  v_target_profit numeric;
  v_target_odds numeric;
  v_target_odds_int integer;
  v_current_cost numeric;
  v_target_cost numeric;
  v_cushion numeric;
  v_state text;
  v_strength text;
  v_ladder jsonb := '{}'::jsonb;
  v_e numeric;
  v_req_profit numeric;
  v_req_odds numeric;
  v_req_int integer;
  v_key text;
begin
  if p_push_probability is null and v_type in ('spread','total') then
    return jsonb_build_object(
      'evaluatorVersion','price-sensitivity-v1',
      'marketType',v_type,
      'state','PENDING',
      'reasonCode','PUSH_PROBABILITY_MISSING',
      'reason','Push probability is required for this spread/total price.'
    );
  end if;

  if p_current_odds is null
     or abs(p_current_odds) < 100
     or p_model_probability is null
     or p_conservative_probability is null
     or p_model_probability <= 0
     or p_model_probability >= 1
     or p_conservative_probability <= 0
     or p_conservative_probability >= 1
     or p_conservative_probability + v_push >= 1 then
    return jsonb_build_object(
      'evaluatorVersion','price-sensitivity-v1',
      'marketType',v_type,
      'state','PENDING',
      'reasonCode','INPUTS_INCOMPLETE',
      'reason','Current American price and valid model/conservative probabilities are required.'
    );
  end if;

  v_profit := case
    when p_current_odds > 0 then p_current_odds::numeric/100.0
    else 100.0/abs(p_current_odds)::numeric
  end;

  v_loss_model := greatest(0,1-p_model_probability-v_push);
  v_loss_cons := greatest(0,1-p_conservative_probability-v_push);
  v_model_ev := p_model_probability*v_profit-v_loss_model;
  v_cons_ev := p_conservative_probability*v_profit-v_loss_cons;

  if p_sharp_probability is not null
     and p_sharp_probability > 0
     and p_sharp_probability < 1
     and p_sharp_probability + v_push < 1 then
    v_loss_sharp := greatest(0,1-p_sharp_probability-v_push);
    v_sharp_ev := p_sharp_probability*v_profit-v_loss_sharp;
  end if;

  v_fair_model := v_loss_model/p_model_probability;
  v_fair_cons := v_loss_cons/p_conservative_probability;

  if p_sharp_probability is not null
     and p_sharp_probability > 0
     and p_sharp_probability < 1
     and p_sharp_probability + v_push < 1 then
    v_fair_sharp := v_loss_sharp/p_sharp_probability;
  end if;

  v_target_profit := (v_target + v_loss_cons)/p_conservative_probability;
  v_target_odds := case
    when v_target_profit >= 1 then 100*v_target_profit
    else -100/v_target_profit
  end;
  v_target_odds_int := ceil(v_target_odds)::integer;

  v_current_cost := case
    when p_current_odds > 0 then 200-p_current_odds
    else abs(p_current_odds)
  end;
  v_target_cost := case
    when v_target_odds_int > 0 then 200-v_target_odds_int
    else abs(v_target_odds_int)
  end;
  v_cushion := v_target_cost-v_current_cost;

  if v_cons_ev >= v_target then
    v_state := 'BUY';
  elsif v_cons_ev >= 0 then
    v_state := 'HOLD';
  else
    v_state := 'PASS';
  end if;

  v_strength := case
    when v_cons_ev >= v_strong then 'STRONG_VALUE'
    when v_cons_ev >= v_target then 'PLAYABLE_VALUE'
    when v_cons_ev >= 0 then 'BELOW_BUY_POINT'
    else 'NEGATIVE_ROBUST_EV'
  end;

  foreach v_e in array array[0::numeric,0.01::numeric,0.02::numeric,0.03::numeric]
  loop
    v_req_profit := (v_e + v_loss_cons)/p_conservative_probability;
    v_req_odds := case
      when v_req_profit >= 1 then 100*v_req_profit
      else -100/v_req_profit
    end;
    v_req_int := ceil(v_req_odds)::integer;
    if v_e = 0 then
      v_key := '0%';
    else
      v_key := trim(trailing '.' from trim(trailing '0' from (v_e*100)::text)) || '%';
    end if;
    v_ladder := v_ladder || jsonb_build_object(v_key,v_req_int);
  end loop;

  return jsonb_build_object(
    'evaluatorVersion','price-sensitivity-v1',
    'marketType',v_type,
    'state',v_state,
    'strength',v_strength,
    'currentOdds',p_current_odds,
    'targetEvPct',round(v_target*100,2),
    'strongEvPct',round(v_strong*100,2),
    'pushProbability',round(v_push,6),
    'currentModelEvPct',round(v_model_ev*100,3),
    'currentRobustEvPct',round(v_cons_ev*100,3),
    'currentSharpEvPct',case when v_sharp_ev is null then null else round(v_sharp_ev*100,3) end,
    'fairModelOdds',ceil(case when v_fair_model >= 1 then 100*v_fair_model else -100/v_fair_model end)::integer,
    'fairConservativeOdds',ceil(case when v_fair_cons >= 1 then 100*v_fair_cons else -100/v_fair_cons end)::integer,
    'fairSharpOdds',case
      when v_fair_sharp is null then null
      else ceil(case when v_fair_sharp >= 1 then 100*v_fair_sharp else -100/v_fair_sharp end)::integer
    end,
    'maxPlayableOdds',v_target_odds_int,
    'priceCushionCents',round(v_cushion,1),
    'evPriceLadder',v_ladder,
    'reasonCode',case
      when v_state='BUY' then 'AT_OR_BETTER_THAN_BUY_POINT'
      when v_state='HOLD' then 'POSITIVE_EV_BELOW_TARGET'
      else 'NEGATIVE_ROBUST_EV'
    end
  );
end;
$function$;
revoke execute on function public.compute_price_sensitivity_v1(p_market_type text, p_current_odds integer, p_model_probability numeric, p_conservative_probability numeric, p_sharp_probability numeric, p_push_probability numeric, p_target_ev_pct numeric, p_strong_ev_pct numeric) from public, anon, authenticated;
grant execute on function public.compute_price_sensitivity_v1(p_market_type text, p_current_odds integer, p_model_probability numeric, p_conservative_probability numeric, p_sharp_probability numeric, p_push_probability numeric, p_target_ev_pct numeric, p_strong_ev_pct numeric) to service_role;

CREATE OR REPLACE FUNCTION public.refresh_market_price_sensitivity_shadow()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  r record;
  p record;
  v_eval jsonb;
  v_push numeric;
  v_push_known boolean;
  v_target numeric;
  v_strong numeric;
  v_count integer := 0;
begin
  for r in
    select
      u.*,
      o.best_book,
      o.best_odds,
      o.raw as observation_raw
    from public.market_uncertainty_shadow u
    join public.market_grade_observations o
      on o.id=u.observation_id
    where u.source_captured_at >= now() - interval '14 days'
    order by u.source_captured_at asc,u.observation_id asc
  loop
    v_push_known := true;

    if coalesce(r.observation_raw,'{}'::jsonb) ? 'pushProbability' then
      begin
        v_push := nullif(r.observation_raw->>'pushProbability','')::numeric;
        if v_push is null then
          v_push_known := false;
        end if;
      exception when others then
        v_push := null;
        v_push_known := false;
      end;
    elsif r.market_type in ('spread','total')
       and r.line is not null
       and abs(r.line-round(r.line)) < 0.001 then
      v_push := null;
      v_push_known := false;
    else
      v_push := 0;
    end if;

    for p in
      select *
      from public.market_policy_registry
      where active=true
        and market_type=r.market_type
      order by policy_id
    loop
      begin
        v_target := coalesce(nullif(p.config->>'minEvPct','')::numeric,0);
      exception when others then
        v_target := 0;
      end;
      v_strong := v_target + 2.0;

      v_eval := public.compute_price_sensitivity_v1(
        r.market_type,
        r.best_odds,
        r.model_probability,
        r.conservative_probability,
        r.sharp_consensus_probability,
        v_push,
        v_target,
        v_strong
      );

      insert into public.market_price_sensitivity_shadow (
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
        current_book,
        current_odds,
        model_probability,
        conservative_probability,
        sharp_consensus_probability,
        push_probability,
        target_ev_pct,
        strong_ev_pct,
        state,
        strength,
        current_model_ev_pct,
        current_robust_ev_pct,
        current_sharp_ev_pct,
        fair_model_odds,
        fair_conservative_odds,
        fair_sharp_odds,
        max_playable_odds,
        price_cushion_cents,
        ev_price_ladder,
        reason_code,
        raw
      )
      values (
        r.observation_id,
        p.policy_id,
        r.source_captured_at,
        now(),
        'price-sensitivity-v1',
        r.sport,
        r.event_id,
        r.starts_at,
        r.market_type,
        r.market_side,
        r.market_label,
        r.line,
        r.best_book,
        r.best_odds,
        r.model_probability,
        r.conservative_probability,
        r.sharp_consensus_probability,
        v_push,
        v_target,
        v_strong,
        coalesce(v_eval->>'state','PENDING'),
        v_eval->>'strength',
        nullif(v_eval->>'currentModelEvPct','')::numeric,
        nullif(v_eval->>'currentRobustEvPct','')::numeric,
        nullif(v_eval->>'currentSharpEvPct','')::numeric,
        nullif(v_eval->>'fairModelOdds','')::integer,
        nullif(v_eval->>'fairConservativeOdds','')::integer,
        nullif(v_eval->>'fairSharpOdds','')::integer,
        nullif(v_eval->>'maxPlayableOdds','')::integer,
        nullif(v_eval->>'priceCushionCents','')::numeric,
        coalesce(v_eval->'evPriceLadder','{}'::jsonb),
        v_eval->>'reasonCode',
        jsonb_build_object(
          'policyFamily',p.policy_family,
          'policyConfig',p.config,
          'uncertaintyClassification',r.classification,
          'uncertaintyPctPoints',r.uncertainty_pp,
          'pushProbabilityKnown',v_push_known
        )
      )
      on conflict (observation_id,policy_id) do update
      set
        source_captured_at=excluded.source_captured_at,
        evaluated_at=excluded.evaluated_at,
        current_book=excluded.current_book,
        current_odds=excluded.current_odds,
        model_probability=excluded.model_probability,
        conservative_probability=excluded.conservative_probability,
        sharp_consensus_probability=excluded.sharp_consensus_probability,
        push_probability=excluded.push_probability,
        target_ev_pct=excluded.target_ev_pct,
        strong_ev_pct=excluded.strong_ev_pct,
        state=excluded.state,
        strength=excluded.strength,
        current_model_ev_pct=excluded.current_model_ev_pct,
        current_robust_ev_pct=excluded.current_robust_ev_pct,
        current_sharp_ev_pct=excluded.current_sharp_ev_pct,
        fair_model_odds=excluded.fair_model_odds,
        fair_conservative_odds=excluded.fair_conservative_odds,
        fair_sharp_odds=excluded.fair_sharp_odds,
        max_playable_odds=excluded.max_playable_odds,
        price_cushion_cents=excluded.price_cushion_cents,
        ev_price_ladder=excluded.ev_price_ladder,
        reason_code=excluded.reason_code,
        raw=excluded.raw;

      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end;
$function$;
revoke execute on function public.refresh_market_price_sensitivity_shadow() from public, anon, authenticated;
grant execute on function public.refresh_market_price_sensitivity_shadow() to service_role;

create or replace view public.market_price_sensitivity_latest with (security_invoker = true) as
SELECT p.observation_id,
    p.policy_id,
    p.source_captured_at,
    p.evaluated_at,
    p.evaluator_version,
    p.sport,
    p.event_id,
    p.starts_at,
    p.market_type,
    p.market_side,
    p.market_label,
    p.line,
    p.current_book,
    p.current_odds,
    p.model_probability,
    p.conservative_probability,
    p.sharp_consensus_probability,
    p.push_probability,
    p.target_ev_pct,
    p.strong_ev_pct,
    p.state,
    p.strength,
    p.current_model_ev_pct,
    p.current_robust_ev_pct,
    p.current_sharp_ev_pct,
    p.fair_model_odds,
    p.fair_conservative_odds,
    p.fair_sharp_odds,
    p.max_playable_odds,
    p.price_cushion_cents,
    p.ev_price_ladder,
    p.reason_code,
    p.raw
   FROM market_price_sensitivity_shadow p
     JOIN market_grade_latest g ON g.id = p.observation_id;
;
revoke all on table public.market_price_sensitivity_latest from public, anon, authenticated;
grant select on table public.market_price_sensitivity_latest to service_role;

create or replace view public.market_price_wait_analysis with (security_invoker = true) as
WITH base AS (
         SELECT p.observation_id,
            p.policy_id,
            p.source_captured_at,
            p.evaluated_at,
            p.evaluator_version,
            p.sport,
            p.event_id,
            p.starts_at,
            p.market_type,
            p.market_side,
            p.market_label,
            p.line,
            p.current_book,
            p.current_odds,
            p.model_probability,
            p.conservative_probability,
            p.sharp_consensus_probability,
            p.push_probability,
            p.target_ev_pct,
            p.strong_ev_pct,
            p.state,
            p.strength,
            p.current_model_ev_pct,
            p.current_robust_ev_pct,
            p.current_sharp_ev_pct,
            p.fair_model_odds,
            p.fair_conservative_odds,
            p.fair_sharp_odds,
            p.max_playable_odds,
            p.price_cushion_cents,
            p.ev_price_ladder,
            p.reason_code,
            p.raw,
            reg.policy_family,
            reg.display_name,
                CASE
                    WHEN p.current_odds IS NULL THEN NULL::integer
                    WHEN p.current_odds > 0 THEN 200 - p.current_odds
                    ELSE abs(p.current_odds)
                END AS price_cost,
            row_number() OVER (PARTITION BY p.policy_id, p.sport, p.event_id, p.market_type, p.market_side, (COALESCE(p.line::text, ''::text)) ORDER BY p.source_captured_at, p.observation_id) AS first_rn,
            row_number() OVER (PARTITION BY p.policy_id, p.sport, p.event_id, p.market_type, p.market_side, (COALESCE(p.line::text, ''::text)) ORDER BY p.source_captured_at DESC, p.observation_id DESC) AS final_rn,
            min(
                CASE
                    WHEN p.current_odds IS NULL THEN NULL::integer
                    WHEN p.current_odds > 0 THEN 200 - p.current_odds
                    ELSE abs(p.current_odds)
                END) OVER (PARTITION BY p.policy_id, p.sport, p.event_id, p.market_type, p.market_side, (COALESCE(p.line::text, ''::text))) AS best_price_cost,
            first_value(p.current_odds) OVER (PARTITION BY p.policy_id, p.sport, p.event_id, p.market_type, p.market_side, (COALESCE(p.line::text, ''::text)) ORDER BY (
                CASE
                    WHEN p.current_odds IS NULL THEN 999999
                    WHEN p.current_odds > 0 THEN 200 - p.current_odds
                    ELSE abs(p.current_odds)
                END), p.source_captured_at) AS best_odds_seen
           FROM market_price_sensitivity_shadow p
             JOIN market_policy_registry reg ON reg.policy_id = p.policy_id
          WHERE p.source_captured_at IS NOT NULL AND (p.starts_at IS NULL OR p.source_captured_at <= p.starts_at)
        ), agg AS (
         SELECT base.policy_id,
            base.policy_family,
            base.display_name,
            base.sport,
            base.event_id,
            max(base.starts_at) AS starts_at,
            base.market_type,
            base.market_side,
            max(base.market_label) AS market_label,
            base.line,
            max(base.source_captured_at) FILTER (WHERE base.first_rn = 1) AS first_tracked_at,
            max(base.current_book) FILTER (WHERE base.first_rn = 1) AS first_book,
            max(base.current_odds) FILTER (WHERE base.first_rn = 1) AS first_odds,
            max(base.price_cost) FILTER (WHERE base.first_rn = 1) AS first_price_cost,
            max(base.state) FILTER (WHERE base.first_rn = 1) AS first_state,
            max(base.current_robust_ev_pct) FILTER (WHERE base.first_rn = 1) AS first_robust_ev_pct,
            max(base.max_playable_odds) FILTER (WHERE base.first_rn = 1) AS first_buy_point,
            max(base.source_captured_at) FILTER (WHERE base.final_rn = 1) AS final_tracked_at,
            max(base.current_book) FILTER (WHERE base.final_rn = 1) AS final_book,
            max(base.current_odds) FILTER (WHERE base.final_rn = 1) AS final_odds,
            max(base.price_cost) FILTER (WHERE base.final_rn = 1) AS final_price_cost,
            max(base.state) FILTER (WHERE base.final_rn = 1) AS final_state,
            max(base.current_robust_ev_pct) FILTER (WHERE base.final_rn = 1) AS final_robust_ev_pct,
            max(base.max_playable_odds) FILTER (WHERE base.final_rn = 1) AS final_buy_point,
            min(base.best_price_cost) AS best_price_cost,
            min(base.best_odds_seen) AS best_odds_seen,
            count(*) AS snapshot_count,
            count(*) FILTER (WHERE base.state = 'BUY'::text) AS buy_snapshot_count,
            min(base.source_captured_at) FILTER (WHERE base.state = 'BUY'::text) AS first_buy_at,
            max(base.source_captured_at) FILTER (WHERE base.state = 'BUY'::text) AS last_buy_at
           FROM base
          GROUP BY base.policy_id, base.policy_family, base.display_name, base.sport, base.event_id, base.market_type, base.market_side, base.line
        )
 SELECT policy_id,
    policy_family,
    display_name,
    sport,
    event_id,
    starts_at,
    market_type,
    market_side,
    market_label,
    line,
    first_tracked_at,
    first_book,
    first_odds,
    first_price_cost,
    first_state,
    first_robust_ev_pct,
    first_buy_point,
    final_tracked_at,
    final_book,
    final_odds,
    final_price_cost,
    final_state,
    final_robust_ev_pct,
    final_buy_point,
    best_price_cost,
    best_odds_seen,
    snapshot_count,
    buy_snapshot_count,
    first_buy_at,
    last_buy_at,
        CASE
            WHEN first_price_cost IS NULL OR final_price_cost IS NULL THEN NULL::integer
            ELSE first_price_cost - final_price_cost
        END AS wait_change_cents,
        CASE
            WHEN first_price_cost IS NULL OR best_price_cost IS NULL THEN NULL::integer
            ELSE first_price_cost - best_price_cost
        END AS best_improvement_cents,
        CASE
            WHEN first_price_cost IS NULL OR final_price_cost IS NULL THEN 'UNKNOWN'::text
            WHEN (first_price_cost - final_price_cost) > 0 THEN 'IMPROVED'::text
            WHEN (first_price_cost - final_price_cost) < 0 THEN 'WORSENED'::text
            ELSE 'UNCHANGED'::text
        END AS wait_result,
        CASE
            WHEN first_state = 'BUY'::text AND final_state = 'BUY'::text THEN 'STAYED_BUY'::text
            WHEN first_state <> 'BUY'::text AND final_state = 'BUY'::text THEN 'BECAME_BUY'::text
            WHEN first_state = 'BUY'::text AND final_state <> 'BUY'::text THEN 'LOST_BUY_POINT'::text
            WHEN buy_snapshot_count > 0 THEN 'BUY_WINDOW_CLOSED'::text
            ELSE 'NEVER_BUY'::text
        END AS buy_window_result
   FROM agg a;
;
revoke all on table public.market_price_wait_analysis from public, anon, authenticated;
grant select on table public.market_price_wait_analysis to service_role;
