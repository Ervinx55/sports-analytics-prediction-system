-- Explicit automatic participation evidence; no change to forecasting or promotion.
create or replace function public.valid_nba_auto_inactive_v1(r jsonb,o jsonb) returns boolean
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare e jsonb:=r->'participationEvidence'; matched integer;
begin
 if not coalesce(
 r->>'outcome'='INACTIVE' and r->>'sourceContract'='nba-official-inactive-auto-v1'
 and r->>'settlementPolicy'='RESEARCH_INACTIVE_NOT_GRADED'
 and r->'actual'='null'::jsonb and (r->>'actualMinutes')::numeric=0 and r->'researchOnly'='true'::jsonb
 and e->>'contract'='nba-official-inactive-auto-v1' and e->'reviewed'='false'::jsonb
 and e->>'participation'='OFFICIAL_INACTIVE' and e->'gameFinal'='true'::jsonb
 and e->>'verificationMethod'='EXACT_OFFICIAL_GAMEBOOK_ROSTER_MATCH'
 and e->>'officialGameId'~'^[0-9]{10}$'
 and e->>'sourceUrl'~'^https://statsdmz[.]nba[.]com/pdfs/[0-9]{8}/[0-9]{8}_[A-Z]{6}_book[.]pdf$'
 and e->>'sourceSha256'~'^[a-f0-9]{64}$'
 and e->>'gamePageUrl'~('^https://www[.]nba[.]com/game/[a-z]{3}-vs-[a-z]{3}-'||(e->>'officialGameId')||'/box-score$')
 and e->>'gamePageSha256'~'^[a-f0-9]{64}$'
 and jsonb_array_length(e->'rosterUrls')=2 and jsonb_array_length(e->'rosterSha256')=2
 and o->'context'->>'sourceContract'='sgo-nba-v1'
 and r->>'identity'=o->>'identity' and r->>'officialEventId'=o->>'eventID' and r->>'playerID'=o->>'playerID'
 and e->>'eventID'=o->>'eventID' and e->>'playerID'=o->>'playerID' and e->>'teamId'=o->'context'->>'teamId'
 and (e->>'officialStartAt')::timestamptz=(r->>'officialStartAt')::timestamptz
 and (e->>'retrievedAt')::timestamptz=(r->>'retrievedAt')::timestamptz
 and isfinite((r->>'officialStartAt')::timestamptz) and isfinite((r->>'retrievedAt')::timestamptz)
 and abs(extract(epoch from ((o->>'startsAt')::timestamptz-(r->>'officialStartAt')::timestamptz)))<=900
 and (o->>'receivedAt')::timestamptz<least((o->>'startsAt')::timestamptz,(r->>'officialStartAt')::timestamptz)
 and (r->>'officialStartAt')::timestamptz<(r->>'retrievedAt')::timestamptz
 and (r->>'retrievedAt')::timestamptz between now()-interval '6 hours' and now()
 ,false) then return false; end if;
 if exists(select 1 from jsonb_array_elements_text(e->'rosterUrls') u where u!~'^https://www[.]nba[.]com/team/[0-9]{10}/[a-z0-9-]+/roster$')
 or exists(select 1 from jsonb_array_elements_text(e->'rosterSha256') h where h!~'^[a-f0-9]{64}$') then return false;end if;
 select count(*) into matched from jsonb_array_elements(e->'inactive') p where p->'nbaPlayerId'=e->'nbaPlayerId';
 if matched<>1 or nullif(trim(e->>'providerFirstName'),'') is null or nullif(trim(e->>'providerLastName'),'') is null then return false;end if;
 select count(*) into matched from jsonb_array_elements(e->'inactive') p
 where p->'nbaPlayerId'=e->'nbaPlayerId' and p->>'teamTricode'=e->>'teamTricode'
 and lower(regexp_replace(normalize(p->>'fullName',NFD),'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(normalize((e->>'providerFirstName')||' '||(e->>'providerLastName'),NFD),'[^a-zA-Z0-9]','','g'))
 and lower(regexp_replace(normalize((p->>'firstName')||' '||(p->>'lastName'),NFD),'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(normalize(p->>'fullName',NFD),'[^a-zA-Z0-9]','','g'));
 return matched=1;
 exception when others then return false;
end $$;
revoke all on function public.valid_nba_auto_inactive_v1(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.valid_nba_auto_inactive_v1(jsonb,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.finish_nba_prop_run_v1(p_token uuid, p_delta jsonb, p_state jsonb, p_summaries jsonb, p_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare s public.nba_prop_collector_v1; r jsonb; k text; n integer; observations integer:=0; forecasts integer:=0; outcomes integer:=0; inactive integer:=0; participation_conflicts integer:=0;
begin
 select * into s from public.nba_prop_collector_v1 where id=1 for update;
 if p_token is null or s.token is null or s.lease_until is null or s.token is distinct from p_token or s.lease_until<=clock_timestamp() then raise exception 'Lease lost'; end if;
 if jsonb_array_length(p_delta->'observations')>10000 or jsonb_array_length(p_delta->'forecasts')>10000 or jsonb_array_length(p_delta->'outcomes')>500 or octet_length(p_delta::text)>20000000 then raise exception 'Batch limit'; end if;
 for r in select value from jsonb_array_elements(p_delta->'observations') loop
  if nullif(r->>'identity','') is null or nullif(r->>'startsAt','') is null or (r->>'productionWeight')::numeric is distinct from 0 or (r->>'productionEligible')::boolean is distinct from false or nullif(r->>'receivedAt','') is null or not isfinite((r->>'receivedAt')::timestamptz) or not isfinite((r->>'startsAt')::timestamptz) or (r->>'receivedAt')::timestamptz > clock_timestamp() or (r->>'receivedAt')::timestamptz >= (r->>'startsAt')::timestamptz then raise exception 'Invalid observation'; end if;
  insert into public.nba_prop_observations_v1(identity,payload,starts_at) values(r->>'identity',r,(r->>'startsAt')::timestamptz) on conflict do nothing;get diagnostics n=row_count;observations:=observations+n;
 end loop;
 for r in select value from jsonb_array_elements(p_delta->'forecasts') loop
  if nullif(r->>'identity','') is null or nullif(r->>'startsAt','') is null or (r->>'productionWeight')::numeric is distinct from 0 or (r->>'productionEligible')::boolean is distinct from false or nullif(r->>'modelHash','') is null or nullif(r->>'issuedAt','') is null or not isfinite((r->>'issuedAt')::timestamptz) or not isfinite((r->>'startsAt')::timestamptz) or (r->>'issuedAt')::timestamptz > clock_timestamp() or (r->>'issuedAt')::timestamptz >= (r->>'startsAt')::timestamptz then raise exception 'Invalid forecast'; end if;
  if exists(select 1 from public.nba_prop_observations_v1 where identity=r->>'identity') then
   insert into public.nba_prop_forecasts_v1 values(r->>'identity',r->>'modelHash',r) on conflict do nothing;get diagnostics n=row_count;forecasts:=forecasts+n;
  end if;
 end loop;
 for r in select value from jsonb_array_elements(p_delta->'outcomes') loop
  if r->>'outcome'='INACTIVE' then
   if not coalesce((select public.valid_nba_auto_inactive_v1(r,o.payload) from public.nba_prop_observations_v1 o where o.identity=r->>'identity'),false) then raise exception 'Invalid inactive evidence';end if;
  elsif (r->>'researchOnly')::boolean is distinct from true or coalesce(r->>'outcome','') not in ('WIN','LOSS','PUSH') then raise exception 'Invalid outcome';end if;
  if exists(select 1 from public.nba_prop_outcomes_v1 x where x.payload->>'officialEventId'=r->>'officialEventId' and x.payload->>'playerID'=r->>'playerID' and (x.payload->>'outcome'='INACTIVE') is distinct from (r->>'outcome'='INACTIVE')) then participation_conflicts:=participation_conflicts+1;continue;end if;
  insert into public.nba_prop_outcomes_v1 values(r->>'identity',r) on conflict do nothing;get diagnostics n=row_count;outcomes:=outcomes+n;if r->>'outcome'='INACTIVE' then inactive:=inactive+n;end if;
 end loop;
 for k,r in select key,value from jsonb_each(p_summaries) loop insert into public.nba_prop_summaries_v1 values(k,r) on conflict do nothing;end loop;
 update public.nba_prop_collector_v1 set token=null,lease_until=null,state=p_state,last_report=p_report||jsonb_build_object('persistedObservations',observations,'persistedForecasts',forecasts,'persistedOutcomes',outcomes,'persistedInactive',inactive,'participationConflicts',participation_conflicts),last_completed_at=clock_timestamp() where id=1;
 return jsonb_build_object('observations',observations,'forecasts',forecasts,'outcomes',outcomes,'inactive',inactive,'participationConflicts',participation_conflicts);
end $function$
;

