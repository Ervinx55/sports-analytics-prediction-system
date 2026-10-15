-- Forward-only scoped priority sport contracts; old ledger rows and identities remain unchanged.
alter table public.performance_events drop constraint performance_events_sport_check;
alter table public.performance_events add constraint performance_events_sport_check check(sport in ('MLB','NFL','NBA','CFB','NHL','TENNIS','SOCCER'));
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
 key := jsonb_build_array(sport,event,p->>'playerKey',p->>'marketType',p->>'side',trim_scale(public.performance_number_v1(p->'line')),p->>'modelVersion',p->>'modelMode')::text;
 if scoped then key := (key::jsonb || jsonb_build_array(scope_key))::text; end if;
 insert into public.performance_predictions(source_key,sport,event_key,player_key,market_type,side,line,model_version,model_mode,model_available,captured_at,starts_at,eligibility_starts_at,quote_at,model_probability,market_probability,push_probability,odds,book,probability_basis,settlement_rule,source_ids,provenance,market_key,eligibility_reasons,valid,payload)
 values(p->>'sourceKey',sport,event,p->>'playerKey',p->>'marketType',p->>'side',trim_scale(public.performance_number_v1(p->'line')),p->>'modelVersion',p->>'modelMode',coalesce(p->>'modelAvailable' = 'true',false),capture,start_time,original,quote,model,market,push,public.performance_number_v1(p->'odds'),p->>'book',p->>'probabilityBasis',p->'settlementRule',coalesce(p->'sourceIds','{}'),coalesce(p->'provenance','{}'),key,reasons,reasons = '[]',p) returning id into result;
 return result;
end $$;
