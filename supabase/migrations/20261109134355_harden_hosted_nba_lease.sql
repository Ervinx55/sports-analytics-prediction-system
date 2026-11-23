create or replace function public.finish_nba_prop_run_v1(p_token uuid,p_delta jsonb,p_state jsonb,p_summaries jsonb,p_report jsonb) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.nba_prop_collector_v1; r jsonb; k text; n integer; observations integer:=0; forecasts integer:=0; outcomes integer:=0;
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
  if (r->>'researchOnly')::boolean is distinct from true or r->>'outcome' not in ('WIN','LOSS','PUSH') then raise exception 'Invalid outcome'; end if;
  insert into public.nba_prop_outcomes_v1 values(r->>'identity',r) on conflict do nothing;get diagnostics n=row_count;outcomes:=outcomes+n;
 end loop;
 for k,r in select key,value from jsonb_each(p_summaries) loop insert into public.nba_prop_summaries_v1 values(k,r) on conflict do nothing;end loop;
 update public.nba_prop_collector_v1 set token=null,lease_until=null,state=p_state,last_report=p_report||jsonb_build_object('persistedObservations',observations,'persistedForecasts',forecasts,'persistedOutcomes',outcomes),last_completed_at=clock_timestamp() where id=1;
 return jsonb_build_object('observations',observations,'forecasts',forecasts,'outcomes',outcomes);
end $$;

