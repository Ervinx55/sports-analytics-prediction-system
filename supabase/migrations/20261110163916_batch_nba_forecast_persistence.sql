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
 if exists(select 1 from jsonb_array_elements(p_delta->'forecasts') as batch(r) where nullif(batch.r->>'identity','') is null or nullif(batch.r->>'startsAt','') is null or (batch.r->>'productionWeight')::numeric is distinct from 0 or (batch.r->>'productionEligible')::boolean is distinct from false or nullif(batch.r->>'modelHash','') is null or nullif(batch.r->>'issuedAt','') is null or not isfinite((batch.r->>'issuedAt')::timestamptz) or not isfinite((batch.r->>'startsAt')::timestamptz) or (batch.r->>'issuedAt')::timestamptz > clock_timestamp() or (batch.r->>'issuedAt')::timestamptz >= (batch.r->>'startsAt')::timestamptz) then raise exception 'Invalid forecast';end if;
 insert into public.nba_prop_forecasts_v1(identity,model_hash,payload)
 select batch.r->>'identity',batch.r->>'modelHash',batch.r from jsonb_array_elements(p_delta->'forecasts') with ordinality as batch(r,ord)
 where exists(select 1 from public.nba_prop_observations_v1 o where o.identity=batch.r->>'identity')
 order by ord on conflict do nothing;
 get diagnostics forecasts=row_count;
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

-- Indexed, bounded lookup: avoid resending immutable forecasts every collection cycle.
create function public.load_nba_saved_forecasts_v1(p_identities text[]) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if p_identities is null or cardinality(p_identities)>500 or octet_length(p_identities::text)>100000 then raise exception 'Invalid identity batch';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('identity',identity,'modelHash',model_hash)),'[]') from public.nba_prop_forecasts_v1 where identity=any(p_identities));
end $$;
revoke all on function public.load_nba_saved_forecasts_v1(text[]) from public,anon,authenticated,service_role;
grant execute on function public.load_nba_saved_forecasts_v1(text[]) to service_role;

