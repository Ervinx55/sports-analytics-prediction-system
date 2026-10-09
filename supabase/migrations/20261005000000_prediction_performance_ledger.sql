-- Append-only performance data. No existing model weights or betting gates change.
create table public.performance_events (
 sport text not null check (sport in ('MLB','NFL','NBA','CFB')),
 event_key text not null,
 eligibility_starts_at timestamptz not null,
 primary key(sport,event_key)
);
create table public.performance_event_mappings (
 id uuid primary key default gen_random_uuid(), sport text not null, event_key text not null,
 provider text not null, source_event_id text not null,
 provenance jsonb not null, unique(sport,provider,source_event_id),
 foreign key(sport,event_key) references public.performance_events(sport,event_key)
);
create table public.performance_start_revisions (
 id uuid primary key default gen_random_uuid(), sport text not null, event_key text not null,
 starts_at timestamptz not null, observed_at timestamptz not null,
 unique(sport,event_key,starts_at),
 foreign key(sport,event_key) references public.performance_events(sport,event_key)
);
create table public.performance_predictions (
 id uuid primary key default gen_random_uuid(), source_key text not null unique,
 sport text, event_key text, player_key text, market_type text, side text, line numeric,
 model_version text, model_mode text, model_available boolean not null default false,
 captured_at timestamptz, starts_at timestamptz, eligibility_starts_at timestamptz, quote_at timestamptz,
 model_probability numeric, market_probability numeric, push_probability numeric,
 odds numeric, book text, probability_basis text, settlement_rule jsonb,
 source_ids jsonb not null, provenance jsonb not null,
 market_key text not null, eligibility_reasons jsonb not null, valid boolean not null,
 payload jsonb not null,
 foreign key(sport,event_key) references public.performance_events(sport,event_key),
 check (not valid or (model_available and captured_at < eligibility_starts_at and quote_at <= captured_at
   and model_probability between 0 and 1 and market_probability between 0 and 1 and eligibility_reasons = '[]'::jsonb))
);
create index performance_predictions_market_capture on public.performance_predictions(market_key,captured_at desc);
create table public.performance_decisions (
 id uuid primary key default gen_random_uuid(), source_key text not null unique,
 prediction_id uuid not null references public.performance_predictions(id), market_key text not null,
 issued_at timestamptz not null, status text not null check(status in ('PLAY','PASS','PENDING')),
 qualified boolean not null, evidence jsonb not null, legacy_reconstructed boolean not null,
 first_issued boolean not null default false, payload jsonb not null, check(not qualified or status = 'PLAY'), check(not first_issued or (status = 'PLAY' and qualified and not legacy_reconstructed))
);
-- Portfolio lock spans snapshots. Shadow candidates and reconstructed history never consume it.
create unique index performance_first_play on public.performance_decisions(market_key)
 where first_issued;
