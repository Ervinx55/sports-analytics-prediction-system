-- Forward-only semantic identity: existing prediction/decision payloads and keys remain untouched.
-- Comparisons project old payloads through the same function; no new version can reissue an old equivalent PLAY.
create function public.performance_identity_json_v2(v jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb;
begin
 case jsonb_typeof(v)
 when 'number' then return to_jsonb(trim_scale((v#>>'{}')::numeric));
 when 'object' then select coalesce(jsonb_object_agg(key,public.performance_identity_json_v2(value)),'{}'::jsonb) into result from jsonb_each(v);return result;
 when 'array' then select coalesce(jsonb_agg(public.performance_identity_json_v2(value) order by n),'[]'::jsonb) into result from jsonb_array_elements(v) with ordinality a(value,n);return result;
 else return v;
 end case;
end $$;
revoke all on function public.performance_identity_json_v2(jsonb) from public,anon,authenticated;
grant execute on function public.performance_identity_json_v2(jsonb) to service_role;
create function public.performance_exact_market_key_v2(p jsonb) returns text
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_array(p->>'sport',
 case when p->>'sport' in ('NHL','TENNIS','SOCCER') then jsonb_build_array(p->>'sport',p->>'competitionKey',p->>'tour',p->>'eventKey')::text else p->>'eventKey' end,
 p->>'playerKey',p->>'marketType',p->>'side',trim_scale(public.performance_number_v1(p->'line')),p->>'modelVersion',p->>'modelMode',
 public.performance_identity_json_v2(jsonb_build_array(coalesce(p->'marketScope','null'::jsonb),case when jsonb_typeof(p->'settlementRule')='object' then (p->'settlementRule')-'book' else 'null'::jsonb end)))::text;
$$;
revoke all on function public.performance_exact_market_key_v2(jsonb) from public,anon,authenticated;
grant execute on function public.performance_exact_market_key_v2(jsonb) to service_role;
create index performance_predictions_semantic_key_v2 on public.performance_predictions(public.performance_exact_market_key_v2(payload));
create or replace function public.ingest_prediction_v1(payload jsonb) returns uuid language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_variable
declare p jsonb := payload; existing public.performance_predictions; result uuid;
 sport text := p->>'sport'; event text := nullif(p->>'eventKey','');
 capture timestamptz := public.performance_time_v1(p->>'capturedAt');
 start_time timestamptz := public.performance_time_v1(p->>'startsAt');
 original timestamptz := least(public.performance_time_v1(p->>'eligibilityStartsAt'),start_time);
 canonical_start timestamptz; scoped boolean := sport in ('NHL','TENNIS','SOCCER'); mapping_event text := p#>>'{sourceIds,event}'; scope_key jsonb;
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
 if scoped then
  if nullif(btrim(p->>'eventKey'),'') is null then reasons := reasons || '"INVALID_EVENT_IDENTITY"'::jsonb; end if;
  event := jsonb_build_array(sport,p->>'competitionKey',p->>'tour',event)::text;
  mapping_event := jsonb_build_array(p->>'competitionKey',p->>'tour',mapping_event)::text;
  if nullif(btrim(p->>'competitionKey'),'') is null then reasons := reasons || '"INVALID_COMPETITION_SCOPE"'::jsonb; end if;
  if sport='TENNIS' then
   if coalesce(p->>'tour','') not in ('ATP','WTA') then reasons := reasons || '"INVALID_TOUR"'::jsonb; end if;
   if coalesce(p#>'{marketScope,period}','null'::jsonb)<>'null'::jsonb
    or (p#>>'{marketScope,unit}'='MATCH' and (coalesce(p#>'{marketScope,set}','null'::jsonb)<>'null'::jsonb or coalesce(p#>'{marketScope,game}','null'::jsonb)<>'null'::jsonb))
    or (p#>>'{marketScope,unit}'='SET' and coalesce(p#>'{marketScope,game}','null'::jsonb)<>'null'::jsonb)
    or coalesce(p#>>'{marketScope,unit}','') not in ('MATCH','SET','GAME')
    or (p#>>'{marketScope,unit}' in ('SET','GAME') and (jsonb_typeof(p#>'{marketScope,set}') is distinct from 'number' or coalesce(public.performance_number_v1(p#>'{marketScope,set}'),0)<=0 or public.performance_number_v1(p#>'{marketScope,set}')>9007199254740991 or public.performance_number_v1(p#>'{marketScope,set}')<>trunc(public.performance_number_v1(p#>'{marketScope,set}'))))
    or (p#>>'{marketScope,unit}'='GAME' and (jsonb_typeof(p#>'{marketScope,game}') is distinct from 'number' or coalesce(public.performance_number_v1(p#>'{marketScope,game}'),0)<=0 or public.performance_number_v1(p#>'{marketScope,game}')>9007199254740991 or public.performance_number_v1(p#>'{marketScope,game}')<>trunc(public.performance_number_v1(p#>'{marketScope,game}')))) then reasons := reasons || '"INVALID_MARKET_SCOPE"'::jsonb; end if;
   if coalesce(p#>>'{settlementRule,format}','') not in ('BEST_OF_3','BEST_OF_5') or coalesce(p#>>'{settlementRule,retirement}','') not in ('VOID','ACTION') or coalesce(p#>>'{settlementRule,walkover}','') not in ('VOID','ACTION') then reasons := reasons || '"UNKNOWN_TENNIS_POLICY"'::jsonb; end if;
  elsif coalesce(p#>'{marketScope,unit}','null'::jsonb)<>'null'::jsonb or coalesce(p#>'{marketScope,set}','null'::jsonb)<>'null'::jsonb or coalesce(p#>'{marketScope,game}','null'::jsonb)<>'null'::jsonb or (sport='SOCCER' and coalesce(p#>>'{marketScope,period}','') not in ('REGULATION','INCLUDING_EXTRA_TIME')) or (sport='NHL' and coalesce(p#>>'{marketScope,period}','') not in ('REGULATION','INCLUDING_OVERTIME_SHOOTOUT')) then reasons := reasons || '"INVALID_MARKET_SCOPE"'::jsonb; end if;
  scope_key := jsonb_build_array(p#>>'{marketScope,period}',p#>>'{marketScope,unit}',to_jsonb(trim_scale(public.performance_number_v1(p#>'{marketScope,set}'))),to_jsonb(trim_scale(public.performance_number_v1(p#>'{marketScope,game}'))),p#>>'{settlementRule,version}',p#>>'{settlementRule,format}',p#>>'{settlementRule,retirement}',p#>>'{settlementRule,walkover}');
 end if;
 -- Lock order: observation source, external mapping identity, canonical event.
 -- Different eventKeys claiming one provider event must see the winning mapping
 -- before any ambiguity check or canonical state mutation.
 if nullif(p#>>'{sourceIds,provider}','') is not null and nullif(p#>>'{sourceIds,event}','') is not null then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mapping:' || jsonb_build_array(sport,p#>>'{sourceIds,provider}',mapping_event)::text,0));
 end if;
 -- Lock/read existing canonical state, but diagnostics must not create it.
 if sport in ('MLB','NFL','NBA','CFB','NHL','TENNIS','SOCCER') and event is not null and start_time is not null then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('event:' || sport || ':' || event,0));
  select e.eligibility_starts_at into canonical_start from public.performance_events e where e.sport = sport and e.event_key = event;
  original := least(original,canonical_start);
  if exists(select 1 from public.performance_event_mappings m where m.sport = sport and m.provider = p#>>'{sourceIds,provider}' and m.source_event_id = mapping_event and m.event_key <> event) then reasons := reasons || '"AMBIGUOUS_SOURCE_MAPPING"'::jsonb; end if;
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
   insert into public.performance_event_mappings(sport,event_key,provider,source_event_id,provenance) values(sport,event,p#>>'{sourceIds,provider}',mapping_event,coalesce(p->'provenance','{}')) on conflict do nothing;
  end if;
  insert into public.performance_start_revisions(sport,event_key,starts_at,observed_at) values(sport,event,start_time,capture) on conflict do nothing;
 elsif canonical_start is null then
  -- No canonical FK target exists; diagnostic source identity remains in payload.
  sport := null; event := null;
 end if;
 key := public.performance_exact_market_key_v2(p);
 insert into public.performance_predictions(source_key,sport,event_key,player_key,market_type,side,line,model_version,model_mode,model_available,captured_at,starts_at,eligibility_starts_at,quote_at,model_probability,market_probability,push_probability,odds,book,probability_basis,settlement_rule,source_ids,provenance,market_key,eligibility_reasons,valid,payload)
 values(p->>'sourceKey',sport,event,p->>'playerKey',p->>'marketType',p->>'side',trim_scale(public.performance_number_v1(p->'line')),p->>'modelVersion',p->>'modelMode',coalesce(p->>'modelAvailable' = 'true',false),capture,start_time,original,quote,model,market,push,public.performance_number_v1(p->'odds'),p->>'book',p->>'probabilityBasis',p->'settlementRule',coalesce(p->'sourceIds','{}'),coalesce(p->'provenance','{}'),key,reasons,reasons = '[]',p) returning id into result;
 return result;
end $$;

-- Use wall-clock future validation when a caller records an actual issuance after locks.
-- All other Task 1 decision validation and immutable/idempotent behavior is unchanged.
create or replace function public.record_decision_v1(payload jsonb) returns uuid language plpgsql security invoker set search_path = '' as $$
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
 if p->>'status' = 'PLAY' and (prediction.odds is null or abs(prediction.odds) < 100 or nullif(prediction.book,'') is null or not prediction.valid or issued < prediction.captured_at or issued >= prediction.eligibility_starts_at or issued > clock_timestamp() or prediction.quote_at is null or prediction.quote_at > issued or issued - prediction.quote_at > make_interval(mins => max_age) or p#>>'{evidence,finalQualification}' is distinct from 'true') then raise exception 'PLAY lacks contemporaneous complete qualification' using errcode='23514'; end if;
 if qualified and (p->>'status' <> 'PLAY' or prediction.model_mode <> 'LIVE') then raise exception 'qualified PLAY requires LIVE model' using errcode='23514'; end if;
 if p->>'status' = 'PLAY' and qualified and not legacy then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portfolio:' || public.performance_exact_market_key_v2(prediction.payload),0));
  select d.id into result from public.performance_decisions d join public.performance_predictions prior on prior.id=d.prediction_id where public.performance_exact_market_key_v2(prior.payload) = public.performance_exact_market_key_v2(prediction.payload) and d.status='PLAY' and d.qualified and not d.legacy_reconstructed;
  first_play := not found;
  if clock_timestamp() >= prediction.eligibility_starts_at then raise exception 'decision time reached event start' using errcode='23514'; end if;
 end if;
 insert into public.performance_decisions(source_key,prediction_id,market_key,issued_at,status,qualified,evidence,legacy_reconstructed,first_issued,payload)
 values(p->>'sourceKey',prediction.id,prediction.market_key,issued,p->>'status',qualified,coalesce(p->'evidence','{}'),legacy,first_play,p) returning id into result;
 return result;
end $$;
-- Publication and import are service-only transactions. No GET writes.
create or replace function public.publish_mlb_performance_v1(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare prediction_id uuid; decision_id uuid; prediction_row public.performance_predictions;
 publication_at timestamptz; publication_iso text; minutes numeric; max_age integer; qualification_expires timestamptz; existing public.performance_decisions; source_identity text := payload#>>'{prediction,sourceKey}';
begin
 if payload#>>'{prediction,sport}' is distinct from 'MLB' or payload#>>'{evidence,finalQualification}' is distinct from 'true' or payload#>>'{evidence,status}' is distinct from 'PLAY' then raise exception 'complete MLB final qualification required' using errcode='23514'; end if;
 prediction_id := public.ingest_prediction_v1(payload->'prediction');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('decision:' || source_identity || ':final',0));
 select * into existing from public.performance_decisions where performance_decisions.source_key = source_identity || ':final';
 if found then
  if existing.prediction_id <> prediction_id or not existing.qualified or existing.legacy_reconstructed then raise exception 'publication conflict' using errcode='23505'; end if;
  return jsonb_build_object('id',existing.id,'prediction_id',existing.prediction_id,'issued_at',existing.issued_at,'status',existing.status,'qualified',existing.qualified,'legacy_reconstructed',existing.legacy_reconstructed);
 end if;
 -- record_decision_v1 also acquires the portfolio lock. Take it now so no lock
 -- wait can move a NEW issuance past the guards below. Existing retries returned above.
 select * into strict prediction_row from public.performance_predictions where id=prediction_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portfolio:' || public.performance_exact_market_key_v2(prediction_row.payload),0));
 publication_at := clock_timestamp();
 if prediction_row.eligibility_starts_at is null or publication_at >= prediction_row.eligibility_starts_at then
  raise exception 'publication time reached event start' using errcode='23514';
 end if;
 minutes := extract(epoch from (prediction_row.eligibility_starts_at-publication_at))/60;
 max_age := case when minutes <=20 then 2 when minutes <=90 then 5 when minutes <=360 then 15 else 30 end;
 if prediction_row.quote_at is null or prediction_row.quote_at > publication_at or publication_at-prediction_row.quote_at > make_interval(mins=>max_age) then
  raise exception 'publication quote freshness expired' using errcode='23514';
 end if;
 qualification_expires := public.performance_time_v1(payload#>>'{evidence,qualificationExpiresAt}');
 if payload#>'{evidence,freshness}' is not null and (qualification_expires is null or publication_at >= qualification_expires) then
  raise exception 'publication final-check freshness expired' using errcode='23514';
 end if;
 publication_iso := to_char(publication_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 decision_id := public.record_decision_v1(jsonb_build_object(
  'sourceKey',source_identity || ':final','predictionId',prediction_id,'issuedAt',publication_iso,
  'status','PLAY','qualified',true,
  'evidence',(payload->'evidence') || jsonb_build_object('publicationClockAt',publication_iso,'quoteAgeMinutes',extract(epoch from (publication_at-prediction_row.quote_at))/60),
  'legacyReconstructed',false));
 select * into strict existing from public.performance_decisions where id=decision_id;
 return jsonb_build_object('id',existing.id,'prediction_id',existing.prediction_id,'issued_at',existing.issued_at,'status',existing.status,'qualified',existing.qualified,'legacy_reconstructed',existing.legacy_reconstructed);
end $$;
