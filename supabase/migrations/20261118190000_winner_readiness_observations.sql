-- Preserve original forecasts; append each subsequent pregame evidence check.
-- No backfill, model change, approval write, or changes to the scoring cohorts.
set lock_timeout='5s';
create table public.winner_readiness_observations (
 like public.winner_prospective_forecasts including defaults including constraints,
 -- A retry cannot become a new observation when the server crosses a window.
 primary key(sport,event_id,model_hash,input_hash,issued_at),
 foreign key(model_hash) references public.winner_model_manifests(model_hash),
 foreign key(input_hash) references public.winner_source_snapshots(source_hash)
);
create index winner_readiness_upcoming on public.winner_readiness_observations(starts_at,sport,event_id,issued_at desc);
alter table public.winner_readiness_observations enable row level security;
revoke all on public.winner_readiness_observations from public,anon,authenticated,service_role;
grant select,insert on public.winner_readiness_observations to service_role;
create trigger winner_readiness_immutable before update or delete on public.winner_readiness_observations for each row execute function public.winner_reject_mutation();
create trigger winner_00_quality_quarantine before insert on public.winner_readiness_observations for each row execute function public.winner_skip_quarantined_forecast();
create trigger winner_01_schedule_identity before insert on public.winner_readiness_observations for each row execute function public.winner_guard_schedule_capture();
create trigger winner_readiness_clock before insert on public.winner_readiness_observations for each row execute function public.winner_before_insert();

create or replace function public.winner_before_insert() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare m public.winner_model_manifests; s public.winner_source_snapshots; f public.winner_prospective_forecasts; h numeric; a numeric;
begin
 if tg_table_name in ('winner_prospective_forecasts','winner_readiness_observations') then
  new.captured_at:=clock_timestamp();
  if new.starts_at-new.captured_at <= interval '5 minutes' or new.starts_at-new.captured_at > interval '7 days' then raise exception 'Outside winner capture window'; end if;
  new.capture_window:=case when new.starts_at-new.captured_at>interval '90 minutes' then 'EARLY' when new.starts_at-new.captured_at>interval '30 minutes' then 'PRE90_30' else 'PRE30_5' end;
  select * into strict m from public.winner_model_manifests where model_hash=new.model_hash;
  select * into strict s from public.winner_source_snapshots where source_hash=new.input_hash;
  if m.sport<>new.sport or m.model_version<>new.model_version or s.fetched_at>new.issued_at or s.recorded_at>new.captured_at
   or new.forecast->>'productionEligible' is distinct from 'false' or new.forecast->>'productionWeight' is distinct from '0'
   or new.forecast->>'fullFeatureEligible' is distinct from 'false'
   or jsonb_typeof(new.forecast->'identity') is distinct from 'object'
   or new.forecast->>'sport' is distinct from new.sport
   or new.forecast->>'eventID' is distinct from new.event_id
   or new.forecast#>>'{identity,eventID}' is distinct from new.event_id
   or new.forecast#>>'{identity,home,id}' is null or new.forecast#>>'{identity,away,id}' is null
   or new.forecast#>>'{identity,home,id}'=new.forecast#>>'{identity,away,id}'
   or new.forecast->>'homeProbability' is null or new.forecast->>'homeProbability' in ('NaN','Infinity','-Infinity')
   or new.forecast->>'manifestHash' is distinct from new.model_hash
   or (new.forecast->>'issuedAt')::timestamptz is distinct from new.issued_at
   or (new.forecast->>'startsAt')::timestamptz is distinct from new.starts_at then raise exception 'Invalid winner forecast provenance'; end if;
  if exists(select 1 from public.winner_prospective_forecasts prior_forecast where prior_forecast.sport=new.sport and prior_forecast.event_id=new.event_id and (prior_forecast.starts_at<>new.starts_at or prior_forecast.forecast->'identity' is distinct from new.forecast->'identity')) then raise exception 'Winner event identity changed'; end if;
 elsif tg_table_name='winner_outcome_revisions' then
  new.recorded_at:=clock_timestamp();
  select * into strict f from public.winner_prospective_forecasts where sport=new.sport and event_id=new.event_id order by captured_at limit 1;
  select * into strict s from public.winner_source_snapshots where source_hash=new.outcome->>'sourceHash';
  h:=(new.outcome->>'homeScore')::numeric; a:=(new.outcome->>'awayScore')::numeric;
  if new.observed_at<f.starts_at
   or (new.outcome->>'sourceFetchedAt')::timestamptz is distinct from new.observed_at
   or not exists(select 1 from public.winner_source_receipts r where r.source_hash=s.source_hash and r.fetched_at=new.observed_at)
   or new.outcome->>'sourceUrl' is distinct from s.source_url
   or new.outcome->'identity' is distinct from f.forecast->'identity'
   or new.outcome->>'final' is distinct from 'true' or new.outcome->>'productionEligible' is distinct from 'false'
   or new.outcome->>'source' is distinct from (case when new.sport='NBA' then 'ESPN_SCOREBOARD' else 'NFLVERSE_SCHEDULE' end)
   or h is null or a is null or h<0 or a<0 or h>250 or a>250 or h<>trunc(h) or a<>trunc(a)
   or h::text in ('NaN','Infinity','-Infinity') or a::text in ('NaN','Infinity','-Infinity')
   or new.outcome->>'status' is distinct from (case when h=a and new.sport='NFL' then 'TIE' else 'FINAL' end)
   or (h=a and new.sport='NBA')
   or new.outcome->>'result' is distinct from (case when h=a then 'TIE' when h>a then 'HOME_WIN' else 'AWAY_WIN' end)
   then raise exception 'Invalid winner final outcome provenance'; end if;
 elsif tg_table_name='winner_model_manifests' then
  new.recorded_at:=clock_timestamp();
  if new.manifest->>'sport' is distinct from new.sport or new.manifest->>'modelVersion' is distinct from new.model_version
   or new.manifest->>'manifestHash' is distinct from new.model_hash or new.manifest->>'productionWeight' is distinct from '0'
   or new.manifest->>'productionEligible' is distinct from 'false' then raise exception 'Invalid frozen research manifest'; end if;
 else
  new.recorded_at:=clock_timestamp();
 end if;
 return new;