create table public.performance_settlements (
 id uuid primary key default gen_random_uuid(), prediction_id uuid not null references public.performance_predictions(id),
 revision integer not null check(revision > 0), outcome text not null check(outcome in ('WIN','LOSS','PUSH','VOID','UNRESOLVED')),
 actual_value numeric, away_score numeric, home_score numeric, source text not null,
 source_updated_at timestamptz not null, settled_at timestamptz not null, rule_version text not null,
 reason text, supersedes_revision integer, payload jsonb not null,
 unique(prediction_id,revision), foreign key(prediction_id,supersedes_revision) references public.performance_settlements(prediction_id,revision),
 check(supersedes_revision is null or supersedes_revision < revision)
);
create function public.performance_immutable_v1() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'performance ledger is append-only' using errcode = '42501'; end $$;
do $$ declare t text; begin
 foreach t in array array['performance_events','performance_event_mappings','performance_start_revisions','performance_predictions','performance_decisions','performance_settlements'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public, anon, authenticated, service_role',t);
  execute format('grant select, insert on public.%I to service_role',t);
  execute format('create trigger immutable before update or delete on public.%I for each row execute function public.performance_immutable_v1()',t);
 end loop;
end $$;
-- Safe casts keep malformed source rows diagnosable instead of coercing nulls to zero.
create function public.performance_number_v1(value jsonb) returns numeric language plpgsql immutable set search_path = '' as $$
declare parsed numeric;
begin
 if jsonb_typeof(value) not in ('number','string') or value is null then return null; end if;
 parsed := nullif(btrim(value #>> '{}'),'')::numeric;
 if parsed::text in ('NaN','Infinity','-Infinity') then return null; end if;
 return parsed;
exception when others then return null;
end $$;
create function public.performance_time_v1(value text) returns timestamptz language plpgsql immutable set search_path = '' as $$
begin
 if value is null or value !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then return null; end if;
 return value::timestamptz;
exception when others then return null;
end $$;
create function public.ingest_prediction_v1(payload jsonb) returns uuid language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_variable
declare p jsonb := payload; existing public.performance_predictions; result uuid;
 sport text := p->>'sport'; event text := nullif(p->>'eventKey','');
 capture timestamptz := public.performance_time_v1(p->>'capturedAt');
 start_time timestamptz := public.performance_time_v1(p->>'startsAt');
 original timestamptz := least(public.performance_time_v1(p->>'eligibilityStartsAt'),start_time);
 canonical_start timestamptz;
 quote timestamptz := public.performance_time_v1(p->>'quoteAt');
 model numeric := public.performance_number_v1(p->'modelProbability'); market numeric := public.performance_number_v1(p->'marketProbability');
 push numeric := public.performance_number_v1(p->'pushProbability'); reasons jsonb := '[]'; key text; minutes numeric; max_age integer;
begin
 if jsonb_typeof(p) <> 'object' or nullif(btrim(p->>'sourceKey'),'') is null then raise exception 'sourceKey required' using errcode='23514'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('prediction:' || (p->>'sourceKey'),0));
 select * into existing from public.performance_predictions where source_key = p->>'sourceKey';
 if found then
  if existing.payload <> p then raise exception 'sourceKey payload conflict' using errcode='23505'; end if;
  return existing.id;
 end if;
 -- Lock/read existing canonical state, but diagnostics must not create it.
 if sport in ('MLB','NFL','NBA','CFB') and event is not null and start_time is not null then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('event:' || sport || ':' || event,0));
  select e.eligibility_starts_at into canonical_start from public.performance_events e where e.sport = sport and e.event_key = event;
  original := least(original,canonical_start);
  if exists(select 1 from public.performance_event_mappings m where m.sport = sport and m.provider = p#>>'{sourceIds,provider}' and m.source_event_id = p#>>'{sourceIds,event}' and m.event_key <> event) then reasons := reasons || '"AMBIGUOUS_SOURCE_MAPPING"'::jsonb; end if;
 else
  sport := null; event := null; original := null; reasons := reasons || '"INVALID_EVENT_IDENTITY"'::jsonb;
 end if;
 if jsonb_typeof(p->'eligibilityReasons') = 'array' then reasons := reasons || (p->'eligibilityReasons'); end if;
 if p->>'modelAvailable' is distinct from 'true' then reasons := reasons || '"MODEL_UNAVAILABLE"'::jsonb; end if;
 if model is null or model not between 0 and 1 then reasons := reasons || '"INVALID_MODEL_PROBABILITY"'::jsonb; end if;
 if market is null or market not between 0 and 1 then reasons := reasons || '"INVALID_MARKET_PROBABILITY"'::jsonb; end if;
 if push is not null and (push not between 0 and 1 or (p->>'probabilityBasis' = 'UNCONDITIONAL' and model + push > 1)) then reasons := reasons || '"INVALID_PUSH_PROBABILITY"'::jsonb; end if;
 if p->>'marketType' <> 'moneyline' and public.performance_number_v1(p->'line') is null then reasons := reasons || '"MISSING_MARKET_LINE"'::jsonb; end if;
 if p->>'modelMode' is null or p->>'modelMode' not in ('LIVE','SHADOW') then reasons := reasons || '"INVALID_MODEL_MODE"'::jsonb; end if;
 if p->>'probabilityBasis' is null or p->>'probabilityBasis' not in ('CONDITIONAL_NO_PUSH','UNCONDITIONAL') then reasons := reasons || '"UNKNOWN_PROBABILITY_BASIS"'::jsonb; end if;
 if nullif(p->>'marketType','') is null or nullif(p->>'side','') is null or nullif(p->>'modelVersion','') is null or nullif(p#>>'{sourceIds,event}','') is null or nullif(p#>>'{settlementRule,version}','') is null then reasons := reasons || '"MISSING_CONTRACT_IDENTITY"'::jsonb; end if;
 if p->>'marketType' like 'player_%' and (nullif(p->>'playerKey','') is null or nullif(p#>>'{sourceIds,player}','') is null) then reasons := reasons || '"MISSING_PLAYER_KEY"'::jsonb; end if;
 if p#>>'{provenance,identityAmbiguous}' = 'true' then reasons := reasons || '"AMBIGUOUS_IDENTITY"'::jsonb; end if;
 if capture is null or original is null or capture >= original or capture > current_timestamp then reasons := reasons || '"INVALID_PREGAME_CAPTURE"'::jsonb; end if;
 minutes := extract(epoch from (original-capture))/60;
 max_age := case when minutes <=20 then 2 when minutes <=90 then 5 when minutes <=360 then 15 else 30 end;
 if quote is null or quote > capture or capture - quote > make_interval(mins => max_age) then reasons := reasons || '"INVALID_QUOTE_AGE"'::jsonb; end if;
 -- Only a fully validated saved prediction may establish canonical event/mapping state.
 -- Keep invalid source observations and all reported times in their immutable payload.
 if reasons = '[]'::jsonb then
  insert into public.performance_events values(sport,event,original) on conflict do nothing;
  if nullif(p#>>'{sourceIds,provider}','') is not null then
   insert into public.performance_event_mappings(sport,event_key,provider,source_event_id,provenance) values(sport,event,p#>>'{sourceIds,provider}',p#>>'{sourceIds,event}',coalesce(p->'provenance','{}')) on conflict do nothing;
  end if;
  insert into public.performance_start_revisions(sport,event_key,starts_at,observed_at) values(sport,event,start_time,capture) on conflict do nothing;
 elsif canonical_start is null then
  -- No canonical FK target exists; diagnostic source identity remains in payload.
  sport := null; event := null;
 end if;
 key := jsonb_build_array(sport,event,p->>'playerKey',p->>'marketType',p->>'side',trim_scale(public.performance_number_v1(p->'line')),p->>'modelVersion',p->>'modelMode')::text;
 insert into public.performance_predictions(source_key,sport,event_key,player_key,market_type,side,line,model_version,model_mode,model_available,captured_at,starts_at,eligibility_starts_at,quote_at,model_probability,market_probability,push_probability,odds,book,probability_basis,settlement_rule,source_ids,provenance,market_key,eligibility_reasons,valid,payload)
 values(p->>'sourceKey',sport,event,p->>'playerKey',p->>'marketType',p->>'side',trim_scale(public.performance_number_v1(p->'line')),p->>'modelVersion',p->>'modelMode',coalesce(p->>'modelAvailable' = 'true',false),capture,start_time,original,quote,model,market,push,public.performance_number_v1(p->'odds'),p->>'book',p->>'probabilityBasis',p->'settlementRule',coalesce(p->'sourceIds','{}'),coalesce(p->'provenance','{}'),key,reasons,reasons = '[]',p) returning id into result;
 return result;
end $$;
create function public.record_decision_v1(payload jsonb) returns uuid language plpgsql security invoker set search_path = '' as $$
declare p jsonb := payload; prediction public.performance_predictions; existing public.performance_decisions; result uuid;
 issued timestamptz := public.performance_time_v1(p->>'issuedAt'); qualified boolean := coalesce(p->>'qualified' = 'true',false);
 first_play boolean := false; legacy boolean := coalesce(p->>'legacyReconstructed' = 'true',false); minutes numeric; max_age integer;
begin
 if nullif(p->>'sourceKey','') is null or issued is null then raise exception 'decision identity/time required' using errcode='23514'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('decision:' || (p->>'sourceKey'),0));
 select * into existing from public.performance_decisions where source_key = p->>'sourceKey';
 if found then if existing.payload <> p then raise exception 'decision sourceKey conflict' using errcode='23505'; end if; return existing.id; end if;
 select * into strict prediction from public.performance_predictions where id = (p->>'predictionId')::uuid;
 minutes := extract(epoch from (prediction.eligibility_starts_at-issued))/60;
 max_age := case when minutes <=20 then 2 when minutes <=90 then 5 when minutes <=360 then 15 else 30 end;
 if p->>'status' = 'PLAY' and (prediction.odds is null or abs(prediction.odds) < 100 or nullif(prediction.book,'') is null or not prediction.valid or issued < prediction.captured_at or issued >= prediction.eligibility_starts_at or issued > current_timestamp or prediction.quote_at is null or prediction.quote_at > issued or issued - prediction.quote_at > make_interval(mins => max_age) or p#>>'{evidence,finalQualification}' is distinct from 'true') then raise exception 'PLAY lacks contemporaneous complete qualification' using errcode='23514'; end if;
 if qualified and (p->>'status' <> 'PLAY' or prediction.model_mode <> 'LIVE') then raise exception 'qualified PLAY requires LIVE model' using errcode='23514'; end if;
 if p->>'status' = 'PLAY' and qualified and not legacy then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portfolio:' || prediction.market_key,0));
  select d.id into result from public.performance_decisions d where d.market_key = prediction.market_key and d.status='PLAY' and d.qualified and not d.legacy_reconstructed;
  first_play := not found;
 end if;
 insert into public.performance_decisions(source_key,prediction_id,market_key,issued_at,status,qualified,evidence,legacy_reconstructed,first_issued,payload)
 values(p->>'sourceKey',prediction.id,prediction.market_key,issued,p->>'status',qualified,coalesce(p->'evidence','{}'),legacy,first_play,p) returning id into result;
 return result;
end $$;
create function public.append_settlement_v1(payload jsonb) returns uuid language plpgsql security invoker set search_path = '' as $$
declare p jsonb := payload; prediction uuid := (p->>'predictionId')::uuid; rev integer := (p->>'revision')::integer;
 prior integer; existing public.performance_settlements; result uuid;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('settlement:' || prediction::text,0));
 select * into existing from public.performance_settlements where prediction_id=prediction and revision=rev;
 if found then if existing.payload <> p then raise exception 'settlement revision conflict' using errcode='23505'; end if; return existing.id; end if;
 select max(revision) into prior from public.performance_settlements where prediction_id=prediction;
 if rev <> coalesce(prior,0)+1 or (p->>'supersedesRevision')::integer is distinct from prior then raise exception 'invalid settlement revision chain' using errcode='23514'; end if;
 insert into public.performance_settlements(prediction_id,revision,outcome,actual_value,away_score,home_score,source,source_updated_at,settled_at,rule_version,reason,supersedes_revision,payload)
 values(prediction,rev,p->>'outcome',public.performance_number_v1(p->'actualValue'),public.performance_number_v1(p->'awayScore'),public.performance_number_v1(p->'homeScore'),p->>'source',public.performance_time_v1(p->>'sourceUpdatedAt'),public.performance_time_v1(p->>'settledAt'),p->>'ruleVersion',p->>'reason',prior,p) returning id into result;
 return result;
end $$;
revoke all on function public.performance_immutable_v1(),public.performance_number_v1(jsonb),public.performance_time_v1(text),public.ingest_prediction_v1(jsonb),public.record_decision_v1(jsonb),public.append_settlement_v1(jsonb) from public,anon,authenticated;
grant execute on function public.performance_number_v1(jsonb),public.performance_time_v1(text),public.ingest_prediction_v1(jsonb),public.record_decision_v1(jsonb),public.append_settlement_v1(jsonb) to service_role;



