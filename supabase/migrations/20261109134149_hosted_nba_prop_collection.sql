create table public.nba_prop_observations_v1(identity text primary key,payload jsonb not null,starts_at timestamptz not null,last_attempt_at timestamptz not null default '-infinity');
create table public.nba_prop_forecasts_v1(identity text references public.nba_prop_observations_v1(identity),model_hash text not null,payload jsonb not null,primary key(identity,model_hash));
create table public.nba_prop_outcomes_v1(identity text primary key references public.nba_prop_observations_v1(identity),payload jsonb not null);
create table public.nba_prop_summaries_v1(id text primary key,payload jsonb not null);
create table public.nba_prop_collector_v1(id integer primary key check(id=1),token uuid,lease_until timestamptz,state jsonb not null default '{}',last_report jsonb,last_completed_at timestamptz);
insert into public.nba_prop_collector_v1(id) values(1);
create index nba_prop_pending_attempt on public.nba_prop_observations_v1(last_attempt_at,starts_at);
alter table public.nba_prop_observations_v1 enable row level security;
alter table public.nba_prop_forecasts_v1 enable row level security;
alter table public.nba_prop_outcomes_v1 enable row level security;
alter table public.nba_prop_summaries_v1 enable row level security;
alter table public.nba_prop_collector_v1 enable row level security;
revoke all on public.nba_prop_observations_v1,public.nba_prop_forecasts_v1,public.nba_prop_outcomes_v1,public.nba_prop_summaries_v1,public.nba_prop_collector_v1 from public,anon,authenticated;
grant select,insert,update on public.nba_prop_observations_v1,public.nba_prop_forecasts_v1,public.nba_prop_outcomes_v1,public.nba_prop_summaries_v1,public.nba_prop_collector_v1 to service_role;
create function public.claim_nba_prop_run_v1() returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.nba_prop_collector_v1; pending jsonb; ids text[];
begin
 select * into s from public.nba_prop_collector_v1 where id=1 for update;
 if s.lease_until>clock_timestamp() then return null; end if;
 s.token:=gen_random_uuid();
 update public.nba_prop_collector_v1 set token=s.token,lease_until=clock_timestamp()+interval '4 minutes' where id=1;
 select array_agg(identity),jsonb_agg(payload) into ids,pending from (
 select o.identity,o.payload from public.nba_prop_observations_v1 o where starts_at<now() and starts_at>now()-interval '30 days' and not exists(select 1 from public.nba_prop_outcomes_v1 x where x.identity=o.identity) order by last_attempt_at,starts_at,identity limit 500) p;
 update public.nba_prop_observations_v1 set last_attempt_at=clock_timestamp() where identity=any(ids);
 return jsonb_build_object('token',s.token,'state',s.state,'pending',coalesce(pending,'[]'::jsonb));
end $$;
create function public.load_nba_prop_summaries_v1(p_ids text[]) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if cardinality(p_ids)>200 then raise exception 'Summary request limit'; end if;
 return coalesce((select jsonb_object_agg(id,payload) from public.nba_prop_summaries_v1 where id=any(p_ids)),'{}'::jsonb);
end $$;
create function public.finish_nba_prop_run_v1(p_token uuid,p_delta jsonb,p_state jsonb,p_summaries jsonb,p_report jsonb) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.nba_prop_collector_v1; r jsonb; k text; n integer; observations integer:=0; forecasts integer:=0; outcomes integer:=0;
begin
 select * into s from public.nba_prop_collector_v1 where id=1 for update;
 if s.token is distinct from p_token or s.lease_until<=clock_timestamp() then raise exception 'Lease lost'; end if;
 if jsonb_array_length(p_delta->'observations')>10000 or jsonb_array_length(p_delta->'forecasts')>10000 or jsonb_array_length(p_delta->'outcomes')>500 or octet_length(p_delta::text)>20000000 then raise exception 'Batch limit'; end if;
 for r in select value from jsonb_array_elements(p_delta->'observations') loop
  if (r->>'productionWeight')::numeric is distinct from 0 or (r->>'productionEligible')::boolean is distinct from false or (r->>'receivedAt')::timestamptz >= (r->>'startsAt')::timestamptz then raise exception 'Invalid observation'; end if;
  insert into public.nba_prop_observations_v1(identity,payload,starts_at) values(r->>'identity',r,(r->>'startsAt')::timestamptz) on conflict do nothing;get diagnostics n=row_count;observations:=observations+n;
 end loop;
 for r in select value from jsonb_array_elements(p_delta->'forecasts') loop
  if (r->>'productionWeight')::numeric is distinct from 0 or (r->>'productionEligible')::boolean is distinct from false or (r->>'issuedAt')::timestamptz >= (r->>'startsAt')::timestamptz then raise exception 'Invalid forecast'; end if;
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
revoke all on function public.claim_nba_prop_run_v1(),public.load_nba_prop_summaries_v1(text[]),public.finish_nba_prop_run_v1(uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.claim_nba_prop_run_v1(),public.load_nba_prop_summaries_v1(text[]),public.finish_nba_prop_run_v1(uuid,jsonb,jsonb,jsonb,jsonb) to service_role;