end;
$$;

create or replace function public.winner_research_append(p_manifests jsonb default '[]',p_sources jsonb default '[]',p_forecasts jsonb default '[]',p_outcomes jsonb default '[]',p_status jsonb default '{}') returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare r jsonb; n integer; captured integer:=0; observations integer:=0; sources integer:=0; outcomes integer:=0; f public.winner_prospective_forecasts;
begin
 if jsonb_typeof(p_manifests) is distinct from 'array' or jsonb_typeof(p_sources) is distinct from 'array' or jsonb_typeof(p_forecasts) is distinct from 'array' or jsonb_typeof(p_outcomes) is distinct from 'array'
  or jsonb_array_length(p_manifests)>4 or jsonb_array_length(p_sources)>300 or jsonb_array_length(p_forecasts)>100 or jsonb_array_length(p_outcomes)>100 then raise exception 'Winner batch limit'; end if;
 for r in select value from jsonb_array_elements(p_manifests) loop
  insert into public.winner_model_manifests(model_hash,sport,model_version,manifest) values(r->>'model_hash',r->>'sport',r->>'model_version',r->'manifest') on conflict do nothing;
  if not exists(select 1 from public.winner_model_manifests where model_hash=r->>'model_hash' and sport=r->>'sport' and model_version=r->>'model_version' and manifest=r->'manifest') then raise exception 'Frozen winner manifest mismatch'; end if;
 end loop;
 for r in select value from jsonb_array_elements(p_sources) loop
  insert into public.winner_source_snapshots(source_hash,source_url,fetched_at,body) values(r->>'source_hash',r->>'source_url',(r->>'fetched_at')::timestamptz,r->'body') on conflict do nothing;
  get diagnostics n=row_count; sources:=sources+n;
  if not exists(select 1 from public.winner_source_snapshots where source_hash=r->>'source_hash' and body=r->'body' and source_url=r->>'source_url') then raise exception 'Winner source hash collision'; end if;
  insert into public.winner_source_receipts(source_hash,fetched_at) values(r->>'source_hash',(r->>'fetched_at')::timestamptz) on conflict do nothing;
 end loop;
 for r in select value from jsonb_array_elements(p_forecasts) loop
  -- Do not backdate a forecast if a batch crosses kickoff or its final window.
  if (r->>'starts_at')::timestamptz-clock_timestamp() <= interval '5 minutes' or (r->>'starts_at')::timestamptz-clock_timestamp()>interval '7 days' then continue; end if;
  insert into public.winner_prospective_forecasts(sport,event_id,model_hash,model_version,starts_at,capture_window,issued_at,input_hash,forecast)
  values(r->>'sport',r->>'event_id',coalesce(r->>'model_hash',r#>>'{forecast,manifestHash}'),r->>'model_version',(r->>'starts_at')::timestamptz,'EARLY',(r#>>'{forecast,issuedAt}')::timestamptz,r->>'input_hash',r->'forecast') on conflict do nothing;
  get diagnostics n=row_count; captured:=captured+n;
  -- Later readiness is not substituted for the immutable first-window forecast.
  begin
   insert into public.winner_readiness_observations(sport,event_id,model_hash,model_version,starts_at,capture_window,issued_at,input_hash,forecast)
   values(r->>'sport',r->>'event_id',coalesce(r->>'model_hash',r#>>'{forecast,manifestHash}'),r->>'model_version',(r->>'starts_at')::timestamptz,'EARLY',(r#>>'{forecast,issuedAt}')::timestamptz,r->>'input_hash',r->'forecast') on conflict do nothing;
   get diagnostics n=row_count; observations:=observations+n;
  exception when raise_exception then
   -- Keep a valid first insert if only this later insert crosses its cutoff.
   -- Every source, identity, model or other provenance failure still aborts.
   if sqlerrm<>'Outside winner capture window' or (r->>'starts_at')::timestamptz-clock_timestamp()>interval '5 minutes' then raise; end if;
  end;
 end loop;
 for r in select value from jsonb_array_elements(p_outcomes) loop
  select * into f from public.winner_prospective_forecasts where sport=r->>'sport' and event_id=r->>'event_id' order by captured_at limit 1;
  if not found or (r->>'observed_at')::timestamptz<f.starts_at or r#>'{outcome,identity}' is distinct from f.forecast->'identity' then raise exception 'Winner outcome identity mismatch'; end if;
  insert into public.winner_outcome_revisions(sport,event_id,evidence_hash,observed_at,outcome) values(r->>'sport',r->>'event_id',r->>'evidence_hash',(r->>'observed_at')::timestamptz,r->'outcome') on conflict do nothing;
  get diagnostics n=row_count; outcomes:=outcomes+n;
 end loop;
 if p_status<>'{}'::jsonb then
  for r in select value from jsonb_array_elements(coalesce(p_status->'checkedEvents','[]'::jsonb)) limit 100 loop
   if exists(select 1 from public.winner_prospective_forecasts where sport=r->>'sport' and event_id=r->>'event_id') then
    insert into public.winner_outcome_checks(sport,event_id) values(r->>'sport',r->>'event_id') on conflict(sport,event_id) do update set checked_at=clock_timestamp();
   end if;
  end loop;
  insert into public.winner_research_state(id,payload) values('latest',p_status) on conflict(id) do update set payload=excluded.payload,recorded_at=clock_timestamp();
 end if;
 return jsonb_build_object('captured',captured,'readinessObservations',observations,'sourceCount',sources,'outcomeRevisions',outcomes);
end;
$$;

create or replace function public.winner_research_status() returns jsonb language sql stable set search_path=pg_catalog,public as $$
 with latest as (select distinct on(sport,event_id) sport,event_id,outcome from public.winner_outcome_revisions order by sport,event_id,observed_at desc,recorded_at desc,evidence_hash),
 flagged as (select distinct sport,event_id from public.winner_event_quality_flags),
 readiness_latest as (
  select distinct on (r.sport,r.event_id,r.model_hash) r.*
  from public.winner_readiness_observations r
  where r.starts_at>clock_timestamp() and r.captured_at>clock_timestamp()-interval '7 days'
   and not exists(select 1 from flagged q where q.sport=r.sport and q.event_id=r.event_id)
  order by r.sport,r.event_id,r.model_hash,r.issued_at desc,r.captured_at desc,r.input_hash
 ), readiness_events as (
  select sport,event_id,starts_at,issued_at as observed_at,captured_at as recorded_at,issued_at,capture_window,
   issued_at<=clock_timestamp() and clock_timestamp()-issued_at<=interval '15 minutes' as observation_fresh,
   forecast->>'lineupVerified'='true' as lineup_verified_at_observation,
   forecast#>>'{lineup,status}' as lineup_status,forecast#>>'{lineup,reason}' as lineup_reason,
   forecast->>'quoteComparisonEligible'='true' as paired_prices_at_observation,
   jsonb_array_length(coalesce(forecast#>'{quoteComparison,pairs}','[]')) as pair_count,
   coalesce(forecast#>'{quoteComparison,reasons}','[]') as price_reasons
  from readiness_latest order by starts_at,sport,event_id limit 100
 ), report as (
 select f.sport,f.capture_window,count(*) as forecast_rows,count(distinct coalesce(r.base_event_id,f.event_id)) as games,
 count(distinct coalesce(r.base_event_id,f.event_id)) filter(where q.event_id is null) as eligible_games,
 count(distinct f.event_id) filter(where q.event_id is not null) as quarantined_games,
 count(distinct r.base_event_id) filter(where q.event_id is null) as schedule_resolved_games,
 count(*) filter(where q.event_id is null and f.forecast->>'lineupVerified'='true') as lineup_verified,
 count(*) filter(where q.event_id is null and f.forecast->>'quoteComparisonEligible'='true') as paired_prices,
 count(*) filter(where q.event_id is null and o.outcome->>'status'='FINAL') as final_results,
 count(*) filter(where q.event_id is null and o.outcome->>'status'='TIE') as ties,
 count(*) filter(where q.event_id is null and o.event_id is null) as awaiting_outcome
 from public.winner_prospective_forecasts f left join latest o using(sport,event_id) left join flagged q using(sport,event_id)
 left join public.winner_official_schedule_revisions r on r.event_id=f.event_id and r.sport=f.sport
 group by f.sport,f.capture_window
 ) select jsonb_build_object('status','RESEARCH_NOT_CLEARED','productionWeight',0,'productionEligible',false,
 'quarantined_games',(select count(*) from flagged q where exists(select 1 from public.winner_prospective_forecasts f where f.sport=q.sport and f.event_id=q.event_id)),
 'quality_flagged_events',(select count(*) from flagged),'schedule_resolutions',(select count(*) from public.winner_event_quality_resolutions),
 'readiness',jsonb_build_object('basis','LATEST_PREGAME_OBSERVATION_NOT_ORIGINAL_FORECAST','maxAgeSeconds',900,'events',coalesce((select jsonb_agg(to_jsonb(readiness_events)) from readiness_events),'[]')),
 'cohorts',coalesce((select jsonb_agg(to_jsonb(report)) from report),'[]'),
 'latest',(select payload from public.winner_research_state where id='latest'));
$$;
revoke all on function public.winner_before_insert() from public,anon,authenticated;
revoke all on function public.winner_research_append(jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.winner_research_append(jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.winner_research_status() from public,anon,authenticated;
grant execute on function public.winner_research_status() to service_role;
reset lock_timeout;
