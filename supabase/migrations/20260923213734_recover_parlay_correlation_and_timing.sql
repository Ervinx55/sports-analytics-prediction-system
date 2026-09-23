-- Reconstructed from production catalog on 2026-09-23.
-- Catch-up source for fresh environments; do not replay blindly on current production.

create table if not exists public.parlay_correlation_shadow (
  pair_key text not null,
  first_seen_at timestamp with time zone default now() not null,
  evaluated_at timestamp with time zone default now() not null,
  sport text default 'MLB'::text not null,
  pair_type text not null,
  same_event boolean not null,
  leg_a_kind text not null,
  leg_a_observation_id bigint not null,
  leg_a_event_id text not null,
  leg_a_starts_at timestamp with time zone,
  leg_a_label text not null,
  leg_a_probability numeric,
  leg_a_probability_basis text,
  leg_a_odds integer,
  leg_a_fusion_state text,
  leg_a_raw jsonb default '{}'::jsonb not null,
  leg_b_kind text not null,
  leg_b_observation_id bigint not null,
  leg_b_event_id text not null,
  leg_b_starts_at timestamp with time zone,
  leg_b_label text not null,
  leg_b_probability numeric,
  leg_b_probability_basis text,
  leg_b_odds integer,
  leg_b_fusion_state text,
  leg_b_raw jsonb default '{}'::jsonb not null,
  relation_class text not null,
  direction text not null,
  strength text not null,
  action text not null,
  reason_code text not null,
  reason text not null,
  independent_probability numeric,
  independent_decimal_odds numeric,
  independent_american_odds integer,
  independent_ev_pct numeric,
  shadow_conflict boolean default false not null,
  shadow_conflict_reason text,
  shadow_only boolean default true not null,
  affects_decision boolean default false not null,
  raw jsonb default '{}'::jsonb not null,
  constraint parlay_correlation_shadow_pkey PRIMARY KEY (pair_key)
);
alter table public.parlay_correlation_shadow enable row level security;
revoke all on table public.parlay_correlation_shadow from public, anon, authenticated;
grant select, insert, update, delete on table public.parlay_correlation_shadow to service_role;

CREATE INDEX IF NOT EXISTS parlay_correlation_eval_idx ON public.parlay_correlation_shadow USING btree (evaluated_at DESC);

CREATE INDEX IF NOT EXISTS parlay_correlation_leg_a_idx ON public.parlay_correlation_shadow USING btree (leg_a_kind, leg_a_observation_id);

CREATE INDEX IF NOT EXISTS parlay_correlation_leg_b_idx ON public.parlay_correlation_shadow USING btree (leg_b_kind, leg_b_observation_id);

CREATE INDEX IF NOT EXISTS parlay_correlation_relation_idx ON public.parlay_correlation_shadow USING btree (relation_class, action, evaluated_at DESC);

create table if not exists public.decision_timing_shadow (
  leg_type text not null,
  observation_id bigint not null,
  captured_at timestamp with time zone not null,
  starts_at timestamp with time zone not null,
  minutes_to_start numeric not null,
  timing_bucket text not null,
  sport text default 'MLB'::text not null,
  event_id text not null,
  game_pk bigint,
  label text not null,
  category text,
  side text,
  line numeric,
  player_name text,
  player_role text,
  upstream_status text,
  fusion_state text,
  odds integer,
  book text,
  model_probability numeric,
  market_probability numeric,
  edge_pp numeric,
  ev_pct numeric,
  price_state text,
  robust_ev_pct numeric,
  price_cushion_cents numeric,
  buy_point integer,
  context_ready boolean,
  raw jsonb default '{}'::jsonb not null,
  shadow_only boolean default true not null,
  affects_decision boolean default false not null,
  constraint decision_timing_shadow_leg_type_check CHECK (leg_type = ANY (ARRAY['TEAM'::text, 'PROP'::text])),
  constraint decision_timing_shadow_timing_bucket_check CHECK (timing_bucket = ANY (ARRAY['GT_180'::text, '120_180'::text, '60_120'::text, '30_60'::text, '20_30'::text, 'LT_20'::text])),
  constraint decision_timing_shadow_pkey PRIMARY KEY (leg_type, observation_id)
);
alter table public.decision_timing_shadow enable row level security;
revoke all on table public.decision_timing_shadow from public, anon, authenticated;
grant select, insert, update, delete on table public.decision_timing_shadow to service_role;

CREATE INDEX IF NOT EXISTS decision_timing_bucket_idx ON public.decision_timing_shadow USING btree (leg_type, timing_bucket, captured_at DESC);

CREATE INDEX IF NOT EXISTS decision_timing_event_idx ON public.decision_timing_shadow USING btree (event_id, leg_type, captured_at DESC);

