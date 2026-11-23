create or replace function public.claim_nba_prop_run_v1() returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.nba_prop_collector_v1; pending jsonb; ids text[];
begin
 select * into s from public.nba_prop_collector_v1 where id=1 for update;
 if s.lease_until>clock_timestamp() then return null; end if;
 s.token:=gen_random_uuid();
 update public.nba_prop_collector_v1 set token=s.token,lease_until=clock_timestamp()+interval '4 minutes' where id=1;
 select array_agg(identity),jsonb_agg(payload) into ids,pending from (
 select o.identity,o.payload from public.nba_prop_observations_v1 o where starts_at<now() and starts_at>now()-interval '30 days' and not exists(select 1 from public.nba_prop_outcomes_v1 x where x.identity=o.identity) and (o.starts_at at time zone 'UTC')::date=(select (q.starts_at at time zone 'UTC')::date from public.nba_prop_observations_v1 q where q.starts_at<now() and q.starts_at>now()-interval '30 days' and not exists(select 1 from public.nba_prop_outcomes_v1 z where z.identity=q.identity) order by q.last_attempt_at,q.starts_at,q.identity limit 1) order by last_attempt_at,starts_at,identity limit 500) p;
 update public.nba_prop_observations_v1 set last_attempt_at=clock_timestamp() where identity=any(ids);
 return jsonb_build_object('token',s.token,'state',s.state,'pending',coalesce(pending,'[]'::jsonb));
end $$;

