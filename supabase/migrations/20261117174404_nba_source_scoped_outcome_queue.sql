-- The SGO worker cannot settle legacy numeric-ID observations. Keep both queues
-- and immutable evidence, but do not spend SGO collection leases on legacy rows.
create or replace function public.claim_nba_prop_run_v2(p_source_contract text)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare s public.nba_prop_collector_v1; pending jsonb; ids text[]; selected_day date;
begin
 if p_source_contract is null or p_source_contract not in ('sgo-nba-v1','legacy') then
  raise exception 'UNSUPPORTED_NBA_SOURCE_CONTRACT';
 end if;
 select * into s from public.nba_prop_collector_v1 where id=1 for update;
 if not found then raise exception 'NBA_COLLECTOR_STATE_MISSING'; end if;
 if s.lease_until>clock_timestamp() then return null; end if;
 s.token:=gen_random_uuid();
 update public.nba_prop_collector_v1 set token=s.token,lease_until=clock_timestamp()+interval '4 minutes' where id=1;
 select (o.starts_at at time zone 'UTC')::date into selected_day
 from public.nba_prop_observations_v1 o
 where o.starts_at<now() and o.starts_at>now()-interval '30 days'
 and ((p_source_contract='legacy' and o.payload#>>'{context,sourceContract}' is null)
      or o.payload#>>'{context,sourceContract}'=p_source_contract)
 and not exists(select 1 from public.nba_prop_outcomes_v1 x where x.identity=o.identity)
 order by o.last_attempt_at,o.starts_at,o.identity limit 1;
 select array_agg(identity),jsonb_agg(payload) into ids,pending from (
  select o.identity,o.payload from public.nba_prop_observations_v1 o
  where o.starts_at<now() and o.starts_at>now()-interval '30 days'
  and (o.starts_at at time zone 'UTC')::date=selected_day
  and ((p_source_contract='legacy' and o.payload#>>'{context,sourceContract}' is null)
       or o.payload#>>'{context,sourceContract}'=p_source_contract)
  and not exists(select 1 from public.nba_prop_outcomes_v1 x where x.identity=o.identity)
  order by o.last_attempt_at,o.starts_at,o.identity limit 500
 ) p;
 update public.nba_prop_observations_v1 set last_attempt_at=clock_timestamp() where identity=any(ids);
 return jsonb_build_object('token',s.token,'state',s.state,'pending',coalesce(pending,'[]'::jsonb),'sourceContract',p_source_contract);
end;
$$;
revoke all on function public.claim_nba_prop_run_v2(text) from public,anon,authenticated;
grant execute on function public.claim_nba_prop_run_v2(text) to service_role;