CREATE OR REPLACE FUNCTION public.compute_parlay_correlation_v1(p_leg_a jsonb, p_leg_b jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$;
declare
  a_kind text := upper(coalesce(p_leg_a->>'kind',''));
  b_kind text := upper(coalesce(p_leg_b->>'kind',''));
  a_event text := coalesce(p_leg_a->>'eventId','');
  b_event text := coalesce(p_leg_b->>'eventId','');
  same_event boolean := a_event<>'' and a_event=b_event;

  a_mt text := lower(coalesce(p_leg_a->>'marketType',''));
  b_mt text := lower(coalesce(p_leg_b->>'marketType',''));
  a_side text := lower(coalesce(p_leg_a->>'marketSide',p_leg_a->>'side',''));
  b_side text := lower(coalesce(p_leg_b->>'marketSide',p_leg_b->>'side',''));
  a_line numeric := nullif(p_leg_a->>'line','')::numeric;
  b_line numeric := nullif(p_leg_b->>'line','')::numeric;

  a_stat text := coalesce(p_leg_a->>'statId','');
  b_stat text := coalesce(p_leg_b->>'statId','');
  a_player text := lower(coalesce(p_leg_a->>'playerName',''));
  b_player text := lower(coalesce(p_leg_b->>'playerName',''));
  a_role text := upper(coalesce(p_leg_a->>'playerRole',''));
  b_role text := upper(coalesce(p_leg_b->>'playerRole',''));
  a_pts text := lower(coalesce(p_leg_a->>'playerTeamSide',''));
  b_pts text := lower(coalesce(p_leg_b->>'playerTeamSide',''));

  a_home text := lower(coalesce(p_leg_a->>'homeTeam',''));
  a_away text := lower(coalesce(p_leg_a->>'awayTeam',''));
  b_home text := lower(coalesce(p_leg_b->>'homeTeam',''));
  b_away text := lower(coalesce(p_leg_b->>'awayTeam',''));

  a_selected_team text;
  b_selected_team text;

  relation text := 'UNKNOWN_SAME_GAME';
  direction text := 'UNKNOWN';
  strength text := 'UNKNOWN';
  action text := 'AUDIT_ONLY';
  reason_code text := 'UNCLASSIFIED_SAME_GAME';
  reason text := 'Same-game relationship is not yet covered by a validated structural rule.';
begin
  if a_kind='TEAM' and a_mt in ('moneyline','spread') then
    a_selected_team := case when a_side='home' then a_home when a_side='away' then a_away else null end;
  end if;
  if b_kind='TEAM' and b_mt in ('moneyline','spread') then
    b_selected_team := case when b_side='home' then b_home when b_side='away' then b_away else null end;
  end if;

  if not same_event then
    if (
      (a_home<>'' and (a_home=b_home or a_home=b_away)) or
      (a_away<>'' and (a_away=b_home or a_away=b_away))
    ) then
      relation := 'CROSS_GAME_SHARED_TEAM';
      direction := 'UNKNOWN';
      strength := 'MODERATE';
      action := 'AUDIT_ONLY';
      reason_code := 'SHARED_TEAM_ACROSS_EVENTS';
      reason := 'The legs are from different events but share a team, so roster and doubleheader dependencies make a pure independence assumption unsafe.';
    else
      relation := 'CROSS_GAME_LOW_KNOWN_CORRELATION';
      direction := 'NEUTRAL';
      strength := 'LOW';
      action := 'ALLOW_INDEPENDENCE_ESTIMATE';
      reason_code := 'DIFFERENT_EVENTS_NO_SHARED_TEAM';
      reason := 'The legs are in different events with no shared team. Independence is permitted as an estimate, not asserted as exact statistical independence.';
    end if;

    return jsonb_build_object(
      'evaluatorVersion','parlay-correlation-v1',
      'sameEvent',same_event,
      'relationClass',relation,
      'direction',direction,
      'strength',strength,
      'action',action,
      'reasonCode',reason_code,
      'reason',reason,
      'independenceEstimateAllowed',action='ALLOW_INDEPENDENCE_ESTIMATE',
      'adjustedJointProbability',null,
      'calibrationNeeded',true
    );
  end if;

  -- Exact duplicate selection.
  if a_kind=b_kind
     and coalesce(a_mt,'')=coalesce(b_mt,'')
     and coalesce(a_stat,'')=coalesce(b_stat,'')
     and coalesce(a_player,'')=coalesce(b_player,'')
     and coalesce(a_side,'')=coalesce(b_side,'')
     and (
       (a_line is null and b_line is null)
       or (a_line is not null and b_line is not null and abs(a_line-b_line)<0.001)
     ) then
    relation := 'DUPLICATE_EXPOSURE';
    direction := 'REDUNDANT';
    strength := 'STRONG';
    action := 'BLOCK';
    reason_code := 'SAME_SELECTION_DUPLICATED';
    reason := 'Both legs represent the same underlying selection and must not be counted twice.';

  -- Direct opposite sides of a team moneyline.
  elsif a_kind='TEAM' and b_kind='TEAM'
     and a_mt='moneyline' and b_mt='moneyline'
     and a_side<>b_side and a_side in ('home','away') and b_side in ('home','away') then
    relation := 'HARD_CONFLICT';
    direction := 'NEGATIVE';
    strength := 'STRONG';
    action := 'BLOCK';
    reason_code := 'OPPOSITE_MONEYLINE_SIDES';
    reason := 'Opposite moneyline sides in the same game cannot both win.';

  -- Opposite total sides at same line.
  elsif a_kind='TEAM' and b_kind='TEAM'
     and a_mt='total' and b_mt='total'
     and a_side<>b_side
     and a_line is not null and b_line is not null and abs(a_line-b_line)<0.001 then
    relation := 'HARD_CONFLICT';
    direction := 'NEGATIVE';
    strength := 'STRONG';
    action := 'BLOCK';
    reason_code := 'OPPOSITE_TOTAL_SIDES_SAME_LINE';
    reason := 'Over and under at the same game-total line cannot both win.';

  -- Opposite spread sides of the same handicap.
  elsif a_kind='TEAM' and b_kind='TEAM'
     and a_mt='spread' and b_mt='spread'
     and a_side<>b_side
     and a_line is not null and b_line is not null and abs(a_line+b_line)<0.001 then
    relation := 'HARD_CONFLICT';
    direction := 'NEGATIVE';
    strength := 'STRONG';
    action := 'BLOCK';
    reason_code := 'OPPOSITE_SPREAD_SIDES';
    reason := 'The two legs are opposite sides of the same spread market.';

  -- Same prop, opposite sides at same line.
  elsif a_kind='PROP' and b_kind='PROP'
     and a_player=b_player and a_player<>''
     and a_stat=b_stat and a_stat<>''
     and a_side<>b_side
     and a_line is not null and b_line is not null and abs(a_line-b_line)<0.001 then
    relation := 'HARD_CONFLICT';
    direction := 'NEGATIVE';
    strength := 'STRONG';
    action := 'BLOCK';
    reason_code := 'OPPOSITE_PROP_SIDES_SAME_LINE';
    reason := 'Opposite sides of the same player prop at the same line cannot both win.';

  -- Same player/same stat, overlapping same-side alternate lines.
  elsif a_kind='PROP' and b_kind='PROP'
     and a_player=b_player and a_player<>''
     and a_stat=b_stat and a_stat<>''
     and a_side=b_side
     and a_line is not null and b_line is not null then
    relation := 'REDUNDANT_EXPOSURE';
    direction := 'POSITIVE';
    strength := 'STRONG';
    action := 'BLOCK';
    reason_code := 'NESTED_ALTERNATE_LINES_SAME_PROP';
    reason := 'Same-side alternate lines on the same player/stat are nested outcomes and should not be treated as separate independent legs.';

  -- Hits 0.5 and total bases 0.5 are outcome-equivalent for the same player and side.
  elsif a_kind='PROP' and b_kind='PROP'
     and a_player=b_player and a_player<>''
     and a_side=b_side
     and a_line is not null and b_line is not null
     and abs(a_line-0.5)<0.001 and abs(b_line-0.5)<0.001
     and (
       (a_stat='batting_hits' and b_stat='batting_totalBases')
       or (a_stat='batting_totalBases' and b_stat='batting_hits')
     ) then
    relation := 'REDUNDANT_EXPOSURE';
    direction := 'POSITIVE';
    strength := 'STRONG';
    action := 'BLOCK';
    reason_code := 'HITS_TB_POINT5_EQUIVALENT';
    reason := 'For the same hitter at 0.5, Hits and Total Bases resolve from the same hit/no-hit event and should not be doubled.';

  -- Same hitter, hits and total bases move together.
  elsif a_kind='PROP' and b_kind='PROP'
     and a_player=b_player and a_player<>''
     and (
       (a_stat='batting_hits' and b_stat='batting_totalBases')
       or (a_stat='batting_totalBases' and b_stat='batting_hits')
     ) then
    if a_side=b_side then
      relation := 'POSITIVE_CORRELATION';
      direction := 'POSITIVE';
      strength := 'STRONG';
      reason_code := 'SAME_HITTER_HITS_TOTAL_BASES_SAME_DIRECTION';
      reason := 'Hits and total bases for the same hitter share the same underlying offensive outcomes.';
    else
      relation := 'NEGATIVE_CORRELATION';
      direction := 'NEGATIVE';
      strength := 'STRONG';
      reason_code := 'SAME_HITTER_HITS_TOTAL_BASES_OPPOSITE_DIRECTION';
      reason := 'Opposite directions on the same hitter’s hits and total bases create strong outcome tension.';
    end if;

  -- Team moneyline + same-team spread.
  elsif a_kind='TEAM' and b_kind='TEAM'
     and a_mt in ('moneyline','spread') and b_mt in ('moneyline','spread')
     and a_selected_team is not null and b_selected_team is not null then
    if a_selected_team=b_selected_team then
      relation := 'POSITIVE_CORRELATION';
      direction := 'POSITIVE';
      strength := 'STRONG';
      reason_code := 'SAME_TEAM_ML_SPREAD';
      reason := 'Moneyline and spread positions on the same team share the same game outcome and are strongly correlated.';
    else
      relation := 'NEGATIVE_CORRELATION';
      direction := 'NEGATIVE';
      strength := 'STRONG';
      reason_code := 'OPPOSING_TEAM_ML_SPREAD';
      reason := 'Moneyline/spread positions on opposing teams create strong outcome tension.';
    end if;

  -- Game total + hitter offense prop.
  elsif (
      a_kind='TEAM' and a_mt='total' and b_kind='PROP' and b_role='HITTER'
    ) or (
      b_kind='TEAM' and b_mt='total' and a_kind='PROP' and a_role='HITTER'
    ) then
    if a_kind='TEAM' then
      if a_side=b_side then
        relation := 'POSITIVE_CORRELATION'; direction := 'POSITIVE'; strength := 'MODERATE';
        reason_code := 'TOTAL_AND_HITTER_PROP_SAME_DIRECTION';
        reason := 'A higher-scoring game environment generally supports hitter overs, while a lower-scoring environment generally supports hitter unders.';
      else
        relation := 'NEGATIVE_CORRELATION'; direction := 'NEGATIVE'; strength := 'MODERATE';
        reason_code := 'TOTAL_AND_HITTER_PROP_OPPOSITE_DIRECTION';
        reason := 'The game-total direction and hitter-prop direction rely on opposing scoring environments.';
      end if;
    else
      if b_side=a_side then
        relation := 'POSITIVE_CORRELATION'; direction := 'POSITIVE'; strength := 'MODERATE';
        reason_code := 'TOTAL_AND_HITTER_PROP_SAME_DIRECTION';
        reason := 'A higher-scoring game environment generally supports hitter overs, while a lower-scoring environment generally supports hitter unders.';
      else
        relation := 'NEGATIVE_CORRELATION'; direction := 'NEGATIVE'; strength := 'MODERATE';
        reason_code := 'TOTAL_AND_HITTER_PROP_OPPOSITE_DIRECTION';
        reason := 'The game-total direction and hitter-prop direction rely on opposing scoring environments.';
      end if;
    end if;

  -- Game total + pitcher strikeouts: lower-scoring conditions generally support K overs / upper-scoring conditions support K unders.
  elsif (
      a_kind='TEAM' and a_mt='total' and b_kind='PROP' and b_stat='pitching_strikeouts'
    ) or (
      b_kind='TEAM' and b_mt='total' and a_kind='PROP' and a_stat='pitching_strikeouts'
    ) then
    if a_kind='TEAM' then
      if (a_side='under' and b_side='over') or (a_side='over' and b_side='under') then
        relation := 'POSITIVE_CORRELATION'; direction := 'POSITIVE'; strength := 'MODERATE';
        reason_code := 'TOTAL_AND_PITCHER_K_COMPLEMENTARY';
        reason := 'Lower-scoring environments tend to support pitcher strikeout overs and higher-scoring environments tend to support strikeout unders.';
      else
        relation := 'NEGATIVE_CORRELATION'; direction := 'NEGATIVE'; strength := 'MODERATE';
        reason_code := 'TOTAL_AND_PITCHER_K_TENSION';
        reason := 'The total and pitcher-strikeout directions depend on opposing run-prevention environments.';
      end if;
    else
      if (b_side='under' and a_side='over') or (b_side='over' and a_side='under') then
        relation := 'POSITIVE_CORRELATION'; direction := 'POSITIVE'; strength := 'MODERATE';
        reason_code := 'TOTAL_AND_PITCHER_K_COMPLEMENTARY';
        reason := 'Lower-scoring environments tend to support pitcher strikeout overs and higher-scoring environments tend to support strikeout unders.';
      else
        relation := 'NEGATIVE_CORRELATION'; direction := 'NEGATIVE'; strength := 'MODERATE';
        reason_code := 'TOTAL_AND_PITCHER_K_TENSION';
        reason := 'The total and pitcher-strikeout directions depend on opposing run-prevention environments.';
      end if;
    end if;

  -- Opposing pitcher K and hitter offense.
  elsif a_kind='PROP' and b_kind='PROP'
     and (
       (a_role='PITCHER' and b_role='HITTER' and a_pts<>'' and b_pts<>'' and a_pts<>b_pts)
       or
       (b_role='PITCHER' and a_role='HITTER' and a_pts<>'' and b_pts<>'' and a_pts<>b_pts)
     ) then
    if a_role='PITCHER' then
      if a_side=b_side then
        relation := 'NEGATIVE_CORRELATION'; direction := 'NEGATIVE'; strength := 'MODERATE';
        reason_code := 'OPPOSING_PITCHER_K_HITTER_OFFENSE_TENSION';
        reason := 'An opposing pitcher strikeout over and hitter offense over compete for the same plate-appearance outcomes; the reverse pairing has similar tension.';
      else
        relation := 'POSITIVE_CORRELATION'; direction := 'POSITIVE'; strength := 'MODERATE';
        reason_code := 'OPPOSING_PITCHER_K_HITTER_OFFENSE_COMPLEMENT';
        reason := 'Pitcher-K and opposing-hitter directions are structurally complementary.';
      end if;
    else
      if b_side=a_side then
        relation := 'NEGATIVE_CORRELATION'; direction := 'NEGATIVE'; strength := 'MODERATE';
        reason_code := 'OPPOSING_PITCHER_K_HITTER_OFFENSE_TENSION';
        reason := 'An opposing pitcher strikeout over and hitter offense over compete for the same plate-appearance outcomes; the reverse pairing has similar tension.';
      else
        relation := 'POSITIVE_CORRELATION'; direction := 'POSITIVE'; strength := 'MODERATE';
        reason_code := 'OPPOSING_PITCHER_K_HITTER_OFFENSE_COMPLEMENT';
        reason := 'Pitcher-K and opposing-hitter directions are structurally complementary.';
      end if;
    end if;

  -- Two different hitter offense props in same game share run environment.
  elsif a_kind='PROP' and b_kind='PROP'
     and a_role='HITTER' and b_role='HITTER'
     and a_player<>b_player then
    if a_side=b_side then
      relation := 'POSITIVE_CORRELATION';
      direction := 'POSITIVE';
      strength := 'WEAK';
      reason_code := 'SAME_GAME_HITTERS_SHARED_RUN_ENVIRONMENT';
      reason := 'Different hitters in the same game share park, weather, bullpen, and run-environment factors.';
    else
      relation := 'NEGATIVE_CORRELATION';
      direction := 'NEGATIVE';
      strength := 'WEAK';
      reason_code := 'SAME_GAME_HITTERS_OPPOSITE_DIRECTIONS';
      reason := 'Opposite hitter-prop directions share the same run environment but point in opposite directions.';
    end if;
  end if;

  return jsonb_build_object(
    'evaluatorVersion','parlay-correlation-v1',
    'sameEvent',same_event,
    'relationClass',relation,
    'direction',direction,
    'strength',strength,
    'action',action,
    'reasonCode',reason_code,
    'reason',reason,
    'independenceEstimateAllowed',action='ALLOW_INDEPENDENCE_ESTIMATE',
    'adjustedJointProbability',null,
    'calibrationNeeded',action<>'BLOCK'
  );
end;
$function$;
revoke execute on function public.compute_parlay_correlation_v1(p_leg_a jsonb, p_leg_b jsonb) from public, anon, authenticated;
grant execute on function public.compute_parlay_correlation_v1(p_leg_a jsonb, p_leg_b jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.refresh_parlay_correlation_shadow()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$;
declare
  r record;
  v_rel jsonb;
  v_pair_key text;
  v_pair_type text;
  v_prob numeric;
  v_dec numeric;
  v_ev numeric;
  v_conflict boolean;
  v_conflict_reason text;
  v_count integer := 0;
begin
  for r in
    with team_legs as (
      select
        'TEAM'::text as kind,
        g.id::bigint as observation_id,
        g.event_id,
        g.game_pk,
        g.starts_at,
        g.away_team,
        g.home_team,
        g.market_label as label,
        g.market_type,
        g.market_side,
        g.line,
        null::text as player_name,
        null::text as player_role,
        null::text as player_team_side,
        null::text as stat_id,
        coalesce(u.conservative_probability,g.model_probability) as probability,
        case when u.conservative_probability is not null
             then 'UNCERTAINTY_CONSERVATIVE'
             else 'MODEL_PROBABILITY' end as probability_basis,
        g.best_odds as odds,
        f.fusion_state,
        jsonb_build_object(
          'kind','TEAM',
          'observationId',g.id,
          'eventId',g.event_id,
          'gamePk',g.game_pk,
          'startsAt',g.starts_at,
          'awayTeam',g.away_team,
          'homeTeam',g.home_team,
          'label',g.market_label,
          'marketType',g.market_type,
          'marketSide',g.market_side,
          'line',g.line,
          'probability',coalesce(u.conservative_probability,g.model_probability),
          'probabilityBasis',case when u.conservative_probability is not null then 'UNCERTAINTY_CONSERVATIVE' else 'MODEL_PROBABILITY' end,
          'odds',g.best_odds,
          'fusionState',f.fusion_state
        ) as leg_json
      from public.market_grade_latest g
      left join public.market_uncertainty_latest u on u.observation_id=g.id
      left join public.market_decision_fusion_latest f on f.observation_id=g.id
      join lateral (
        select s.*
        from public.sharp_gate_latest s
        where s.event_id=g.event_id
          and s.market_type=g.market_type
          and s.market_side=g.market_side
          and (
            (s.market_line is null and g.line is null)
            or (s.market_line is not null and g.line is not null and abs(s.market_line-g.line)<0.001)
          )
        order by s.checked_at desc,s.id desc
        limit 1
      ) sg on true
      where g.sport='MLB'
        and g.non_sharp_status='READY_FOR_SHARP_CHECK'
        and sg.final_status='FINAL_PLAY'
        and g.starts_at>now()
        and g.starts_at<=now()+interval '36 hours'
    ),
    prop_legs as (
      select
        'PROP'::text as kind,
        p.id::bigint as observation_id,
        p.event_id,
        p.game_pk,
        p.starts_at,
        p.away_team,
        p.home_team,
        p.label,
        null::text as market_type,
        p.side as market_side,
        p.line,
        p.player_name,
        coalesce(f.player_role,
          case when p.stat_id like 'pitching_%' then 'PITCHER' else 'HITTER' end
        ) as player_role,
        v.player_team_side,
        p.stat_id,
        p.model_probability as probability,
        'MARKET_SHRUNK_PROP_MODEL'::text as probability_basis,
        p.best_odds as odds,
        f.fusion_state,
        jsonb_build_object(
          'kind','PROP',
          'observationId',p.id,
          'eventId',p.event_id,
          'gamePk',p.game_pk,
          'startsAt',p.starts_at,
          'awayTeam',p.away_team,
          'homeTeam',p.home_team,
          'label',p.label,
          'playerName',p.player_name,
          'playerRole',coalesce(f.player_role,case when p.stat_id like 'pitching_%' then 'PITCHER' else 'HITTER' end),
          'playerTeamSide',v.player_team_side,
          'statId',p.stat_id,
          'side',p.side,
          'line',p.line,
          'probability',p.model_probability,
          'probabilityBasis','MARKET_SHRUNK_PROP_MODEL',
          'odds',p.best_odds,
          'fusionState',f.fusion_state
        ) as leg_json
      from public.player_prop_latest p
      left join public.player_prop_decision_fusion_latest f on f.observation_id=p.id
      left join public.player_prop_verification_latest v on v.observation_id=p.id
      where p.sport='MLB'
        and p.status='PLAY'
        and p.starts_at>now()
        and p.starts_at<=now()+interval '36 hours'
    ),
    legs as (
      select * from team_legs
      union all
      select * from prop_legs
    ),
    ranked as (
      select *,
        row_number() over (
          order by starts_at,kind,observation_id
        ) as rn
      from legs
      where probability is not null
        and odds is not null
    )
    select
      a.kind as a_kind,a.observation_id as a_id,a.event_id as a_event,a.starts_at as a_starts,
      a.label as a_label,a.probability as a_prob,a.probability_basis as a_prob_basis,
      a.odds as a_odds,a.fusion_state as a_fusion,a.leg_json as a_json,
      b.kind as b_kind,b.observation_id as b_id,b.event_id as b_event,b.starts_at as b_starts,
      b.label as b_label,b.probability as b_prob,b.probability_basis as b_prob_basis,
      b.odds as b_odds,b.fusion_state as b_fusion,b.leg_json as b_json
    from ranked a
    join ranked b on a.rn<b.rn
    limit 2000
  loop
    v_rel := public.compute_parlay_correlation_v1(r.a_json,r.b_json);
    v_pair_type := case
      when r.a_kind='TEAM' and r.b_kind='TEAM' then 'TEAM_TEAM'
      when r.a_kind='PROP' and r.b_kind='PROP' then 'PROP_PROP'
      else 'MIXED'
    end;
    v_pair_key := case
      when r.a_kind||':'||r.a_id::text < r.b_kind||':'||r.b_id::text
        then r.a_kind||':'||r.a_id::text||'|'||r.b_kind||':'||r.b_id::text
      else r.b_kind||':'||r.b_id::text||'|'||r.a_kind||':'||r.a_id::text
    end;

    v_prob := null;
    v_dec := null;
    v_ev := null;

    if coalesce((v_rel->>'independenceEstimateAllowed')::boolean,false)
       and r.a_prob between 0 and 1
       and r.b_prob between 0 and 1 then
      v_prob := r.a_prob*r.b_prob;
      v_dec := public.american_to_decimal_v1(r.a_odds) * public.american_to_decimal_v1(r.b_odds);
      if v_dec is not null then
        v_ev := (v_prob*v_dec-1)*100;
      end if;
    end if;

    v_conflict := coalesce(r.a_fusion,'') in ('PASS','REMODEL','WAIT','HOLD_PRICE')
               or coalesce(r.b_fusion,'') in ('PASS','REMODEL','WAIT','HOLD_PRICE');
    v_conflict_reason := case
      when v_conflict then 'At least one leg has a shadow fusion state that is not PLAY_CANDIDATE/WATCH.'
      else null
    end;

    insert into public.parlay_correlation_shadow (
      pair_key,first_seen_at,evaluated_at,sport,pair_type,same_event,
      leg_a_kind,leg_a_observation_id,leg_a_event_id,leg_a_starts_at,leg_a_label,
      leg_a_probability,leg_a_probability_basis,leg_a_odds,leg_a_fusion_state,leg_a_raw,
      leg_b_kind,leg_b_observation_id,leg_b_event_id,leg_b_starts_at,leg_b_label,
      leg_b_probability,leg_b_probability_basis,leg_b_odds,leg_b_fusion_state,leg_b_raw,
      relation_class,direction,strength,action,reason_code,reason,
      independent_probability,independent_decimal_odds,independent_american_odds,independent_ev_pct,
      shadow_conflict,shadow_conflict_reason,shadow_only,affects_decision,raw
    ) values (
      v_pair_key,now(),now(),'MLB',v_pair_type,coalesce((v_rel->>'sameEvent')::boolean,false),
      r.a_kind,r.a_id,r.a_event,r.a_starts,r.a_label,
      r.a_prob,r.a_prob_basis,r.a_odds,r.a_fusion,r.a_json,
      r.b_kind,r.b_id,r.b_event,r.b_starts,r.b_label,
      r.b_prob,r.b_prob_basis,r.b_odds,r.b_fusion,r.b_json,
      v_rel->>'relationClass',v_rel->>'direction',v_rel->>'strength',v_rel->>'action',
      v_rel->>'reasonCode',v_rel->>'reason',
      v_prob,v_dec,case when v_dec is not null then public.decimal_to_american_v1(v_dec) else null end,v_ev,
      v_conflict,v_conflict_reason,true,false,
      jsonb_build_object('evaluatorVersion','parlay-correlation-v1','relation',v_rel)
    )
    on conflict (pair_key) do update
    set
      evaluated_at=excluded.evaluated_at,
      leg_a_probability=excluded.leg_a_probability,
      leg_a_probability_basis=excluded.leg_a_probability_basis,
      leg_a_odds=excluded.leg_a_odds,
      leg_a_fusion_state=excluded.leg_a_fusion_state,
      leg_a_raw=excluded.leg_a_raw,
      leg_b_probability=excluded.leg_b_probability,
      leg_b_probability_basis=excluded.leg_b_probability_basis,
      leg_b_odds=excluded.leg_b_odds,
      leg_b_fusion_state=excluded.leg_b_fusion_state,
      leg_b_raw=excluded.leg_b_raw,
      relation_class=excluded.relation_class,
      direction=excluded.direction,
      strength=excluded.strength,
      action=excluded.action,
      reason_code=excluded.reason_code,
      reason=excluded.reason,
      independent_probability=excluded.independent_probability,
      independent_decimal_odds=excluded.independent_decimal_odds,
      independent_american_odds=excluded.independent_american_odds,
      independent_ev_pct=excluded.independent_ev_pct,
      shadow_conflict=excluded.shadow_conflict,
      shadow_conflict_reason=excluded.shadow_conflict_reason,
      raw=excluded.raw,
      shadow_only=true,
      affects_decision=false;

    v_count := v_count+1;
  end loop;

  return v_count;
end;
$function$;
revoke execute on function public.refresh_parlay_correlation_shadow() from public, anon, authenticated;
grant execute on function public.refresh_parlay_correlation_shadow() to service_role;

CREATE OR REPLACE FUNCTION public.trigger_parlay_correlation_shadow()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$;
  select public.refresh_parlay_correlation_shadow();
$function$;
revoke execute on function public.trigger_parlay_correlation_shadow() from public, anon, authenticated;
grant execute on function public.trigger_parlay_correlation_shadow() to service_role;

CREATE OR REPLACE FUNCTION public.decision_timing_bucket_v1(p_starts_at timestamp with time zone, p_captured_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog', 'public'
AS $function$;
declare
  v_minutes numeric;
begin
  v_minutes := extract(epoch from (p_starts_at-p_captured_at))/60.0;
  if v_minutes < 0 then return 'POST_START';
  elsif v_minutes < 20 then return 'LT_20';
  elsif v_minutes < 30 then return '20_30';
  elsif v_minutes < 60 then return '30_60';
  elsif v_minutes < 120 then return '60_120';
  elsif v_minutes < 180 then return '120_180';
  else return 'GT_180';
  end if;
end;
$function$;
revoke execute on function public.decision_timing_bucket_v1(p_starts_at timestamp with time zone, p_captured_at timestamp with time zone) from public, anon, authenticated;
grant execute on function public.decision_timing_bucket_v1(p_starts_at timestamp with time zone, p_captured_at timestamp with time zone) to service_role;

CREATE OR REPLACE FUNCTION public.refresh_decision_timing_shadow()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$;
declare
  v_team integer := 0;
  v_prop integer := 0;
begin
  insert into public.decision_timing_shadow (
    leg_type,observation_id,captured_at,starts_at,minutes_to_start,timing_bucket,
    sport,event_id,game_pk,label,category,side,line,
    upstream_status,fusion_state,odds,book,model_probability,market_probability,
    edge_pp,ev_pct,price_state,robust_ev_pct,price_cushion_cents,buy_point,
    context_ready,raw,shadow_only,affects_decision
  )
  select
    'TEAM',
    p.observation_id,
    p.source_captured_at,
    p.starts_at,
    round((extract(epoch from (p.starts_at-p.source_captured_at))/60.0)::numeric,2),
    public.decision_timing_bucket_v1(p.starts_at,p.source_captured_at),
    p.sport,
    p.event_id,
    g.game_pk,
    p.market_label,
    p.market_type,
    p.market_side,
    p.line,
    g.non_sharp_status,
    f.fusion_state,
    p.current_odds,
    p.current_book,
    p.model_probability,
    g.market_fair_probability,
    g.edge_pct_points,
    g.ev_pct,
    p.state,
    p.current_robust_ev_pct,
    p.price_cushion_cents,
    p.max_playable_odds,
    coalesce(v.state='READY',false)
      and coalesce(w.state not in ('PENDING','REMODEL','WEATHER_RISK'),false),
    jsonb_build_object(
      'evaluatorVersion','decision-timing-v1',
      'policyId',p.policy_id,
      'priceStrength',p.strength,
      'verificationState',v.state,
      'weatherState',w.state,
      'sharpClassification',f.sharp_classification
    ),
    true,false
  from public.market_price_sensitivity_shadow p
  join public.market_grade_observations g on g.id=p.observation_id
  left join public.market_decision_fusion_shadow f on f.observation_id=p.observation_id
  left join public.team_market_verification_shadow v on v.observation_id=p.observation_id
  left join public.team_market_weather_shadow w on w.observation_id=p.observation_id
  where p.policy_id in ('ML_BALANCED','RL_BALANCED','TOT_BALANCED')
    and p.starts_at is not null
    and p.source_captured_at < p.starts_at
    and p.source_captured_at >= now()-interval '14 days'
  on conflict (leg_type,observation_id) do update
  set
    captured_at=excluded.captured_at,
    starts_at=excluded.starts_at,
    minutes_to_start=excluded.minutes_to_start,
    timing_bucket=excluded.timing_bucket,
    upstream_status=excluded.upstream_status,
    fusion_state=excluded.fusion_state,
    odds=excluded.odds,
    book=excluded.book,
    model_probability=excluded.model_probability,
    market_probability=excluded.market_probability,
    edge_pp=excluded.edge_pp,
    ev_pct=excluded.ev_pct,
    price_state=excluded.price_state,
    robust_ev_pct=excluded.robust_ev_pct,
    price_cushion_cents=excluded.price_cushion_cents,
    buy_point=excluded.buy_point,
    context_ready=excluded.context_ready,
    raw=excluded.raw;

  get diagnostics v_team = row_count;

  insert into public.decision_timing_shadow (
    leg_type,observation_id,captured_at,starts_at,minutes_to_start,timing_bucket,
    sport,event_id,game_pk,label,category,side,line,player_name,player_role,
    upstream_status,fusion_state,odds,book,model_probability,market_probability,
    edge_pp,ev_pct,context_ready,raw,shadow_only,affects_decision
  )
  select
    'PROP',
    p.id,
    p.captured_at,
    p.starts_at,
    round((extract(epoch from (p.starts_at-p.captured_at))/60.0)::numeric,2),
    public.decision_timing_bucket_v1(p.starts_at,p.captured_at),
    p.sport,
    p.event_id,
    p.game_pk,
    p.label,
    p.stat_id,
    p.side,
    p.line,
    p.player_name,
    coalesce(f.player_role,case when p.stat_id like 'pitching_%' then 'PITCHER' else 'HITTER' end),
    p.status,
    f.fusion_state,
    p.best_odds,
    p.best_book,
    p.model_probability,
    p.market_fair_probability,
    p.edge_pct_points,
    p.ev_pct,
    coalesce(v.state='READY',false)
      and coalesce(w.state not in ('PENDING','REMODEL','WEATHER_RISK'),false),
    jsonb_build_object(
      'evaluatorVersion','decision-timing-v1',
      'dataQuality',p.data_quality,
      'exactLineBookCount',p.exact_line_book_count,
      'pairedBooks',p.paired_books,
      'verificationState',v.state,
      'weatherState',w.state
    ),
    true,false
  from public.player_prop_observations p
  left join public.player_prop_decision_fusion_shadow f on f.observation_id=p.id
  left join public.player_prop_verification_shadow v on v.observation_id=p.id
  left join public.player_prop_weather_shadow w on w.observation_id=p.id
  where p.sport='MLB'
    and p.starts_at is not null
    and p.captured_at < p.starts_at
    and p.captured_at >= now()-interval '14 days'
  on conflict (leg_type,observation_id) do update
  set
    captured_at=excluded.captured_at,
    starts_at=excluded.starts_at,
    minutes_to_start=excluded.minutes_to_start,
    timing_bucket=excluded.timing_bucket,
    upstream_status=excluded.upstream_status,
    fusion_state=excluded.fusion_state,
    odds=excluded.odds,
    book=excluded.book,
    model_probability=excluded.model_probability,
    market_probability=excluded.market_probability,
    edge_pp=excluded.edge_pp,
    ev_pct=excluded.ev_pct,
    context_ready=excluded.context_ready,
    raw=excluded.raw;

  get diagnostics v_prop = row_count;
  return v_team+v_prop;
end;
$function$;
revoke execute on function public.refresh_decision_timing_shadow() from public, anon, authenticated;
grant execute on function public.refresh_decision_timing_shadow() to service_role;

CREATE OR REPLACE FUNCTION public.trigger_decision_timing_shadow()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$;
  select public.refresh_decision_timing_shadow();
$function$;
revoke execute on function public.trigger_decision_timing_shadow() from public, anon, authenticated;
grant execute on function public.trigger_decision_timing_shadow() to service_role;

create or replace view public.parlay_correlation_latest with (security_invoker = true) as
SELECT pair_key,
    first_seen_at,
    evaluated_at,
    sport,
    pair_type,
    same_event,
    leg_a_kind,
    leg_a_observation_id,
    leg_a_event_id,
    leg_a_starts_at,
    leg_a_label,
    leg_a_probability,
    leg_a_probability_basis,
    leg_a_odds,
    leg_a_fusion_state,
    leg_a_raw,
    leg_b_kind,
    leg_b_observation_id,
    leg_b_event_id,
    leg_b_starts_at,
    leg_b_label,
    leg_b_probability,
    leg_b_probability_basis,
    leg_b_odds,
    leg_b_fusion_state,
    leg_b_raw,
    relation_class,
    direction,
    strength,
    action,
    reason_code,
    reason,
    independent_probability,
    independent_decimal_odds,
    independent_american_odds,
    independent_ev_pct,
    shadow_conflict,
    shadow_conflict_reason,
    shadow_only,
    affects_decision,
    raw
   FROM parlay_correlation_shadow
  WHERE GREATEST(COALESCE(leg_a_starts_at, '1970-01-01 00:00:00+00'::timestamp with time zone), COALESCE(leg_b_starts_at, '1970-01-01 00:00:00+00'::timestamp with time zone)) > now();
;
revoke all on table public.parlay_correlation_latest from public, anon, authenticated;
grant select on table public.parlay_correlation_latest to service_role;

create or replace view public.decision_timing_latest with (security_invoker = true) as
SELECT leg_type,
    observation_id,
    captured_at,
    starts_at,
    minutes_to_start,
    timing_bucket,
    sport,
    event_id,
    game_pk,
    label,
    category,
    side,
    line,
    player_name,
    player_role,
    upstream_status,
    fusion_state,
    odds,
    book,
    model_probability,
    market_probability,
    edge_pp,
    ev_pct,
    price_state,
    robust_ev_pct,
    price_cushion_cents,
    buy_point,
    context_ready,
    raw,
    shadow_only,
    affects_decision
   FROM decision_timing_shadow
  WHERE starts_at > now();
;
revoke all on table public.decision_timing_latest from public, anon, authenticated;
grant select on table public.decision_timing_latest to service_role;
